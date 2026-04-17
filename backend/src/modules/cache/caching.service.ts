import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class CachingService {
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
}
