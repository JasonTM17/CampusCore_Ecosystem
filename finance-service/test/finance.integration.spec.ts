import { createServer, IncomingMessage, ServerResponse } from 'http';
import { once } from 'events';
import { Socket } from 'net';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as amqp from 'amqplib';
import * as supertest from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PaymentProvider } from '@prisma/client';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { CSRF_HEADER } from '../src/modules/auth/auth-session.util';
import {
  FINANCE_EVENT_TYPES,
  NOTIFICATION_EVENTS_QUEUE,
} from '../src/modules/rabbitmq/rabbitmq.events';
import {
  SandboxPaymentSignalStatus,
  signSandboxPaymentSignal,
} from '../src/modules/finance/payment-orchestration.util';

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
    process.env.PAYMENT_SANDBOX_SHARED_SECRET ??= 'finance-sandbox-secret';
    process.env.DATABASE_URL ??=
      'postgresql://campuscore:campuscore_password@127.0.0.1:5432/campuscore?schema=finance';
    process.env.RABBITMQ_URL ??=
      'amqp://campuscore:campuscore_password@127.0.0.1:5672';

    const databaseUrl = getRequiredEnv('DATABASE_URL');
    const rabbitmqUrl = getRequiredEnv('RABBITMQ_URL');

    await assertSchemeReachable(
      'Finance integration database',
      databaseUrl,
      5432,
    );
    await assertSchemeReachable(
      'Finance integration RabbitMQ',
      rabbitmqUrl,
      5672,
    );

    internalCoreServer = createInternalCoreStub();
    internalCoreServer.listen(0, '127.0.0.1');
    await once(internalCoreServer, 'listening');
    const address = internalCoreServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve internal core stub address');
    }
    internalCoreBaseUrl = `http://127.0.0.1:${address.port}`;
    process.env.CORE_API_INTERNAL_URL = internalCoreBaseUrl;

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
    await prisma.paymentIntentEvent.deleteMany();
    await prisma.paymentAttempt.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.paymentIntent.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.studentScholarship.deleteMany();
    await prisma.scholarship.deleteMany();
    await rabbitChannel.purgeQueue(NOTIFICATION_EVENTS_QUEUE);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    if (internalCoreServer) {
      await new Promise((resolve) => internalCoreServer.close(resolve));
    }

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
      .expect(201)
      .expect(({ body }) => {
        expect(body.semester.nameEn).toBe('Fall 2026');
        expect(body.semester.nameVi).toBe('Học kỳ Thu 2026');
        expect(body.semesterNameEn).toBe('Fall 2026');
        expect(body.semesterNameVi).toBe('Học kỳ Thu 2026');
      });

    await expectFinanceEvent(FINANCE_EVENT_TYPES.INVOICE_CREATED);

    const invoiceId = createResponse.body.id;

    await supertest(baseUrl)
      .get('/api/v1/finance/my/invoices')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].invoiceNumber).toBe(createResponse.body.invoiceNumber);
        expect(body[0].semesterNameVi).toBe('Học kỳ Thu 2026');
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
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toContain(
          'Student payments must be initiated through the checkout flow',
        );
      });
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

  it('initiates sandbox checkout and completes it idempotently through provider webhooks', async () => {
    const adminAuth = await issueAuth(adminUser);
    const studentAuth = await issueAuth(studentUser);

    const createResponse = await supertest(baseUrl)
      .post('/api/v1/finance/invoices')
      .set(adminAuth.bearer)
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

    const invoiceId = createResponse.body.id;

    await expectFinanceEvent(FINANCE_EVENT_TYPES.INVOICE_CREATED);

    const checkoutResponse = await supertest(baseUrl)
      .post(`/api/v1/finance/my/invoices/${invoiceId}/checkout`)
      .set(studentAuth.cookie)
      .set(studentAuth.csrf)
      .send({
        provider: 'MOMO',
        idempotencyKey: 'sandbox-idem-001',
        returnUrl: 'http://127.0.0.1:3100/return',
        cancelUrl: 'http://127.0.0.1:3100/cancel',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('REQUIRES_ACTION');
        expect(body.latestAttempt.publicToken).toBeTruthy();
        expect(body.sandbox.webhookUrl).toBeTruthy();
        expect(body.nextAction.flow).toBe('REDIRECT');
        expect(body.nextAction.redirectUrl).toMatch(
          /\/api\/v1\/finance\/payment-providers\/momo\/handoff\//,
        );
        expect(body.latestAttempt.nextAction.redirectUrl).toBe(
          body.nextAction.redirectUrl,
        );
      });

    await supertest(baseUrl)
      .get(checkoutResponse.body.nextAction.redirectUrl)
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('MoMo');
        expect(text).toContain(createResponse.body.invoiceNumber);
      });

    const signature = signSandboxPaymentSignal(
      process.env.PAYMENT_SANDBOX_SHARED_SECRET ?? 'finance-sandbox-secret',
      {
        provider: PaymentProvider.MOMO,
        attemptToken: checkoutResponse.body.latestAttempt.publicToken,
        status: SandboxPaymentSignalStatus.SUCCESS,
        providerTransactionId: 'momo-tx-001',
      },
    );

    const webhookBody = {
      status: 'SUCCESS',
      signature,
      providerTransactionId: 'momo-tx-001',
      payload: {
        source: 'integration-test',
      },
    };

    await supertest(baseUrl)
      .post(checkoutResponse.body.sandbox.webhookUrl)
      .send(webhookBody)
      .expect(200)
      .expect(({ body }) => {
        expect(body.verified).toBe(true);
        expect(body.intentStatus).toBe('SUCCEEDED');
        expect(body.paymentId).toBeTruthy();
      });

    await expectFinanceEvent(FINANCE_EVENT_TYPES.PAYMENT_COMPLETED);

    await supertest(baseUrl)
      .post(checkoutResponse.body.sandbox.webhookUrl)
      .send(webhookBody)
      .expect(200)
      .expect(({ body }) => {
        expect(body.verified).toBe(true);
        expect(body.intentStatus).toBe('SUCCEEDED');
      });

    const checkoutIntent = await supertest(baseUrl)
      .get(`/api/v1/finance/my/payment-intents/${checkoutResponse.body.id}`)
      .set(studentAuth.cookie)
      .expect(200);

    expect(checkoutIntent.body.status).toBe('SUCCEEDED');

    const payments = await prisma.payment.findMany({
      where: {
        paymentIntentId: checkoutResponse.body.id,
      },
    });
    expect(payments).toHaveLength(1);

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    expect(invoice?.status).toBe('PAID');
  });

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
        url ===
        `/api/v1/internal/finance-context/students/${STUDENT_PROFILE_ID}`
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

      if (url === `/api/v1/internal/finance-context/semesters/${SEMESTER_ID}`) {
        respondJson(res, {
          id: SEMESTER_ID,
          name: 'Fall 2026',
          nameEn: 'Fall 2026',
          nameVi: 'Học kỳ Thu 2026',
          endDate: '2026-12-20T00:00:00.000Z',
        });
        return;
      }

      if (
        url ===
        `/api/v1/internal/finance-context/semesters/${SEMESTER_ID}/billable-students`
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
    const skippedMessages: amqp.GetMessage[] = [];

    while (Date.now() < deadline) {
      const message = await rabbitChannel.get(NOTIFICATION_EVENTS_QUEUE, {
        noAck: false,
      });

      if (!message) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }

      const parsed = JSON.parse(message.content.toString()) as { type: string };
      if (parsed.type === type) {
        rabbitChannel.ack(message);
        for (const skipped of skippedMessages) {
          rabbitChannel.nack(skipped, false, true);
        }
        expect(parsed.type).toBe(type);
        return;
      }

      skippedMessages.push(message);
    }

    for (const skipped of skippedMessages) {
      rabbitChannel.nack(skipped, false, true);
    }

    throw new Error(`Timed out waiting for finance event ${type}`);
  }
});

async function assertSchemeReachable(
  label: string,
  value: string,
  defaultPort: number,
) {
  const endpoint = new URL(value);
  const port = Number(endpoint.port || String(defaultPort));

  await assertTcpReachable(label, endpoint.hostname, port);
}

async function assertTcpReachable(
  label: string,
  host: string,
  port: number,
  timeoutMs = 3_000,
) {
  await new Promise<void>((resolve, reject) => {
    const socket = new Socket();

    const finalize = (error?: Error) => {
      socket.removeAllListeners();
      socket.destroy();

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize());
    socket.once('timeout', () => {
      finalize(
        new Error(
          `${label} is not reachable at ${host}:${port}. Start the local dependency stack and rerun the integration lane.`,
        ),
      );
    });
    socket.once('error', (error) => {
      finalize(
        new Error(
          `${label} is not reachable at ${host}:${port}: ${error.message}`,
        ),
      );
    });

    socket.connect(port, host);
  });
}
