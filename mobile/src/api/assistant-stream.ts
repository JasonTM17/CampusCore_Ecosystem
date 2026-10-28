import type { AssistantLocale } from './client';

export interface AssistantChatRequest {
  message: string;
  locale: AssistantLocale;
  clientRequestId: string;
  conversationId?: string;
  scope?: 'academic' | 'specialized';
}

export interface AssistantMetaEvent {
  type: 'meta';
  requestId: string;
  clientRequestId: string;
  turnId: string;
  conversationId: string;
  model: string;
  locale: AssistantLocale;
}

export interface AssistantDeltaEvent {
  type: 'delta';
  sequence: number;
  text: string;
  sourceIds: string[];
}

export interface AssistantReplaceEvent {
  type: 'replace';
  text: string;
  sourceIds: string[];
  reasonCode?: string;
}

export interface AssistantCitationEvent {
  type: 'citation';
  citation: Record<string, unknown> & { id?: string; sourceId?: string | null };
}

export interface AssistantDoneEvent {
  type: 'done';
  messageId: string;
  reasonCode: string;
  degraded: boolean;
  terminalStatus: string;
  resetAt: string | null;
}

export interface AssistantErrorEvent {
  type: 'error';
  code: string;
  retryable: boolean;
}

export type AssistantStreamEvent =
  | AssistantMetaEvent
  | AssistantDeltaEvent
  | AssistantReplaceEvent
  | AssistantCitationEvent
  | AssistantDoneEvent
  | AssistantErrorEvent;

export interface AssistantTransportOptions {
  signal?: AbortSignal;
}

export interface AssistantTransport {
  stream(
    request: AssistantChatRequest,
    options?: AssistantTransportOptions,
  ): AsyncIterable<AssistantStreamEvent>;
  cancel(clientRequestId: string): Promise<void>;
}

export interface AssistantStreamErrorOptions {
  status?: number;
  retryAfter?: string | null;
  retryable?: boolean;
  connectionLost?: boolean;
}

export class AssistantStreamError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryAfter: string | null;
  readonly retryable: boolean;
  readonly connectionLost: boolean;

  constructor(code: string, options: AssistantStreamErrorOptions = {}) {
    super(code);
    this.name = 'AssistantStreamError';
    this.code = code;
    this.status = options.status;
    this.retryAfter = options.retryAfter ?? null;
    this.retryable = options.retryable ?? false;
    this.connectionLost = options.connectionLost ?? false;
  }
}

export interface SseFrame {
  event?: string;
  data: string;
}

/** Incremental SSE framing; UTF-8 decoding is performed by the transport. */
export class SseFrameParser {
  private buffer = '';
  private eventName: string | undefined;
  private dataLines: string[] = [];

  push(text: string): SseFrame[] {
    this.buffer += text;
    return this.readLines(false);
  }

  finish(text = ''): SseFrame[] {
    this.buffer += text;
    const frames = this.readLines(true);
    const finalFrame = this.dispatch();
    if (finalFrame) frames.push(finalFrame);
    return frames;
  }

