import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';

const isExternalStack = process.env.E2E_EXTERNAL_STACK === '1';
const frontendBaseURL =
  process.env.E2E_BASE_URL ??
  (isExternalStack ? 'http://127.0.0.1' : 'http://127.0.0.1:3100');
const apiBaseURL =
  process.env.E2E_API_URL ??
  (isExternalStack
    ? 'http://127.0.0.1/api/v1'
    : 'http://127.0.0.1:4100/api/v1');
const notificationsURL = new URL('/notifications', frontendBaseURL).toString();

type ControlSpec = {
  role: 'button' | 'link';
  name: string | RegExp;
};

type RouteSpec = {
  path: string;
  heading: string | RegExp;
  controls?: ControlSpec[];
  ready?: (page: Page) => Promise<void>;
};

const publicRoutes = ['/', '/login', '/forgot-password', '/reset-password'];

const studentRoutes: RouteSpec[] = [
  {
    path: '/dashboard',
    heading: /Welcome back, Michael/i,
    controls: [
      { role: 'button', name: 'Toggle notifications panel' },
      { role: 'button', name: 'Toggle profile menu' },
    ],
  },
  { path: '/dashboard/register', heading: 'Available Sections' },
  { path: '/dashboard/enrollments', heading: 'My Enrollments' },
  { path: '/dashboard/schedule', heading: 'My Class Schedule' },
  { path: '/dashboard/grades', heading: 'Academic Grades' },
  { path: '/dashboard/transcript', heading: 'Academic Transcript' },
  { path: '/dashboard/announcements', heading: 'Announcements' },
  {
    path: '/dashboard/profile',
    heading: 'Profile Settings',
    controls: [{ role: 'button', name: 'Upload profile photo' }],
  },
  {
    path: '/dashboard/invoices',
    heading: 'My Invoices',
    controls: [{ role: 'button', name: /View details for invoice/i }],
    ready: async (page) => {
      await page
        .getByRole('button', { name: /View details for invoice/i })
        .first()
        .click();
      await expect(
        page.getByRole('heading', { name: 'Invoice Details' }),
      ).toBeVisible();
      const closeButton = page.getByRole('button', {
        name: 'Close invoice details',
      });
      await expect(closeButton).toBeVisible();
      await closeButton.click();
      await expect(
        page.getByRole('heading', { name: 'Invoice Details' }),
      ).toBeHidden();
    },
  },
];

const adminRoutes: RouteSpec[] = [
  {
    path: '/admin/users',
    heading: 'User Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /Edit user / },
      { role: 'button', name: /Delete user / },
    ],
  },
  {
    path: '/admin/lecturers',
    heading: 'Lecturer Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /Edit lecturer / },
      { role: 'button', name: /Delete lecturer / },
    ],
  },
  {
    path: '/admin/courses',
    heading: 'Course Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /Edit course / },
      { role: 'button', name: /Delete course / },
    ],
  },
  {
    path: '/admin/sections',
    heading: 'Section Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /Edit section / },
      { role: 'button', name: /Delete section / },
    ],
  },
  {
    path: '/admin/enrollments',
    heading: 'Enrollment Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /View enrollment details for / },
      { role: 'button', name: /Delete enrollment for / },
    ],
  },
  {
    path: '/admin/classrooms',
    heading: 'Classroom Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /Edit classroom / },
      { role: 'button', name: /Delete classroom / },
    ],
  },
  {
    path: '/admin/semesters',
    heading: 'Semester Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /Edit semester / },
      { role: 'button', name: /Delete semester / },
    ],
  },
  {
    path: '/admin/academic-years',
    heading: 'Academic Year Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /Edit academic year / },
      { role: 'button', name: /Delete academic year / },
    ],
  },
  {
    path: '/admin/departments',
    heading: 'Department Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /Edit department / },
      { role: 'button', name: /Delete department / },
    ],
  },
  {
    path: '/admin/announcements',
    heading: 'Announcements',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /Delete announcement / },
    ],
  },
  {
    path: '/admin/invoices',
    heading: 'Invoice Management',
    controls: [
      { role: 'link', name: 'Back to admin dashboard' },
      { role: 'button', name: /View invoice / },
      { role: 'button', name: /Delete invoice / },
    ],
  },
  {
    path: '/admin/analytics',
    heading: 'Reports & Analytics',
    controls: [{ role: 'link', name: 'Back to admin dashboard' }],
  },
];

const lecturerRoutes: RouteSpec[] = [
  {
    path: '/dashboard/lecturer',
    heading: /Lecturer Portal/i,
    controls: [
      { role: 'button', name: 'Toggle notifications panel' },
      { role: 'button', name: 'Toggle profile menu' },
    ],
  },
  {
    path: '/dashboard/profile',
    heading: 'Profile Settings',
    controls: [{ role: 'button', name: 'Upload profile photo' }],
  },
  {
    path: '/dashboard/lecturer/schedule',
    heading: 'My Teaching Schedule',
    ready: async (page) => {
      if ((await page.getByRole('table').count()) > 0) {
        await expect(page.getByRole('table').first()).toBeVisible();
      } else {
        await expect(
          page.getByRole('heading', { name: 'No Teaching Assignments' }),
        ).toBeVisible();
      }
    },
  },
  {
    path: '/dashboard/lecturer/announcements',
    heading: 'Announcements',
    controls: [{ role: 'link', name: 'Back to lecturer dashboard' }],
  },
];

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

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function expectControl(page: Page, control: ControlSpec) {
  await expect(
    page.getByRole(control.role, { name: control.name }).first(),
  ).toBeVisible();
}

