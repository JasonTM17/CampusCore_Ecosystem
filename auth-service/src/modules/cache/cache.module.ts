import { Module, Global, Logger } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KeyvAdapter } from 'cache-manager';
import { Keyv } from 'keyv';
import { CachingService } from './caching.service';
import { ENV } from '../../config/env.constants';
import { CACHE_RUNTIME_STATUS, CacheRuntimeStatus } from './cache.constants';

const CACHE_NAMESPACE = 'campuscore';
const CACHE_TTL = 300;
const cacheLogger = new Logger('CacheModule');

const cacheRuntimeStatus: CacheRuntimeStatus = {
  backend: 'memory',
  redisConfigured: false,
  fallbackToMemory: false,
};

@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>(ENV.REDIS_URL);
        const useRedis = redisUrl && redisUrl.startsWith('redis://');

        let store: any;
        cacheRuntimeStatus.redisConfigured = Boolean(useRedis);
        cacheRuntimeStatus.fallbackToMemory = false;

        if (useRedis) {
          try {
            const { redisStore } = await import('cache-manager-redis-store');
            const redisCacheStore = await redisStore({
              url: redisUrl,
              ttl: CACHE_TTL,
            });
            store = new Keyv({
              store: new KeyvAdapter(
                redisCacheStore as unknown as ConstructorParameters<
                  typeof KeyvAdapter
                >[0],
              ),
              namespace: CACHE_NAMESPACE,
              ttl: CACHE_TTL,
            });
            cacheRuntimeStatus.backend = 'redis';
            cacheLogger.log('Redis caching enabled');
          } catch (error) {
            cacheLogger.warn(
              'Failed to initialize Redis store, falling back to memory store:',
              error,
            );
            store = undefined;
            cacheRuntimeStatus.backend = 'memory';
            cacheRuntimeStatus.fallbackToMemory = true;
          }
        } else {
          cacheLogger.log('Using in-memory cache store');
          store = undefined;
          cacheRuntimeStatus.backend = 'memory';
        }

        return {
          ...(store ? { stores: [store] } : {}),
          ttl: CACHE_TTL,
          namespace: CACHE_NAMESPACE,
        };
      },
    }),
  ],
  providers: [
    CachingService,
    {
      provide: CACHE_RUNTIME_STATUS,
      useValue: cacheRuntimeStatus,
    },
  ],
  exports: [NestCacheModule, CachingService, CACHE_RUNTIME_STATUS],
})
export class CacheModule {}