  private readLines(final: boolean): SseFrame[] {
    const frames: SseFrame[] = [];
    while (this.buffer.length > 0) {
      let end = -1;
      let endingLength = 0;
      for (let index = 0; index < this.buffer.length; index += 1) {
        const character = this.buffer[index];
        if (character === '\n') {
          end = index;
          endingLength = 1;
          break;
        }
        if (character === '\r') {
          if (index + 1 === this.buffer.length && !final) break;
          end = index;
          endingLength = this.buffer[index + 1] === '\n' ? 2 : 1;
          break;
        }
      }
      if (end < 0) {
        if (final && this.buffer.length > 0) {
          this.processLine(this.buffer, frames);
          this.buffer = '';
        }
        break;
      }
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + endingLength);
      this.processLine(line, frames);
    }
    return frames;
  }

  private processLine(line: string, frames: SseFrame[]): void {
    if (line === '') {
      const frame = this.dispatch();
      if (frame) frames.push(frame);
      return;
    }
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') {
      this.eventName = value || undefined;
    } else if (field === 'data') {
      this.dataLines.push(value);
    }
  }

  private dispatch(): SseFrame | undefined {
    if (this.dataLines.length === 0) {
      this.eventName = undefined;
      return undefined;
    }
    const frame = {
      ...(this.eventName ? { event: this.eventName } : {}),
      data: this.dataLines.join('\n'),
    };
    this.eventName = undefined;
    this.dataLines = [];
    return frame;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Order and shape checks shared by every SSE transport (fetch and XHR). */
export class AssistantEventValidator {
  private metaSeen = false;
  private lastSequence = -1;
  private bodySeen = false;
  private citationSeen = false;
  private terminalSeen = false;

  accept(value: unknown, eventName?: string): AssistantStreamEvent {
    if (!isObject(value) || typeof value.type !== 'string') {
      throw new AssistantStreamError('STREAM_INVALID_EVENT');
    }
    const event = value as unknown as AssistantStreamEvent;
    if (eventName && eventName !== event.type) {
      throw new AssistantStreamError('STREAM_EVENT_TYPE_MISMATCH');
    }
    if (this.terminalSeen) {
      throw new AssistantStreamError('STREAM_EVENT_AFTER_TERMINAL');
    }

    switch (event.type) {
      case 'meta':
        if (
          this.metaSeen || this.bodySeen || this.citationSeen
          || !['requestId', 'clientRequestId', 'turnId', 'conversationId', 'model']
            .every((key) => typeof value[key] === 'string')
          || !['en', 'vi'].includes(String(value.locale))
        ) {
          throw new AssistantStreamError('STREAM_EVENT_ORDER_INVALID');
        }
        this.metaSeen = true;
        break;
      case 'delta':
        if (
          !this.metaSeen || this.citationSeen || !Number.isInteger(value.sequence)
          || (value.sequence as number) <= this.lastSequence
          || typeof value.text !== 'string' || !isStringArray(value.sourceIds)
        ) {
          throw new AssistantStreamError('STREAM_EVENT_ORDER_INVALID');
        }
        this.lastSequence = value.sequence as number;
        this.bodySeen = true;
        break;
      case 'replace':
        if (
          !this.metaSeen || this.citationSeen || typeof value.text !== 'string'
          || !isStringArray(value.sourceIds)
          || (value.reasonCode !== undefined && typeof value.reasonCode !== 'string')
        ) {
          throw new AssistantStreamError('STREAM_EVENT_ORDER_INVALID');
        }
        this.bodySeen = true;
        break;
      case 'citation':
        if (!this.metaSeen || !this.bodySeen || !isObject(value.citation)) {
          throw new AssistantStreamError('STREAM_EVENT_ORDER_INVALID');
        }
        this.citationSeen = true;
        break;
      case 'done':
        if (
          !this.metaSeen || !this.bodySeen || typeof value.messageId !== 'string'
          || typeof value.reasonCode !== 'string' || typeof value.degraded !== 'boolean'
          || typeof value.terminalStatus !== 'string'
          || !(value.resetAt === null || typeof value.resetAt === 'string')
        ) {
          throw new AssistantStreamError('STREAM_EVENT_ORDER_INVALID');
        }
        this.terminalSeen = true;
        break;
      case 'error':
        if (typeof value.code !== 'string' || typeof value.retryable !== 'boolean') {
          throw new AssistantStreamError('STREAM_INVALID_EVENT');
        }
        this.terminalSeen = true;
        break;
      default:
        throw new AssistantStreamError('STREAM_UNKNOWN_EVENT');
    }
    return event;
  }

  finish(clientRequestId: string): void {
    if (!this.terminalSeen) {
      throw new AssistantStreamError('STREAM_INCOMPLETE', {
        retryable: true,
        connectionLost: true,
      });
    }
    void clientRequestId;
  }
}

export interface SseTransportOptions {
  fetchImpl: typeof fetch;
  baseUrl: string;
  getAccessToken: () => string | undefined;
  cancelRequest?: (clientRequestId: string) => Promise<unknown>;
}

/** Decode one SSE frame into a validated event; malformed frames never reach UI state. */
export function decodeSseFrame(frame: SseFrame, validator: AssistantEventValidator): AssistantStreamEvent {
  let data: unknown;
  try {
    data = JSON.parse(frame.data);
  } catch {
    throw new AssistantStreamError('STREAM_INVALID_JSON');
  }
  return validator.accept(data, frame.event);
}

const cancelFallbackCode: Record<number, string> = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  429: 'RATE_LIMITED',
  503: 'ASSISTANT_RLS_UNAVAILABLE',
};

export function responseErrorCode(status: number, bodyText: string): string {
  try {
    const body: unknown = JSON.parse(bodyText);
    if (isObject(body) && typeof body.code === 'string') return body.code;
  } catch {
    // The server may return a plain error body; never expose it to callers.
  }
  return cancelFallbackCode[status] ?? 'HTTP_ERROR';
}

