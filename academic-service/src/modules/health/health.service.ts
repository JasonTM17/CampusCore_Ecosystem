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
      service: 'campuscore-academic-service',
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
      service: 'campuscore-academic-service',
      services: {
        database,
        rabbitmq,
      },
    };
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
