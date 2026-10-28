/**
 * Per-account in-memory query cache (mobile-policy §5). Keys are
 * `${accountId}:${queryKey}` — an account switch changes the keyspace, so a
 * previous account's academic data is unreachable. Memory only: nothing in
 * this module may touch disk (the disk whitelist is session-store's three
 * keys). `clearQueryCache` runs on every sign-out.
 */

interface CacheEntry {
  data: unknown;
  at: number;
}

export interface QueryCacheScope {
  locale?: string;
  roleLane?: string;
}

const cache = new Map<string, CacheEntry>();

export function queryCacheKey(
  accountId: string | null,
  queryKey: string,
  scope?: QueryCacheScope,
): string {
  const base = `${accountId ?? 'anonymous'}:${queryKey}`;
  if (!scope || (scope.locale === undefined && scope.roleLane === undefined)) return base;
  return `${base}:scope:${JSON.stringify([scope.locale ?? null, scope.roleLane ?? null])}`;
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
  cache.set(key, { data, at: Date.now() });
}

export function clearQueryCache(): void {
  cache.clear();
}
