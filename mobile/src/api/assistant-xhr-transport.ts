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

/**
 * Session-scoped authority a stream joins instead of running its own grant:
 * the epoch snapshot fences the lane and one pre-frame 401 may share the
 * client-wide refresh flight.
 */
export interface XhrSessionAuthority {
  /** Current session epoch; a change retires every lane that started earlier. */
  epoch?(): number | undefined;
  /** Joins the shared single-flight refresh for a lane that started under `requestEpoch`. */
  refresh(requestEpoch: number | undefined): Promise<boolean>;
}

export interface XhrSseTransportOptions {
  baseUrl: string;
  getAccessToken: () => string | undefined;
  /** Same cancel call the turn orchestrator uses; the bearer and refresh rules stay with the caller. */
  cancelRequest: (clientRequestId: string) => Promise<unknown>;
  /** Shared session lane; without it the transport stays read-only on 401 like any HTTP failure. */
  session?: XhrSessionAuthority;
  createXhr?: () => XhrLike;
  clock?: AssistantClock;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseChars?: number;
  epochPollMs?: number;
}

interface QueueItem {
  events: AssistantStreamEvent[];
  error?: Error;
  end?: boolean;
}

const XHR_DONE = 4;
/** How often a live stream re-checks its session epoch; mirrors the client transfer watch. */
const DEFAULT_EPOCH_POLL_MS = 250;

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
  const epochPollMs = options.epochPollMs ?? DEFAULT_EPOCH_POLL_MS;
  const active = new Map<string, () => void>();

  return {
    async *stream(request, transportOptions = {}) {
      const signal = transportOptions.signal;
      if (signal?.aborted) return;

      const session = options.session;
      const startEpoch = session?.epoch?.();
      const epochChanged = () => startEpoch !== undefined && session?.epoch?.() !== startEpoch;

      let xhr: XhrLike | undefined;
      const validator = new AssistantEventValidator(request.clientRequestId);
      const parser = new SseFrameParser();
      const queue: QueueItem[] = [];
      let wake: (() => void) | undefined;
      let settled = false;
      let offset = 0;
      let frameSeen = false;
      let retriedUnauthorized = false;
      let idleTimer: unknown;
      let totalTimer: unknown;
      let epochTimer: unknown;

      const clearTimers = () => {
        if (idleTimer !== undefined) clock.clearTimeout(idleTimer);
        if (totalTimer !== undefined) clock.clearTimeout(totalTimer);
        if (epochTimer !== undefined) clock.clearTimeout(epochTimer);
        idleTimer = undefined;
        totalTimer = undefined;
        epochTimer = undefined;
      };
      const detach = (attempt: XhrLike) => {
        attempt.onprogress = null;
        attempt.onload = null;
        attempt.onerror = null;
        attempt.onabort = null;
        attempt.ontimeout = null;
      };
      const finish = (events: AssistantStreamEvent[], error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (xhr) detach(xhr);
        queue.push({ events, error, end: true });
        wake?.();
        wake = undefined;
        if (xhr && xhr.readyState !== XHR_DONE) {
          try {
            xhr.abort();
          } catch {
            // Aborting a finished request is a no-op on some runtimes.
          }
        }
      };
      /** The owning session was replaced: end as a failed terminal so nothing replays under it. */
      const sessionExpired = () => finish([{ type: 'error', code: 'SESSION_CHANGED', retryable: false }]);
      const armIdle = () => {
        if (idleTimer !== undefined) clock.clearTimeout(idleTimer);
        idleTimer = clock.setTimeout(() => finish([], lost('STREAM_IDLE_TIMEOUT')), idleMs);
      };
      const statusOk = (attempt: XhrLike) => attempt.status >= 200 && attempt.status < 300;
      const httpError = (attempt: XhrLike) => new AssistantStreamError(
        responseErrorCode(attempt.status, attempt.responseText ?? ''),
        {
          status: attempt.status,
          retryAfter: attempt.getResponseHeader('Retry-After'),
          retryable: attempt.status === 429 || attempt.status >= 500,
        },
      );

      /** Decode frames; events decoded before a violation are still delivered. */
      const consume = (frames: SseFrame[]): boolean => {
        if (epochChanged()) {
          sessionExpired();
          return true;
        }
        if (frames.length > 0) frameSeen = true;
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

      const readNewText = (attempt: XhrLike): boolean => {
        const text = attempt.responseText ?? '';
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

      /** One pre-frame 401 may join the shared refresh, then the same logical request is replayed. */
      const retryAfterRefresh = async (failed: XhrLike) => {
        detach(failed);
        let refreshed = false;
        try {
          refreshed = (await session?.refresh(startEpoch)) === true;
        } catch {
          // A failed grant keeps the original 401.
        }
        if (settled) return;
        if (epochChanged()) {
          sessionExpired();
          return;
        }
        if (!refreshed) {
          finish([], httpError(failed));
          return;
        }
        try {
          openAttempt();
        } catch {
          finish([], lost('STREAM_CONNECTION_LOST'));
        }
      };

      const onAttemptLoad = (attempt: XhrLike) => {
        if (settled) return;
        if (
          attempt.status === 401 && !retriedUnauthorized && !frameSeen && offset === 0
          && session?.refresh !== undefined && !epochChanged()
        ) {
          retriedUnauthorized = true;
          void retryAfterRefresh(attempt);
          return;
        }
        if (!statusOk(attempt)) {
          finish([], httpError(attempt));
          return;
        }
        if (readNewText(attempt) || consume(parser.finish())) return;
        try {
          validator.finish(request.clientRequestId);
        } catch (error) {
          finish([], error instanceof Error ? error : lost('STREAM_INCOMPLETE'));
        }
      };

      const traceId = requestId();
      const body = streamRequestBody(request);

      const openAttempt = () => {
        const attempt = createXhr();
        xhr = attempt;
        attempt.onprogress = () => {
          if (!settled && attempt === xhr && statusOk(attempt)) readNewText(attempt);
        };
        attempt.onload = () => {
          if (attempt === xhr) onAttemptLoad(attempt);
        };
        attempt.onerror = () => {
          if (attempt === xhr) finish([], lost('STREAM_CONNECTION_LOST'));
        };
        attempt.ontimeout = () => {
          if (attempt === xhr) finish([], lost('STREAM_CONNECTION_LOST'));
        };
        attempt.onabort = () => {
          if (attempt === xhr) finish([], lost('STREAM_CONNECTION_LOST'));
        };
        const token = getAccessToken();
        attempt.open('POST', streamUrl(baseUrl));
        attempt.timeout = 0;
        attempt.setRequestHeader('Accept', 'text/event-stream');
        attempt.setRequestHeader('Content-Type', 'application/json');
        attempt.setRequestHeader('X-Request-Id', traceId);
        if (token) attempt.setRequestHeader('Authorization', `Bearer ${token}`);
        armIdle();
        try {
          attempt.send(body);
        } catch {
          finish([], lost('STREAM_CONNECTION_LOST'));
        }
      };

      /** A quiet stream still dies with its epoch; the watch polls the shared clock. */
      const armEpochWatch = () => {
        if (session?.epoch === undefined || startEpoch === undefined) return;
        epochTimer = clock.setTimeout(() => {
          epochTimer = undefined;
          if (settled) return;
          if (epochChanged()) {
            sessionExpired();
            return;
          }
          armEpochWatch();
        }, epochPollMs);
      };

      const onCallerAbort = () => finish([]);
      active.set(request.clientRequestId, onCallerAbort);
      signal?.addEventListener('abort', onCallerAbort, { once: true });
      try {
        armEpochWatch();
        totalTimer = clock.setTimeout(() => finish([], lost('STREAM_TOTAL_TIMEOUT')), totalMs);
        openAttempt();

        while (true) {
          const item = queue.shift();
          if (!item) {
            await new Promise<void>((resolve) => { wake = resolve; });
            continue;
          }
          if (!item.end && epochChanged()) {
            sessionExpired();
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
