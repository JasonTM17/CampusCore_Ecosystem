import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request = require('supertest');
import type { Response as SupertestResponse } from 'supertest';
import * as amqp from 'amqplib';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import {
  NOTIFICATION_EVENTS_QUEUE,
  NOTIFICATION_EVENT_TYPES,
} from '../src/modules/rabbitmq/notification-events';

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

describe('Auth and health integration', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let rabbitConnection: amqp.ChannelModel;
  let rabbitChannel: amqp.Channel;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL ??= 'http://127.0.0.1:3100';
    process.env.HEALTH_READINESS_KEY ??= 'integration-readiness-key';
    process.env.COOKIE_SECURE ??= 'false';

    getRequiredEnv('DATABASE_URL');
    getRequiredEnv('JWT_SECRET');
    getRequiredEnv('JWT_REFRESH_SECRET');
    const rabbitmqUrl = getRequiredEnv('RABBITMQ_URL');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    await app.listen(0, '127.0.0.1');

    prisma = app.get(PrismaService);
    baseUrl = await app.getUrl();
    rabbitConnection = await amqp.connect(rabbitmqUrl);
    rabbitChannel = await rabbitConnection.createChannel();
    await rabbitChannel.assertQueue(NOTIFICATION_EVENTS_QUEUE, {
      durable: true,
    });
  });

  beforeEach(async () => {
    await clearAuthArtifacts();
  });

  afterEach(async () => {
    await clearAuthArtifacts();
  });

  afterAll(async () => {
    await app.close();
    if (rabbitChannel) {
      await rabbitChannel.close();
    }
    if (rabbitConnection) {
      await rabbitConnection.close();
    }
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

  it('publishes announcement.created events to RabbitMQ', async () => {
    await rabbitChannel.purgeQueue(NOTIFICATION_EVENTS_QUEUE);

    const loginResponse = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send(SEEDED_USERS.admin)
      .expect(200);

    const createResponse = await request(baseUrl)
      .post('/api/v1/announcements')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
      .send({
        title: 'Microservices maintenance window',
        content: 'Notification service cutover tonight.',
        targetRoles: ['STUDENT'],
        targetYears: [1, 2],
        isGlobal: false,
      })
      .expect(201);

    const message = await waitForQueueMessage();

    expect(createResponse.body.id).toBeTruthy();
    expect(message).toMatchObject({
      type: NOTIFICATION_EVENT_TYPES.ANNOUNCEMENT_CREATED,
      source: 'campuscore-core-api',
      payload: {
        announcement: expect.objectContaining({
          id: createResponse.body.id,
          title: 'Microservices maintenance window',
          content: 'Notification service cutover tonight.',
        }),
      },
    });
  });

  async function waitForQueueMessage(timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const message = await rabbitChannel.get(NOTIFICATION_EVENTS_QUEUE, {
        noAck: false,
      });

      if (message) {
        rabbitChannel.ack(message);
        return JSON.parse(message.content.toString());
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(
      `Timed out waiting for message on ${NOTIFICATION_EVENTS_QUEUE}`,
    );
  }

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
