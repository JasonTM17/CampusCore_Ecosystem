import {
  AssistantEventValidator,
  AssistantStreamError,
  SseFrameParser,
  decodeSseFrame,
  requestId,
  responseErrorCode,
  streamRequestBody,
  streamUrl,
} from './assistant-stream';
import type {
  AssistantStreamEvent,
  AssistantTransport,
  SseFrame,
} from './assistant-stream';
import {
  ASSISTANT_STREAM_IDLE_TIMEOUT_MS,
  ASSISTANT_STREAM_MAX_RESPONSE_CHARS,
  ASSISTANT_STREAM_TOTAL_TIMEOUT_MS,
  systemAssistantClock,
} from './assistant-limits';
import type { AssistantClock } from './assistant-limits';

/** The subset of XMLHttpRequest the transport needs; React Native and the test double both fit. */
export interface XhrLike {
  readyState: number;
  status: number;
  responseText: string;
  timeout: number;
  onprogress: (() => void) | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  getResponseHeader(name: string): string | null;
  send(body: string): void;
  abort(): void;
}

export interface XhrSseTransportOptions {
  baseUrl: string;
  getAccessToken: () => string | undefined;
  /** Same cancel call the turn orchestrator uses; the bearer and refresh rules stay with the caller. */
  cancelRequest: (clientRequestId: string) => Promise<unknown>;
  createXhr?: () => XhrLike;
  clock?: AssistantClock;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseChars?: number;
}

interface QueueItem {
  events: AssistantStreamEvent[];
  error?: Error;
  end?: boolean;
}

const XHR_DONE = 4;

function lost(code: string): AssistantStreamError {
  return new AssistantStreamError(code, { retryable: true, connectionLost: true });
}

/** Text deltas and citations prove progress; meta, heartbeats and empty deltas do not. */
function isUsefulEvent(event: AssistantStreamEvent): boolean {
  if (event.type === 'citation') return true;
  return (event.type === 'delta' || event.type === 'replace') && event.text.trim().length > 0;
}

/**
 * Incremental SSE over XMLHttpRequest. React Native's fetch has no streaming body,
 * but XHR `onprogress` appends decoded text to `responseText`. Only the new tail is
 * fed to the shared frame parser. React Native decodes UTF-8 natively, so the JS side
 * never sees a half byte sequence; the parser buffers partial lines and UTF-16 pairs.
 */
