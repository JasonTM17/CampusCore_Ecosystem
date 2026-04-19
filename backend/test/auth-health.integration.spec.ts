import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import * as amqp from 'amqplib';
import request = require('supertest');
import type { Response as SupertestResponse } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';

const SEEDED_USERS = {
  admin: {
    email: 'admin@campuscore.edu',
  },
  student: {
    email: 'student1@campuscore.edu',
  },
  lecturer: {
    email: 'john.doe@campuscore.edu',
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

describe('Core platform integration', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let baseUrl: string;
  let rabbitConnection: amqp.ChannelModel;
  let rabbitChannel: amqp.Channel;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL ??= 'http://127.0.0.1:3100';
    process.env.HEALTH_READINESS_KEY ??= 'integration-readiness-key';
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
    jwtService = app.get(JwtService);
    baseUrl = await app.getUrl();
    rabbitConnection = await amqp.connect(rabbitmqUrl);
    rabbitChannel = await rabbitConnection.createChannel();
    await rabbitChannel.assertQueue('audit-log-events', { durable: true });
    await rabbitChannel.assertQueue('people-shadow', { durable: true });
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: ['INTEGRATION_AUDIT_EVENT'],
        },
      },
    });
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

  it('does not retain public ownership of auth or iam routes', async () => {
    await request(baseUrl).post('/api/v1/auth/login').send({}).expect(404);
    await request(baseUrl).get('/api/v1/users').expect(404);
    await request(baseUrl).get('/api/v1/roles').expect(404);
    await request(baseUrl).get('/api/v1/permissions').expect(404);
  });

  it('keeps public liveness minimal and protects finance context with the service token', async () => {
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

    expect(readiness.body.services.database.status).toBe('up');

    if (process.env.REDIS_URL && process.env.REDIS_URL !== 'disabled') {
      expect(readiness.body.services.redis.status).toBe('up');
    }

    if (process.env.RABBITMQ_URL && process.env.RABBITMQ_URL !== 'disabled') {
      expect(readiness.body.services.rabbitmq.status).toBe('up');
    }

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

    const serviceToken =
      process.env.INTERNAL_SERVICE_TOKEN ?? 'integration-service-token';

    await request(baseUrl)
      .get(`/api/v1/internal/finance-context/students/${student.id}`)
      .set('X-Service-Token', serviceToken)
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
      .set('X-Service-Token', serviceToken)
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
      .set('X-Service-Token', serviceToken)
      .expect(200)
      .expect(({ body }: SupertestResponse) => {
        expect(body.semesterId).toBe(semester.id);
        expect(Array.isArray(body.students)).toBe(true);
      });
  });

  it('consumes audit-log events and exposes audit logs only to privileged JWT roles', async () => {
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: SEEDED_USERS.admin.email },
      select: {
        id: true,
        email: true,
      },
    });

    await request(baseUrl).get('/api/v1/audit-logs').expect(401);

    await publishRabbitEvent('audit-log-events', {
      type: 'audit-log.created',
      source: 'campuscore-auth-service',
      occurredAt: new Date().toISOString(),
      payload: {
        userId: adminUser.id,
        action: 'INTEGRATION_AUDIT_EVENT',
        entity: 'User',
        entityId: adminUser.id,
        oldValues: null,
        newValues: { source: 'integration-test' },
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        description: 'Audit log event consumed from RabbitMQ',
      },
    });

    await waitForCondition(async () => {
      const count = await prisma.auditLog.count({
        where: { action: 'INTEGRATION_AUDIT_EVENT' },
      });
      return count === 1;
    });

    const token = await jwtService.signAsync({
      sub: adminUser.id,
      email: adminUser.email,
      roles: ['ADMIN'],
      permissions: ['audit-logs:read'],
      claimsVersion: 1,
    });

    const response = await request(baseUrl)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(
      response.body.data.some(
        (entry: { action: string; description?: string }) =>
          entry.action === 'INTEGRATION_AUDIT_EVENT' &&
          entry.description === 'Audit log event consumed from RabbitMQ',
      ),
    ).toBe(true);
  });

  it('keeps student and lecturer shadow compatibility alive through people-shadow events', async () => {
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

    const shadowStudent = studentUser.student!;
    const shadowLecturer = lecturerUser.lecturer!;

    await prisma.student.delete({
      where: { id: shadowStudent.id },
    });
    await prisma.lecturer.delete({
      where: { id: shadowLecturer.id },
    });

    const serviceToken =
      process.env.INTERNAL_SERVICE_TOKEN ?? 'integration-service-token';

    await request(baseUrl)
      .get(`/api/v1/internal/finance-context/students/${shadowStudent.id}`)
      .set('X-Service-Token', serviceToken)
      .expect(404);

    await publishRabbitEvent('people-shadow', {
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

    await publishRabbitEvent('people-shadow', {
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

    await request(baseUrl)
      .get(`/api/v1/internal/finance-context/students/${shadowStudent.id}`)
      .set('X-Service-Token', serviceToken)
      .expect(200)
      .expect(({ body }: SupertestResponse) => {
        expect(body.id).toBe(shadowStudent.id);
        expect(body.studentCode).toBe(shadowStudent.studentId);
      });
  });

  async function publishRabbitEvent(
    queue: string,
    event: Record<string, unknown>,
  ) {
    await rabbitChannel.sendToQueue(queue, Buffer.from(JSON.stringify(event)), {
      persistent: false,
    });
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
