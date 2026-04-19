import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ENV, ENV_DEFAULTS } from './config/env.constants';
import { configureHttpApp, logBootstrapSummary } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const { configService, swaggerEnabled } = configureHttpApp(app);
  const port = configService.get<number>(ENV.PORT) ?? ENV_DEFAULTS.PORT;

  await app.listen(port);
  logBootstrapSummary(port, swaggerEnabled);
}

void bootstrap();
