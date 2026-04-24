import { Logger, ValidationPipe, ForbiddenException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { join } from 'path';
import { ENV, ENV_DEFAULTS } from './config/env.constants';
import { getAllowedOrigins, isAllowedOrigin } from './config/cors.util';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_TOKEN_COOKIE,
  hasBearerAuthorization,
  hasSessionCookie,
} from '@campuscore/platform-auth';
import { GlobalExceptionFilter } from './modules/common/filters/global-exception.filter';

const logger = new Logger('Bootstrap');

function isSafeMethod(method: string) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function shouldProtectWithCsrf(req: Request) {
  if (isSafeMethod(req.method)) {
    return false;
  }

  if (hasBearerAuthorization(req)) {
    return false;
  }

  return hasSessionCookie(req);
}

export function configureHttpApp(app: NestExpressApplication) {
  const configService = app.get(ConfigService);
  const frontendUrl =
    configService.get<string>(ENV.FRONTEND_URL) ?? ENV_DEFAULTS.FRONTEND_URL;
  const swaggerEnabled =
    configService.get<boolean>(ENV.SWAGGER_ENABLED) ??
    ENV_DEFAULTS.SWAGGER_ENABLED;
  const allowedOrigins = getAllowedOrigins(frontendUrl);

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
  app.use(cookieParser());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!shouldProtectWithCsrf(req)) {
      next();
      return;
    }

    const csrfCookie = req.cookies?.[CSRF_COOKIE];
    const csrfHeader = req.headers[CSRF_HEADER];

    if (
      typeof csrfCookie !== 'string' ||
      typeof csrfHeader !== 'string' ||
      csrfHeader !== csrfCookie
    ) {
      next(new ForbiddenException('Invalid CSRF token'));
      return;
    }

    next();
  });

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
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api/v1');

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('CampusCore API')
      .setDescription('Enterprise Academic Management Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth(ACCESS_TOKEN_COOKIE, {
        type: 'apiKey',
        in: 'cookie',
        name: ACCESS_TOKEN_COOKIE,
      })
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: CSRF_HEADER,
        },
        'csrf',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: false,
      },
    });
  }

  return {
    configService,
    frontendUrl,
    swaggerEnabled,
    allowedOrigins,
  };
}

export function logBootstrapSummary(port: number, swaggerEnabled: boolean) {
  logger.log(`CampusCore API running on port ${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
  } else {
    logger.log('Swagger docs are disabled for this runtime');
  }
  logger.debug(
    `Session cookies enabled: ${ACCESS_TOKEN_COOKIE}, ${REFRESH_TOKEN_COOKIE}, ${CSRF_COOKIE}`,
  );
}
