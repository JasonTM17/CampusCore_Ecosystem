import type { ClassifiedError } from './account-errors';

/**
 * Pure state machine for the email-code (OTP) two-factor settings. The
 * password and the code are held by the form while a request is in flight and
 * never enter this state; only the challenge id does, in memory.
 */

export const TWO_FACTOR_CODE_LENGTH = 6;

export type TwoFactorAction = 'enable' | 'disable';
export type TwoFactorStage = 'idle' | 'confirmDisable' | 'password' | 'code';

export type TwoFactorErrorKey =
  | 'passwordRequired'
  | 'passwordIncorrect'
  | 'invalidFormat'
  | 'codeInvalid'
  | 'codeLocked'
  | 'codeExpired'
  | 'challengeInvalid'
  | 'alreadyEnabled'
  | 'notEnabled'
  | 'mailFailed'
  | 'rateLimited'
  | 'network'
  | 'unauthorized'
  | 'failed';

export interface TwoFactorState {
  /** null until the status has loaded. */
  enabled: boolean | null;
  statusFailed: boolean;
  stage: TwoFactorStage;
  action: TwoFactorAction;
  challengeId: string | null;
  busy: boolean;
  error: TwoFactorErrorKey | null;
  /** Set once a change is confirmed; the screen ends the session on it. */
  completed: TwoFactorAction | null;
}

export type TwoFactorEvent =
  | { type: 'statusLoaded'; enabled: boolean }
  | { type: 'statusFailed' }
  | { type: 'begin'; action: TwoFactorAction }
  | { type: 'confirmDisable' }
  | { type: 'cancel' }
  | { type: 'requestStarted' }
  | { type: 'challengeStarted'; challengeId: string }
  | { type: 'succeeded'; enabled: boolean }
  | { type: 'failed'; error: TwoFactorErrorKey };

export const initialTwoFactorState: TwoFactorState = {
  enabled: null,
  statusFailed: false,
  stage: 'idle',
  action: 'enable',
  challengeId: null,
  busy: false,
  error: null,
  completed: null,
};

/** Challenges that can never succeed again, so the flow must restart. */
const DEAD_CHALLENGE: readonly TwoFactorErrorKey[] = ['codeLocked', 'codeExpired', 'challengeInvalid'];

const reset = (state: TwoFactorState): TwoFactorState => ({
  ...state,
  stage: 'idle',
  challengeId: null,
  busy: false,
  error: null,
});

export function twoFactorReducer(state: TwoFactorState, event: TwoFactorEvent): TwoFactorState {
  switch (event.type) {
    case 'statusLoaded':
      return { ...state, enabled: event.enabled, statusFailed: false };
    case 'statusFailed':
      return { ...state, statusFailed: true };
    case 'begin': {
      const allowed = state.stage === 'idle' && !state.busy && state.completed === null
        && (event.action === 'enable' ? state.enabled === false : state.enabled === true);
      if (!allowed) return state;
      return {
        ...state,
        action: event.action,
        stage: event.action === 'disable' ? 'confirmDisable' : 'password',
        error: null,
      };
    }
    case 'confirmDisable':
      return state.stage === 'confirmDisable' ? { ...state, stage: 'password' } : state;
    case 'cancel':
      return state.busy ? state : reset(state);
    case 'requestStarted':
      return state.busy || (state.stage !== 'password' && state.stage !== 'code')
        ? state
        : { ...state, busy: true, error: null };
    case 'challengeStarted':
      return state.stage === 'password'
        ? { ...state, stage: 'code', challengeId: event.challengeId, busy: false, error: null }
        : state;
    case 'succeeded':
      return { ...reset(state), enabled: event.enabled, completed: state.action };
    case 'failed': {
      const next = { ...state, busy: false, error: event.error };
      if (event.error === 'alreadyEnabled') return { ...reset(next), enabled: true, error: event.error };
      if (event.error === 'notEnabled') return { ...reset(next), enabled: false, error: event.error };
      if (state.stage === 'code' && DEAD_CHALLENGE.includes(event.error)) {
        return { ...next, stage: 'idle', challengeId: null };
      }
      return next;
    }
    default:
      return state;
  }
}

/** Digits only (spaces and dashes from a paste are dropped), capped at six. */
export function normalizeOtpCode(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '').slice(0, TWO_FACTOR_CODE_LENGTH);
}

export function isCompleteOtp(code: string): boolean {
  return normalizeOtpCode(code).length === TWO_FACTOR_CODE_LENGTH;
}

/** "s***@example.edu": first character, three asterisks, then the domain. */
export function maskEmail(email: string | null | undefined): string {
  const trimmed = (email ?? '').trim();
  if (!trimmed) return '';
  const at = trimmed.indexOf('@');
  if (at <= 0) return `${trimmed.charAt(0)}***`;
  return `${trimmed.charAt(0)}***@${trimmed.slice(at + 1)}`;
}

const CODE_TO_KEY: Record<string, TwoFactorErrorKey> = {
  TWO_FACTOR_CODE_INVALID: 'codeInvalid',
  TWO_FACTOR_CODE_LOCKED: 'codeLocked',
  TWO_FACTOR_CODE_EXPIRED: 'codeExpired',
  TWO_FACTOR_CHALLENGE_INVALID: 'challengeInvalid',
  TWO_FACTOR_ALREADY_ENABLED: 'alreadyEnabled',
  TWO_FACTOR_NOT_ENABLED: 'notEnabled',
  MAIL_DELIVERY_FAILED: 'mailFailed',
};

/**
 * Maps a failure to a localized message key. At the password step the API
 * answers a wrong password with a bare 400 (no business code), so a
 * validation failure there means "password incorrect".
 */
export function twoFactorErrorKey(
  failure: ClassifiedError,
  step: 'password' | 'code',
): TwoFactorErrorKey {
  if (failure.code && CODE_TO_KEY[failure.code]) return CODE_TO_KEY[failure.code];
  if (failure.status === 502) return 'mailFailed';
  if (failure.kind === 'rateLimited') return 'rateLimited';
  if (failure.kind === 'network') return 'network';
  if (failure.kind === 'unauthorized') return 'unauthorized';
  if (step === 'password' && failure.kind === 'validation') return 'passwordIncorrect';
  return 'failed';
}
