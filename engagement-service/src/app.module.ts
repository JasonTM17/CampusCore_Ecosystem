import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from './config/env.validation';
import { PrismaModule } from './modules/common/prisma/prisma.module';
import { CommonModule } from './modules/common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { RabbitMQModule } from './modules/rabbitmq/rabbitmq.module';
import { HealthModule } from './modules/health/health.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { SupportTicketsModule } from './modules/support-tickets/support-tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile:
        process.env.NODE_ENV === 'test' ||
        process.env.NODE_ENV === 'production',
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 1000,
        limit: 20,
      },
    ]),
    PrismaModule,
    CommonModule,
    AuthModule,
    RabbitMQModule,
    HealthModule,
    AnnouncementsModule,
    SupportTicketsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
