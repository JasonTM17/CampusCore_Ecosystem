import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_TOKEN_COOKIE,
  clearSessionCookies as clearSharedSessionCookies,
  extractAccessTokenFromRequest,
  extractRefreshTokenFromRequest,
  hasBearerAuthorization,
  hasSessionCookie,
  issueSessionCookies as issueSharedSessionCookies,
  parseDurationToMs,
} from '@campuscore/platform-auth';
import { ENV, ENV_DEFAULTS } from '../../config/env.constants';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

function resolveCookieSecure(
  configService: ConfigService,
  request?: Request,
): boolean {
  const explicitSecure = configService.get<boolean | undefined>(
    ENV.COOKIE_SECURE,
  );

  if (explicitSecure !== undefined) {
    return explicitSecure;
  }

  const forwardedProto = request?.headers?.['x-forwarded-proto'];
  if (
    typeof forwardedProto === 'string' &&
    forwardedProto.split(',').some((proto) => proto.trim() === 'https')
  ) {
    return true;
  }

  if (request?.protocol === 'https') {
    return true;
  }

  const frontendUrl =
    configService.get<string>(ENV.FRONTEND_URL) ?? ENV_DEFAULTS.FRONTEND_URL;

  return frontendUrl.startsWith('https://');
}

export function issueSessionCookies(
  response: Response,
  configService: ConfigService,
  tokens: AuthTokens,
  request?: Request,
) {
  const accessMaxAge = parseDurationToMs(
    configService.get<string>(ENV.JWT_EXPIRES_IN, ENV_DEFAULTS.JWT_EXPIRES_IN),
  );
  const refreshMaxAge = parseDurationToMs(
    configService.get<string>(
      ENV.JWT_REFRESH_EXPIRES_IN,
      ENV_DEFAULTS.JWT_REFRESH_EXPIRES_IN,
    ),
  );
  issueSharedSessionCookies(response, {
    ...tokens,
    accessMaxAgeMs: accessMaxAge,
    refreshMaxAgeMs: refreshMaxAge,
    secure: resolveCookieSecure(configService, request),
    path: '/',
  });
}

export function clearSessionCookies(
  response: Response,
  configService: ConfigService,
  request?: Request,
) {
  clearSharedSessionCookies(response, {
    secure: resolveCookieSecure(configService, request),
    path: '/',
  });
}

export {
  ACCESS_TOKEN_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_TOKEN_COOKIE,
  extractAccessTokenFromRequest,
  extractRefreshTokenFromRequest,
  hasBearerAuthorization,
  hasSessionCookie,
  parseDurationToMs,
};
