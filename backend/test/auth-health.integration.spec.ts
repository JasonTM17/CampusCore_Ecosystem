import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as amqp from 'amqplib';
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
    process.env.INTERNAL_SERVICE_TOKEN ??= 'integration-service-token';

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
    await rabbitChannel.assertQueue('people-shadow', { durable: true });
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

  it('exposes internal finance context only with a valid service token', async () => {
    const student = await prisma.student.findFirstOrThrow({
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    const semester = await prisma.semester.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });

    await request(baseUrl)
      .get(`/api/v1/internal/finance-context/students/${student.id}`)
      .expect(403);

    await request(baseUrl)
      .get(`/api/v1/internal/finance-context/students/${student.id}`)
      .set(
        'X-Service-Token',
        process.env.INTERNAL_SERVICE_TOKEN ?? 'integration-service-token',
      )
      .expect(200)
      .expect(({ body }: SupertestResponse) => {
        expect(body).toMatchObject({
          id: student.id,
          userId: student.userId,
          studentCode: student.studentId,
          email: student.user.email,
        });
      });

    await request(baseUrl)
      .get(`/api/v1/internal/finance-context/semesters/${semester.id}`)
      .set(
        'X-Service-Token',
        process.env.INTERNAL_SERVICE_TOKEN ?? 'integration-service-token',
      )
      .expect(200)
      .expect(({ body }: SupertestResponse) => {
        expect(body).toMatchObject({
          id: semester.id,
          name: semester.name,
        });
      });

    await request(baseUrl)
      .get(
        `/api/v1/internal/finance-context/semesters/${semester.id}/billable-students`,
      )
      .set(
        'X-Service-Token',
        process.env.INTERNAL_SERVICE_TOKEN ?? 'integration-service-token',
      )
      .expect(200)
      .expect(({ body }: SupertestResponse) => {
        expect(body.semesterId).toBe(semester.id);
        expect(Array.isArray(body.students)).toBe(true);
      });
  });

  it('exposes internal people context and keeps jwt claims stable through people shadow sync', async () => {
    const serviceToken =
      process.env.INTERNAL_SERVICE_TOKEN ?? 'integration-service-token';

    const studentUser = await prisma.user.findUniqueOrThrow({
      where: { email: SEEDED_USERS.student.email },
      include: { student: true },
    });
    const lecturerUser = await prisma.user.findUniqueOrThrow({
      where: { email: SEEDED_USERS.lecturer.email },
      include: { lecturer: true },
    });

    expect(studentUser.student).toBeTruthy();
    expect(lecturerUser.lecturer).toBeTruthy();

    await request(baseUrl)
      .get(`/api/v1/internal/people-context/users/${studentUser.id}`)
      .expect(403);

    await request(baseUrl)
      .get(`/api/v1/internal/people-context/users/${studentUser.id}`)
      .set('X-Service-Token', serviceToken)
      .expect(200)
      .expect(({ body }: SupertestResponse) => {
        expect(body).toMatchObject({
          id: studentUser.id,
          email: SEEDED_USERS.student.email,
        });
      });

    const shadowStudent = studentUser.student!;
    const shadowLecturer = lecturerUser.lecturer!;

    await prisma.student.delete({
      where: { id: shadowStudent.id },
    });
    await prisma.lecturer.delete({
      where: { id: shadowLecturer.id },
    });

    await publishPeopleShadowEvent({
      type: 'student.upserted',
      source: 'campuscore-people-service',
      occurredAt: new Date().toISOString(),
      payload: {
        id: shadowStudent.id,
        userId: shadowStudent.userId,
        studentId: shadowStudent.studentId,
        curriculumId: shadowStudent.curriculumId,
        year: shadowStudent.year,
        status: shadowStudent.status,
        admissionDate: shadowStudent.admissionDate.toISOString(),
      },
    });

    await publishPeopleShadowEvent({
      type: 'lecturer.upserted',
      source: 'campuscore-people-service',
      occurredAt: new Date().toISOString(),
      payload: {
        id: shadowLecturer.id,
        userId: shadowLecturer.userId,
        departmentId: shadowLecturer.departmentId,
        employeeId: shadowLecturer.employeeId,
        title: shadowLecturer.title,
        specialization: shadowLecturer.specialization,
        office: shadowLecturer.office,
        phone: shadowLecturer.phone,
        isActive: shadowLecturer.isActive,
      },
    });

    await waitForCondition(async () => {
      const [student, lecturer] = await Promise.all([
        prisma.student.findUnique({ where: { id: shadowStudent.id } }),
        prisma.lecturer.findUnique({ where: { id: shadowLecturer.id } }),
      ]);

      return Boolean(student && lecturer);
    });

    const studentLogin = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send(SEEDED_USERS.student)
      .expect(200);
    expect(studentLogin.body.user.studentId).toBe(shadowStudent.id);

    const lecturerLogin = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send(SEEDED_USERS.lecturer)
      .expect(200);
    expect(lecturerLogin.body.user.lecturerId).toBe(shadowLecturer.id);
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

  async function publishPeopleShadowEvent(event: Record<string, unknown>) {
    await rabbitChannel.sendToQueue(
      'people-shadow',
      Buffer.from(JSON.stringify(event)),
      { persistent: false },
    );
  }

  async function waitForCondition(
    predicate: () => Promise<boolean>,
    timeoutMs = 10_000,
    intervalMs = 250,
  ) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await predicate()) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error('Timed out waiting for asynchronous condition');
  }
});
