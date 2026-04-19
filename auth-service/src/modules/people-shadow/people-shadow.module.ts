import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { PeopleShadowConsumer } from './people-shadow.consumer';

@Module({
  imports: [PrismaModule, RabbitMQModule],
  providers: [PeopleShadowConsumer],
})
export class PeopleShadowModule {}
