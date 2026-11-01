/** Clamp a 1-based page number into a response's real page range. */
export function clampPage(page: number, totalPages: number): number {
  const pages = Math.max(1, Math.trunc(totalPages) || 1);
  const next = Math.trunc(page) || 1;
  return Math.min(Math.max(next, 1), pages);
}

/** Whether any page follows `page` inside `totalPages`. */
export function hasNextPage(page: number, totalPages: number): boolean {
  return page < Math.max(1, Math.trunc(totalPages) || 1);
}
