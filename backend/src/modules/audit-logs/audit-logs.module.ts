import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogEventsConsumer } from './audit-log-events.consumer';

@Module({
  imports: [PrismaModule, RabbitMQModule],
  controllers: [AuditLogsController],
  providers: [AuditLogsService, AuditLogEventsConsumer],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
