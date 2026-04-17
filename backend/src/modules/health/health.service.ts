import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CachingService } from '../cache/caching.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  CACHE_RUNTIME_STATUS,
  CacheRuntimeStatus,
} from '../cache/cache.constants';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private prisma: PrismaService,
    private cachingService: CachingService,
    private rabbitMQService: RabbitMQService,
    @Inject(CACHE_RUNTIME_STATUS)
    private readonly cacheRuntimeStatus: CacheRuntimeStatus,
  ) {}

  async check() {
    const dbCheck = await this.checkDatabase();
    const redisCheck = await this.checkRedis();
    const rabbitmqCheck = await this.checkRabbitMQ();

    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: dbCheck,
        redis: redisCheck,
        rabbitmq: rabbitmqCheck,
      },
    };

    if (
      dbCheck.status === 'down' ||
      redisCheck.status === 'down' ||
      rabbitmqCheck.status === 'down'
    ) {
      health.status = 'degraded';
    }

    return health;
  }

  private async checkDatabase(): Promise<{ status: string; latency?: number }> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;

      return { status: 'up', latency };
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return { status: 'down' };
    }
  }

  private async checkRedis(): Promise<{ status: string; latency?: number }> {
    if (this.cacheRuntimeStatus.backend !== 'redis') {
      return {
        status: this.cacheRuntimeStatus.redisConfigured
          ? 'down'
          : 'not_configured',
      };
    }

    try {
      const start = Date.now();
      // Test Redis connection by setting and getting a value
      const testKey = 'health:check';
      await this.cachingService.set(testKey, 'ok', 10);
      const result = await this.cachingService.get<string>(testKey);
      await this.cachingService.del(testKey);
      const latency = Date.now() - start;

      if (result !== 'ok') {
        throw new Error('Redis returned unexpected result');
      }

      return { status: 'up', latency };
    } catch (error) {
      this.logger.error('Redis health check failed', error);
      return { status: 'down' };
    }
  }

  private async checkRabbitMQ(): Promise<{ status: string; latency?: number }> {
    try {
      if (!this.rabbitMQService.isConfigured()) {
        return { status: 'not_configured' };
      }

      const start = Date.now();
      const isConnected = this.rabbitMQService.isConnected();
      const latency = Date.now() - start;

      if (!isConnected) {
        return { status: 'down', latency };
      }

      return { status: 'up', latency };
    } catch (error) {
      this.logger.error('RabbitMQ health check failed', error);
      return { status: 'down' };
    }
  }
}
