/**
 * Client-side mirror of the backend `PasswordPolicy` checks that can be
 * evaluated without server state (the common-password denylist stays
 * server-only). The backend remains authoritative: codes returned here match
 * `PasswordPolicy` exactly so callers can localize one code namespace for
 * both client rejections and server `PASSWORD_*` responses.
 */
export type PasswordErrorCode =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_CONTAINS_IDENTITY'
  | 'PASSWORD_TOO_WEAK'
  | 'PASSWORD_TOO_COMMON'
  | 'PASSWORD_REUSED'
  | 'PASSWORD_MISMATCH'
  | 'RESET_TOKEN_INVALID'
  | 'INVALID_OLD_PASSWORD'
  | 'RATE_LIMIT_EXCEEDED';

/** Codes the client can produce itself (server-only codes excluded). */
export type PasswordPolicyIssue =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_CONTAINS_IDENTITY'
  | 'PASSWORD_TOO_WEAK'
  | 'PASSWORD_REUSED'
  | 'PASSWORD_MISMATCH';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
/** BCrypt truncates silently at 72 bytes — the policy rejects instead. */
export const MAX_PASSWORD_UTF8_BYTES = 72;

const MIN_LOCAL_PART_FOR_SUBSTRING = 4;
const LETTER_PATTERN = /\p{L}/u;
const DIGIT_PATTERN = /\p{Nd}/u;

const KNOWN_ERROR_CODES = new Set<string>([
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORD_CONTAINS_IDENTITY',
  'PASSWORD_TOO_WEAK',
  'PASSWORD_TOO_COMMON',
  'PASSWORD_REUSED',
  'PASSWORD_MISMATCH',
  'RESET_TOKEN_INVALID',
  'INVALID_OLD_PASSWORD',
  'RATE_LIMIT_EXCEEDED',
]);

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Character AND UTF-8 byte limits together — the live checklist item. */
export function passwordWithinLimits(candidate: string): boolean {
  return (
    candidate.length >= MIN_PASSWORD_LENGTH &&
    candidate.length <= MAX_PASSWORD_LENGTH &&
    utf8Length(candidate) <= MAX_PASSWORD_UTF8_BYTES
  );
}

export function passwordHasLetterAndDigit(candidate: string): boolean {
  return LETTER_PATTERN.test(candidate) && DIGIT_PATTERN.test(candidate);
}

/** Same normalization as `PasswordPolicy.localPart`: lowercase part before
 * the first `@`, or the whole trimmed value when no `@` is present. */
function emailLocalPart(email: string): string {
  const at = email.indexOf('@');
  const part = (at > 0 ? email.substring(0, at) : email).trim().toLowerCase();
  return part;
}

export type PasswordPolicyOptions = {
  /** When known, the account email drives the identity check. */
  email?: string;
  /** When supplied, a candidate equal to it reports PASSWORD_REUSED. */
  currentPassword?: string;
  /** When supplied, a non-matching value reports PASSWORD_MISMATCH. */
  confirmPassword?: string;
};

/**
 * Returns the first failing rule's code, checked in the same order as the
 * backend: length, byte limit, identity, letter+digit, reuse, then the
 * client-only confirmation match. `null` means the candidate passes every
 * client-checkable rule (the denylist is still verified server-side).
 */
export function checkPasswordPolicy(
  candidate: string,
  options: PasswordPolicyOptions = {},
): PasswordPolicyIssue | null {
  if (!candidate || candidate.length < MIN_PASSWORD_LENGTH) {
    return 'PASSWORD_TOO_SHORT';
  }
  if (
    candidate.length > MAX_PASSWORD_LENGTH ||
    utf8Length(candidate) > MAX_PASSWORD_UTF8_BYTES
  ) {
    return 'PASSWORD_TOO_LONG';
  }
  const email = options.email?.trim();
  if (email) {
    const normalized = candidate.toLowerCase();
    const localPart = emailLocalPart(email);
    if (
      localPart &&
      (normalized === email.toLowerCase() ||
        normalized === localPart ||
        (localPart.length >= MIN_LOCAL_PART_FOR_SUBSTRING &&
          normalized.includes(localPart)))
    ) {
      return 'PASSWORD_CONTAINS_IDENTITY';
    }
  }
  if (!LETTER_PATTERN.test(candidate) || !DIGIT_PATTERN.test(candidate)) {
    return 'PASSWORD_TOO_WEAK';
  }
  if (options.currentPassword !== undefined && candidate === options.currentPassword) {
    return 'PASSWORD_REUSED';
  }
  if (options.confirmPassword !== undefined && candidate !== options.confirmPassword) {
    return 'PASSWORD_MISMATCH';
  }
  return null;
}

/**
 * Maps a backend/client password error code to the i18n key under
 * `messages.common.campusErrors.codes`. Unknown codes return `null` so the
 * caller can fall back to the generic copy.
 */
export function mapPasswordErrorCode(
  code: string | null | undefined,
): PasswordErrorCode | null {
  if (code && KNOWN_ERROR_CODES.has(code)) {
    return code as PasswordErrorCode;
  }
  return null;
}
