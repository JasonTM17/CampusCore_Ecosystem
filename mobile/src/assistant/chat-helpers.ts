import type { AssistantGuardReason } from './assistant-input-guard';

/** Strips control characters the server never produces, caps length, trims. */
export function safeText(value: string | null | undefined, maxLength = 12_000): string {
  return (value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLength).trim();
}

export type GuardNoticeKey = 'guardSensitive' | 'guardInjection' | 'guardTechnical';

export function guardNoticeKey(reason: AssistantGuardReason | undefined): GuardNoticeKey {
  switch (reason) {
    case 'SENSITIVE_EMAIL':
    case 'SENSITIVE_PHONE':
    case 'SENSITIVE_STUDENT_ID':
    case 'SENSITIVE_CREDENTIAL':
      return 'guardSensitive';
    case 'TECHNICAL_REQUEST_BLOCKED':
      return 'guardTechnical';
    default:
      return 'guardInjection';
  }
}

export type FailureKind =
  | 'session'
  | 'forbidden'
  | 'rate'
  | 'quota'
  | 'interrupted'
  | 'invalid'
  | 'unavailable'
  | 'generic';

const SESSION_CODES = new Set(['UNAUTHORIZED', 'SESSION_EXPIRED', 'SESSION_CHANGED']);
const RATE_CODES = new Set(['RATE_LIMITED', 'RATE_LIMIT_EXCEEDED']);
const QUOTA_CODES = new Set(['QUOTA_EXCEEDED', 'DAILY_QUOTA_EXCEEDED']);
const UNAVAILABLE_CODES = new Set(['ASSISTANT_UNAVAILABLE', 'STREAMING_UNSUPPORTED', 'HTTP_ERROR', 'ASSISTANT_RLS_UNAVAILABLE']);

/** Maps a wire or stream code to a copy family; the raw server text is never shown. */
export function classifyFailure(code: string | undefined, connectionLost: boolean): FailureKind {
  if (code && SESSION_CODES.has(code)) return 'session';
  if (code === 'FORBIDDEN') return 'forbidden';
  if (code && RATE_CODES.has(code)) return 'rate';
  if (code && QUOTA_CODES.has(code)) return 'quota';
  if (code && (code.startsWith('STREAM_INVALID') || code.startsWith('STREAM_EVENT') || code === 'STREAM_UNKNOWN_EVENT')) return 'invalid';
  if (connectionLost || (code && (code.startsWith('STREAM_') || code === 'TURN_TIMEOUT'))) return 'interrupted';
  if (code && UNAVAILABLE_CODES.has(code)) return 'unavailable';
  return 'generic';
}

/**
 * The buffered adapter falls back to the clientRequestId when a reply has no
 * conversationId; that value must never be adopted as a conversation.
 */
export function resolveConversationId(
  metaConversationId: string | undefined,
  clientRequestId: string,
  requestedConversationId: string | undefined,
): string | undefined {
  if (metaConversationId && metaConversationId !== clientRequestId) return metaConversationId;
  return requestedConversationId;
}

/**
 * While text is still arriving, hold back the unfinished last word so a prefix
 * such as `/api/v` or `http` is never judged or shown half-formed. A finished
 * turn passes the full text.
 */
export function liveVisibleText(answer: string, finished: boolean): string {
  if (finished) return answer;
  const lastBreak = Math.max(answer.lastIndexOf(' '), answer.lastIndexOf('\n'), answer.lastIndexOf('\t'));
  return lastBreak < 0 ? '' : answer.slice(0, lastBreak);
}
