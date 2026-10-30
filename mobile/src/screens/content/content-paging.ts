// Pure paging helpers for the content and service lists. Two server shapes
// meet here: a bare array with `X-Total-Count` (0-based page) and the legacy
// `{ data, meta }` envelope (1-based page). Both end as one `PagedResult`.

import type { PagedResult } from '../../api/paging';

export const CONTENT_PAGE_SIZE = 20;
/** Upper bound on pages fetched automatically for a client-side filter. */
export const EAGER_PAGE_CAP = 10;

interface EnvelopeMeta {
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

/** `{ data, meta }` body to the shared page shape; `page` is the 0-based window that was requested. */
export function envelopeToPage<T>(body: unknown, window: { page: number; limit: number }): PagedResult<T> {
  const envelope = body as { data?: unknown; meta?: EnvelopeMeta } | null;
  if (!envelope || !Array.isArray(envelope.data)) {
    throw new TypeError('Expected a { data, meta } list body');
  }
  const items = envelope.data as T[];
  const meta = envelope.meta;
  let hasMore: boolean;
  if (meta && typeof meta.totalPages === 'number' && typeof meta.page === 'number') {
    hasMore = meta.page < meta.totalPages;
  } else if (meta && typeof meta.total === 'number') {
    hasMore = (window.page + 1) * window.limit < meta.total;
  } else {
    hasMore = items.length >= window.limit;
  }
  const total = typeof meta?.total === 'number' ? meta.total : undefined;
  return total === undefined ? { items, hasMore } : { items, total, hasMore };
}

/**
 * Keeps the existing order, refreshes a repeated key with the newer row and
 * appends the rest, so a page that overlaps the previous one never shows a
 * row twice and never drops one.
 */
export function mergeUnique<T>(existing: readonly T[], incoming: readonly T[], keyOf: (item: T) => string): T[] {
  const next = existing.slice();
  const positions = new Map<string, number>();
  next.forEach((item, index) => positions.set(keyOf(item), index));
  for (const item of incoming) {
    const key = keyOf(item);
    const at = positions.get(key);
    if (at === undefined) {
      positions.set(key, next.length);
      next.push(item);
    } else {
      next[at] = item;
    }
  }
  return next;
}

export interface PagedView<T> {
  items: T[];
  total?: number;
  hasMore: boolean;
  /** 0-based index of the next window to request. */
  nextPage: number;
}

export function startView<T>(first: PagedResult<T>, keyOf: (item: T) => string): PagedView<T> {
  return {
    items: mergeUnique([], first.items, keyOf),
    total: first.total,
    hasMore: first.hasMore,
    nextPage: 1,
  };
}

/** A page lands only when it is the one the view asked for; a duplicate or stale response is ignored. */
export function appendPage<T>(
  view: PagedView<T>,
  page: PagedResult<T>,
  requestedPage: number,
  keyOf: (item: T) => string,
): PagedView<T> {
  if (requestedPage !== view.nextPage) return view;
  return {
    items: mergeUnique(view.items, page.items, keyOf),
    total: page.total ?? view.total,
    hasMore: page.hasMore && page.items.length > 0,
    nextPage: view.nextPage + 1,
  };
}

/** Rows of a list after a local change, for example a notification marked read. */
export function patchItems<T>(view: PagedView<T>, patch: (item: T) => T | null): PagedView<T> {
  const items: T[] = [];
  for (const item of view.items) {
    const next = patch(item);
    if (next !== null) items.push(next);
  }
  const removed = view.items.length - items.length;
  return {
    ...view,
    items,
    total: view.total === undefined ? undefined : Math.max(0, view.total - removed),
  };
}
