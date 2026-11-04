/**
 * Bounded display window for the assistant transcript.
 *
 * The panel renders at most {@link ASSISTANT_HISTORY_WINDOW_SIZE} messages.
 * A live send reserves two slots (the user turn and its assistant reply)
 * before the new exchange is admitted; older-history pages are prepended while
 * the newest end is evicted. The rules are pure so reducer/panel tests can
 * exercise them without React, matching the bounded window design authority:
 *
 * - `admitLiveExchange`: reserve two slots, evict oldest completed exchanges.
 * - `prependHistoryPage`: prepend an older page, evict from the newest end.
 * - `fitHistoryWindow`: policy-based cap used by resets/replays.
 * - `canNavigateHistory`: block navigation during streaming/reconciliation or
 *   feedback writes that the requested page would evict.
 * - `rebaseCursor`: never reuse a cursor after a live eviction; rebase from the
 *   latest server page instead.
 *
 * Nothing here slices blindly from either end: every eviction is exchange-aware
 * and keeps pending, latest-turn and feedback-attached messages.
 */

export const ASSISTANT_HISTORY_WINDOW_SIZE = 100;
/** Two slots: the new user turn plus its assistant reply. */
export const ASSISTANT_EXCHANGE_RESERVE = 2;
/** Existing server page size; retained during rebases and older paging. */
export const ASSISTANT_HISTORY_PAGE_SIZE = 50;
/** Sidebar conversations are bounded separately from transcript messages. */
export const ASSISTANT_CONVERSATION_LIMIT = 100;

export interface WindowMessageLike {
  id: string;
  role: 'user' | 'assistant';
  pending?: boolean;
  feedback?: 'UP' | 'DOWN' | null;
  feedbackReason?: string | null;
  feedbackPending?: boolean;
  feedbackRetry?: unknown;
}

export interface WindowOptions {
  limit?: number;
}

export interface WindowResult<T> {
  messages: T[];
  /** Removed messages in their original (oldest-first) order. */
  evicted: T[];
}

export interface CursorPageLike<T> {
  items: readonly T[];
  nextCursor?: string;
}

export interface HistoryRequestIdentity {
  conversationId?: string;
  scope: string;
  generation: number;
}

export interface HistoryNavigationState {
  isSending: boolean;
  /** True while a streamed turn is being reconciled through JSON. */
  isReconciling?: boolean;
  /** True while an older page or the latest page is already loading. */
  loading?: boolean;
  /** Assistant message ids whose feedback write is in flight. */
  feedbackPendingIds?: readonly string[];
  /** Message ids the requested older page would evict from the newest end. */
  evictedIds?: readonly string[];
}

export interface CursorRebase {
  cursor?: string;
  /** The caller must fetch the latest server page before using a cursor. */
  needsLatestPage: boolean;
  /** The cursor was replaced from the latest server page. */
  rebased: boolean;
  reason: 'current' | 'refresh-latest' | 'latest-page';
}

/**
 * Feedback state is user-owned signal. It survives live eviction so a saved
 * thumbs-up/down does not silently disappear from the visible turn.
 */
export function isFeedbackAttached(message: WindowMessageLike): boolean {
  return (
    message.feedbackPending === true ||
    message.feedbackRetry != null ||
    message.feedback === 'UP' ||
    message.feedback === 'DOWN'
  );
}

/**
 * Indices that must never be evicted by the live window: the active turn, the
 * latest retryable turn (the trailing assistant and its prompt) and every
 * feedback-attached message.
 */
function protectedIndexes(messages: readonly WindowMessageLike[]): Set<number> {
  const protectedSet = new Set<number>();
  messages.forEach((message, index) => {
    if (message.pending || isFeedbackAttached(message)) protectedSet.add(index);
  });

  let tail = messages.length - 1;
  while (
    tail >= 0 &&
    (messages[tail].pending || isFeedbackAttached(messages[tail]))
  ) {
    tail -= 1;
  }
  if (tail >= 0) {
    protectedSet.add(tail);
    if (messages[tail].role === 'assistant' && tail > 0) {
      const prompt = tail - 1;
      if (messages[prompt].role === 'user') protectedSet.add(prompt);
    }
  }
  return protectedSet;
}

