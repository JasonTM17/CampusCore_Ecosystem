import { createServer, IncomingMessage, ServerResponse } from 'http';
import { once } from 'events';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as amqp from 'amqplib';
import * as supertest from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { CSRF_HEADER } from '../src/modules/auth/auth-session.util';
import {
  FINANCE_EVENT_TYPES,
  NOTIFICATION_EVENTS_QUEUE,
} from '../src/modules/rabbitmq/rabbitmq.events';

type TestUser = {
  id: string;
  email: string;
  roles: string[];
  studentId?: string | null;
};

type AuthContext = {
  token: string;
  bearer: Record<string, string>;
  cookie: Record<string, string>;
  csrf: Record<string, string>;
};

const STUDENT_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const SEMESTER_ID = '22222222-2222-4222-8222-222222222222';

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

describe('Finance service integration', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let baseUrl: string;
  let rabbitConnection: amqp.ChannelModel;
  let rabbitChannel: amqp.Channel;
  let internalCoreServer: ReturnType<typeof createServer>;
  let internalCoreBaseUrl: string;

  const studentUser: TestUser = {
    id: 'student-user-1',
    email: 'student1@campuscore.edu',
    roles: ['STUDENT'],
    studentId: STUDENT_PROFILE_ID,
  };

  const adminUser: TestUser = {
    id: 'admin-user-1',
    email: 'admin@campuscore.edu',
    roles: ['ADMIN'],
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL ??= 'http://127.0.0.1:3100';
    process.env.HEALTH_READINESS_KEY ??= 'finance-readiness-key';
    process.env.COOKIE_SECURE ??= 'false';
    process.env.INTERNAL_SERVICE_TOKEN ??= 'finance-service-token-12345';

    internalCoreServer = createInternalCoreStub();
    internalCoreServer.listen(0, '127.0.0.1');
    await once(internalCoreServer, 'listening');
    const address = internalCoreServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve internal core stub address');
    }
    internalCoreBaseUrl = `http://127.0.0.1:${address.port}`;
    process.env.CORE_API_INTERNAL_URL = internalCoreBaseUrl;

    const rabbitmqUrl = getRequiredEnv('RABBITMQ_URL');

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
    await prisma.payment.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.studentScholarship.deleteMany();
    await prisma.scholarship.deleteMany();
    await rabbitChannel.purgeQueue(NOTIFICATION_EVENTS_QUEUE);
  });

  afterAll(async () => {
    await app.close();
    internalCoreServer.close();
    if (rabbitChannel) {
      await rabbitChannel.close();
    }
    if (rabbitConnection) {
      await rabbitConnection.close();
    }
  });

  it('supports cookie auth, csrf enforcement, invoice reads, and payment events', async () => {
    const auth = await issueAuth(studentUser);

    const createResponse = await supertest(baseUrl)
      .post('/api/v1/finance/invoices')
      .set((await issueAuth(adminUser)).bearer)
      .send({
        studentId: studentUser.studentId,
        semesterId: SEMESTER_ID,
        dueDate: '2026-12-20T00:00:00.000Z',
        items: [
          {
            description: 'COMP101 - Intro to CS (3 credits)',
            quantity: 3,
            unitPrice: 150,
          },
        ],
      })
      .expect(201);

    await expectFinanceEvent(FINANCE_EVENT_TYPES.INVOICE_CREATED);

    const invoiceId = createResponse.body.id;

    await supertest(baseUrl)
      .get('/api/v1/finance/my/invoices')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].invoiceNumber).toBe(createResponse.body.invoiceNumber);
      });

    await supertest(baseUrl)
      .post('/api/v1/finance/my/payments')
      .set(auth.cookie)
      .send({
        invoiceId,
        amount: 450,
        method: 'CARD',
      })
      .expect(403);

    await supertest(baseUrl)
      .post('/api/v1/finance/my/payments')
      .set(auth.cookie)
      .set(auth.csrf)
      .send({
        invoiceId,
        amount: 450,
        method: 'CARD',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.paymentNumber).toBeTruthy();
        expect(body.amount).toBe(450);
      });

    await expectFinanceEvent(FINANCE_EVENT_TYPES.PAYMENT_COMPLETED);
  });

  it('generates invoices for a semester through the internal core context', async () => {
    const adminAuth = await issueAuth(adminUser);

    await supertest(baseUrl)
      .post(`/api/v1/finance/invoices/generate/semester/${SEMESTER_ID}`)
      .set(adminAuth.bearer)
      .expect(201)
      .expect(({ body }) => {
        expect(body.generated).toBeGreaterThanOrEqual(1);
      });

    const invoices = await prisma.invoice.findMany();
    expect(invoices.length).toBeGreaterThanOrEqual(1);
  }, 15_000);

  async function issueAuth(user: TestUser): Promise<AuthContext> {
    const token = await jwtService.signAsync({
      sub: user.id,
      email: user.email,
      roles: user.roles,
      permissions: [],
      studentId: user.studentId ?? null,
      lecturerId: null,
    });
    const csrfToken = 'finance-csrf-token';
    const cookieHeader = [
      `cc_access_token=${token}`,
      `cc_refresh_token=${token}`,
      `cc_csrf=${csrfToken}`,
    ].join('; ');

    return {
      token,
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

  function createInternalCoreStub() {
    return createServer((req: IncomingMessage, res: ServerResponse) => {
      if (
        req.headers['x-service-token'] !==
        (process.env.INTERNAL_SERVICE_TOKEN ?? 'finance-service-token-12345')
      ) {
        res.statusCode = 403;
        res.end(JSON.stringify({ message: 'Forbidden' }));
        return;
      }

      const url = req.url ?? '';

      if (
        url === `/internal/v1/finance-context/students/${STUDENT_PROFILE_ID}`
      ) {
        respondJson(res, {
          id: STUDENT_PROFILE_ID,
          userId: 'student-user-1',
          studentCode: 'STU001',
          displayName: 'Michael Chen',
          email: 'student1@campuscore.edu',
        });
        return;
      }

      if (url === `/internal/v1/finance-context/semesters/${SEMESTER_ID}`) {
        respondJson(res, {
          id: SEMESTER_ID,
          name: 'Fall 2026',
          endDate: '2026-12-20T00:00:00.000Z',
        });
        return;
      }

      if (
        url ===
        `/internal/v1/finance-context/semesters/${SEMESTER_ID}/billable-students`
      ) {
        respondJson(res, {
          semesterId: SEMESTER_ID,
          students: [
            {
              id: STUDENT_PROFILE_ID,
              userId: 'student-user-1',
              studentCode: 'STU001',
              displayName: 'Michael Chen',
              email: 'student1@campuscore.edu',
              items: [
                {
                  description: 'COMP101 - Intro to CS (3 credits)',
                  quantity: 3,
                  unitPrice: 150,
                },
              ],
            },
          ],
        });
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ message: 'Not found' }));
    });
  }

  function respondJson(res: ServerResponse, body: unknown) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  }

  async function expectFinanceEvent(type: string) {
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
      throw new Error(`Timed out waiting for finance event ${type}`);
    }

    const parsed = JSON.parse(message.content.toString()) as { type: string };
    rabbitChannel.ack(message);
    expect(parsed.type).toBe(type);
  }
});
