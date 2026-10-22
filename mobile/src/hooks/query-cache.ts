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

const cache = new Map<string, CacheEntry>();

export function queryCacheKey(accountId: string | null, queryKey: string): string {
  return `${accountId ?? 'anonymous'}:${queryKey}`;
}

export function readQueryCache<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export function writeQueryCache(key: string, data: unknown): void {
  cache.set(key, { data, at: Date.now() });
}

export function clearQueryCache(): void {
  cache.clear();
}
