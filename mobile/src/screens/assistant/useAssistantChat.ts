import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  apiClient,
  createAssistantClientRequestId,
  type AssistantCitation,
  type AssistantConversation,
  type AssistantFeedbackRating,
  type AssistantFeedbackReason,
  type AssistantHistoryMessage,
} from '../../api/client';
import { assistantApi, createAssistantRuntime, type AssistantScope } from '../../api/assistant-api';
import { ASSISTANT_USER_DAILY_QUOTA } from '../../api/assistant-limits';
import {
  assistantStreamReducer,
  initialAssistantStreamState,
  selectAssistantStreamView,
} from '../../api/assistant-stream-state';
import { inspectAssistantInput } from '../../assistant/assistant-input-guard';
import { isAssistantOutputSafe, sanitizeAssistantOutput } from '../../assistant/assistant-output-guard';
import {
  classifyFailure,
  guardNoticeKey,
  liveVisibleText,
  resolveConversationId,
  safeText,
  type FailureKind,
  type GuardNoticeKey,
} from '../../assistant/chat-helpers';
import { consumeAssistantEntryScope, peekAssistantEntryScope } from '../../assistant/entry-scope';
import { createTurnAccumulator } from '../../assistant/turn-accumulator';
import { createTurnOrchestrator, type SendResult, type TurnOutcome } from '../../assistant/turn-orchestrator';
import { useLocale } from '../../i18n/locale-provider';
import { assistantChatMessages } from '../../i18n/assistant-messages';

export interface MessageFeedback {
  rating: AssistantFeedbackRating;
  reason?: AssistantFeedbackReason;
}

export interface ChatMessage {
  id: string;
  from: 'assistant' | 'student';
  text: string;
  citations?: AssistantCitation[];
  degraded?: boolean;
  reasonCode?: string | null;
  feedback?: MessageFeedback | null;
  /** True for text produced on the device (stop notice, preview echo); never rated. */
  local?: boolean;
  /** The answer was replaced by the output guard. */
  blocked?: boolean;
}

export interface ChatFailure {
  kind: FailureKind;
  code?: string;
  /** True when the same clientRequestId may be sent again without creating a second turn. */
  resubmittable: boolean;
}

