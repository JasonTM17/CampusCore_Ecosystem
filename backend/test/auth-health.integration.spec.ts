import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { io, Socket } from 'socket.io-client';
import request = require('supertest');
import type { Response as SupertestResponse } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';

type AuthCookies = {
  cookieHeader: string;
  csrfToken?: string;
};

const SEEDED_USERS = {
  admin: {
    email: 'admin@campuscore.edu',
    password: 'admin123',
  },
  student: {
    email: 'student1@campuscore.edu',
    password: 'password123',
  },
  lecturer: {
    email: 'john.doe@campuscore.edu',
    password: 'password123',
  },
} as const;

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable for integration tests: ${name}`,
    );
  }

  return value;
}

function normalizeSetCookie(setCookie: string[] | string | undefined) {
  if (!setCookie) {
    return [];
  }

  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

function extractCookieValue(
  setCookie: string[] | string | undefined,
  name: string,
) {
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

function toCookieHeader(setCookie: string[] | string | undefined) {
  return normalizeSetCookie(setCookie)
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

async function emitWithAck<T>(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>,
) {
  return socket.timeout(10_000).emitWithAck(event, payload) as Promise<T>;
}

async function connectNotificationsSocket(baseUrl: string, token: string) {
  const frontendOrigin = process.env.FRONTEND_URL ?? 'http://127.0.0.1:3100';

  const socket = io(new URL('/notifications', baseUrl).toString(), {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    forceNew: true,
    extraHeaders: {
      Origin: frontendOrigin,
    },
  });

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Timed out waiting for websocket authentication'));
    }, 10_000);

    socket.once('connect', () => {
      clearTimeout(timeoutId);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    socket.once('disconnect', (reason) => {
      clearTimeout(timeoutId);
      reject(
        new Error(
          `Socket disconnected before authentication finished: ${reason}`,
        ),
      );
    });
  });

  return socket;
}

async function waitForRejectedSocket(socket: Socket) {
  return new Promise<string>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Expected invalid websocket token to be rejected'));
    }, 10_000);

    socket.once('connect_error', (error) => {
      clearTimeout(timeoutId);
      resolve(error.message);
    });
    socket.once('disconnect', (reason) => {
      clearTimeout(timeoutId);
      resolve(reason);
    });
    socket.once('connect', () => {
      socket.once('disconnect', (reason) => {
        clearTimeout(timeoutId);
        resolve(reason);
      });
    });
  });
}

describe('Auth and health integration', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL ??= 'http://127.0.0.1:3100';
    process.env.HEALTH_READINESS_KEY ??= 'integration-readiness-key';
    process.env.COOKIE_SECURE ??= 'false';

    getRequiredEnv('DATABASE_URL');
    getRequiredEnv('JWT_SECRET');
    getRequiredEnv('JWT_REFRESH_SECRET');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    await app.listen(0, '127.0.0.1');

    prisma = app.get(PrismaService);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await clearAuthArtifacts();
  });

  afterEach(async () => {
    await clearAuthArtifacts();
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports both browser session cookies and legacy bearer auth', async () => {
    const loginResponse = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send(SEEDED_USERS.student)
      .expect(200);

    expect(loginResponse.body.user.email).toBe(SEEDED_USERS.student.email);
    expect(loginResponse.body.accessToken).toBeTruthy();
    expect(loginResponse.body.refreshToken).toBeTruthy();

    const setCookie = loginResponse.headers['set-cookie'];
    expect(setCookie).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cc_access_token='),
        expect.stringContaining('cc_refresh_token='),
        expect.stringContaining('cc_csrf='),
      ]),
    );
    for (const cookie of normalizeSetCookie(setCookie)) {
      expect(cookie).not.toContain('Secure');
    }

    const cookieHeader = toCookieHeader(setCookie);
    const seededUser = await prisma.user.findUniqueOrThrow({
      where: { email: SEEDED_USERS.student.email },
      select: { id: true },
    });

    expect(
      await prisma.session.count({
        where: { userId: seededUser.id },
      }),
    ).toBe(1);

    await request(baseUrl)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
      .expect(200)
      .expect(({ body }: SupertestResponse) => {
        expect(body.email).toBe(SEEDED_USERS.student.email);
        expect(body.roles).toContain('STUDENT');
      });

    await request(baseUrl)
      .get('/api/v1/auth/me')
      .set('Cookie', cookieHeader)
      .expect(200)
      .expect(({ body }: SupertestResponse) => {
        expect(body.email).toBe(SEEDED_USERS.student.email);
        expect(body.roles).toContain('STUDENT');
      });
  });

  it('enforces CSRF for cookie refresh/logout and clears the session on logout', async () => {
    const loginResponse = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send(SEEDED_USERS.student)
      .expect(200);

    let cookies: AuthCookies = {
      cookieHeader: toCookieHeader(loginResponse.headers['set-cookie']),
      csrfToken: extractCookieValue(
        loginResponse.headers['set-cookie'],
        'cc_csrf',
      ),
    };

    await request(baseUrl)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies.cookieHeader)
      .send({})
      .expect(403);

    const refreshResponse = await request(baseUrl)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies.cookieHeader)
      .set('X-CSRF-Token', cookies.csrfToken ?? '')
      .send({})
      .expect(200);

    cookies = {
      cookieHeader: toCookieHeader(refreshResponse.headers['set-cookie']),
      csrfToken:
        extractCookieValue(refreshResponse.headers['set-cookie'], 'cc_csrf') ??
        cookies.csrfToken,
    };

    expect(refreshResponse.body.accessToken).toBeTruthy();
    expect(refreshResponse.body.refreshToken).toBeTruthy();

    await request(baseUrl)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies.cookieHeader)
      .send({})
      .expect(403);

    const logoutResponse = await request(baseUrl)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies.cookieHeader)
      .set('X-CSRF-Token', cookies.csrfToken ?? '')
      .send({})
      .expect(200);

    cookies = {
      cookieHeader: toCookieHeader(logoutResponse.headers['set-cookie']),
    };

    await request(baseUrl)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies.cookieHeader)
      .expect(401);

    const seededUser = await prisma.user.findUniqueOrThrow({
      where: { email: SEEDED_USERS.student.email },
      select: { id: true },
    });

    expect(
      await prisma.session.count({
        where: { userId: seededUser.id },
      }),
    ).toBe(0);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        userId: seededUser.id,
        action: { in: ['LOGIN', 'LOGOUT'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(auditLogs.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['LOGIN', 'LOGOUT']),
    );
  });

  it('keeps public liveness minimal and exposes dependency details only on readiness', async () => {
    const liveness = await request(baseUrl)
      .get('/api/v1/health/liveness')
      .expect(200);

    expect(liveness.body).toMatchObject({
      status: 'ok',
      service: 'campuscore-api',
    });
    expect(liveness.body.services).toBeUndefined();

    const readiness = await request(baseUrl)
      .get('/api/v1/health/readiness')
      .expect(200);

    expect(readiness.body.status).toBeDefined();
    expect(readiness.body.services.database.status).toBe('up');

    if (process.env.REDIS_URL && process.env.REDIS_URL !== 'disabled') {
      expect(readiness.body.services.redis.status).toBe('up');
    }

    if (process.env.RABBITMQ_URL && process.env.RABBITMQ_URL !== 'disabled') {
      expect(readiness.body.services.rabbitmq.status).toBe('up');
    }

    await request(baseUrl)
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }: SupertestResponse) => {
        expect(body.services.database.status).toBe('up');
      });
  });

  it('authenticates the notifications websocket and rejects invalid tokens', async () => {
    const loginResponse = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send(SEEDED_USERS.student)
      .expect(200);

    const validSocket = await connectNotificationsSocket(
      baseUrl,
      loginResponse.body.accessToken,
    );

    try {
      const authResult = await emitWithAck<{
        status: string;
        userId: string;
        roles: string[];
      }>(validSocket, 'authenticate', { channel: 'announcements' });
      expect(authResult.status).toBe('authenticated');
      expect(authResult.roles).toContain('STUDENT');

      const subscribeResult = await emitWithAck<{
        status: string;
        channel: string;
      }>(validSocket, 'subscribe', { channel: 'announcements' });
      expect(subscribeResult).toEqual({
        status: 'subscribed',
        channel: 'announcements',
      });
    } finally {
      validSocket.disconnect();
    }

    const invalidSocket = io(new URL('/notifications', baseUrl).toString(), {
      transports: ['websocket'],
      auth: { token: 'invalid-token' },
      reconnection: false,
      forceNew: true,
      extraHeaders: {
        Origin: process.env.FRONTEND_URL ?? 'http://127.0.0.1:3100',
      },
    });

    try {
      const rejectionReason = await waitForRejectedSocket(invalidSocket);
      expect(rejectionReason).toBeTruthy();
    } finally {
      invalidSocket.disconnect();
    }
  });

  async function clearAuthArtifacts() {
    const users = await prisma.user.findMany({
      where: {
        email: {
          in: Object.values(SEEDED_USERS).map((user) => user.email),
        },
      },
      select: { id: true },
    });

    if (users.length === 0) {
      return;
    }

    await prisma.session.deleteMany({
      where: {
        userId: {
          in: users.map((user) => user.id),
        },
      },
    });
  }
});
