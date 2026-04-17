export const CACHE_RUNTIME_STATUS = 'CACHE_RUNTIME_STATUS';

export type CacheBackend = 'memory' | 'redis';

export interface CacheRuntimeStatus {
  backend: CacheBackend;
  redisConfigured: boolean;
  fallbackToMemory: boolean;
}
