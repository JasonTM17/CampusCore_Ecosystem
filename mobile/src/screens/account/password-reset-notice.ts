/**
 * One-shot, in-memory note that tells sign-in a password reset completed.
 * It holds no identity or credential and is not persisted, so an app restart
 * starts without the notice.
 */
let pending = false;

export function setPasswordResetNotice(): void {
  pending = true;
}

/** Returns the pending notice once, then forgets it. */
export function takePasswordResetNotice(): boolean {
  const value = pending;
  pending = false;
  return value;
}
