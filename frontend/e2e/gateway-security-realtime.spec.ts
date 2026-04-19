import { expect, test } from '@playwright/test';
import {
  apiBaseURL,
  buildCookieHeaders,
  connectSocket,
  emitWithAck,
  frontendBaseURL,
  getSharedSessionArtifacts,
  isExternalStack,
  waitForRejectedSocket,
} from './helpers';
import { io } from 'socket.io-client';

test.describe('edge-only contract smoke', () => {
  test.skip(!isExternalStack, 'requires the nginx-backed external edge stack');

  test('public edge exposes liveness and docs while blocking readiness and internal paths', async ({
    request,
  }) => {
    const healthResponse = await request.get(`${frontendBaseURL}/health`);
    expect(healthResponse.ok()).toBeTruthy();

    const health = await healthResponse.json();
    expect(health.status).toBe('ok');
    expect(health.service).toBe('campuscore-api');
    expect(health.services).toBeUndefined();

    const docsResponse = await request.get(`${frontendBaseURL}/api/docs`);
    expect(docsResponse.ok()).toBeTruthy();
    expect(await docsResponse.text()).toContain('Swagger UI');

    const readinessResponse = await request.get(
      `${frontendBaseURL}/api/v1/health/readiness`,
    );
    expect(readinessResponse.status()).toBe(403);

    const internalResponse = await request.get(
      `${frontendBaseURL}/api/v1/internal/people-context/users/test-user`,
    );
    expect(internalResponse.status()).toBe(403);
  });

  test('public edge keeps notification routes on the notification service boundary', async ({
    request,
    playwright,
  }) => {
    const session = await getSharedSessionArtifacts(playwright, 'student');
    const unreadResponse = await request.get(
      `${apiBaseURL}/notifications/my/unread-count`,
      {
        headers: buildCookieHeaders(session),
      },
    );

    expect(unreadResponse.ok()).toBeTruthy();
    const unread = await unreadResponse.json();
    expect(typeof unread.unreadCount).toBe('number');
  });

  test('notifications gateway authenticates, reconnects, and receives announcement events through the public edge', async ({
    playwright,
  }) => {
    const adminApi = await playwright.request.newContext({
      baseURL: frontendBaseURL,
    });

    let createdAnnouncementId: string | undefined;
    let adminAccessToken: string | undefined;

    try {
      const studentSession = await getSharedSessionArtifacts(playwright, 'student');
      const adminSession = await getSharedSessionArtifacts(playwright, 'admin');
      const studentData = studentSession.authData;
      adminAccessToken = adminSession.authData.accessToken;

      const socket = await connectSocket(studentData.accessToken);

      try {
        const authResult = await emitWithAck<{
          status: string;
          userId: string;
          roles: string[];
        }>(socket, 'authenticate', { channel: 'announcements' });
        expect(authResult.status).toBe('authenticated');
        expect(authResult.userId).toBeTruthy();
        expect(authResult.roles).toContain('STUDENT');

        const subscribeResult = await emitWithAck<{
          status: string;
          channel: string;
        }>(socket, 'subscribe', { channel: 'announcements' });
        expect(subscribeResult).toEqual({
          status: 'subscribed',
          channel: 'announcements',
        });

        const announcementPromise = new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Timed out waiting for announcement event'));
            }, 15_000);

            socket.once('announcement', (payload) => {
              clearTimeout(timeout);
              resolve(payload as Record<string, unknown>);
            });
          },
        );

        const title = `E2E announcement ${Date.now()}`;
        const createResponse = await adminApi.post('/api/v1/announcements', {
          data: {
            title,
            content: 'Announcement emitted from edge E2E contract test.',
            priority: 'HIGH',
            isGlobal: true,
          },
          headers: {
            ...buildCookieHeaders(adminSession),
            Authorization: `Bearer ${adminSession.authData.accessToken}`,
          },
        });
        expect(createResponse.ok()).toBeTruthy();

        const createdAnnouncement = await createResponse.json();
        createdAnnouncementId = createdAnnouncement.id;

        const pushedAnnouncement = await announcementPromise;
        expect(pushedAnnouncement.title).toBe(title);

        socket.disconnect();

        const reconnectedSocket = await connectSocket(studentData.accessToken);
        try {
          const reconnectResult = await emitWithAck<{
            status: string;
            channel: string;
          }>(reconnectedSocket, 'subscribe', { channel: 'announcements' });
          expect(reconnectResult).toEqual({
            status: 'subscribed',
            channel: 'announcements',
          });
        } finally {
          reconnectedSocket.disconnect();
        }
      } finally {
        socket.disconnect();
      }
    } finally {
      if (createdAnnouncementId && adminAccessToken) {
        await adminApi.delete(`/api/v1/announcements/${createdAnnouncementId}`, {
          headers: {
            Authorization: `Bearer ${adminAccessToken}`,
          },
        });
      }
      await adminApi.dispose();
    }
  });

  test('notifications gateway rejects invalid public edge tokens', async () => {
    const socket = io(new URL('/notifications', frontendBaseURL).toString(), {
      transports: ['websocket'],
      auth: { token: 'invalid-edge-token' },
      reconnection: false,
      forceNew: true,
    });

    try {
      const rejectionReason = await waitForRejectedSocket(socket);
      expect(rejectionReason).toBeTruthy();
    } finally {
      socket.disconnect();
    }
  });
});