/**
 * Group the transcript into exchanges: a user turn plus the assistant replies
 * that follow it before the next user turn. A leading or orphan assistant
 * message is its own group.
 */
function exchangeGroups(
  messages: readonly WindowMessageLike[],
): number[][] {
  const groups: number[][] = [];
  let index = 0;
  while (index < messages.length) {
    if (messages[index].role === 'user') {
      const group = [index];
      let next = index + 1;
      while (next < messages.length && messages[next].role === 'assistant') {
        group.push(next);
        next += 1;
      }
      groups.push(group);
      index = next;
    } else {
      groups.push([index]);
      index += 1;
    }
  }
  return groups;
}

function removeOldest<T extends WindowMessageLike>(
  messages: readonly T[],
  excess: number,
  protectedSet: ReadonlySet<number>,
): WindowResult<T> {
  if (excess <= 0) return { messages: messages.slice(), evicted: [] };

  const removed = new Set<number>();
  let removedCount = 0;

  // Whole exchanges first: dropping half an exchange leaves a dangling
  // assistant reply or a prompt without its answer.
  for (const group of exchangeGroups(messages)) {
    if (removedCount >= excess) break;
    if (group.some((index) => protectedSet.has(index))) continue;
    for (const index of group) removed.add(index);
    removedCount += group.length;
  }

  // A pathological transcript (almost everything protected) still has to
  // converge. Split the oldest unprotected messages only when no full
  // exchange could be removed. If every message is protected, preservation
  // wins over the display bound: there is nothing safe to evict.
  if (removedCount < excess) {
    for (let index = 0; index < messages.length && removedCount < excess; index += 1) {
      if (protectedSet.has(index) || removed.has(index)) continue;
      removed.add(index);
      removedCount += 1;
    }
  }

  return {
    messages: messages.filter((_, index) => !removed.has(index)),
    evicted: messages.filter((_, index) => removed.has(index)),
  };
}

/**
 * Live admission: keep room for the new user turn and its assistant reply,
 * evicting the oldest completed exchanges. The reducer applies this before it
 * appends the user message; `assistant-start` then fills the reserved slot.
 */
export function admitLiveExchange<T extends WindowMessageLike>(
  messages: readonly T[],
  options: WindowOptions = {},
): WindowResult<T> {
  const limit = options.limit ?? ASSISTANT_HISTORY_WINDOW_SIZE;
  const target = Math.max(0, limit - ASSISTANT_EXCHANGE_RESERVE);
  if (messages.length <= target) return { messages: messages.slice(), evicted: [] };
  return removeOldest(messages, messages.length - target, protectedIndexes(messages));
}

/**
 * Policy cap for a reset/replay. Unlike a blind `slice(-100)` it keeps the
 * latest turn and feedback state, and drops whole oldest exchanges.
 */
export function fitHistoryWindow<T extends WindowMessageLike>(
  messages: readonly T[],
  options: WindowOptions = {},
): WindowResult<T> {
  const limit = options.limit ?? ASSISTANT_HISTORY_WINDOW_SIZE;
  if (messages.length <= limit) return { messages: messages.slice(), evicted: [] };
  return removeOldest(messages, messages.length - limit, protectedIndexes(messages));
}

/**
 * Older-history paging: prepend the next server page (deduplicated by id) and
 * evict from the newest end until the window fits. Reading backwards therefore
 * never loses the older page the user asked for. The panel calls
 * `canNavigateHistory` first so an in-flight feedback write is never dropped;
 * a pending active turn is still protected here as a last line of defence.
 */
