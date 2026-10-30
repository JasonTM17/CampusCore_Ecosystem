import { SESSION_ID_PATTERN } from '../attendance-checkin/checkin-link';

/**
 * Post-sign-in resume for lecturer check-in links (G3B). A signed-out user
 * who opens `campuscore://attendance/checkin/<id>` (or the claimed https
 * twin) is bounced to sign-in by the guard; the intended session link is
 * kept in memory here and consumed once by the root navigator's session-kind
 * effect, which resumes it only when the lane guard allows.
 * Memory-only: a killed app loses the intent, which is safe — the link can
 * be tapped again.
 */

const CHECKIN_PATH = /^\/attendance\/checkin\/([^/?]+)\/?$/;
const MAX_AGE_MS = 5 * 60_000;

let pending: { path: string; at: number } | null = null;

/** Store the intent only when the path is a well-formed session link. */
export function rememberCheckinPath(pathname: string | null | undefined): void {
  if (typeof pathname !== 'string') {
    return;
  }
  const match = CHECKIN_PATH.exec(pathname.split('?')[0]);
  if (!match || !SESSION_ID_PATTERN.test(match[1])) {
    return;
  }
  pending = { path: `/attendance/checkin/${match[1]}`, at: Date.now() };
}

/** Read once and clear; stale intents (> 5 min) are dropped. */
export function consumePendingCheckinPath(now = Date.now()): string | null {
  const value = pending;
  pending = null;
  return value !== null && now - value.at <= MAX_AGE_MS ? value.path : null;
}
