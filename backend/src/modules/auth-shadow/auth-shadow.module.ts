import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { AuthShadowConsumer } from './auth-shadow.consumer';

@Module({
  imports: [PrismaModule, RabbitMQModule],
  providers: [AuthShadowConsumer],
})
export class AuthShadowModule {}
