import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { io, Socket } from 'socket.io-client';
import * as amqp from 'amqplib';
import * as supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
} from '../src/modules/auth/auth-session.util';
import {
  NOTIFICATION_EVENTS_QUEUE,
  NOTIFICATION_EVENT_TYPES,
} from '../src/modules/rabbitmq/rabbitmq.events';

type TestUser = {
  id: string;
  email: string;
  roles: string[];
  permissions?: string[];
};

type AuthContext = {
  token: string;
  bearer: Record<string, string>;
  cookie: Record<string, string>;
  csrf: Record<string, string>;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function emitWithAck<T>(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>,
) {
  return socket.timeout(10_000).emitWithAck(event, payload) as Promise<T>;
}

describe('Notification service integration', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let baseUrl: string;
  let rabbitConnection: amqp.ChannelModel;
  let rabbitChannel: amqp.Channel;

  const studentUser: TestUser = {
    id: 'student-user-1',
    email: 'student1@campuscore.edu',
    roles: ['STUDENT'],
  };

  const secondStudentUser: TestUser = {
    id: 'student-user-2',
    email: 'student2@campuscore.edu',
    roles: ['STUDENT'],
  };

  const adminUser: TestUser = {
    id: 'admin-user-1',
    email: 'admin@campuscore.edu',
    roles: ['ADMIN'],
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL ??= 'http://127.0.0.1:3100';
    process.env.HEALTH_READINESS_KEY ??= 'notification-readiness-key';
    process.env.COOKIE_SECURE ??= 'false';

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
    await rabbitChannel.assertQueue(NOTIFICATION_EVENTS_QUEUE, {
      durable: true,
    });
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany();
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

  it('supports cookie auth, csrf enforcement, and unread inbox reads', async () => {
    await prisma.notification.createMany({
      data: [
        {
          id: 'n-1',
          userId: studentUser.id,
          title: 'Unread notification',
          message: 'You have a new invoice.',
          type: 'INFO',
        },
        {
          id: 'n-2',
          userId: studentUser.id,
          title: 'Read notification',
          message: 'Semester schedule updated.',
          type: 'SUCCESS',
          isRead: true,
          readAt: new Date(),
        },
        {
          id: 'n-3',
          userId: adminUser.id,
          title: 'Admin only',
          message: 'Ignore this',
          type: 'INFO',
        },
      ],
    });

    const auth = await issueAuth(studentUser);

    await supertest(baseUrl)
      .get('/api/v1/notifications/my')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toHaveLength(2);
        expect(
          body.data.every(
            (item: { userId: string }) => item.userId === studentUser.id,
          ),
        ).toBe(true);
      });

    await supertest(baseUrl)
      .get('/api/v1/notifications/my/unread-count')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.unreadCount).toBe(1);
      });

    await supertest(baseUrl)
      .patch('/api/v1/notifications/my/n-1/read')
      .set(auth.cookie)
      .send({})
      .expect(403);

    await supertest(baseUrl)
      .patch('/api/v1/notifications/my/n-1/read')
      .set(auth.cookie)
      .set(auth.csrf)
      .send({})
      .expect(200)
      .expect(({ body }) => {
        expect(body.isRead).toBe(true);
      });

    await supertest(baseUrl)
      .patch('/api/v1/notifications/my/read-all')
      .set(auth.cookie)
      .set(auth.csrf)
      .send({})
      .expect(200)
      .expect(({ body }) => {
        expect(body.updated).toBeGreaterThanOrEqual(0);
      });

    await supertest(baseUrl)
      .delete('/api/v1/notifications/my/n-2')
      .set(auth.cookie)
      .set(auth.csrf)
      .expect(200);
  });

  it('supports legacy bearer admin CRUD', async () => {
    const adminAuth = await issueAuth(adminUser);

    const createResponse = await supertest(baseUrl)
      .post('/api/v1/notifications')
      .set(adminAuth.bearer)
      .send({
        userId: studentUser.id,
        title: 'Created by admin',
        message: 'This came from admin REST.',
        type: 'WARNING',
      })
      .expect(201);

    await supertest(baseUrl)
      .get('/api/v1/notifications')
      .set(adminAuth.bearer)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toHaveLength(1);
      });

    await supertest(baseUrl)
      .put(`/api/v1/notifications/${createResponse.body.id}`)
      .set(adminAuth.bearer)
      .send({
        title: 'Updated title',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe('Updated title');
      });
  });

  it('authenticates websocket clients from token or cookie and rejects invalid tokens', async () => {
    const auth = await issueAuth(studentUser);
    const validSocket = await connectNotificationsSocket({
      token: auth.token,
    });

    try {
      const authResult = await emitWithAck<{
        status: string;
        userId: string;
        roles: string[];
      }>(validSocket, 'authenticate', { channel: 'announcements' });
      expect(authResult.status).toBe('authenticated');
      expect(authResult.userId).toBe(studentUser.id);
      expect(authResult.roles).toContain('STUDENT');
    } finally {
      validSocket.disconnect();
    }

    const cookieSocket = await connectNotificationsSocket({
      cookieHeader: [`cc_access_token=${auth.token}`].join('; '),
    });

    try {
      const authResult = await emitWithAck<{
        status: string;
        userId: string;
        roles: string[];
      }>(cookieSocket, 'authenticate', { channel: 'announcements' });
      expect(authResult.status).toBe('authenticated');
      expect(authResult.userId).toBe(studentUser.id);
      expect(authResult.roles).toContain('STUDENT');
    } finally {
      cookieSocket.disconnect();
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

  it('consumes RabbitMQ events for announcements and user notifications', async () => {
    const auth = await issueAuth(studentUser);
    const socket = await connectNotificationsSocket({
      token: auth.token,
    });

    try {
      await emitWithAck(socket, 'subscribe', { channel: 'announcements' });

      const announcementPromise = waitForSocketEvent(socket, 'announcement');
      rabbitChannel.sendToQueue(
        NOTIFICATION_EVENTS_QUEUE,
        Buffer.from(
          JSON.stringify({
            type: NOTIFICATION_EVENT_TYPES.ANNOUNCEMENT_CREATED,
            source: 'campuscore-core-api',
            occurredAt: new Date().toISOString(),
            payload: {
              announcement: {
                id: 'announcement-1',
                title: 'Realtime announcement',
              },
            },
          }),
        ),
        { persistent: true },
      );

      await expect(announcementPromise).resolves.toMatchObject({
        id: 'announcement-1',
        title: 'Realtime announcement',
      });

      const notificationPromise = waitForSocketEvent(socket, 'notification');
      rabbitChannel.sendToQueue(
        NOTIFICATION_EVENTS_QUEUE,
        Buffer.from(
          JSON.stringify({
            type: NOTIFICATION_EVENT_TYPES.NOTIFICATION_USER_CREATED,
            source: 'campuscore-core-api',
            occurredAt: new Date().toISOString(),
            payload: {
              userId: studentUser.id,
              notification: {
                id: 'event-notification-1',
                title: 'Inbox event',
                message: 'Notification service consumed the queue event.',
                type: 'INFO',
              },
            },
          }),
        ),
        { persistent: true },
      );

      await expect(notificationPromise).resolves.toMatchObject({
        id: 'event-notification-1',
        userId: studentUser.id,
        title: 'Inbox event',
      });

      const saved = await prisma.notification.findUnique({
        where: { id: 'event-notification-1' },
      });
      expect(saved?.userId).toBe(studentUser.id);
    } finally {
      socket.disconnect();
    }
  });

  it('fans out role notifications with persistence for listed users', async () => {
    const auth = await issueAuth(studentUser);
    const socket = await connectNotificationsSocket({
      token: auth.token,
    });

    try {
      await emitWithAck(socket, 'subscribe', { channel: 'role:STUDENT' });

      const notificationPromise = waitForSocketEvent(socket, 'notification');
      rabbitChannel.sendToQueue(
        NOTIFICATION_EVENTS_QUEUE,
        Buffer.from(
          JSON.stringify({
            type: NOTIFICATION_EVENT_TYPES.NOTIFICATION_ROLE_CREATED,
            source: 'campuscore-core-api',
            occurredAt: new Date().toISOString(),
            payload: {
              role: 'STUDENT',
              userIds: [studentUser.id, secondStudentUser.id],
              notification: {
                title: 'Role-wide notice',
                message: 'All students should see this.',
                type: 'SUCCESS',
              },
            },
          }),
        ),
        { persistent: true },
      );

      await expect(notificationPromise).resolves.toMatchObject({
        role: 'STUDENT',
      });

      const saved = await prisma.notification.findMany({
        where: {
          userId: {
            in: [studentUser.id, secondStudentUser.id],
          },
        },
      });
      expect(saved).toHaveLength(2);
    } finally {
      socket.disconnect();
    }
  });

  async function issueAuth(user: TestUser): Promise<AuthContext> {
    const token = await jwtService.signAsync({
      sub: user.id,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions ?? [],
      studentId: user.roles.includes('STUDENT') ? user.id : null,
      lecturerId: user.roles.includes('LECTURER') ? user.id : null,
    });
    const csrfToken = 'test-csrf-token';

    return {
      token,
      bearer: {
        Authorization: `Bearer ${token}`,
      },
      cookie: {
        Cookie: [
          `cc_access_token=${token}`,
          `${CSRF_COOKIE}=${csrfToken}`,
        ].join('; '),
      },
      csrf: {
        [CSRF_HEADER]: csrfToken,
      },
    };
  }

  async function connectNotificationsSocket({
    token,
    cookieHeader,
  }: {
    token?: string;
    cookieHeader?: string;
  }) {
    const socket = io(new URL('/notifications', baseUrl).toString(), {
      transports: ['websocket'],
      auth: token ? { token } : undefined,
      reconnection: false,
      forceNew: true,
      extraHeaders: {
        Origin: process.env.FRONTEND_URL ?? 'http://127.0.0.1:3100',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timed out waiting for notifications socket connect'));
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
            `Notifications socket disconnected before auth finished: ${reason}`,
          ),
        );
      });
    });

    return socket;
  }

  async function waitForRejectedSocket(socket: Socket) {
    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Invalid socket token was not rejected in time'));
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

  async function waitForSocketEvent(
    socket: Socket,
    event: 'announcement' | 'notification',
  ) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${event} websocket event`));
      }, 10_000);

      socket.once(event, (payload) => {
        clearTimeout(timeoutId);
        resolve(payload as Record<string, unknown>);
      });
    });
  }
});
