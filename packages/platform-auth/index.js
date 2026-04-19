const { randomBytes } = require('crypto');
const {
  createParamDecorator,
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
} = require('@nestjs/common');
const { Reflector } = require('@nestjs/core');
const { AuthGuard } = require('@nestjs/passport');

const ACCESS_TOKEN_COOKIE = 'cc_access_token';
const REFRESH_TOKEN_COOKIE = 'cc_refresh_token';
const CSRF_COOKIE = 'cc_csrf';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';
const INTERNAL_API_PREFIX = '/api/v1/internal';
const INTERNAL_SERVICE_TOKEN_HEADER = 'x-service-token';
const INTERNAL_SERVICE_TOKEN_HEADER_NAME = 'X-Service-Token';
const HEALTH_READINESS_HEADER = 'x-health-key';
const HEALTH_READINESS_HEADER_NAME = 'X-Health-Key';
const JWT_CLAIMS_VERSION = 1;
const ROLES_KEY = 'roles';

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf('=');

      if (separatorIndex === -1) {
        return cookies;
      }

      const name = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();

      if (name) {
        cookies[name] = decodeURIComponent(value);
      }

      return cookies;
    }, {});
}

function normalizeSetCookie(setCookie) {
  if (!setCookie) {
    return [];
  }

  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

function extractCookieValue(setCookie, name) {
  const cookies = normalizeSetCookie(setCookie);
  if (cookies.length === 0) {
    return undefined;
  }

  for (const cookie of cookies) {
    const [pair] = cookie.split(';', 1);
    const [cookieName, ...rest] = pair.split('=');
    if (cookieName === name) {
      return rest.join('=');
    }
  }

  return undefined;
}

function toCookieHeader(setCookie) {
  return normalizeSetCookie(setCookie)
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

function extractAccessTokenFromCookieHeader(cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader);
  const cookieToken = cookies[ACCESS_TOKEN_COOKIE];

  return typeof cookieToken === 'string' && cookieToken.trim()
    ? cookieToken
    : null;
}

function extractAccessTokenFromRequest(request) {
  const headers = request?.headers ?? {};
  const headerToken = headers.authorization;

  if (typeof headerToken === 'string' && headerToken.startsWith('Bearer ')) {
    return headerToken.slice(7);
  }

  const cookieToken =
    request?.cookies?.[ACCESS_TOKEN_COOKIE] ??
    extractAccessTokenFromCookieHeader(headers.cookie);

  return typeof cookieToken === 'string' && cookieToken.trim()
    ? cookieToken
    : null;
}

function extractRefreshTokenFromRequest(request) {
  const bodyToken =
    typeof request?.body?.refreshToken === 'string'
      ? request.body.refreshToken
      : null;

  if (bodyToken) {
    return bodyToken;
  }

  const cookieToken =
    request?.cookies?.[REFRESH_TOKEN_COOKIE] ??
    parseCookieHeader(request?.headers?.cookie)[REFRESH_TOKEN_COOKIE];

  return typeof cookieToken === 'string' && cookieToken.trim()
    ? cookieToken
    : null;
}

function hasBearerAuthorization(request) {
  const authorization = request?.headers?.authorization;
  return (
    typeof authorization === 'string' &&
    authorization.startsWith('Bearer ')
  );
}

function hasSessionCookie(request) {
  const cookies = request?.cookies ?? parseCookieHeader(request?.headers?.cookie);
  return Boolean(cookies[ACCESS_TOKEN_COOKIE] || cookies[REFRESH_TOKEN_COOKIE]);
}

function parseDurationToMs(duration) {
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

function buildSessionCookieOptions({
  maxAgeMs,
  httpOnly,
  secure,
  path = '/',
}) {
  return {
    httpOnly,
    sameSite: 'lax',
    secure,
    path,
    maxAge: maxAgeMs,
  };
}

function issueSessionCookies(
  response,
  { accessToken, refreshToken, accessMaxAgeMs, refreshMaxAgeMs, secure, path = '/' },
) {
  const csrfToken = randomBytes(24).toString('hex');

  response.cookie(
    ACCESS_TOKEN_COOKIE,
    accessToken,
    buildSessionCookieOptions({
      maxAgeMs: accessMaxAgeMs,
      httpOnly: true,
      secure,
      path,
    }),
  );
  response.cookie(
    REFRESH_TOKEN_COOKIE,
    refreshToken,
    buildSessionCookieOptions({
      maxAgeMs: refreshMaxAgeMs,
      httpOnly: true,
      secure,
      path,
    }),
  );
  response.cookie(
    CSRF_COOKIE,
    csrfToken,
    buildSessionCookieOptions({
      maxAgeMs: refreshMaxAgeMs,
      httpOnly: false,
      secure,
      path,
    }),
  );

  return csrfToken;
}

function clearSessionCookies(response, { secure, path = '/' }) {
  const expiredHttpOnlyOptions = {
    ...buildSessionCookieOptions({
      maxAgeMs: 0,
      httpOnly: true,
      secure,
      path,
    }),
    expires: new Date(0),
  };
  const expiredReadableOptions = {
    ...buildSessionCookieOptions({
      maxAgeMs: 0,
      httpOnly: false,
      secure,
      path,
    }),
    expires: new Date(0),
  };

  response.clearCookie(ACCESS_TOKEN_COOKIE, expiredHttpOnlyOptions);
  response.clearCookie(REFRESH_TOKEN_COOKIE, expiredHttpOnlyOptions);
  response.clearCookie(CSRF_COOKIE, expiredReadableOptions);
}

function normalizeJwtPayload(payload) {
  if (!payload?.sub || !payload?.email) {
    throw new UnauthorizedException('Invalid JWT payload');
  }

  return {
    id: payload.sub,
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
    phone: payload.phone,
    gender: payload.gender,
    dateOfBirth: payload.dateOfBirth,
    address: payload.address,
    avatar: payload.avatar,
    status: payload.status,
    createdAt: payload.createdAt,
    roles: payload.roles ?? [],
    permissions: payload.permissions ?? [],
    studentId: payload.studentId ?? null,
    lecturerId: payload.lecturerId ?? null,
    student: payload.student ?? null,
    claimsVersion: payload.claimsVersion ?? JWT_CLAIMS_VERSION,
  };
}

const CurrentUser = createParamDecorator(
  (data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

const CurrentStudent = createParamDecorator(
  (data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const studentId = user.studentId;
    if (!studentId) {
      throw new ForbiddenException(
        'You do not have a student profile. Only students can access this resource.',
      );
    }

    return data ? user?.[data] : studentId;
  },
);

const CurrentLecturer = createParamDecorator(
  (data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const lecturerId = user.lecturerId;
    if (!lecturerId) {
      throw new ForbiddenException(
        'You do not have a lecturer profile. Only lecturers can access this resource.',
      );
    }

    return data ? user?.[data] : lecturerId;
  },
);

const Roles = (...roles) => SetMetadata(ROLES_KEY, roles);

class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context) {
    return super.canActivate(context);
  }

  handleRequest(err, user) {
    if (err || !user) {
      throw err || new UnauthorizedException('Invalid or expired token');
    }

    return user;
  }
}

class RolesGuard {
  constructor(reflector = new Reflector()) {
    this.reflector = reflector;
  }

  canActivate(context) {
    const requiredRoles = this.reflector.getAllAndOverride(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    const userRoles = user?.roles ?? [];
    return requiredRoles.some((role) => userRoles.includes(role));
  }
}

module.exports = {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  CSRF_HEADER_NAME,
  INTERNAL_API_PREFIX,
  INTERNAL_SERVICE_TOKEN_HEADER,
  INTERNAL_SERVICE_TOKEN_HEADER_NAME,
  HEALTH_READINESS_HEADER,
  HEALTH_READINESS_HEADER_NAME,
  JWT_CLAIMS_VERSION,
  ROLES_KEY,
  CurrentUser,
  CurrentStudent,
  CurrentLecturer,
  Roles,
  JwtAuthGuard,
  RolesGuard,
  parseCookieHeader,
  normalizeSetCookie,
  extractCookieValue,
  toCookieHeader,
  extractAccessTokenFromCookieHeader,
  extractAccessTokenFromRequest,
  extractRefreshTokenFromRequest,
  hasBearerAuthorization,
  hasSessionCookie,
  parseDurationToMs,
  buildSessionCookieOptions,
  issueSessionCookies,
  clearSessionCookies,
  normalizeJwtPayload,
};
