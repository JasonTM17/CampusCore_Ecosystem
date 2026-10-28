import {
  ASSISTANT_CANCEL_TIMEOUT_MS,
  ASSISTANT_MAX_MESSAGE_CHARS,
  canAttemptReconcile,
  nextReconcileBackoffMs,
  remainingReconcileMs,
  startReconcileBudget,
  systemAssistantClock,
} from '../api/assistant-limits';
import type { AssistantClock } from '../api/assistant-limits';
import { AssistantStreamError, bufferedReplyEvents } from '../api/assistant-stream';
import type {
  AssistantChatRequest,
  AssistantErrorEvent,
  AssistantStreamEvent,
  BufferedAssistantReply,
} from '../api/assistant-stream';
import type { AssistantStreamAction } from '../api/assistant-stream-state';

/** Terminal wire codes the server fences; a JSON replay would only mislabel them. */
const FENCED_CODES = new Set([
  'TURN_CANCELLED', 'TURN_TERMINAL_RACE', 'TURN_NOT_ACTIVE', 'FAILED_AMBIGUOUS', 'PURGED', 'TURN_PURGED',
]);

export interface TurnInput {
  message: string;
  locale: AssistantChatRequest['locale'];
  conversationId?: string;
  scope?: AssistantChatRequest['scope'];
  /** Pass the previous id only to resubmit the same intent after a lost connection. */
  clientRequestId?: string;
}

export interface TurnDeps {
  stream: (request: AssistantChatRequest, options: { signal: AbortSignal }) => AsyncIterable<AssistantStreamEvent>;
  /** Idempotent JSON call; the same clientRequestId replays or polls the committed turn. */
  chat: (request: AssistantChatRequest, init: { signal: AbortSignal }) => Promise<BufferedAssistantReply>;
  cancelRequest: (clientRequestId: string) => Promise<unknown>;
  dispatch: (action: AssistantStreamAction) => void;
  /** False when the UI shows no pending turn although the lock is held (orphaned lock). */
  isTurnVisible?: () => boolean;
  createClientRequestId?: () => string;
  clock?: AssistantClock;
  onSettled?: (outcome: TurnOutcome) => void;
}

export interface TurnOutcome {
  status: 'completed' | 'reconciled' | 'cancelled' | 'failed' | 'aborted';
  clientRequestId: string;
  /** True only when the same clientRequestId may be sent again. */
  resubmittable: boolean;
}

export type SendResult = TurnOutcome | { status: 'busy' | 'empty' | 'too-long' };
export type CancelResult =
  | { status: 'idle' | 'reconciled' | 'cas-pending' }
  | { status: 'cancelled'; confirmed: boolean };

interface Turn {
  request: AssistantChatRequest;
  controller: AbortController;
  ended: boolean;
  cancelling: boolean;
  outcome?: TurnOutcome;
}

export function newClientRequestId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 0;
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** A 4xx the server will repeat: the same key never produces a different answer. */
function isDefinitiveClientError(error: unknown): boolean {
  const status = statusOf(error);
  if (status < 400 || status >= 500 || status === 408) return false;
  return !(status === 409 && codeOf(error) === 'TURN_IN_PROGRESS');
}

function aborted(): AssistantStreamError {
  return new AssistantStreamError('TURN_ABORTED');
}

