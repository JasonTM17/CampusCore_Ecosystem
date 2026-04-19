import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [CacheModule, RabbitMQModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
