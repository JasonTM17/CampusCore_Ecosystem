import { createServer, Server, ServerResponse } from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as amqp from 'amqplib';
import * as supertest from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { CSRF_HEADER } from '../src/modules/auth/auth-session.util';
import {
  PEOPLE_EVENT_TYPES,
  PEOPLE_SHADOW_QUEUE,
} from '../src/modules/rabbitmq/rabbitmq.events';

type TestUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  studentId?: string | null;
  lecturerId?: string | null;
};

type AuthContext = {
  bearer: Record<string, string>;
  cookie: Record<string, string>;
  csrf: Record<string, string>;
};

describe('People service integration', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let baseUrl: string;
  let rabbitConnection: amqp.ChannelModel;
  let rabbitChannel: amqp.Channel;
  let contextServer: Server;
  let contextBaseUrl: string;

  const adminUser: TestUser = {
    id: 'admin-user-1',
    email: 'admin@campuscore.edu',
    firstName: 'Admin',
    lastName: 'User',
    roles: ['ADMIN'],
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL ??= 'http://127.0.0.1:3100';
    process.env.HEALTH_READINESS_KEY ??= 'people-readiness-key-12345';
    process.env.COOKIE_SECURE ??= 'false';
    process.env.INTERNAL_SERVICE_TOKEN ??= 'people-integration-token-12345';

    contextServer = createContextServer(
      process.env.INTERNAL_SERVICE_TOKEN ?? 'people-integration-token-12345',
    );
    await new Promise<void>((resolve) => {
      contextServer.listen(0, '127.0.0.1', resolve);
    });
    const address = contextServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind context server');
    }

    contextBaseUrl = `http://127.0.0.1:${address.port}`;
    process.env.CORE_API_INTERNAL_URL = contextBaseUrl;
    process.env.ACADEMIC_SERVICE_INTERNAL_URL = contextBaseUrl;

    const rabbitmqUrl = process.env.RABBITMQ_URL;
    if (!rabbitmqUrl) {
      throw new Error('Missing required environment variable: RABBITMQ_URL');
    }

    const { AppModule } = await import('../src/app.module');
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
    await rabbitChannel.assertQueue(PEOPLE_SHADOW_QUEUE, {
      durable: true,
    });
  });

  beforeEach(async () => {
    await prisma.student.deleteMany();
    await prisma.lecturer.deleteMany();
    await rabbitChannel.purgeQueue(PEOPLE_SHADOW_QUEUE);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (contextServer) {
      await new Promise<void>((resolve, reject) => {
        contextServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    if (rabbitChannel) {
      await rabbitChannel.close();
    }
    if (rabbitConnection) {
      await rabbitConnection.close();
    }
  });

  it('supports admin CRUD flows and enrollment history read-through', async () => {
    const adminAuth = await issueAuth(adminUser);

    await supertest(baseUrl)
      .post('/api/v1/students')
      .set(adminAuth.cookie)
      .send({
        userId: 'student-user-1',
        studentId: 'STU001',
        curriculumId: 'curriculum-1',
        year: 2,
        admissionDate: '2025-09-01',
      })
      .expect(403);

    const createStudentResponse = await supertest(baseUrl)
      .post('/api/v1/students')
      .set(adminAuth.csrf)
      .send({
        userId: 'student-user-1',
        studentId: 'STU001',
        curriculumId: 'curriculum-1',
        year: 2,
        admissionDate: '2025-09-01',
      })
      .expect(201);

    expect(createStudentResponse.body.user.email).toBe(
      'student1@campuscore.edu',
    );
    expect(createStudentResponse.body.curriculum.name).toBe(
      'Computer Science 2026',
    );

    await expectPeopleEvent(PEOPLE_EVENT_TYPES.STUDENT_UPSERTED);

    const createLecturerResponse = await supertest(baseUrl)
      .post('/api/v1/lecturers')
      .set(adminAuth.bearer)
      .send({
        userId: 'lecturer-user-1',
        departmentId: 'department-1',
        employeeId: 'EMP001',
        title: 'Dr.',
        specialization: 'Distributed Systems',
        office: 'B-201',
      })
      .expect(201);

    expect(createLecturerResponse.body.department.name).toBe(
      'Computer Science',
    );
    expect(createLecturerResponse.body.user.email).toBe(
      'john.doe@campuscore.edu',
    );

    await expectPeopleEvent(PEOPLE_EVENT_TYPES.LECTURER_UPSERTED);

    await supertest(baseUrl)
      .get('/api/v1/lecturers')
      .set(adminAuth.bearer)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toHaveLength(1);
        expect(body.data[0].employeeId).toBe('EMP001');
      });

    await supertest(baseUrl)
      .get(`/api/v1/students/${createStudentResponse.body.id}/enrollments`)
      .set(adminAuth.bearer)
      .expect(200)
      .expect(({ body }) => {
        expect(Array.isArray(body)).toBe(true);
        expect(body[0].section.course.code).toBe('CS101');
      });
  });

  it('supports readiness checks for production-like verification', async () => {
    const adminAuth = await issueAuth(adminUser);

    await supertest(baseUrl)
      .get('/api/v1/students')
      .set(adminAuth.bearer)
      .expect(200);

    await supertest(baseUrl)
      .get('/api/v1/health/readiness')
      .set('X-Health-Key', 'people-readiness-key-12345')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toMatch(/ok|degraded/);
        expect(body.services.database.status).toBe('up');
        expect(['up', 'down', 'not_configured']).toContain(
          body.services.rabbitmq.status,
        );
      });
  });

  async function issueAuth(user: TestUser): Promise<AuthContext> {
    const token = await jwtService.signAsync({
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
      permissions: [],
      studentId: user.studentId ?? null,
      lecturerId: user.lecturerId ?? null,
      student: null,
    });

    const csrfToken = `${user.id}-csrf-token`;
    const cookieHeader = [
      `cc_access_token=${token}`,
      `cc_refresh_token=${token}`,
      `cc_csrf=${csrfToken}`,
    ].join('; ');

    return {
      bearer: {
        Authorization: `Bearer ${token}`,
      },
      cookie: {
        Cookie: cookieHeader,
      },
      csrf: {
        Cookie: cookieHeader,
        [CSRF_HEADER]: csrfToken,
      },
    };
  }

  async function expectPeopleEvent(type: string) {
    const deadline = Date.now() + 10_000;
    let message: amqp.GetMessage | false = false;

    while (!message && Date.now() < deadline) {
      message = await rabbitChannel.get(PEOPLE_SHADOW_QUEUE, {
        noAck: false,
      });

      if (!message) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    expect(message).not.toBe(false);
    if (!message) {
      throw new Error(`Timed out waiting for people event ${type}`);
    }

    const parsed = JSON.parse(message.content.toString()) as { type: string };
    rabbitChannel.ack(message);
    expect(parsed.type).toBe(type);
  }
});