export function createTurnOrchestrator(deps: TurnDeps) {
  const clock = deps.clock ?? systemAssistantClock;
  const newId = deps.createClientRequestId ?? newClientRequestId;
  let active: Turn | null = null;
  let lastRequest: AssistantChatRequest | null = null;
  let resubmittable = false;

  const isCurrent = (turn: Turn) => active === turn && !turn.ended;
  const emit = (turn: Turn, event: AssistantStreamEvent) => {
    if (isCurrent(turn)) deps.dispatch({ type: 'event', event });
  };

  /** Runs `operation` with a hard deadline; the parent signal and the deadline both abort it. */
  function bounded<T>(
    ms: number,
    parent: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        parent?.removeEventListener('abort', onParent);
        action();
      };
      const timer = clock.setTimeout(() => settle(() => {
        controller.abort();
        reject(new AssistantStreamError('TURN_TIMEOUT', { retryable: true, connectionLost: true }));
      }), Math.max(1, ms));
      const onParent = () => settle(() => {
        controller.abort();
        reject(aborted());
      });
      if (parent?.aborted) { onParent(); return; }
      parent?.addEventListener('abort', onParent, { once: true });
      operation(controller.signal).then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error)),
      );
    });
  }

  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = clock.setTimeout(() => { signal.removeEventListener('abort', done); resolve(); }, ms);
      const done = () => { clock.clearTimeout(timer); resolve(); };
      signal.addEventListener('abort', done, { once: true });
    });
  }

  function release(turn: Turn, status: TurnOutcome['status'], canResubmit = false): TurnOutcome {
    if (turn.outcome) return turn.outcome;
    turn.ended = true;
    turn.outcome = { status, clientRequestId: turn.request.clientRequestId, resubmittable: canResubmit };
    if (active === turn) {
      active = null;
      resubmittable = canResubmit;
      if (status === 'completed' || status === 'reconciled') deps.onSettled?.(turn.outcome);
    }
    return turn.outcome;
  }

  function applyReply(turn: Turn, reply: BufferedAssistantReply): void {
    for (const event of bufferedReplyEvents(reply, turn.request, { replaceBody: true })) emit(turn, event);
  }

  /** Same-key JSON replay under one shared budget; only TURN_IN_PROGRESS is polled. */
  async function reconcile(turn: Turn, failure: unknown, failureEvent?: AssistantErrorEvent): Promise<TurnOutcome> {
    const budget = startReconcileBudget(clock.now());
    let last = failure;
    while (isCurrent(turn) && canAttemptReconcile(budget, clock.now())) {
      budget.attemptsStarted += 1;
      try {
        const reply = await bounded(
          remainingReconcileMs(budget, clock.now()),
          turn.controller.signal,
          (signal) => deps.chat(turn.request, { signal }),
        );
        if (!isCurrent(turn)) break;
        applyReply(turn, reply);
        return release(turn, 'reconciled');
      } catch (error) {
        last = error;
        if (!isCurrent(turn) || codeOf(error) !== 'TURN_IN_PROGRESS') break;
        const delay = nextReconcileBackoffMs(budget, clock.now());
        if (delay === null) break;
        await sleep(delay, turn.controller.signal);
      }
    }
    if (!isCurrent(turn)) return turn.outcome ?? release(turn, 'aborted');
    if (isDefinitiveClientError(last)) {
      const retryable = statusOf(last) === 429 && codeOf(last) === 'RATE_LIMIT_EXCEEDED';
      emit(turn, { type: 'error', code: codeOf(last) ?? 'HTTP_ERROR', retryable });
      return release(turn, 'failed');
    }
    if (failureEvent && last === failure) {
      emit(turn, failureEvent);
      return release(turn, 'failed');
    }
    deps.dispatch({ type: 'connectionLost', code: codeOf(last) ?? codeOf(failure) });
    return release(turn, 'failed', true);
  }

  async function run(turn: Turn): Promise<TurnOutcome> {
    let failure: unknown = new AssistantStreamError('STREAM_INCOMPLETE', { retryable: true, connectionLost: true });
    let failureEvent: AssistantErrorEvent | undefined;
    try {
      for await (const event of deps.stream(turn.request, { signal: turn.controller.signal })) {
        if (!isCurrent(turn)) return turn.outcome ?? release(turn, 'aborted');
        if (event.type === 'error') {
          if (!event.retryable || FENCED_CODES.has(event.code)) {
            emit(turn, event);
            return release(turn, event.code === 'TURN_CANCELLED' ? 'cancelled' : 'failed');
          }
          failureEvent = event;
          failure = new AssistantStreamError(event.code, { retryable: true });
          break;
        }
        emit(turn, event);
        if (event.type === 'done') return release(turn, 'completed');
      }
    } catch (error) {
      failure = error;
      // 400/403/429 are definitive before any turn exists; 401 still reconciles so the JSON client can refresh.
      if (isCurrent(turn) && [400, 403, 429].includes(statusOf(error))) {
        const retryable = (error as AssistantStreamError).retryable === true;
        emit(turn, { type: 'error', code: codeOf(error) ?? 'HTTP_ERROR', retryable });
        return release(turn, 'failed');
      }
    }
    if (!isCurrent(turn) || turn.controller.signal.aborted) return turn.outcome ?? release(turn, 'aborted');
    return reconcile(turn, failure, failureEvent);
  }

  async function send(input: TurnInput): Promise<SendResult> {
    const message = input.message.trim();
    if (!message) return { status: 'empty' };
    if (message.length > ASSISTANT_MAX_MESSAGE_CHARS) return { status: 'too-long' };
    if (active) {
      if (deps.isTurnVisible?.() !== false) return { status: 'busy' };
      dispose(); // orphaned lock: stop the stale turn and let this send continue
    }
    const request: AssistantChatRequest = {
      message,
      locale: input.locale,
      clientRequestId: input.clientRequestId ?? newId(),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
    };
    const turn: Turn = { request, controller: new AbortController(), ended: false, cancelling: false };
    active = turn; // the lock is taken before any await, so a second send cannot interleave
    lastRequest = request;
    resubmittable = false;
    deps.dispatch({ type: 'send', clientRequestId: request.clientRequestId });
    return run(turn);
  }

  /** Stop button: bounded cancel, then a same-key replay when the server says the turn already committed. */
  async function cancel(): Promise<CancelResult> {
    const turn = active;
    if (!turn || turn.ended || turn.cancelling) return { status: 'idle' };
    turn.cancelling = true;
    let confirmed = true;
    try {
      await bounded(ASSISTANT_CANCEL_TIMEOUT_MS, undefined, () => deps.cancelRequest(turn.request.clientRequestId));
    } catch (error) {
      if (!isCurrent(turn)) return { status: 'idle' };
      if (statusOf(error) === 409) {
        const budget = startReconcileBudget(clock.now());
        try {
          const reply = await bounded(
            remainingReconcileMs(budget, clock.now()),
            turn.controller.signal,
            (signal) => deps.chat(turn.request, { signal }),
          );
          if (!isCurrent(turn)) return { status: 'idle' };
          applyReply(turn, reply);
          release(turn, 'reconciled');
          turn.controller.abort();
          return { status: 'reconciled' };
        } catch {
          turn.cancelling = false; // keep the stream alive so its own done frame can arrive
          return { status: 'cas-pending' };
        }
      }
      confirmed = false;
    }
    if (!isCurrent(turn)) return { status: 'idle' };
    deps.dispatch({ type: 'cancel' });
    release(turn, 'cancelled');
    turn.controller.abort();
    return { status: 'cancelled', confirmed };
  }

  /** Sign-out, unmount or scope change: abort locally and tell the server, never reporting a result. */
  function dispose(): void {
    const turn = active;
    if (!turn) return;
    turn.ended = true;
    active = null;
    turn.controller.abort();
    void bounded(ASSISTANT_CANCEL_TIMEOUT_MS, undefined, () => deps.cancelRequest(turn.request.clientRequestId))
      .catch(() => undefined);
  }

  function retry(): Promise<SendResult> {
    if (!lastRequest || !resubmittable) return Promise.resolve({ status: 'empty' });
    return send({ ...lastRequest });
  }

  return {
    send,
    cancel,
    retry,
    dispose,
    isBusy: () => active !== null,
    canRetry: () => resubmittable,
  };
}

export type TurnOrchestrator = ReturnType<typeof createTurnOrchestrator>;