export function requestId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** JSON body shared by every streaming transport. */
export function streamRequestBody(request: AssistantChatRequest): string {
  return JSON.stringify({
    message: request.message,
    locale: request.locale,
    clientRequestId: request.clientRequestId,
    ...(request.conversationId ? { conversationId: request.conversationId } : {}),
    ...(request.scope ? { scope: request.scope } : {}),
  });
}

export function streamUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/assistant/chat/stream`;
}

function cancellationUrl(baseUrl: string, clientRequestId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/assistant/requests/${encodeURIComponent(clientRequestId)}/cancel`;
}

export function createSseTransport(options: SseTransportOptions): AssistantTransport {
  const activeRequests = new Map<string, {
    controller: AbortController;
    reader?: ReadableStreamDefaultReader<Uint8Array>;
  }>();
  const { fetchImpl, baseUrl, getAccessToken, cancelRequest } = options;

  return {
    async *stream(request, transportOptions = {}) {
      const controller = new AbortController();
      const activeRequest: {
        controller: AbortController;
        reader?: ReadableStreamDefaultReader<Uint8Array>;
      } = { controller };
      activeRequests.set(request.clientRequestId, activeRequest);
      const externalSignal = transportOptions.signal;
      const abortFromCaller = () => {
        controller.abort();
        void activeRequest.reader?.cancel().catch(() => undefined);
      };
      if (externalSignal?.aborted) controller.abort();
      else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });

      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let terminal = false;
      const validator = new AssistantEventValidator();
      const parser = new SseFrameParser();
      const decoder = new TextDecoder();

      const readFrames = (frames: SseFrame[]): AssistantStreamEvent[] => frames.map((frame) => {
        const event = decodeSseFrame(frame, validator);
        if (event.type === 'error' || event.type === 'done') terminal = true;
        return event;
      });

      try {
        const token = getAccessToken();
        const headers = new Headers({
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          'X-Request-Id': requestId(),
        });
        if (token) headers.set('Authorization', `Bearer ${token}`);

        let response: Response;
        try {
          response = await fetchImpl(streamUrl(baseUrl), {
            method: 'POST',
            headers,
            body: streamRequestBody(request),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          throw new AssistantStreamError('STREAM_CONNECTION_LOST', {
            retryable: true,
            connectionLost: true,
          });
        }

        if (!response.ok) {
          let bodyText = '';
          try {
            bodyText = await response.text();
          } catch {
            // Keep the status as the only source of error information.
          }
          const status = response.status;
          throw new AssistantStreamError(responseErrorCode(status, bodyText), {
            status,
            retryAfter: response.headers.get('Retry-After'),
            retryable: status === 429 || status >= 500,
          });
        }

        if (!response.body || typeof response.body.getReader !== 'function') {
          throw new AssistantStreamError('STREAMING_UNSUPPORTED');
        }

        reader = response.body.getReader();
        activeRequest.reader = reader;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const text = decoder.decode(chunk.value, { stream: true });
          for (const event of readFrames(parser.push(text))) yield event;
        }
        const tail = decoder.decode();
        for (const event of readFrames(parser.finish(tail))) yield event;
        validator.finish(request.clientRequestId);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof AssistantStreamError) throw error;
        throw new AssistantStreamError(
          terminal ? 'STREAM_READ_FAILED' : 'STREAM_CONNECTION_LOST',
          { retryable: true, connectionLost: !terminal },
        );
      } finally {
        externalSignal?.removeEventListener('abort', abortFromCaller);
        if (reader) {
          try {
            reader.releaseLock();
          } catch {
            // A consumed or cancelled reader may already have released its lock.
          }
        }
        if (activeRequests.get(request.clientRequestId) === activeRequest) {
          activeRequests.delete(request.clientRequestId);
        }
      }
    },

    async cancel(clientRequestId) {
      const activeRequest = activeRequests.get(clientRequestId);
      activeRequest?.controller.abort();
      void activeRequest?.reader?.cancel().catch(() => undefined);
      if (cancelRequest) {
        await cancelRequest(clientRequestId);
        return;
      }
      const token = getAccessToken();
      const headers = new Headers({ Accept: 'application/json', 'X-Request-Id': requestId() });
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await fetchImpl(cancellationUrl(baseUrl, clientRequestId), {
        method: 'POST',
        headers,
      });
      if (!response.ok) {
        throw new AssistantStreamError(responseErrorCode(response.status, ''), {
          status: response.status,
          retryAfter: response.headers.get('Retry-After'),
          retryable: response.status === 429 || response.status >= 500,
        });
      }
    },
  };
}

