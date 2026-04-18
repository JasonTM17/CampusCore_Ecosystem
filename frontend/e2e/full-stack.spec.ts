import { expect, test, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';

const isExternalStack = process.env.E2E_EXTERNAL_STACK === '1';
const frontendBaseURL =
  process.env.E2E_BASE_URL ??
  (isExternalStack ? 'http://127.0.0.1' : 'http://127.0.0.1:3100');
const apiBaseURL =
  process.env.E2E_API_URL ??
  (isExternalStack ? 'http://127.0.0.1/api/v1' : 'http://127.0.0.1:4100/api/v1');
const notificationsURL = new URL('/notifications', frontendBaseURL).toString();

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  const passwordInput = page.locator('input#password');
  const submitButton = page.getByRole('button', { name: 'Sign In' });

  await expect(passwordInput).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await page.getByLabel('Email Address').fill(email);
  await passwordInput.fill(password);
  await submitButton.click();
}

async function emitWithAck<T>(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>,
) {
  return socket.timeout(10_000).emitWithAck(event, payload) as Promise<T>;
}

async function connectSocket(accessToken: string) {
  const socket = io(notificationsURL, {
    transports: ['websocket'],
    auth: { token: accessToken },
    reconnection: false,
    forceNew: true,
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
        new Error(`Notifications socket disconnected before auth: ${reason}`),
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

test('public pages respond successfully', async ({ request }) => {
  const homeResponse = await request.get(frontendBaseURL);
  expect(homeResponse.ok()).toBeTruthy();

  const loginResponse = await request.get(`${frontendBaseURL}/login`);
  expect(loginResponse.ok()).toBeTruthy();
});

test('backend API authenticates seeded student data', async ({ request }) => {
  const loginResponse = await request.post(`${apiBaseURL}/auth/login`, {
    data: {
      email: 'student1@campuscore.edu',
      password: 'password123',
    },
  });

  expect(loginResponse.ok()).toBeTruthy();

  const loginData = await loginResponse.json();
  expect(loginData.accessToken).toBeTruthy();
  expect(loginData.refreshToken).toBeTruthy();
  expect(loginData.user.email).toBe('student1@campuscore.edu');
  expect(loginData.user.roles).toContain('STUDENT');
  expect(loginResponse.headers()['set-cookie'] ?? '').toContain('cc_access_token=');
  expect(loginResponse.headers()['set-cookie'] ?? '').toContain('cc_refresh_token=');
  expect(loginResponse.headers()['set-cookie'] ?? '').toContain('cc_csrf=');

  const cookieMeResponse = await request.get(`${apiBaseURL}/auth/me`);
  expect(cookieMeResponse.ok()).toBeTruthy();

  const cookieMe = await cookieMeResponse.json();
  expect(cookieMe.email).toBe('student1@campuscore.edu');
  expect(cookieMe.roles).toContain('STUDENT');

  const meResponse = await request.get(`${apiBaseURL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${loginData.accessToken}`,
    },
  });

  expect(meResponse.ok()).toBeTruthy();

  const me = await meResponse.json();
  expect(me.email).toBe('student1@campuscore.edu');
  expect(me.roles).toContain('STUDENT');
});

test('student can sign in and open the dashboard invoices flow', async ({ page }) => {
  await signIn(page, 'student1@campuscore.edu', 'password123');

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole('heading', { name: /Welcome back, Michael/i }),
  ).toBeVisible();
  await expect.poll(async () => {
      const cookies = await page.context().cookies();
      return {
        hasAccessCookie: cookies.some(
          (cookie) => cookie.name === 'cc_access_token' && cookie.httpOnly,
        ),
        hasRefreshCookie: cookies.some(
          (cookie) => cookie.name === 'cc_refresh_token' && cookie.httpOnly,
        ),
        hasCsrfCookie: cookies.some(
          (cookie) => cookie.name === 'cc_csrf' && !cookie.httpOnly,
        ),
      };
    })
    .toEqual({
      hasAccessCookie: true,
      hasRefreshCookie: true,
      hasCsrfCookie: true,
    });

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole('heading', { name: /Welcome back, Michael/i }),
  ).toBeVisible();

  await page.getByRole('link', { name: /Invoices/i }).first().click();

  await expect(page).toHaveURL(/\/dashboard\/invoices$/);
  await expect(page.getByRole('heading', { name: 'My Invoices' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Spring 2025' })).toBeVisible();

  await page
    .getByRole('button', { name: /View details for invoice/i })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Invoice Details' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Close invoice details' }),
  ).toBeVisible();
});

test('admin can sign in and lands on the admin dashboard', async ({ page }) => {
  await signIn(page, 'admin@campuscore.edu', 'admin123');

  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole('heading', { name: 'Admin Dashboard' }),
  ).toBeVisible();
  await expect(page.getByText('Management Console')).toBeVisible();
  await expect(page.getByRole('link', { name: /User Management/i })).toBeVisible();

  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit user / }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Delete user / }).first()).toBeVisible();
});

test('lecturer can sign in and view the teaching schedule flow', async ({
  page,
}) => {
  await signIn(page, 'john.doe@campuscore.edu', 'password123');

  await expect(page).toHaveURL(/\/dashboard\/lecturer$/);
  await expect(page.getByText(/Lecturer Portal/i)).toBeVisible();

  await page.goto('/dashboard/lecturer/schedule');
  await expect(
    page.getByRole('heading', { name: 'My Teaching Schedule' }),
  ).toBeVisible();

  if ((await page.getByRole('table').count()) > 0) {
    await expect(page.getByRole('table')).toBeVisible();
  } else {
    await expect(
      page.getByRole('heading', { name: 'No Teaching Assignments' }),
    ).toBeVisible();
  }

  await page.goto('/dashboard/lecturer/grades');
  await expect(
    page.getByRole('heading', { name: 'Grade Management' }),
  ).toBeVisible();

  if ((await page.getByRole('table').count()) > 0) {
    await expect(
      page.getByRole('button', { name: /Manage Grades|Enter Grades/i }).first(),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole('heading', { name: 'No Sections Found' }),
    ).toBeVisible();
  }
});

test.describe('edge-only contract smoke', () => {
  test.skip(!isExternalStack, 'requires the nginx-backed external edge stack');

  test('public edge serves health and API docs', async ({ request }) => {
    const healthResponse = await request.get(`${frontendBaseURL}/health`);
    expect(healthResponse.ok()).toBeTruthy();

    const health = await healthResponse.json();
    expect(health.status).toBe('ok');
    expect(health.service).toBe('campuscore-api');
    expect(health.services).toBeUndefined();

    const readinessResponse = await request.get(
      `${frontendBaseURL}/api/v1/health/readiness`,
    );
    expect(readinessResponse.status()).toBe(403);

    const docsResponse = await request.get(`${frontendBaseURL}/api/docs`);
    expect(docsResponse.ok()).toBeTruthy();
    expect(await docsResponse.text()).toContain('Swagger UI');
  });

  test('notifications gateway authenticates through the public edge', async ({
    request,
  }) => {
    const loginResponse = await request.post(`${apiBaseURL}/auth/login`, {
      data: {
        email: 'student1@campuscore.edu',
        password: 'password123',
      },
    });

    expect(loginResponse.ok()).toBeTruthy();
    const loginData = await loginResponse.json();
    const socket = await connectSocket(loginData.accessToken);

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
    } finally {
      socket.disconnect();
    }
  });

  test('notifications gateway rejects invalid public edge tokens', async () => {
    const socket = io(notificationsURL, {
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
