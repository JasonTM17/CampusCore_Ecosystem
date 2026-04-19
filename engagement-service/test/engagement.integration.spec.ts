import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as amqp from 'amqplib';
import * as supertest from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { CSRF_HEADER } from '../src/modules/auth/auth-session.util';
import {
  ENGAGEMENT_EVENT_TYPES,
  NOTIFICATION_EVENTS_QUEUE,
} from '../src/modules/rabbitmq/rabbitmq.events';

type TestUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  studentId?: string | null;
  lecturerId?: string | null;
  student?: { year?: number | null } | null;
};

type AuthContext = {
  bearer: Record<string, string>;
  cookie: Record<string, string>;
  csrf: Record<string, string>;
};

describe('Engagement service integration', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let baseUrl: string;
  let rabbitConnection: amqp.ChannelModel;
  let rabbitChannel: amqp.Channel;

  const adminUser: TestUser = {
    id: 'admin-user-1',
    email: 'admin@campuscore.edu',
    firstName: 'Admin',
    lastName: 'User',
    roles: ['ADMIN'],
  };

  const studentUser: TestUser = {
    id: 'student-user-1',
    email: 'student1@campuscore.edu',
    firstName: 'Michael',
    lastName: 'Chen',
    roles: ['STUDENT'],
    studentId: 'student-profile-1',
    student: { year: 2 },
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL ??= 'http://127.0.0.1:3100';
    process.env.HEALTH_READINESS_KEY ??= 'engagement-readiness-key-12345';
    process.env.COOKIE_SECURE ??= 'false';

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
    await rabbitChannel.assertQueue(NOTIFICATION_EVENTS_QUEUE, {
      durable: true,
    });
  });

  beforeEach(async () => {
    await prisma.ticketResponse.deleteMany();
    await prisma.supportTicket.deleteMany();
    await prisma.announcement.deleteMany();
    await rabbitChannel.purgeQueue(NOTIFICATION_EVENTS_QUEUE);
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

  it('supports announcement delivery and support ticket flows with cookie csrf', async () => {
    const adminAuth = await issueAuth(adminUser);
    const studentAuth = await issueAuth(studentUser);

    await supertest(baseUrl)
      .post('/api/v1/announcements')
      .set(adminAuth.bearer)
      .send({
        title: 'Registration reminder',
        content: 'Please confirm your enrollment before Friday.',
        priority: 'HIGH',
        isGlobal: false,
        targetRoles: ['STUDENT'],
        targetYears: [2],
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.title).toBe('Registration reminder');
        expect(body.priority).toBe('HIGH');
      });

    await expectEngagementEvent(ENGAGEMENT_EVENT_TYPES.ANNOUNCEMENT_CREATED);

    await supertest(baseUrl)
      .get('/api/v1/announcements/my')
      .set(studentAuth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toHaveLength(1);
        expect(body.data[0].title).toBe('Registration reminder');
      });

    await supertest(baseUrl)
      .post('/api/v1/support-tickets')
      .set(studentAuth.cookie)
      .send({
        subject: 'Need help with enrollment',
        description: 'I cannot see my elective section.',
        category: 'ACADEMIC',
        priority: 'HIGH',
      })
      .expect(403);

    const ticketResponse = await supertest(baseUrl)
      .post('/api/v1/support-tickets')
      .set(studentAuth.csrf)
      .send({
        subject: 'Need help with enrollment',
        description: 'I cannot see my elective section.',
        category: 'ACADEMIC',
        priority: 'HIGH',
      })
      .expect(201);

    expect(ticketResponse.body.ticketNumber).toBeTruthy();

    await supertest(baseUrl)
      .get('/api/v1/support-tickets/my')
      .set(studentAuth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toHaveLength(1);
        expect(body.data[0].user.email).toBe('student1@campuscore.edu');
      });

    await supertest(baseUrl)
      .post(`/api/v1/support-tickets/${ticketResponse.body.id}/respond`)
      .set(adminAuth.bearer)
      .send({
        message: 'We have refreshed your enrollment cache. Please try again.',
        isInternal: false,
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.message).toContain('refreshed your enrollment cache');
      });

    await supertest(baseUrl)
      .get(`/api/v1/support-tickets/${ticketResponse.body.id}`)
      .set(adminAuth.bearer)
      .expect(200)
      .expect(({ body }) => {
        expect(body.responses).toHaveLength(1);
        expect(body.status).toBe('IN_PROGRESS');
      });
  });

  it('supports admin listing and readiness checks', async () => {
    const adminAuth = await issueAuth(adminUser);

    await prisma.supportTicket.create({
      data: {
        id: 'ticket-1',
        ticketNumber: 'TKT-00001',
        userId: studentUser.id,
        userEmail: studentUser.email,
        userDisplayName: 'Michael Chen',
        subject: 'Billing issue',
        description: 'Invoice total looks incorrect.',
        category: 'FINANCE',
        priority: 'MEDIUM',
      },
    });

    await supertest(baseUrl)
      .get('/api/v1/support-tickets')
      .set(adminAuth.bearer)
      .query({ status: 'OPEN', page: 1, limit: 10 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toHaveLength(1);
        expect(body.data[0].category).toBe('FINANCE');
      });

    await supertest(baseUrl)
      .get('/api/v1/health/readiness')
      .set('X-Health-Key', 'engagement-readiness-key-12345')
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
      student: user.student ?? null,
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

  async function expectEngagementEvent(type: string) {
    const deadline = Date.now() + 10_000;
    let message: amqp.GetMessage | false = false;

    while (!message && Date.now() < deadline) {
      message = await rabbitChannel.get(NOTIFICATION_EVENTS_QUEUE, {
        noAck: false,
      });

      if (!message) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    expect(message).not.toBe(false);
    if (!message) {
      throw new Error(`Timed out waiting for engagement event ${type}`);
    }

    const parsed = JSON.parse(message.content.toString()) as { type: string };
    rabbitChannel.ack(message);
    expect(parsed.type).toBe(type);
  }
});
