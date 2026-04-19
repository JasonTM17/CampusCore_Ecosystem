import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class CachingService implements OnModuleDestroy {
  private destroyed = false;

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  async reset(): Promise<void> {
    const cache = this.cacheManager as Cache & {
      clear?: () => Promise<boolean>;
      keys?: () => Promise<string[]>;
      disconnect?: () => Promise<void>;
    };

    if (cache.clear) {
      await cache.clear();
      return;
    }

    const keys = await cache.keys?.();
    if (keys && keys.length > 0) {
      for (const key of keys) {
        await this.cacheManager.del(key);
      }
    }
  }

  // Helper for caching function results
  async cacheOrExecute<T>(
    key: string,
    fn: () => Promise<T>,
    ttl: number = 300,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = await fn();
    await this.set(key, result, ttl);
    return result;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    const cache = this.cacheManager as Cache & {
      disconnect?: () => Promise<void>;
      stores?: unknown[];
    };

    await this.ignoreAlreadyClosed(() => cache.disconnect?.());

    for (const store of cache.stores ?? []) {
      const candidate = store as unknown as {
        disconnect?: () => Promise<void>;
        opts?: {
          store?: {
            disconnect?: () => Promise<void>;
            getClient?: () => {
              quit?: () => Promise<void>;
            };
            _cache?: {
              getClient?: () => {
                quit?: () => Promise<void>;
              };
            };
          };
        };
        _store?: {
          disconnect?: () => Promise<void>;
          getClient?: () => {
            quit?: () => Promise<void>;
          };
        };
        store?: {
          disconnect?: () => Promise<void>;
          getClient?: () => {
            quit?: () => Promise<void>;
          };
        };
      };

      await this.ignoreAlreadyClosed(() => candidate.disconnect?.());
      await this.ignoreAlreadyClosed(() =>
        candidate.opts?.store?.disconnect?.(),
      );
      await this.ignoreAlreadyClosed(() => candidate._store?.disconnect?.());
      await this.ignoreAlreadyClosed(() => candidate.store?.disconnect?.());
      await this.ignoreAlreadyClosed(() =>
        candidate.opts?.store?.getClient?.()?.quit?.(),
      );
      await this.ignoreAlreadyClosed(() =>
        candidate.opts?.store?._cache?.getClient?.()?.quit?.(),
      );
      await this.ignoreAlreadyClosed(() =>
        candidate._store?.getClient?.()?.quit?.(),
      );
      await this.ignoreAlreadyClosed(() =>
        candidate.store?.getClient?.()?.quit?.(),
      );
    }
  }

  private async ignoreAlreadyClosed(
    operation: () => Promise<void> | undefined,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (error instanceof Error && /client is closed/i.test(error.message)) {
        return;
      }

      throw error;
    }
  }
}
