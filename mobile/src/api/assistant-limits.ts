/**
 * Timing and size limits for the assistant turn, mirrored from the web client.
 * The parity test reads the web constants and fails when either side drifts.
 */

/** No useful answer content (text delta, replace or citation) within this window aborts the stream. */
export const ASSISTANT_STREAM_IDLE_TIMEOUT_MS = 45_000;
/** Hard ceiling for one stream, even while deltas keep arriving. */
export const ASSISTANT_STREAM_TOTAL_TIMEOUT_MS = 120_000;
/** Bounded cancel so a hung cancel call cannot wedge the composer. */
export const ASSISTANT_CANCEL_TIMEOUT_MS = 8_000;
/** Wall-clock budget for the whole JSON reconciliation chain. */
export const ASSISTANT_RECONCILE_TOTAL_BUDGET_MS = 30_000;
export const ASSISTANT_RECONCILE_MAX_ATTEMPTS = 4;
/** Linear backoff base: 250ms, 500ms, 750ms between attempts. */
export const ASSISTANT_RECONCILE_BACKOFF_BASE_MS = 250;
export const ASSISTANT_MAX_MESSAGE_CHARS = 2000;
/** Mobile-only guard: XHR keeps the whole response text in memory, so cap it. */
export const ASSISTANT_STREAM_MAX_RESPONSE_CHARS = 1_048_576;

export interface AssistantClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemAssistantClock: AssistantClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ReconcileBudget {
  deadline: number;
  attemptsStarted: number;
}

export function startReconcileBudget(
  now: number,
  totalBudgetMs: number = ASSISTANT_RECONCILE_TOTAL_BUDGET_MS,
): ReconcileBudget {
  return { deadline: now + totalBudgetMs, attemptsStarted: 0 };
}

/** The deadline wins over the attempt cap, so a slow chain never exceeds the budget. */
export function canAttemptReconcile(
  budget: ReconcileBudget,
  now: number,
  maxAttempts: number = ASSISTANT_RECONCILE_MAX_ATTEMPTS,
): boolean {
  return budget.attemptsStarted < maxAttempts && now < budget.deadline;
}

/** Delay before the next attempt, or null when the cap or the deadline forbids another. */
export function nextReconcileBackoffMs(
  budget: ReconcileBudget,
  now: number,
  backoffBaseMs: number = ASSISTANT_RECONCILE_BACKOFF_BASE_MS,
): number | null {
  if (budget.attemptsStarted >= ASSISTANT_RECONCILE_MAX_ATTEMPTS) return null;
  const delayMs = backoffBaseMs * budget.attemptsStarted;
  if (now + delayMs >= budget.deadline) return null;
  return delayMs;
}

export function remainingReconcileMs(budget: ReconcileBudget, now: number): number {
  return Math.max(0, budget.deadline - now);
}
