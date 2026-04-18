import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureHttpApp } from './bootstrap';
import { ENV, ENV_DEFAULTS } from './config/env.constants';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const { swaggerEnabled } = configureHttpApp(app);
  const configService = app.get(ConfigService);
  const port = configService.get<number>(ENV.PORT) ?? ENV_DEFAULTS.PORT;

  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`CampusCore Notification Service running on port ${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
  }
}

bootstrap();
