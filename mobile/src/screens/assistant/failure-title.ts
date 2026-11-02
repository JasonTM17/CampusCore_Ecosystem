import type { FailureKind } from '../../assistant/chat-helpers';

/** The assistant quota window is one minute; keep the last known value when no header arrived. */
export const RATE_LIMIT_FALLBACK_SECONDS = 30;

export interface FailureTitleCopy {
  sessionExpired: string;
  forbidden: string;
  rateLimited: string;
  quotaExceeded: string;
  interruptedStatus: string;
  streamInvalid: string;
  unavailable: string;
}

export interface FailureTitleSource {
  kind?: FailureKind;
  retryAfterSeconds?: number;
}

/** Failure heading; the rate-limit window comes from the response when the server sent one. */
export function failureTitle(
  copy: FailureTitleCopy,
  failure: FailureTitleSource | null,
  fallbackTitle: string,
): string {
  switch (failure?.kind) {
    case 'session': return copy.sessionExpired;
    case 'forbidden': return copy.forbidden;
    case 'rate': return copy.rateLimited.replace('{seconds}', String(failure.retryAfterSeconds ?? RATE_LIMIT_FALLBACK_SECONDS));
    case 'quota': return copy.quotaExceeded;
    case 'interrupted': return copy.interruptedStatus;
    case 'invalid': return copy.streamInvalid;
    case 'unavailable': return copy.unavailable;
    default: return fallbackTitle;
  }
}
