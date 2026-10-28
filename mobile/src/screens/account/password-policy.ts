/**
 * Client-side mirror of the backend password policy checks that need no
 * server state (the common-password denylist stays server-only). The server
 * stays authoritative; codes here match its `PASSWORD_*` codes so one message
 * table serves both client rejections and server responses.
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
  | 'INVALID_OLD_PASSWORD';

/** Codes the client can produce without asking the server. */
export type PasswordPolicyIssue =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_CONTAINS_IDENTITY'
  | 'PASSWORD_TOO_WEAK'
  | 'PASSWORD_REUSED'
  | 'PASSWORD_MISMATCH';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
/** BCrypt truncates silently at 72 bytes, so the policy rejects instead. */
export const MAX_PASSWORD_UTF8_BYTES = 72;

const MIN_LOCAL_PART_FOR_SUBSTRING = 4;

function pattern(source: string, fallback: RegExp): RegExp {
  try {
    return new RegExp(source, 'u');
  } catch {
    return fallback;
  }
}

// Unicode property escapes where the engine has them; Latin (incl. Vietnamese)
// and ASCII digits otherwise, so the fallback never rejects a valid password.
const LETTER = pattern('\\p{L}', /[A-Za-zÀ-ɏḀ-ỿ]/);
const DIGIT = pattern('\\p{Nd}', /[0-9]/);

const KNOWN_CODES = new Set<string>([
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORD_CONTAINS_IDENTITY',
  'PASSWORD_TOO_WEAK',
  'PASSWORD_TOO_COMMON',
  'PASSWORD_REUSED',
  'PASSWORD_MISMATCH',
  'RESET_TOKEN_INVALID',
  'INVALID_OLD_PASSWORD',
]);

function utf8Length(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function passwordWithinLimits(candidate: string): boolean {
  return (
    candidate.length >= MIN_PASSWORD_LENGTH
    && candidate.length <= MAX_PASSWORD_LENGTH
    && utf8Length(candidate) <= MAX_PASSWORD_UTF8_BYTES
  );
}

export function passwordHasLetterAndDigit(candidate: string): boolean {
  return LETTER.test(candidate) && DIGIT.test(candidate);
}

function emailLocalPart(email: string): string {
  const at = email.indexOf('@');
  return (at > 0 ? email.substring(0, at) : email).trim().toLowerCase();
}

export interface PasswordPolicyOptions {
  /** When known, the account email drives the identity check. */
  email?: string;
  /** A candidate equal to it reports PASSWORD_REUSED. */
  currentPassword?: string;
  /** A non-matching value reports PASSWORD_MISMATCH. */
  confirmPassword?: string;
}

/**
 * First failing rule, in the backend's order: length, byte limit, identity,
 * letter plus digit, reuse, then the client-only confirmation match.
 * `null` means every client-checkable rule passed.
 */
export function checkPasswordPolicy(
  candidate: string,
  options: PasswordPolicyOptions = {},
): PasswordPolicyIssue | null {
  if (!candidate || candidate.length < MIN_PASSWORD_LENGTH) {
    return 'PASSWORD_TOO_SHORT';
  }
  if (candidate.length > MAX_PASSWORD_LENGTH || utf8Length(candidate) > MAX_PASSWORD_UTF8_BYTES) {
    return 'PASSWORD_TOO_LONG';
  }
  const email = options.email?.trim();
  if (email) {
    const normalized = candidate.toLowerCase();
    const localPart = emailLocalPart(email);
    if (
      localPart
      && (normalized === email.toLowerCase()
        || normalized === localPart
        || (localPart.length >= MIN_LOCAL_PART_FOR_SUBSTRING && normalized.includes(localPart)))
    ) {
      return 'PASSWORD_CONTAINS_IDENTITY';
    }
  }
  if (!passwordHasLetterAndDigit(candidate)) {
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

export type ChecklistKey = 'length' | 'letterDigit' | 'match';

export interface ChecklistItem {
  key: ChecklistKey;
  met: boolean;
}

/** Live requirement list shown while the user types a new password. */
export function passwordChecklist(candidate: string, confirmation: string): ChecklistItem[] {
  return [
    { key: 'length', met: passwordWithinLimits(candidate) },
    { key: 'letterDigit', met: passwordHasLetterAndDigit(candidate) },
    { key: 'match', met: confirmation.length > 0 && candidate === confirmation },
  ];
}

/** Narrows a server code to the password namespace; unknown codes give null. */
export function mapPasswordErrorCode(code: string | null | undefined): PasswordErrorCode | null {
  return code && KNOWN_CODES.has(code) ? (code as PasswordErrorCode) : null;
}
