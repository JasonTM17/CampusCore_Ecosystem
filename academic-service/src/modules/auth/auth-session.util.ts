import { Request } from 'express';

export const ACCESS_TOKEN_COOKIE = 'cc_access_token';
export const REFRESH_TOKEN_COOKIE = 'cc_refresh_token';
export const CSRF_COOKIE = 'cc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function parseCookieHeader(cookieHeader?: string | null) {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, entry) => {
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

export function extractAccessTokenFromCookieHeader(
  cookieHeader?: string | null,
) {
  const cookies = parseCookieHeader(cookieHeader);
  const cookieToken = cookies[ACCESS_TOKEN_COOKIE];

  return typeof cookieToken === 'string' && cookieToken.trim()
    ? cookieToken
    : null;
}

export function extractAccessTokenFromRequest(request: Request) {
  const headerToken = request.headers.authorization;

  if (typeof headerToken === 'string' && headerToken.startsWith('Bearer ')) {
    return headerToken.slice(7);
  }

  const cookieToken =
    request.cookies?.[ACCESS_TOKEN_COOKIE] ??
    extractAccessTokenFromCookieHeader(request.headers.cookie);
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
    request.cookies?.[REFRESH_TOKEN_COOKIE] ||
    extractAccessTokenFromCookieHeader(request.headers.cookie),
  );
}
