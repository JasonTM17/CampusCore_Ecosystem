import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as cacheManager from 'cache-manager';
import { CachingService } from './caching.service';

@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        const useRedis = redisUrl && redisUrl.startsWith('redis://');
        
        let store: any;
        
        if (useRedis) {
          try {
            const { redisStore } = await import('cache-manager-redis-store');
            store = await redisStore({
              url: redisUrl,
              ttl: 300,
            });
            console.log('Redis caching enabled');
          } catch (error) {
            console.warn('Failed to initialize Redis store, falling back to memory store:', error);
            store = cacheManager.caching({ store: 'memory', ttl: 300 });
          }
        } else {
          console.log('Using in-memory cache store');
          store = cacheManager.caching({ store: 'memory', ttl: 300 });
        }
        
        return {
          store,
          ttl: 300, // default TTL: 5 minutes
          isGlobalPrefixed: true,
          prefix: 'campuscore:',
        };
      },
    }),
  ],
  providers: [CachingService],
  exports: [NestCacheModule, CachingService],
})
export class CacheModule {}
