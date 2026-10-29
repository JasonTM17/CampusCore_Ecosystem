/**
 * Per-account in-memory query cache (mobile-policy §5). Keys are
 * `${accountId}:${queryKey}` plus an optional scope tuple, so an account,
 * locale, role or capability-grant change moves to a different keyspace and the
 * previous one is unreachable. Memory only: nothing in this module may touch
 * disk (the disk whitelist is session-store's three keys), so a private read
 * model never outlives the process.
 *
 * Wipe points: `clearQueryCache` runs on sign-out and session expiry,
 * `syncQueryCacheIdentity` clears whenever the account, role or grant set
 * changes, and `evictQueryCache` drops one entry after a 403.
 *
 * Lane resources (dean, staff, admin) are never stored: they are
 * authorization-scoped, and audit rows must not sit in an offline cache.
 */

interface CacheEntry {
  data: unknown;
  at: number;
}

export interface QueryCacheScope {
  locale?: string;
  roleLane?: string;
  /** Capability grants held by the session; order does not matter. */
  grants?: readonly string[];
  /** Server filter, sort or search that changes the result set. */
  filter?: string;
  page?: number;
}

const cache = new Map<string, CacheEntry>();

/** Resource namespaces that are flag/grant gated lanes and never cached. */
const LANE_RESOURCE_PREFIXES: readonly string[] = ['lane.', 'dean.', 'staff.', 'admin.'];
const UNCACHEABLE_SUFFIX = ':uncacheable';

export function isLaneQueryKey(queryKey: string): boolean {
  return LANE_RESOURCE_PREFIXES.some((prefix) => queryKey.startsWith(prefix));
}

function scopeTuple(scope: QueryCacheScope): string | null {
  const grants = scope.grants === undefined ? null : [...new Set(scope.grants)].sort();
  const tuple: Array<string | number | string[] | null> = [
    scope.locale ?? null,
    scope.roleLane ?? null,
    grants,
    scope.filter ?? null,
    scope.page ?? null,
  ];
  while (tuple.length > 0 && tuple[tuple.length - 1] === null) tuple.pop();
  return tuple.length === 0 ? null : JSON.stringify(tuple);
}

export function queryCacheKey(
  accountId: string | null,
  queryKey: string,
  scope?: QueryCacheScope,
): string {
  const base = `${accountId ?? 'anonymous'}:${queryKey}`;
  const tuple = scope ? scopeTuple(scope) : null;
  const key = tuple === null ? base : `${base}:scope:${tuple}`;
  return isLaneQueryKey(queryKey) ? `${key}${UNCACHEABLE_SUFFIX}` : key;
}

export function readQueryCache<T>(key: string, maxAge?: number): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (maxAge !== undefined && Date.now() - entry.at > maxAge) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function writeQueryCache(key: string, data: unknown): void {
  if (key.endsWith(UNCACHEABLE_SUFFIX)) return;
  cache.set(key, { data, at: Date.now() });
}

export function evictQueryCache(key: string): void {
  cache.delete(key);
}

export function clearQueryCache(): void {
  cache.clear();
}

let activeIdentity: string | null = null;

export function queryCacheIdentity(
  kind: string,
  accountId: string | null,
  role: string,
  grants: readonly string[],
): string {
  return JSON.stringify([kind, accountId, role, [...new Set(grants)].sort()]);
}

/**
 * Called with the current session identity. Any change (sign-out, account
 * switch, role change, grant added or revoked) wipes every entry, so data read
 * under a previous identity or grant cannot be shown after the change.
 */
export function syncQueryCacheIdentity(identity: string): void {
  if (identity === activeIdentity) return;
  activeIdentity = identity;
  cache.clear();
}
