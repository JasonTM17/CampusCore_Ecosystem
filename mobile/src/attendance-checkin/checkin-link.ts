export type CheckinLinkResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'INVALID_LINK' | 'INVALID_TARGET' | 'INVALID_SESSION_ID' };

// SessionService generates UUIDs; do not broaden this to arbitrary route segments.
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse the original string, before URL normalization can erase traversal or ports. */
export function parseCheckinLink(link: string): CheckinLinkResult {
  if (typeof link !== 'string' || /[\s\\%?#]/.test(link)) return { ok: false, reason: 'INVALID_LINK' };
  const match = /^(campuscore:\/\/attendance\/checkin\/|https:\/\/www\.campusute\.io\.vn\/attendance\/checkin\/)([^/]+)$/.exec(link);
  if (!match) return { ok: false, reason: 'INVALID_TARGET' };
  return SESSION_ID_PATTERN.test(match[2])
    ? { ok: true, sessionId: match[2] }
    : { ok: false, reason: 'INVALID_SESSION_ID' };
}
