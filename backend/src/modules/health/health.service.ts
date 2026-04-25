import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { CachingService } from '../cache/caching.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  CACHE_RUNTIME_STATUS,
  CacheRuntimeStatus,
} from '../cache/cache.constants';

type DependencyStatus = {
  status: 'up' | 'down' | 'not_configured';
  latency?: number;
};

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

  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'campuscore-api',
    };
  }

  async readiness() {
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

  async check() {
    return this.readiness();
  }

  async metrics() {
    const readiness = await this.readiness();
    const services = readiness.services;
    const rssBytes = process.memoryUsage().rss;
    const heapUsedBytes = process.memoryUsage().heapUsed;

    return [
      '# HELP campuscore_service_up Service liveness status.',
      '# TYPE campuscore_service_up gauge',
      'campuscore_service_up{service="campuscore-api"} 1',
      '# HELP campuscore_dependency_up Dependency status by service.',
      '# TYPE campuscore_dependency_up gauge',
      `campuscore_dependency_up{service="campuscore-api",dependency="database"} ${services.database.status === 'up' ? 1 : 0}`,
      `campuscore_dependency_up{service="campuscore-api",dependency="redis"} ${services.redis.status === 'up' ? 1 : 0}`,
      `campuscore_dependency_up{service="campuscore-api",dependency="rabbitmq"} ${services.rabbitmq.status === 'up' ? 1 : 0}`,
      '# HELP campuscore_dependency_latency_ms Dependency latency in milliseconds.',
      '# TYPE campuscore_dependency_latency_ms gauge',
      `campuscore_dependency_latency_ms{service="campuscore-api",dependency="database"} ${services.database.latency ?? 0}`,
      `campuscore_dependency_latency_ms{service="campuscore-api",dependency="redis"} ${services.redis.latency ?? 0}`,
      `campuscore_dependency_latency_ms{service="campuscore-api",dependency="rabbitmq"} ${services.rabbitmq.latency ?? 0}`,
      '# HELP process_resident_memory_bytes Resident memory usage in bytes.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes{service="campuscore-api"} ${rssBytes}`,
      '# HELP process_heap_used_bytes Heap usage in bytes.',
      '# TYPE process_heap_used_bytes gauge',
      `process_heap_used_bytes{service="campuscore-api"} ${heapUsedBytes}`,
    ].join('\n');
  }

  private async checkDatabase(): Promise<DependencyStatus> {
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

  private async checkRedis(): Promise<DependencyStatus> {
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
      const testKey = `health:check:${randomUUID()}`;
      await this.cachingService.set(testKey, 'ok', 30_000);
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

  private async checkRabbitMQ(): Promise<DependencyStatus> {
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