export interface BufferedAssistantReply {
  answer: string;
  model: string;
  degraded: boolean;
  reasonCode: string;
  locale: AssistantLocale;
  citations: Array<Record<string, unknown> & { id?: string; sourceId?: string | null }>;
  conversationId?: string | null;
  messageId?: string | null;
  requestId?: string | null;
  clientRequestId?: string | null;
  turnId?: string | null;
  terminalStatus?: string | null;
}

export type BufferedAssistantChat = (
  request: AssistantChatRequest,
  init?: RequestInit,
) => Promise<BufferedAssistantReply>;

/** Meta, body, citations and terminal for a JSON reply; `replace` overwrites any partial stream text. */
export function* bufferedReplyEvents(
  reply: BufferedAssistantReply,
  request: AssistantChatRequest,
  options: { replaceBody?: boolean } = {},
): Generator<AssistantStreamEvent> {
  const id = request.clientRequestId;
  const sourceIds = reply.citations
    .map((citation) => citation.sourceId)
    .filter((sourceId): sourceId is string => typeof sourceId === 'string');
  yield {
    type: 'meta',
    requestId: reply.requestId || id,
    clientRequestId: reply.clientRequestId || id,
    turnId: reply.turnId || id,
    conversationId: reply.conversationId || request.conversationId || id,
    model: reply.model,
    locale: reply.locale || request.locale,
  };
  yield options.replaceBody
    ? { type: 'replace', text: reply.answer, sourceIds }
    : { type: 'delta', sequence: 0, text: reply.answer, sourceIds };
  for (const citation of reply.citations) yield { type: 'citation', citation };
  yield {
    type: 'done',
    messageId: reply.messageId || id,
    reasonCode: reply.reasonCode,
    degraded: reply.degraded,
    terminalStatus: reply.terminalStatus || 'COMPLETED',
    resetAt: null,
  };
}

function bufferedError(error: unknown): AssistantErrorEvent {
  const value = error as { code?: unknown; status?: unknown; retryable?: unknown };
  const status = typeof value?.status === 'number' ? value.status : 0;
  const code = typeof value?.code === 'string'
    ? value.code
    : error instanceof TypeError ? 'STREAM_CONNECTION_LOST' : 'ASSISTANT_UNAVAILABLE';
  return {
    type: 'error',
    code,
    retryable: typeof value?.retryable === 'boolean'
      ? value.retryable
      : status === 0 || status === 429 || status >= 500,
  };
}

export function createBufferedTransport(
  callBufferedChat: BufferedAssistantChat,
  cancelRequest?: (clientRequestId: string) => Promise<unknown>,
): AssistantTransport {
  const activeControllers = new Map<string, AbortController>();
  return {
    async *stream(request, transportOptions = {}) {
      const controller = new AbortController();
      activeControllers.set(request.clientRequestId, controller);
      const externalSignal = transportOptions.signal;
      const abortFromCaller = () => controller.abort();
      if (externalSignal?.aborted) controller.abort();
      else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
      try {
        const reply = await callBufferedChat(request, { signal: controller.signal });
        if (controller.signal.aborted) return;
        yield* bufferedReplyEvents(reply, request);
      } catch (error) {
        if (!controller.signal.aborted) yield bufferedError(error);
      } finally {
        externalSignal?.removeEventListener('abort', abortFromCaller);
        if (activeControllers.get(request.clientRequestId) === controller) {
          activeControllers.delete(request.clientRequestId);
        }
      }
    },
    async cancel(clientRequestId) {
      activeControllers.get(clientRequestId)?.abort();
      await cancelRequest?.(clientRequestId);
    },
  };
}

/** UI must not claim parity while false; flip only after the M07 dev-build runtime canary. */
export const STREAMING_PARITY_VERIFIED = false;

/** Same-request resubmission is safe only after an unconfirmed connection loss. */
export function canResubmitSameRequest(state: {
  phase: string;
  clientRequestId: string | null;
  connectionLost: boolean;
  terminalStatus: string | null;
}): boolean {
  return state.phase === 'error'
    && state.connectionLost
    && state.terminalStatus === null
    && Boolean(state.clientRequestId);
}
