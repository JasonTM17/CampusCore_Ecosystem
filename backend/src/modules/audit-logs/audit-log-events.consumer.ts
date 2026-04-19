import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

const AUDIT_LOG_EVENTS_QUEUE = 'audit-log-events' as const;

type AuditLogEvent = {
  type: 'audit-log.created';
  payload: {
    userId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    oldValues?: unknown;
    newValues?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
    description?: string | null;
  };
};

@Injectable()
export class AuditLogEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(AuditLogEventsConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.rabbitMQService.consumeMessages(
      AUDIT_LOG_EVENTS_QUEUE,
      async (message) => {
        await this.handleEvent(message as AuditLogEvent);
      },
    );
  }

  private async handleEvent(event: AuditLogEvent) {
    if (event.type !== 'audit-log.created') {
      this.logger.warn(`Ignoring unsupported audit log event: ${event.type}`);
      return;
    }

    await this.prisma.auditLog.create({
      data: {
        userId: event.payload.userId ?? null,
        action: event.payload.action,
        entity: event.payload.entity,
        entityId: event.payload.entityId ?? null,
        oldValues: this.toAuditJson(event.payload.oldValues),
        newValues: this.toAuditJson(event.payload.newValues),
        ipAddress: event.payload.ipAddress ?? null,
        userAgent: event.payload.userAgent ?? null,
        description: event.payload.description ?? null,
      },
    });
  }

  private toAuditJson(value: unknown) {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
