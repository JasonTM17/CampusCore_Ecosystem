/**
 * One in-tab signal for "this account's notification mailbox changed". The
 * shell bell keeps a private copy of the unread preview; a write made on
 * another surface (the notifications centre) must invalidate that copy
 * instead of waiting for the count poll or a full reload.
 */
const NOTIFICATIONS_CHANGED = 'campuscore:notifications-changed';

export function publishNotificationsChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

export function subscribeNotificationsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handler = () => listener();
  window.addEventListener(NOTIFICATIONS_CHANGED, handler);
  return () => window.removeEventListener(NOTIFICATIONS_CHANGED, handler);
}