function createContextServer(serviceToken: string) {
  return createServer((req, res) => {
    if (req.headers['x-service-token'] !== serviceToken) {
      res.statusCode = 403;
      res.end(JSON.stringify({ message: 'Forbidden' }));
      return;
    }

    if (req.url === '/api/v1/internal/people-context/users/student-user-1') {
      return json(res, {
        id: 'student-user-1',
        email: 'student1@campuscore.edu',
        firstName: 'Student',
        lastName: 'One',
        phone: '0123456789',
      });
    }

    if (req.url === '/api/v1/internal/people-context/users/lecturer-user-1') {
      return json(res, {
        id: 'lecturer-user-1',
        email: 'john.doe@campuscore.edu',
        firstName: 'John',
        lastName: 'Doe',
        phone: '0987654321',
      });
    }

    if (
      req.url === '/api/v1/internal/academic-context/curricula/curriculum-1'
    ) {
      return json(res, {
        id: 'curriculum-1',
        code: 'CS-2026',
        name: 'Computer Science 2026',
        department: {
          id: 'department-1',
          code: 'CS',
          name: 'Computer Science',
        },
      });
    }

    if (
      req.url === '/api/v1/internal/academic-context/departments/department-1'
    ) {
      return json(res, {
        id: 'department-1',
        code: 'CS',
        name: 'Computer Science',
      });
    }

    if (
      req.url?.startsWith('/api/v1/internal/academic-context/students/') &&
      req.url?.endsWith('/enrollments')
    ) {
      return json(res, [
        {
          id: 'enrollment-1',
          studentId: req.url.split('/')[6],
          section: {
            id: 'section-1',
            sectionNumber: 'A1',
            course: {
              id: 'course-1',
              code: 'CS101',
              name: 'Intro to Computing',
            },
          },
          gradeItems: [],
        },
      ]);
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'Not found' }));
  });
}

function json(res: ServerResponse, body: unknown) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