async function visitRoute(page: Page, route: RouteSpec) {
  const routeTimeout = isExternalStack ? 20_000 : 45_000;

  await page.goto(route.path, {
    timeout: routeTimeout,
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(new RegExp(`${escapeForRegExp(route.path)}$`));
  await expect(
    page.getByRole('heading', { name: route.heading }).first(),
  ).toBeVisible();

  for (const control of route.controls ?? []) {
    await expectControl(page, control);
  }

  if (route.ready) {
    await route.ready(page);
  }
}

async function visitRoutes(page: Page, routes: RouteSpec[]) {
  const context = page.context();

  for (const route of routes) {
    await test.step(`visit ${route.path}`, async () => {
      if (!isExternalStack) {
        await visitRoute(page, route);
        return;
      }

      const routePage = await context.newPage();

      try {
        await visitRoute(routePage, route);
      } finally {
        await routePage.close();
      }
    });
  }
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
  for (const route of publicRoutes) {
    const response = await request.get(`${frontendBaseURL}${route}`);
    expect(response.ok()).toBeTruthy();
  }
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
  expect(loginResponse.headers()['set-cookie'] ?? '').toContain(
    'cc_access_token=',
  );
  expect(loginResponse.headers()['set-cookie'] ?? '').toContain(
    'cc_refresh_token=',
  );
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

test('student can traverse every implemented student route', async ({
  page,
}) => {
  test.slow();
  test.setTimeout(90_000);
  await signIn(page, 'student1@campuscore.edu', 'password123');

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole('heading', { name: /Welcome back, Michael/i }),
  ).toBeVisible();
  await expect
    .poll(async () => {
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

  await visitRoutes(page, studentRoutes);
});

test('admin can traverse every implemented admin route', async ({ page }) => {
  test.slow();
  test.setTimeout(180_000);
  await signIn(page, 'admin@campuscore.edu', 'admin123');

  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole('heading', { name: 'Admin Dashboard' }),
  ).toBeVisible();
  await expect(page.getByText('Management Console')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /User Management/i }),
  ).toBeVisible();

  await visitRoutes(page, adminRoutes);
});

test('lecturer can traverse every implemented lecturer route', async ({
  page,
}) => {
  test.slow();
  test.setTimeout(120_000);
  await signIn(page, 'john.doe@campuscore.edu', 'password123');

  await expect(page).toHaveURL(/\/dashboard\/lecturer$/);
  await expect(
    page.getByRole('heading', { name: /Lecturer Portal/i }),
  ).toBeVisible();

  await visitRoutes(page, lecturerRoutes);

  await test.step('visit /dashboard/lecturer/grades and open a section detail route', async () => {
    await visitRoute(page, {
      path: '/dashboard/lecturer/grades',
      heading: 'Grade Management',
      ready: async (currentPage) => {
        const manageButtons = currentPage.getByRole('button', {
          name: /Manage Grades|Enter Grades/i,
        });

        if ((await manageButtons.count()) === 0) {
          await expect(
            currentPage.getByRole('heading', { name: 'No Sections Found' }),
          ).toBeVisible();
          return;
        }

        await expect(manageButtons.first()).toBeVisible();
        await manageButtons.first().click();
        await expect(currentPage).toHaveURL(
          /\/dashboard\/lecturer\/grades\/[^/]+$/,
        );
        await expect(
          currentPage.getByRole('button', { name: 'Save Grades' }),
        ).toBeVisible();
        await expect(
          currentPage.getByRole('button', { name: 'Publish Grades' }),
        ).toBeVisible();
        await expect(
          currentPage
            .getByRole('link', { name: /Back to grade management/i })
            .first(),
        ).toBeVisible();
      },
    });
  });
});

test.describe('edge-only contract smoke', () => {
  test.skip(!isExternalStack, 'requires the nginx-backed external edge stack');

  let edgeStudentApi: APIRequestContext | null = null;
  let edgeStudentAccessToken = '';

  test.beforeAll(async ({ playwright }) => {
    edgeStudentApi = await playwright.request.newContext({
      baseURL: frontendBaseURL,
    });

    const loginResponse = await edgeStudentApi.post('/api/v1/auth/login', {
      data: {
        email: 'student1@campuscore.edu',
        password: 'password123',
      },
    });

    expect(loginResponse.ok()).toBeTruthy();
    const loginData = await loginResponse.json();
    edgeStudentAccessToken = loginData.accessToken;
  });

  test.afterAll(async () => {
    await edgeStudentApi?.dispose();
  });

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

  test('public edge keeps notification routes on the notification service boundary', async ({
  }) => {
    expect(edgeStudentApi).toBeTruthy();
    const unreadResponse = await edgeStudentApi!.get(
      '/api/v1/notifications/my/unread-count',
    );
    expect(unreadResponse.ok()).toBeTruthy();

    const unread = await unreadResponse.json();
    expect(typeof unread.unreadCount).toBe('number');
  });

  test('notifications gateway authenticates through the public edge', async ({
  }) => {
    expect(edgeStudentAccessToken).toBeTruthy();
    const socket = await connectSocket(edgeStudentAccessToken);

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
