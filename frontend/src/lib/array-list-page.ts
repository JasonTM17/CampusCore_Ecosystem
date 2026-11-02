/**
 * Shared adapter for the desk queues that answer a bare JSON array plus an
 * optional `X-Total-Count` header. The wire page is zero-based; callers keep
 * display labels one-based. An absent or malformed header means the global
 * total is unknown — never infer it from the current page length.
 */

export interface ArrayListResponse<T> {
  data: T[];
  headers?: unknown;
}

export interface ArrayListPage<T> {
  items: T[];
  page: number;
  /** Present only when the response carried a valid `X-Total-Count`. */
  total?: number;
  /** Present only when `total` is known. */
  totalPages?: number;
}

export interface EmptyPageCorrection {
  page: number;
  /** False when the whole queue is empty, so one more read is unnecessary. */
  refetch: boolean;
}

export interface SequenceGuard {
  /** Start a request and receive its token. Newer tokens supersede older ones. */
  begin(): number;
  /** Whether `token` is still the newest request. */
  isCurrent(token: number): boolean;
}

export interface SingleFlightResult<T> {
  started: boolean;
  value?: T;
}

export interface SingleFlight {
  /** Runs `action` only when no other call is in flight. */
  run<T>(action: () => Promise<T>): Promise<SingleFlightResult<T>>;
}

function headerValue(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    const value = (getter as (key: string) => unknown).call(headers, name);
    if (value !== undefined && value !== null) return value;
  }
  const record = headers as Record<string, unknown>;
  return record[name] ?? record[name.toLowerCase()] ?? record['X-Total-Count'];
}

/** Parse `X-Total-Count`; anything blank, negative or non-integer is unknown. */
export function parseTotalCount(headers: unknown): number | undefined {
  const raw = headerValue(headers, 'X-Total-Count');
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** One-based page count for a known total; `undefined` while the total is unknown. */
export function pageCount(total: number | undefined, pageSize: number): number | undefined {
  if (total === undefined || !Number.isFinite(total)) return undefined;
  const size = Math.max(1, Math.trunc(pageSize) || 1);
  return Math.max(1, Math.ceil(total / size));
}

export function toArrayListPage<T>(
  items: T[],
  page: number,
  headers: unknown,
  pageSize: number,
): ArrayListPage<T> {
  const normalizedPage = Math.max(0, Math.trunc(page) || 0);
  const result: ArrayListPage<T> = { items, page: normalizedPage };
  const total = parseTotalCount(headers);
  if (total !== undefined) {
    result.total = total;
    result.totalPages = pageCount(total, pageSize);
  }
  return result;
}

/** Run one zero-based request and normalise its array + header response. */
export async function fetchArrayListPage<T>(
  page: number,
  limit: number,
  load: (page: number, limit: number) => Promise<ArrayListResponse<T>>,
): Promise<ArrayListPage<T>> {
  const requestPage = Math.max(0, Math.trunc(page) || 0);
  const requestLimit = Math.max(1, Math.trunc(limit) || 1);
  const response = await load(requestPage, requestLimit);
  return toArrayListPage(response.data, requestPage, response.headers, requestLimit);
}

export function hasPreviousPage(page: number): boolean {
  return page > 0;
}

export function hasNextPage(
  page: number,
  totalPages: number | undefined,
  itemCount: number,
  pageSize: number,
): boolean {
  if (totalPages !== undefined) return page + 1 < Math.max(1, totalPages);
  return itemCount >= Math.max(1, Math.trunc(pageSize) || 1);
}

/**
 * An empty non-first page means the queue shrank under the reader. Return the
 * single page correction to try: the last counted page, one step back while
 * the total is unknown, or page zero without a refetch when nothing is left.
 */
export function correctEmptyPage<T>(
  page: number,
  result: Pick<ArrayListPage<T>, 'items' | 'total'>,
  pageSize: number,
): EmptyPageCorrection | null {
  if (page <= 0 || result.items.length > 0) return null;
  if (result.total === 0) return { page: 0, refetch: false };
  if (result.total !== undefined) {
    const lastPage = Math.max(0, (pageCount(result.total, pageSize) ?? 1) - 1);
    return { page: Math.max(0, Math.min(page - 1, lastPage)), refetch: true };
  }
  return { page: page - 1, refetch: true };
}

/** Fence late responses: only the newest token may write desk state. */
export function createSequenceGuard(): SequenceGuard {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(token) {
      return token === current;
    },
  };
}

/** Refuse a second concurrent click before React can commit `disabled`. */
export function createSingleFlight(): SingleFlight {
  let inFlight = false;
  return {
    async run<T>(action: () => Promise<T>): Promise<SingleFlightResult<T>> {
      if (inFlight) return { started: false };
      inFlight = true;
      try {
        return { started: true, value: await action() };
      } finally {
        inFlight = false;
      }
    },
  };
}
