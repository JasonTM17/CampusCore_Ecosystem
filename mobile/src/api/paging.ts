/**
 * Optional paging for list endpoints whose body is a bare JSON array. The
 * server window is `page` (0-based) + `limit` (1..100); the size of the whole
 * authorised list travels only in the `X-Total-Count` response header. With no
 * paging parameters the endpoint returns the full legacy list.
 */
export const TOTAL_COUNT_HEADER = 'X-Total-Count';
export const MAX_PAGE_LIMIT = 100;

export interface PageParams {
  /** 0-based page index; requires `limit`. */
  page?: number;
  /** Rows per page, 1..100. */
  limit?: number;
}

export interface PagedResult<T> {
  items: T[];
  /** Whole-list size from `X-Total-Count`; absent when the header is absent. */
  total?: number;
  /** False for an unpaged read or when the list is exhausted. */
  hasMore: boolean;
}

type HeaderReader = { get(name: string): string | null };
type QueryValue = string | number | boolean | null | undefined;

/** Validates the window the same way the server does so a bad call fails before the request. */
export function pagingParams(paging?: PageParams): Record<string, number> {
  if (!paging || (paging.page === undefined && paging.limit === undefined)) return {};
  const { page, limit } = paging;
  if (limit === undefined) {
    throw new RangeError('limit is required when page is given');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`);
  }
  if (page !== undefined && (!Number.isInteger(page) || page < 0)) {
    throw new RangeError('page must be an integer of 0 or greater');
  }
  return page === undefined ? { limit } : { page, limit };
}

/** `?a=1&b=2` for the defined, non-empty values only; empty string when nothing remains. */
export function buildQuery(values: Record<string, QueryValue>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function parseTotalCount(headers: HeaderReader | null | undefined): number | undefined {
  const raw = headers?.get(TOTAL_COUNT_HEADER);
  if (raw === null || raw === undefined || !/^\d+$/.test(raw.trim())) return undefined;
  const total = Number(raw.trim());
  return Number.isSafeInteger(total) ? total : undefined;
}

/** Wraps the bare-array body; the end of the list is the total when known, else a short page. */
export function toPagedResult<T>(
  body: unknown,
  headers: HeaderReader | null | undefined,
  paging?: PageParams,
): PagedResult<T> {
  if (!Array.isArray(body)) {
    throw new TypeError('Expected a bare array response body');
  }
  const items = body as T[];
  const total = parseTotalCount(headers);
  const window = pagingParams(paging);
  const limit = window.limit;
  let hasMore = false;
  if (limit !== undefined) {
    const offset = (window.page ?? 0) * limit;
    hasMore = total !== undefined ? offset + items.length < total : items.length >= limit;
  }
  return total === undefined ? { items, hasMore } : { items, total, hasMore };
}