export interface HistoryState {
  open: boolean;
  items: AssistantConversation[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  loaded: boolean;
}

const emptyHistory: HistoryState = { open: false, items: [], nextCursor: null, loading: false, loadingMore: false, error: false, loaded: false };

function toChatMessage(message: AssistantHistoryMessage, fallbackBlocked: string, locale: 'vi' | 'en', scope: AssistantScope): ChatMessage {
  const from = message.role.toLowerCase() === 'user' ? 'student' : 'assistant';
  const raw = safeText(message.content);
  const blocked = from === 'assistant' && !isAssistantOutputSafe(raw, scope);
  return {
    id: message.id,
    from,
    text: from === 'assistant' ? sanitizeAssistantOutput(raw, fallbackBlocked, locale, scope) : raw,
    citations: message.citations,
    degraded: message.degraded,
    reasonCode: message.reasonCode,
    feedback: message.feedback ? { rating: message.feedback } : null,
    blocked,
  };
}

/**
 * Chat state for the assistant screen. One turn orchestrator owns the lock, the
 * clientRequestId, cancel and same-key reconciliation; this hook only renders
 * its outcome and guards what enters and leaves the composer.
 */
export function useAssistantChat() {
  const { locale, formatDateTime } = useLocale();
  const copy = assistantChatMessages[locale];
  const isPreview = apiClient.mode === 'preview';

  const [scope, setScopeState] = useState<AssistantScope>(() => peekAssistantEntryScope() ?? 'academic');
  useEffect(() => { consumeAssistantEntryScope(); }, []);

  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [earlierCursor, setEarlierCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [notice, setNotice] = useState<GuardNoticeKey | null>(null);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [quotaResetAt, setQuotaResetAt] = useState<{ at: string | null } | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [feedbackBusyId, setFeedbackBusyId] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState(false);
  const [history, setHistory] = useState<HistoryState>(emptyHistory);
  const [streamState, dispatchStream] = useReducer(assistantStreamReducer, initialAssistantStreamState);
  const stream = selectAssistantStreamView(streamState);

  const accumulator = useMemo(() => createTurnAccumulator(), []);
  const resetAtByRequest = useRef(new Map<string, string | null>());
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const lastTextRef = useRef('');
  const optimisticIdRef = useRef<string | null>(null);
  const historySeq = useRef(0);
  const selectionSeq = useRef(0);
  const localCounter = useRef(0);

  const runtime = useMemo(
    () => (isPreview
      ? null
      : createAssistantRuntime({
        api: assistantApi,
        onReply: (request, reply) => { resetAtByRequest.current.set(request.clientRequestId, reply.resetAt ?? null); },
      })),
    [isPreview],
  );

  const commitRef = useRef<(outcome: TurnOutcome) => void>(() => undefined);
  const orchestrator = useMemo(() => {
    if (!runtime) return null;
    return createTurnOrchestrator({
      stream: (request, options) => runtime.transport.stream(request, options),
      chat: runtime.chat,
      cancelRequest: (clientRequestId) => assistantApi.cancel(clientRequestId),
      dispatch: (action) => {
        accumulator.apply(action);
        dispatchStream(action);
      },
      createClientRequestId: createAssistantClientRequestId,
      onSettled: (outcome) => commitRef.current(outcome),
    });
  }, [runtime, accumulator]);

  const nextLocalId = (prefix: string) => `local-${prefix}-${++localCounter.current}`;

  const refreshHistory = useCallback(async (targetScope: AssistantScope, more: boolean, cursor: string | null) => {
    if (isPreview) return;
    const seq = ++historySeq.current;
    setHistory((current) => ({ ...current, loading: !more, loadingMore: more, error: false }));
    try {
      const page = await assistantApi.conversationsPage({ scope: targetScope, cursor: more && cursor ? cursor : undefined });
      if (seq !== historySeq.current) return;
      setHistory((current) => ({
        ...current,
        items: more ? [...current.items, ...page.data] : page.data,
        nextCursor: page.nextCursor ?? null,
        loading: false,
        loadingMore: false,
        loaded: true,
      }));
    } catch {
      if (seq !== historySeq.current) return;
      setHistory((current) => ({ ...current, loading: false, loadingMore: false, error: true }));
    }
  }, [isPreview]);

  commitRef.current = (outcome) => {
    const snapshot = accumulator.snapshot();
    const currentCopy = copyRef.current;
    const currentScope = scopeRef.current;
    const safe = isAssistantOutputSafe(snapshot.answer, currentScope);
    const text = sanitizeAssistantOutput(safeText(snapshot.answer), currentCopy.outputBlocked, localeRef.current, currentScope);
    const done = snapshot.done;
    const messageId = done?.messageId && done.messageId !== outcome.clientRequestId ? done.messageId : null;
    setMessages((current) => [...current, {
      id: messageId ?? nextLocalId('assistant'),
      from: 'assistant',
      text: text || currentCopy.knowledgeUnavailable,
      citations: snapshot.citations as unknown as AssistantCitation[],
      degraded: done?.degraded,
      reasonCode: done?.reasonCode ?? null,
      local: messageId === null,
      blocked: !safe,
    }]);
    const resolved = resolveConversationId(snapshot.meta?.conversationId, outcome.clientRequestId, conversationIdRef.current);
    if (resolved) setConversationId(resolved);
    setFailure(null);
    setReconciling(false);
    if (done?.reasonCode === 'QUOTA_EXCEEDED') {
      setQuotaResetAt({ at: done.resetAt ?? resetAtByRequest.current.get(outcome.clientRequestId) ?? null });
    } else {
      setQuotaResetAt(null);
    }
    resetAtByRequest.current.delete(outcome.clientRequestId);
    optimisticIdRef.current = null;
    if (history.loaded || history.open) void refreshHistory(currentScope, false, null);
  };

  const settle = useCallback((result: SendResult, text: string) => {
    if (!('clientRequestId' in result)) return;
    if (result.status === 'failed') {
      const snapshot = accumulator.snapshot();
      const code = snapshot.error?.code;
      const kind = classifyFailure(code, snapshot.connectionLost);
      setFailure({ kind, code, resubmittable: result.resubmittable });
      if (!result.resubmittable) {
        // A definitive failure created no answer: return the text to the composer and drop the echo.
        const echo = optimisticIdRef.current;
        if (echo) setMessages((current) => current.filter((item) => item.id !== echo));
        setDraft((current) => current || text);
      }
      optimisticIdRef.current = null;
    }
    setReconciling(false);
  }, [accumulator]);

  const send = useCallback(async () => {
    const guard = inspectAssistantInput(draft);
    const text = safeText(guard.normalizedMessage, 2_000);
    if (!text) return;
    if (!guard.allowed) {
      setNotice(guardNoticeKey(guard.reasonCode));
      return;
    }
    setNotice(null);
    setFailure(null);
    setFeedbackError(false);
    if (isPreview || !orchestrator) {
      setMessages((current) => [
        ...current,
        { id: nextLocalId('user'), from: 'student', text },
        { id: nextLocalId('preview'), from: 'assistant', text: copy.previewReply, local: true, reasonCode: 'PREVIEW' },
      ]);
      setDraft('');
      return;
    }
    if (orchestrator.isBusy()) return;
    lastTextRef.current = text;
    const echoId = nextLocalId('user');
    optimisticIdRef.current = echoId;
    setMessages((current) => [...current, { id: echoId, from: 'student', text }]);
    setDraft('');
    const result = await orchestrator.send({
      message: text,
      locale,
      scope,
      ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
    });
    if (result.status === 'busy' || result.status === 'empty' || result.status === 'too-long') {
      setMessages((current) => current.filter((item) => item.id !== echoId));
      setDraft((current) => current || text);
      return;
    }
    settle(result, text);
  }, [copy.previewReply, draft, isPreview, locale, orchestrator, scope, settle]);

  const retry = useCallback(async () => {
    if (!orchestrator) return;
    setFailure(null);
    const result = await orchestrator.retry();
    settle(result, lastTextRef.current);
  }, [orchestrator, settle]);

  const stop = useCallback(async () => {
    if (!orchestrator) return;
    const result = await orchestrator.cancel();
    if (result.status === 'cancelled') {
      setMessages((current) => [...current, {
        id: nextLocalId('stopped'), from: 'assistant', text: copyRef.current.stoppedMessage, degraded: true, reasonCode: 'CANCELLED', local: true,
      }]);
      setDraft((current) => current || lastTextRef.current);
      optimisticIdRef.current = null;
    } else if (result.status === 'cas-pending') {
      setReconciling(true);
    }
  }, [orchestrator]);

  /** Aborts any generation locally and on the server; the reducer is released so the UI never stays busy. */
  const abandonTurn = useCallback(() => {
    orchestrator?.dispose();
    dispatchStream({ type: 'cancel' });
    accumulator.reset();
    optimisticIdRef.current = null;
    setReconciling(false);
  }, [accumulator, orchestrator]);

  const clearThread = useCallback(() => {
    selectionSeq.current += 1;
    abandonTurn();
    setMessages([]);
    setConversationId(undefined);
    setEarlierCursor(null);
    setLoadingEarlier(false);
    setFailure(null);
    setNotice(null);
    setQuotaResetAt(null);
    setFeedbackError(false);
  }, [abandonTurn]);

  const changeScope = useCallback((next: AssistantScope) => {
    if (next === scopeRef.current) return;
    clearThread();
    scopeRef.current = next;
    setScopeState(next);
    historySeq.current += 1;
    setHistory((current) => ({ ...emptyHistory, open: current.open }));
  }, [clearThread]);

  useEffect(() => {
    if (history.open && !history.loaded && !history.loading && !history.error) void refreshHistory(scope, false, null);
  }, [history.open, history.loaded, history.loading, history.error, refreshHistory, scope]);

  useEffect(() => () => { selectionSeq.current += 1; orchestrator?.dispose(); }, [orchestrator]);

  const setHistoryOpen = useCallback((open: boolean) => setHistory((current) => ({ ...current, open })), []);

  const selectConversation = useCallback(async (conversation: AssistantConversation) => {
    clearThread();
    const seq = ++selectionSeq.current;
    const owner = scopeRef.current;
    setHistory((current) => ({ ...current, open: false }));
    if (isPreview) return;
    try {
      const page = await assistantApi.messagesPage(conversation.id);
      if (seq !== selectionSeq.current || scopeRef.current !== owner) return;
      setConversationId(conversation.id);
      setMessages(page.data.map((item) => toChatMessage(item, copyRef.current.outputBlocked, localeRef.current, scopeRef.current)));
      setEarlierCursor(page.nextCursor ?? null);
    } catch {
      if (seq !== selectionSeq.current || scopeRef.current !== owner) return;
      setHistory((current) => ({ ...current, error: true }));
    }
  }, [clearThread, isPreview]);

  const loadEarlier = useCallback(async () => {
    const id = conversationIdRef.current;
    if (!id || !earlierCursor || loadingEarlier) return;
    const seq = selectionSeq.current;
    const selected = () => seq === selectionSeq.current && conversationIdRef.current === id;
    setLoadingEarlier(true);
    try {
      const page = await assistantApi.messagesPage(id, { cursor: earlierCursor });
      if (!selected()) return;
      setMessages((current) => [
        ...page.data.map((item) => toChatMessage(item, copyRef.current.outputBlocked, localeRef.current, scopeRef.current)),
        ...current,
      ]);
      setEarlierCursor(page.nextCursor ?? null);
    } catch {
      if (selected()) setFailure({ kind: 'generic', resubmittable: false });
    } finally {
      if (selected()) setLoadingEarlier(false);
    }
  }, [earlierCursor, loadingEarlier]);

  const deleteConversation = useCallback(async (conversation: AssistantConversation) => {
    try {
      await assistantApi.deleteConversation(conversation.id);
      setHistory((current) => ({ ...current, items: current.items.filter((item) => item.id !== conversation.id) }));
      if (conversation.id === conversationIdRef.current) clearThread();
    } catch {
      setHistory((current) => ({ ...current, error: true }));
    }
  }, [clearThread]);

  const rate = useCallback(async (messageId: string, rating: AssistantFeedbackRating, reason?: AssistantFeedbackReason) => {
    if (messageId.startsWith('local-') || feedbackBusyId) return;
    const current = messages.find((item) => item.id === messageId)?.feedback;
    const toggleOff = !reason && current?.rating === rating;
    setFeedbackBusyId(messageId);
    setFeedbackError(false);
    try {
      if (toggleOff) await assistantApi.deleteFeedback(messageId);
      else await assistantApi.putFeedback(messageId, rating, reason);
      setMessages((list) => list.map((item) => (item.id === messageId
        ? { ...item, feedback: toggleOff ? null : { rating, ...(reason ? { reason } : {}) } }
        : item)));
    } catch {
      setFeedbackError(true);
    } finally {
      setFeedbackBusyId(null);
    }
  }, [feedbackBusyId, messages]);

  const busy = stream.phase === 'sending' || stream.phase === 'streaming';
  const streamingKind = runtime?.kind ?? 'buffered';
  const liveAnswer = busy && streamingKind === 'xhr-sse' && stream.answer
    ? sanitizeAssistantOutput(liveVisibleText(stream.answer, false), copy.outputBlocked, locale, scope)
    : '';
  const quota = quotaResetAt
    ? { limit: ASSISTANT_USER_DAILY_QUOTA, resetAt: quotaResetAt.at ? formatDateTime(quotaResetAt.at) : null }
    : null;

  return {
    copy,
    locale,
    isPreview,
    scope,
    changeScope,
    draft,
    setDraft,
    messages,
    conversationId,
    busy,
    reconciling,
    stream,
    streamState,
    liveAnswer,
    notice,
    failure,
    quota,
    send,
    retry,
    stop,
    canRetry: Boolean(orchestrator?.canRetry()) || stream.canResubmitSameRequest,
    newChat: clearThread,
    earlierCursor,
    loadingEarlier,
    loadEarlier,
    history,
    setHistoryOpen,
    loadMoreHistory: () => void refreshHistory(scope, true, history.nextCursor),
    reloadHistory: () => void refreshHistory(scope, false, null),
    selectConversation,
    deleteConversation,
    rate,
    feedbackBusyId,
    feedbackError,
  };
}

export type AssistantChat = ReturnType<typeof useAssistantChat>;
