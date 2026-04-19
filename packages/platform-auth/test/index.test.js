const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../index.js');

test('parses cookie headers and access tokens consistently', () => {
  const cookieHeader = [
    `${auth.ACCESS_TOKEN_COOKIE}=access-token`,
    `${auth.REFRESH_TOKEN_COOKIE}=refresh-token`,
    `${auth.CSRF_COOKIE}=csrf-token`,
  ].join('; ');

  assert.equal(
    auth.extractAccessTokenFromCookieHeader(cookieHeader),
    'access-token',
  );
  assert.deepEqual(auth.parseCookieHeader(cookieHeader), {
    [auth.ACCESS_TOKEN_COOKIE]: 'access-token',
    [auth.REFRESH_TOKEN_COOKIE]: 'refresh-token',
    [auth.CSRF_COOKIE]: 'csrf-token',
  });
});

test('normalizes set-cookie headers into request cookie headers', () => {
  const setCookie = [
    `${auth.ACCESS_TOKEN_COOKIE}=access-token; Path=/; HttpOnly`,
    `${auth.CSRF_COOKIE}=csrf-token; Path=/`,
  ];

  assert.deepEqual(auth.normalizeSetCookie(setCookie), setCookie);
  assert.equal(auth.extractCookieValue(setCookie, auth.CSRF_COOKIE), 'csrf-token');
  assert.equal(
    auth.toCookieHeader(setCookie),
    `${auth.ACCESS_TOKEN_COOKIE}=access-token; ${auth.CSRF_COOKIE}=csrf-token`,
  );
});

test('parses duration strings for cookie/session lifetimes', () => {
  assert.equal(auth.parseDurationToMs('10s'), 10_000);
  assert.equal(auth.parseDurationToMs('15m'), 900_000);
  assert.equal(auth.parseDurationToMs('2h'), 7_200_000);
  assert.equal(auth.parseDurationToMs('1d'), 86_400_000);
});

test('normalizes jwt payloads into shared auth users', () => {
  const normalized = auth.normalizeJwtPayload({
    sub: 'user-1',
    email: 'user@example.com',
    roles: ['ADMIN'],
    permissions: ['users:read'],
    lecturerId: 'lecturer-1',
  });

  assert.deepEqual(normalized, {
    id: 'user-1',
    email: 'user@example.com',
    firstName: undefined,
    lastName: undefined,
    phone: undefined,
    gender: undefined,
    dateOfBirth: undefined,
    address: undefined,
    avatar: undefined,
    status: undefined,
    createdAt: undefined,
    roles: ['ADMIN'],
    permissions: ['users:read'],
    studentId: null,
    lecturerId: 'lecturer-1',
    student: null,
    claimsVersion: auth.JWT_CLAIMS_VERSION,
  });
});

test('handles minimal request objects when extracting auth state', () => {
  assert.equal(auth.extractAccessTokenFromRequest({}), null);
  assert.equal(auth.extractRefreshTokenFromRequest({}), null);
  assert.equal(auth.hasBearerAuthorization({}), false);
  assert.equal(auth.hasSessionCookie({}), false);
});
