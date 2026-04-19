import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { AuthShadowPublisher } from './auth-shadow.publisher';

@Global()
@Module({
  imports: [PrismaModule, RabbitMQModule],
  providers: [AuthShadowPublisher],
  exports: [AuthShadowPublisher],
})
export class AuthShadowModule {}
