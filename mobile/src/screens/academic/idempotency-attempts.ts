// One idempotency key per mutation attempt. A retry of an attempt whose
// outcome is unknown (network loss, 5xx, in-flight duplicate) reuses the same
// key so the server can deduplicate; a definitive answer ends the attempt.

export interface AttemptKeys {
  /** Existing key for this attempt, or a fresh one. */
  keyFor(action: string, id: string): string;
  /** Ends the attempt unless the outcome is unknown. */
  settle(action: string, id: string, error?: unknown): void;
  has(action: string, id: string): boolean;
}

export function isOutcomeUnknown(error: unknown): boolean {
  if (error === undefined || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number') return true;
  if (status === 0 || status >= 500 || status === 408) return true;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('IDEMPOTENCY_');
}

export function createAttemptKeys(generate: () => string): AttemptKeys {
  const keys = new Map<string, string>();
  const slot = (action: string, id: string) => `${action}:${id}`;
  return {
    keyFor(action, id) {
      const existing = keys.get(slot(action, id));
      if (existing) return existing;
      const created = generate();
      keys.set(slot(action, id), created);
      return created;
    },
    settle(action, id, error) {
      if (!isOutcomeUnknown(error)) keys.delete(slot(action, id));
    },
    has: (action, id) => keys.has(slot(action, id)),
  };
}
