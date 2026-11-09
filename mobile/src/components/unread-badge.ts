/** Web parity: a numeric unread badge tops out at 99+. */
export function unreadBadgeLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}
