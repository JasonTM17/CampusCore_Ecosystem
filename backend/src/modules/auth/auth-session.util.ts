import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Request, Response, CookieOptions } from 'express';
import { ENV, ENV_DEFAULTS } from '../../config/env.constants';

export const ACCESS_TOKEN_COOKIE = 'cc_access_token';
export const REFRESH_TOKEN_COOKIE = 'cc_refresh_token';
export const CSRF_COOKIE = 'cc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

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

function buildCookieOptions(
  configService: ConfigService,
  request: Request | undefined,
  maxAgeMs: number,
  httpOnly: boolean,
): CookieOptions {
  return {
    httpOnly,
    sameSite: 'lax',
    secure: resolveCookieSecure(configService, request),
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function parseDurationToMs(duration: string) {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());

  if (!match) {
    throw new Error(`Invalid duration configuration: ${duration}`);
  }

  const value = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unsupported duration unit: ${unit}`);
  }
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
  const csrfToken = randomBytes(24).toString('hex');

  response.cookie(
    ACCESS_TOKEN_COOKIE,
    tokens.accessToken,
    buildCookieOptions(configService, request, accessMaxAge, true),
  );
  response.cookie(
    REFRESH_TOKEN_COOKIE,
    tokens.refreshToken,
    buildCookieOptions(configService, request, refreshMaxAge, true),
  );
  response.cookie(
    CSRF_COOKIE,
    csrfToken,
    buildCookieOptions(configService, request, refreshMaxAge, false),
  );
}

export function clearSessionCookies(
  response: Response,
  configService: ConfigService,
  request?: Request,
) {
  const expiredOptions = {
    ...buildCookieOptions(configService, request, 0, true),
    expires: new Date(0),
  };
  const expiredReadableOptions = {
    ...buildCookieOptions(configService, request, 0, false),
    expires: new Date(0),
  };

  response.clearCookie(ACCESS_TOKEN_COOKIE, expiredOptions);
  response.clearCookie(REFRESH_TOKEN_COOKIE, expiredOptions);
  response.clearCookie(CSRF_COOKIE, expiredReadableOptions);
}

export function extractAccessTokenFromRequest(request: Request) {
  const headerToken = request.headers.authorization;

  if (typeof headerToken === 'string' && headerToken.startsWith('Bearer ')) {
    return headerToken.slice(7);
  }

  const cookieToken = request.cookies?.[ACCESS_TOKEN_COOKIE];
  return typeof cookieToken === 'string' && cookieToken.trim()
    ? cookieToken
    : null;
}

export function extractRefreshTokenFromRequest(request: Request) {
  const bodyToken =
    typeof request.body?.refreshToken === 'string'
      ? request.body.refreshToken
      : null;

  if (bodyToken) {
    return bodyToken;
  }

  const cookieToken = request.cookies?.[REFRESH_TOKEN_COOKIE];
  return typeof cookieToken === 'string' && cookieToken.trim()
    ? cookieToken
    : null;
}

export function hasBearerAuthorization(request: Request) {
  return (
    typeof request.headers.authorization === 'string' &&
    request.headers.authorization.startsWith('Bearer ')
  );
}

export function hasSessionCookie(request: Request) {
  return Boolean(
    request.cookies?.[ACCESS_TOKEN_COOKIE] ||
    request.cookies?.[REFRESH_TOKEN_COOKIE],
  );
}
