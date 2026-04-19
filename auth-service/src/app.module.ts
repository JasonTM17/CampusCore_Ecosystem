import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './modules/common/prisma/prisma.module';
import { CacheModule } from './modules/cache/cache.module';
import { RabbitMQModule } from './modules/rabbitmq/rabbitmq.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthContextModule } from './modules/auth-context/auth-context.module';
import { AuthShadowModule } from './modules/auth-shadow/auth-shadow.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { PeopleShadowModule } from './modules/people-shadow/people-shadow.module';
import { HealthModule } from './modules/health/health.module';
import { validateEnvironment } from './config/env.validation';

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
        name: 'short',
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 10000,
        limit: 50,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    CacheModule,
    RabbitMQModule,
    AuthModule,
    AuthContextModule,
    AuthShadowModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    PeopleShadowModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
