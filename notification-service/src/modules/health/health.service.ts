import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

type DependencyStatus = {
  status: 'up' | 'down' | 'not_configured';
  latency?: number;
};

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'campuscore-notification-service',
    };
  }

  async readiness() {
    const database = await this.checkDatabase();
    const rabbitmq = await this.checkRabbitMQ();

    return {
      status:
        database.status === 'down' || rabbitmq.status === 'down'
          ? 'degraded'
          : 'ok',
      timestamp: new Date().toISOString(),
      service: 'campuscore-notification-service',
      services: {
        database,
        rabbitmq,
      },
    };
  }

  async metrics() {
    const readiness = await this.readiness();
    const services = readiness.services;
    const rssBytes = process.memoryUsage().rss;
    const heapUsedBytes = process.memoryUsage().heapUsed;

    return [
      '# HELP campuscore_service_up Service liveness status.',
      '# TYPE campuscore_service_up gauge',
      'campuscore_service_up{service="campuscore-notification-service"} 1',
      '# HELP campuscore_dependency_up Dependency status by service.',
      '# TYPE campuscore_dependency_up gauge',
      `campuscore_dependency_up{service="campuscore-notification-service",dependency="database"} ${services.database.status === 'up' ? 1 : 0}`,
      `campuscore_dependency_up{service="campuscore-notification-service",dependency="rabbitmq"} ${services.rabbitmq.status === 'up' ? 1 : 0}`,
      '# HELP campuscore_dependency_latency_ms Dependency latency in milliseconds.',
      '# TYPE campuscore_dependency_latency_ms gauge',
      `campuscore_dependency_latency_ms{service="campuscore-notification-service",dependency="database"} ${services.database.latency ?? 0}`,
      `campuscore_dependency_latency_ms{service="campuscore-notification-service",dependency="rabbitmq"} ${services.rabbitmq.latency ?? 0}`,
      '# HELP process_resident_memory_bytes Resident memory usage in bytes.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes{service="campuscore-notification-service"} ${rssBytes}`,
      '# HELP process_heap_used_bytes Heap usage in bytes.',
      '# TYPE process_heap_used_bytes gauge',
      `process_heap_used_bytes{service="campuscore-notification-service"} ${heapUsedBytes}`,
    ].join('\n');
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'up',
        latency: Date.now() - start,
      };
    } catch (error) {
      this.logger.error('Database health check failed', error as Error);
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
      return {
        status: isConnected ? 'up' : 'down',
        latency: Date.now() - start,
      };
    } catch (error) {
      this.logger.error('RabbitMQ health check failed', error as Error);
      return { status: 'down' };
    }
  }
}
