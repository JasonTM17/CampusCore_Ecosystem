/**
 * One-shot, in-memory note that tells the logged-out screen why the session
 * ended. It holds a fixed label, never an identity or a credential, and it is
 * not persisted: an app restart starts with the plain signed-out message.
 */
export type ExitNotice =
  | 'signedOut'
  | 'passwordChanged'
  | 'twoFactorEnabled'
  | 'twoFactorDisabled';

let pending: ExitNotice | null = null;

export function setExitNotice(notice: ExitNotice): void {
  pending = notice;
}

/** Returns the pending notice once, then forgets it. */
export function takeExitNotice(): ExitNotice {
  const notice = pending ?? 'signedOut';
  pending = null;
  return notice;
}
