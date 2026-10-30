import {
  apiClient,
  type ApiClient,
  type AssistantConversation,
  type AssistantFeedbackRating,
  type AssistantFeedbackReason,
  type AssistantHistoryMessage,
  type AssistantPage,
  type AssistantReply,
} from './client';
import {
  createBufferedTransport,
  type AssistantChatRequest,
  type AssistantTransport,
  type BufferedAssistantReply,
} from './assistant-stream';
import {
  createXhrSseTransport,
  parseAssistantTransportKind,
  selectAssistantTransport,
  type AssistantTransportKind,
  type XhrSessionAuthority,
} from './assistant-xhr-transport';
import { ASSISTANT_CONVERSATION_PAGE_SIZE, ASSISTANT_MESSAGE_PAGE_SIZE } from './assistant-limits';

declare const process: { env: Record<string, string | undefined> };

export type AssistantScope = NonNullable<AssistantChatRequest['scope']>;

export interface AssistantPageOptions {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface AssistantConversationPageOptions extends AssistantPageOptions {
  /** Corpus filter; each surface lists only conversations created under its own corpus. */
  scope?: AssistantScope;
}

/** Wire reply: the server also sends `resetAt` for a quota-degraded turn. */
export type AssistantChatReply = AssistantReply & { resetAt?: string | null };

/**
 * Scope-aware assistant facade over the shared client. The server holds every
 * provider setting; nothing here carries a provider key or an internal URL.
 */
export function createAssistantApi(client: ApiClient) {
  const id = encodeURIComponent;

  async function page<T>(path: string, options: AssistantPageOptions): Promise<AssistantPage<T>> {
    const response = await client.requestWithMeta<T[] | { data: T[]; nextCursor?: string | null }>(path, {
      method: 'GET',
      signal: options.signal,
    });
    const rows = Array.isArray(response.data) ? response.data : response.data.data;
    const bodyCursor = Array.isArray(response.data) ? null : response.data.nextCursor ?? null;
    return { data: rows, nextCursor: response.headers.get('X-Next-Cursor') ?? bodyCursor };
  }

  return {
    chat: (request: AssistantChatRequest, init: { signal?: AbortSignal } = {}) =>
      client.post<AssistantChatReply>(
        '/assistant/chat',
        {
          message: request.message,
          locale: request.locale,
          clientRequestId: request.clientRequestId,
          ...(request.conversationId ? { conversationId: request.conversationId } : {}),
          ...(request.scope ? { scope: request.scope } : {}),
        },
        { signal: init.signal },
      ),

    conversationsPage: (options: AssistantConversationPageOptions = {}) => {
      const query = new URLSearchParams({ limit: String(options.limit ?? ASSISTANT_CONVERSATION_PAGE_SIZE) });
      if (options.cursor) query.set('cursor', options.cursor);
      if (options.scope) query.set('scope', options.scope);
      return page<AssistantConversation>(`/assistant/conversations?${query.toString()}`, options);
    },

    messagesPage: (conversationId: string, options: AssistantPageOptions = {}) => {
      const query = new URLSearchParams({ limit: String(options.limit ?? ASSISTANT_MESSAGE_PAGE_SIZE) });
      if (options.cursor) query.set('cursor', options.cursor);
      return page<AssistantHistoryMessage>(`/assistant/conversations/${id(conversationId)}/messages?${query.toString()}`, options);
    },

    deleteConversation: (conversationId: string) =>
      client.delete<void>(`/assistant/conversations/${id(conversationId)}`),

    /** 409 means the turn already committed; the caller reconciles with the same key. */
    cancel: (clientRequestId: string) =>
      client.post<void>(`/assistant/requests/${id(clientRequestId)}/cancel`, {}),

    putFeedback: (messageId: string, rating: AssistantFeedbackRating, reason?: AssistantFeedbackReason) =>
      client.put<void>(`/assistant/messages/${id(messageId)}/feedback`, { rating, ...(reason ? { reason } : {}) }),

    deleteFeedback: (messageId: string) =>
      client.delete<void>(`/assistant/messages/${id(messageId)}/feedback`),
  };
}

export type AssistantApi = ReturnType<typeof createAssistantApi>;

export const assistantApi: AssistantApi = createAssistantApi(apiClient);

/** Metro inlines only a literal `process.env.EXPO_PUBLIC_*` member access. */
export function configuredAssistantTransportKind(): AssistantTransportKind {
  return parseAssistantTransportKind(process.env.EXPO_PUBLIC_ASSISTANT_TRANSPORT);
}

/** The session store is resolved lazily so importing this module never loads native storage. */
function readAccessToken(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('../auth/mobile-session-store').sessionStore as { getAccessToken(): string | null };
    return store.getAccessToken() ?? undefined;
  } catch {
    return undefined;
  }
}

export interface AssistantRuntimeOptions {
  api?: AssistantApi;
  kind?: AssistantTransportKind;
  baseUrl?: string;
  getAccessToken?: () => string | undefined;
  /** Session lane the XHR stream joins for refresh and epoch fencing; defaults to the shared client. */
  session?: XhrSessionAuthority;
  /** Sees every JSON reply, for fields the stream events do not carry (`resetAt`). */
  onReply?: (request: AssistantChatRequest, reply: AssistantChatReply) => void;
}

export interface AssistantRuntime {
  transport: AssistantTransport;
  kind: AssistantTransportKind;
  /** Idempotent JSON call used by the turn orchestrator for same-key reconciliation. */
  chat: (request: AssistantChatRequest, init: { signal: AbortSignal }) => Promise<BufferedAssistantReply>;
}

/**
 * Buffered JSON is the default. `EXPO_PUBLIC_ASSISTANT_TRANSPORT=xhr-sse` opts a
 * build into the XHR stream; neither choice reads or flips
 * STREAMING_PARITY_VERIFIED, which stays the device-evidence gate.
 */
export function createAssistantRuntime(options: AssistantRuntimeOptions = {}): AssistantRuntime {
  const api = options.api ?? assistantApi;
  const kind = options.kind ?? configuredAssistantTransportKind();
  const chat = async (request: AssistantChatRequest, init: RequestInit = {}) => {
    const reply = await api.chat(request, { signal: init.signal ?? undefined });
    options.onReply?.(request, reply);
    return reply as unknown as BufferedAssistantReply;
  };
  const transport = selectAssistantTransport({
    kind,
    buffered: () => createBufferedTransport(chat, (clientRequestId) => api.cancel(clientRequestId)),
    xhr: () => createXhrSseTransport({
      baseUrl: options.baseUrl ?? apiClient.baseUrl,
      getAccessToken: options.getAccessToken ?? readAccessToken,
      cancelRequest: (clientRequestId) => api.cancel(clientRequestId),
      session: options.session ?? apiClient.session,
    }),
  });
  return { transport, kind, chat: (request, init) => chat(request, init) };
}
