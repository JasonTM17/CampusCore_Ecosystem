import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './modules/common/filters/global-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { ENV, ENV_DEFAULTS } from './config/env.constants';
import { getAllowedOrigins, isAllowedOrigin } from './config/cors.util';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const configService = app.get(ConfigService);
  const frontendUrl =
    configService.get<string>(ENV.FRONTEND_URL) ?? ENV_DEFAULTS.FRONTEND_URL;
  const port = configService.get<number>(ENV.PORT) ?? ENV_DEFAULTS.PORT;
  const swaggerEnabled =
    configService.get<boolean>(ENV.SWAGGER_ENABLED) ??
    ENV_DEFAULTS.SWAGGER_ENABLED;
  const allowedOrigins = getAllowedOrigins(frontendUrl);

  // Serve static files from uploads directory
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );

  app.enableCors({
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin, allowedOrigins));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Register global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  app.setGlobalPrefix('api/v1');

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('CampusCore API')
      .setDescription('Enterprise Academic Management Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: false,
      },
    });
  }

  await app.listen(port);

  logger.log(`CampusCore API running on port ${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
  } else {
    logger.log('Swagger docs are disabled for this runtime');
  }
}
bootstrap();
