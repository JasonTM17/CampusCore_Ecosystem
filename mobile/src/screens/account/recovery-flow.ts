import type { ClassifiedError } from './account-errors';

/**
 * Pure state for the anonymous recovery flows. Nothing here logs, persists or
 * serialises a token or a password: the reset token lives in component memory
 * for one screen visit and is dropped on every terminal state.
 */

/** Reset tokens are base64url secrets; the API accepts 20 to 200 characters. */
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;

export function normalizeEmail(raw: string): string {
  return raw.trim();
}

export function validateEmail(raw: string): 'required' | 'invalid' | null {
  const email = normalizeEmail(raw);
  if (!email) return 'required';
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return 'invalid';
  return null;
}

/**
 * Reads the reset token from a deep-link query value. Anything that cannot be
 * a token (missing, empty, wrong shape, repeated key) yields null so the
 * screen goes straight to its safe "link no longer valid" state.
 */
export function extractResetToken(raw: string | string[] | null | undefined): string | null {
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : null) : raw;
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return RESET_TOKEN_PATTERN.test(token) ? token : null;
}

/* ---------- forgot password ---------- */

export type ForgotPhase = 'idle' | 'sending' | 'sent' | 'failed';

export interface ForgotState {
  phase: ForgotPhase;
  failure: ClassifiedError | null;
  /** Address the user typed, kept only to echo back in the neutral banner. */
  email: string | null;
}

export type ForgotEvent =
  | { type: 'submit'; email: string }
  | { type: 'accepted' }
  | { type: 'rejected'; failure: ClassifiedError }
  | { type: 'startOver' };

export const initialForgotState: ForgotState = { phase: 'idle', failure: null, email: null };

/**
 * The server answers every eligible request identically, so `accepted` is the
 * only success transition and carries no account-existence signal. A second
 * submit while one is in flight is ignored.
 */
export function forgotReducer(state: ForgotState, event: ForgotEvent): ForgotState {
  switch (event.type) {
    case 'submit':
      return state.phase === 'sending'
        ? state
        : { phase: 'sending', failure: null, email: normalizeEmail(event.email) };
    case 'accepted':
      return state.phase === 'sending' ? { ...state, phase: 'sent', failure: null } : state;
    case 'rejected':
      return state.phase === 'sending'
        ? { phase: 'failed', failure: event.failure, email: null }
        : state;
    case 'startOver':
      return initialForgotState;
    default:
      return state;
  }
}

/* ---------- reset password ---------- */

export type ResetPhase = 'form' | 'submitting' | 'done' | 'tokenInvalid';

export interface ResetState {
  phase: ResetPhase;
  failure: ClassifiedError | null;
}

export type ResetEvent =
  | { type: 'submit' }
  | { type: 'succeeded' }
  | { type: 'failed'; failure: ClassifiedError };

export function initialResetState(token: string | null): ResetState {
  return { phase: token ? 'form' : 'tokenInvalid', failure: null };
}

/** `done` and `tokenInvalid` are terminal: no event leaves them. */
export function resetReducer(state: ResetState, event: ResetEvent): ResetState {
  if (state.phase === 'done' || state.phase === 'tokenInvalid') return state;
  switch (event.type) {
    case 'submit':
      return state.phase === 'form' ? { phase: 'submitting', failure: null } : state;
    case 'succeeded':
      return state.phase === 'submitting' ? { phase: 'done', failure: null } : state;
    case 'failed':
      if (state.phase !== 'submitting') return state;
      return event.failure.code === 'RESET_TOKEN_INVALID'
        ? { phase: 'tokenInvalid', failure: null }
        : { phase: 'form', failure: event.failure };
    default:
      return state;
  }
}