export function createXhrSseTransport(options: XhrSseTransportOptions): AssistantTransport {
  const { baseUrl, getAccessToken, cancelRequest } = options;
  const createXhr = options.createXhr ?? (() => new XMLHttpRequest() as unknown as XhrLike);
  const clock = options.clock ?? systemAssistantClock;
  const idleMs = options.idleTimeoutMs ?? ASSISTANT_STREAM_IDLE_TIMEOUT_MS;
  const totalMs = options.totalTimeoutMs ?? ASSISTANT_STREAM_TOTAL_TIMEOUT_MS;
  const maxChars = options.maxResponseChars ?? ASSISTANT_STREAM_MAX_RESPONSE_CHARS;
  const active = new Map<string, () => void>();

  return {
    async *stream(request, transportOptions = {}) {
      const signal = transportOptions.signal;
      if (signal?.aborted) return;

      const xhr = createXhr();
      const validator = new AssistantEventValidator();
      const parser = new SseFrameParser();
      const queue: QueueItem[] = [];
      let wake: (() => void) | undefined;
      let settled = false;
      let offset = 0;
      let idleTimer: unknown;
      let totalTimer: unknown;

      const clearTimers = () => {
        if (idleTimer !== undefined) clock.clearTimeout(idleTimer);
        if (totalTimer !== undefined) clock.clearTimeout(totalTimer);
        idleTimer = undefined;
        totalTimer = undefined;
      };
      const detach = () => {
        xhr.onprogress = null;
        xhr.onload = null;
        xhr.onerror = null;
        xhr.onabort = null;
        xhr.ontimeout = null;
      };
      const finish = (events: AssistantStreamEvent[], error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimers();
        detach();
        queue.push({ events, error, end: true });
        wake?.();
        wake = undefined;
        if (xhr.readyState !== XHR_DONE) {
          try {
            xhr.abort();
          } catch {
            // Aborting a finished request is a no-op on some runtimes.
          }
        }
      };
      const armIdle = () => {
        if (idleTimer !== undefined) clock.clearTimeout(idleTimer);
        idleTimer = clock.setTimeout(() => finish([], lost('STREAM_IDLE_TIMEOUT')), idleMs);
      };
      const statusOk = () => xhr.status >= 200 && xhr.status < 300;

      /** Decode frames; events decoded before a violation are still delivered. */
      const consume = (frames: SseFrame[]): boolean => {
        const events: AssistantStreamEvent[] = [];
        let failure: Error | undefined;
        try {
          for (const frame of frames) events.push(decodeSseFrame(frame, validator));
        } catch (error) {
          failure = error instanceof Error ? error : lost('STREAM_CONNECTION_LOST');
        }
        if (events.some(isUsefulEvent)) armIdle();
        const terminal = events.some((event) => event.type === 'done' || event.type === 'error');
        if (failure || terminal) {
          finish(events, failure);
          return true;
        }
        if (events.length > 0) {
          queue.push({ events });
          wake?.();
          wake = undefined;
        }
        return false;
      };

      const readNewText = (): boolean => {
        const text = xhr.responseText ?? '';
        if (text.length > maxChars) {
          finish([], lost('STREAM_RESPONSE_TOO_LARGE'));
          return true;
        }
        if (text.length < offset) {
          finish([], lost('STREAM_RESPONSE_RESET'));
          return true;
        }
        if (text.length === offset) return false;
        const chunk = text.slice(offset);
        offset = text.length;
        return consume(parser.push(chunk));
      };

      xhr.onprogress = () => {
        if (!settled && statusOk()) readNewText();
      };
      xhr.onload = () => {
        if (settled) return;
        if (!statusOk()) {
          const status = xhr.status;
          finish([], new AssistantStreamError(responseErrorCode(status, xhr.responseText ?? ''), {
            status,
            retryAfter: xhr.getResponseHeader('Retry-After'),
            retryable: status === 429 || status >= 500,
          }));
          return;
        }
        if (readNewText() || consume(parser.finish())) return;
        try {
          validator.finish(request.clientRequestId);
        } catch (error) {
          finish([], error instanceof Error ? error : lost('STREAM_INCOMPLETE'));
        }
      };
      xhr.onerror = () => finish([], lost('STREAM_CONNECTION_LOST'));
      xhr.ontimeout = () => finish([], lost('STREAM_CONNECTION_LOST'));
      xhr.onabort = () => finish([], lost('STREAM_CONNECTION_LOST'));

      const onCallerAbort = () => finish([]);
      active.set(request.clientRequestId, onCallerAbort);
      signal?.addEventListener('abort', onCallerAbort, { once: true });
      try {
        const token = getAccessToken();
        xhr.open('POST', streamUrl(baseUrl));
        xhr.timeout = 0;
        xhr.setRequestHeader('Accept', 'text/event-stream');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-Request-Id', requestId());
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        armIdle();
        totalTimer = clock.setTimeout(() => finish([], lost('STREAM_TOTAL_TIMEOUT')), totalMs);
        try {
          xhr.send(streamRequestBody(request));
        } catch {
          finish([], lost('STREAM_CONNECTION_LOST'));
        }

        while (true) {
          const item = queue.shift();
          if (!item) {
            await new Promise<void>((resolve) => { wake = resolve; });
            continue;
          }
          for (const event of item.events) yield event;
          if (item.error) throw item.error;
          if (item.end) return;
        }
      } finally {
        signal?.removeEventListener('abort', onCallerAbort);
        if (active.get(request.clientRequestId) === onCallerAbort) {
          active.delete(request.clientRequestId);
        }
        finish([]);
      }
    },

    async cancel(clientRequestId) {
      active.get(clientRequestId)?.();
      await cancelRequest(clientRequestId);
    },
  };
}

export type AssistantTransportKind = 'buffered' | 'xhr-sse';

/** Only the exact value `xhr-sse` opts in; anything else keeps the buffered default. */
export function parseAssistantTransportKind(value: string | undefined): AssistantTransportKind {
  return value === 'xhr-sse' ? 'xhr-sse' : 'buffered';
}

/**
 * Explicit canary switch. It never reads or flips STREAMING_PARITY_VERIFIED: the
 * confirmation constant stays the device-evidence gate, not a transport selector.
 */
export function selectAssistantTransport(input: {
  kind: AssistantTransportKind;
  buffered: () => AssistantTransport;
  xhr: () => AssistantTransport;
}): AssistantTransport {
  return input.kind === 'xhr-sse' ? input.xhr() : input.buffered();
}