export function prependHistoryPage<T extends WindowMessageLike>(
  current: readonly T[],
  page: readonly T[],
  options: WindowOptions = {},
): WindowResult<T> {
  const limit = options.limit ?? ASSISTANT_HISTORY_WINDOW_SIZE;
  const seen = new Set(current.map((message) => message.id));
  const fresh: T[] = [];
  for (const message of page) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    fresh.push(message);
  }

  const combined = [...fresh, ...current];
  if (combined.length <= limit) return { messages: combined, evicted: [] };

  const removed = new Set<number>();
  const excess = combined.length - limit;
  for (
    let index = combined.length - 1;
    index >= 0 && removed.size < excess;
    index -= 1
  ) {
    if (combined[index].pending) continue;
    removed.add(index);
  }

  return {
    messages: combined.filter((_, index) => !removed.has(index)),
    evicted: combined.filter((_, index) => removed.has(index)),
  };
}

/**
 * Predicted ids an older page of `incomingCount` messages would evict from the
 * newest end. The panel uses it to keep navigation disabled when an in-flight
 * feedback write would actually be dropped.
 */
export function previewEvictedIds<T extends WindowMessageLike>(
  messages: readonly T[],
  incomingCount: number,
  options: WindowOptions = {},
): string[] {
  const limit = options.limit ?? ASSISTANT_HISTORY_WINDOW_SIZE;
  const excess = messages.length + Math.max(0, incomingCount) - limit;
  if (excess <= 0) return [];

  const evicted: string[] = [];
  for (
    let index = messages.length - 1;
    index >= 0 && evicted.length < excess;
    index -= 1
  ) {
    if (messages[index].pending) continue;
    evicted.push(messages[index].id);
  }
  return evicted;
}

/**
 * History navigation is disabled during streaming/reconciliation and whenever
 * a page would evict a message whose feedback write is still in flight.
 */
export function canNavigateHistory(state: HistoryNavigationState): boolean {
  if (state.isSending || state.isReconciling || state.loading) return false;
  const pending = state.feedbackPendingIds ?? [];
  if (pending.length === 0) return true;
  const evicted = new Set(state.evictedIds ?? []);
  return !pending.some((id) => evicted.has(id));
}

/**
 * Decide whether a stored older-page cursor is still safe. After live eviction
 * the old cursor can skip messages that were discarded from the display, so it
 * is never reused: the caller must fetch the latest server page and take its
 * cursor instead.
 */
export function rebaseCursor<T>(
  input: {
    cursor?: string;
    stale: boolean;
    latestPage?: CursorPageLike<T> | null;
  },
): CursorRebase {
  if (!input.stale) {
    return {
      cursor: input.cursor,
      needsLatestPage: false,
      rebased: false,
      reason: 'current',
    };
  }
  if (!input.latestPage) {
    return {
      cursor: undefined,
      needsLatestPage: true,
      rebased: false,
      reason: 'refresh-latest',
    };
  }
  return {
    cursor: input.latestPage.nextCursor,
    needsLatestPage: false,
    rebased: true,
    reason: 'latest-page',
  };
}

/**
 * Fence a late history response by the request identity it was issued under:
 * conversation, retrieval scope and monotonic generation.
 */
export function isCurrentHistoryResponse(
  request: HistoryRequestIdentity,
  current: HistoryRequestIdentity,
): boolean {
  return (
    request.generation === current.generation &&
    request.conversationId === current.conversationId &&
    request.scope === current.scope
  );
}

/**
 * Bound the conversation sidebar. Conversations arrive newest-first; keeping
 * the newest 100 means the list stops growing while older cursors are followed
 * only until the bound is reached.
 */
export function appendConversationPage<T extends { id: string }>(
  current: readonly T[],
  page: readonly T[],
  limit: number = ASSISTANT_CONVERSATION_LIMIT,
): { items: T[]; truncated: boolean } {
  const seen = new Set(current.map((item) => item.id));
  const items = [...current];
  for (const item of page) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  if (items.length <= limit) return { items, truncated: false };
  return { items: items.slice(0, limit), truncated: true };
}
