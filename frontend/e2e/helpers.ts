import {
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { io, type Socket } from 'socket.io-client';

export const isExternalStack = process.env.E2E_EXTERNAL_STACK === '1';
export const frontendBaseURL =
  process.env.E2E_BASE_URL ??
  (isExternalStack ? 'http://127.0.0.1' : 'http://127.0.0.1:3100');
export const apiBaseURL =
  process.env.E2E_API_URL ??
  (isExternalStack
    ? 'http://127.0.0.1/api/v1'
    : 'http://127.0.0.1:4100/api/v1');
export const apiOrigin = new URL(apiBaseURL).origin;
export const notificationsURL = new URL(
  '/notifications',
  frontendBaseURL,
).toString();

export const SEEDED_USERS = {
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

export type ControlSpec = {
  role: 'button' | 'link';
  name: string | RegExp;
};

export type RouteSpec = {
  path: string;
  heading: string | RegExp;
  controls?: ControlSpec[];
  ready?: (page: Page) => Promise<void>;
};

export const publicRoutes = ['/', '/login', '/forgot-password', '/reset-password'];

export const studentRoutes: RouteSpec[] = [
  {
    path: '/dashboard',
    heading: /Welcome back/i,
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

export const adminRoutes: RouteSpec[] = [
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

export const lecturerRoutes: RouteSpec[] = [
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

let loginAttemptCounter = 0;
const sharedRoleSessionCache = new Map<
  keyof typeof SEEDED_USERS,
  Promise<SessionArtifacts>
>();

type RequestFactory = {
  request: {
    newContext: (options?: { baseURL?: string }) => Promise<APIRequestContext>;
  };
};

export function normalizeSetCookie(setCookie?: string[] | string) {
  if (!setCookie) {
    return [];
  }

  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

export function toCookieHeader(setCookie?: string[] | string) {
  return normalizeSetCookie(setCookie)
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

export function extractCookieValue(
  setCookie: string[] | string | undefined,
  name: string,
) {
  for (const cookie of normalizeSetCookie(setCookie)) {
    const [pair] = cookie.split(';', 1);
    const [cookieName, ...rest] = pair.split('=');
    if (cookieName === name) {
      return rest.join('=');
    }
  }

  return undefined;
}

export function getSetCookieHeaders(response: {
  headersArray?: () => Array<{ name: string; value: string }>;
  headers?: () => Record<string, string>;
}) {
  const headerEntries = response.headersArray?.() ?? [];
  const setCookies = headerEntries
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);

  if (setCookies.length > 0) {
    return setCookies;
  }

  const legacyHeader = response.headers?.()['set-cookie'];
  return normalizeSetCookie(legacyHeader);
}

export type SessionArtifacts = {
  authData: any;
  setCookieHeaders: string[];
  cookieHeader: string;
  csrfToken?: string;
};

function cloneSessionArtifacts(session: SessionArtifacts): SessionArtifacts {
  return {
    authData: JSON.parse(JSON.stringify(session.authData)),
    setCookieHeaders: [...session.setCookieHeaders],
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  };
}

function mapSameSite(value: string | undefined): 'Strict' | 'Lax' | 'None' {
  const normalized = value?.toLowerCase();

  if (normalized === 'strict') {
    return 'Strict';
  }

  if (normalized === 'none') {
    return 'None';
  }

  return 'Lax';
}

function parseSetCookieForBrowser(cookie: string) {
  const [pair, ...attributeParts] = cookie.split(';');
  const separatorIndex = pair.indexOf('=');

  if (separatorIndex === -1) {
    return null;
  }

  const name = pair.slice(0, separatorIndex).trim();
  const value = pair.slice(separatorIndex + 1).trim();
  const domain = new URL(frontendBaseURL).hostname;
  let path = '/';
  let httpOnly = false;
  let secure = false;
  let sameSite: 'Strict' | 'Lax' | 'None' = 'Lax';
  let expires = -1;

  for (const attributePart of attributeParts) {
    const [rawKey, ...rawValueParts] = attributePart.trim().split('=');
    const key = rawKey.toLowerCase();
    const attributeValue = rawValueParts.join('=').trim();

    if (key === 'path' && attributeValue) {
      path = attributeValue;
      continue;
    }

    if (key === 'httponly') {
      httpOnly = true;
      continue;
    }

    if (key === 'secure') {
      secure = true;
      continue;
    }

    if (key === 'samesite') {
      sameSite = mapSameSite(attributeValue);
      continue;
    }

    if (key === 'max-age' && attributeValue) {
      const parsedMaxAge = Number(attributeValue);
      if (!Number.isNaN(parsedMaxAge)) {
        expires = Math.floor(Date.now() / 1000) + parsedMaxAge;
      }
      continue;
    }

    if (key === 'expires' && attributeValue) {
      const parsedExpires = Date.parse(attributeValue);
      if (!Number.isNaN(parsedExpires)) {
        expires = Math.floor(parsedExpires / 1000);
      }
    }
  }

  return {
    name,
    value,
    domain,
    path,
    httpOnly,
    secure,
    sameSite,
    expires,
  };
}

export async function applySessionCookiesToPage(
  page: Page,
  setCookieHeaders: string[] | string,
) {
  const cookies = normalizeSetCookie(setCookieHeaders)
    .map(parseSetCookieForBrowser)
    .filter((cookie): cookie is NonNullable<ReturnType<typeof parseSetCookieForBrowser>> =>
      Boolean(cookie),
    );

  if (cookies.length === 0) {
    throw new Error('Login response did not return any session cookies');
  }

  await page.context().addCookies(cookies);
}

export async function expectOkResponse(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  context: string,
) {
  if (response.ok()) {
    return;
  }

  const responseText = await response.text();
  throw new Error(
    `${context} failed with ${response.status()} ${response.statusText()}: ${responseText.slice(0, 500)}`,
  );
}

export function buildCookieHeaders(
  session: Pick<SessionArtifacts, 'cookieHeader' | 'csrfToken'>,
  extraHeaders: Record<string, string> = {},
) {
  return {
    Cookie: session.cookieHeader,
    ...extraHeaders,
  };
}

export function buildMutatingSessionHeaders(
  session: Pick<SessionArtifacts, 'cookieHeader' | 'csrfToken'>,
  extraHeaders: Record<string, string> = {},
) {
  return {
    Cookie: session.cookieHeader,
    'X-CSRF-Token': session.csrfToken ?? '',
    ...extraHeaders,
  };
}

export function apiUrl(path: string) {
  return `${apiBaseURL}${path}`;
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  const passwordInput = page.locator('input#password');
  const submitButton = page.getByRole('button', { name: 'Sign In' });

  await expect(passwordInput).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await page.getByLabel('Email Address').fill(email);
  await passwordInput.fill(password);
  await submitButton.click();
}

export async function expectSessionCookies(page: Page) {
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
}

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function expectControl(page: Page, control: ControlSpec) {
  await expect(
    page.getByRole(control.role, { name: control.name }).first(),
  ).toBeVisible();
}

export async function visitRoute(page: Page, route: RouteSpec) {
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

export async function visitRoutes(page: Page, routes: RouteSpec[]) {
  const context = page.context();

  for (const route of routes) {
    const routePage = await context.newPage();
    try {
      await visitRoute(routePage, route);
    } finally {
      await routePage.close();
    }
  }
}

export async function emitWithAck<T>(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>,
) {
  return socket.timeout(10_000).emitWithAck(event, payload) as Promise<T>;
}

export async function connectSocket(accessToken: string) {
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

export async function waitForRejectedSocket(socket: Socket) {
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

export async function loginThroughApi(
  request: APIRequestContext,
  user: keyof typeof SEEDED_USERS,
) {
  loginAttemptCounter += 1;
  const octetA = ((Date.now() + loginAttemptCounter) % 200) + 1;
  const octetB = ((Math.floor(Math.random() * 10_000) + loginAttemptCounter) % 200) + 1;
  const response = await request.post(`${apiBaseURL}/auth/login`, {
    data: SEEDED_USERS[user],
    headers: {
      'X-Forwarded-For': `198.51.${octetA}.${octetB}`,
    },
  });
  await expectOkResponse(response, `Login for ${user}`);
  return response;
}

export async function createSessionArtifacts(
  request: APIRequestContext,
  user: keyof typeof SEEDED_USERS,
): Promise<SessionArtifacts> {
  const response = await loginThroughApi(request, user);
  return buildSessionArtifactsFromResponse(response);
}

export async function getSharedSessionArtifacts(
  playwright: RequestFactory,
  user: keyof typeof SEEDED_USERS,
): Promise<SessionArtifacts> {
  if (!sharedRoleSessionCache.has(user)) {
    sharedRoleSessionCache.set(
      user,
      (async () => {
        const api = await playwright.request.newContext({
          baseURL: apiOrigin,
        });

        try {
          return await createSessionArtifacts(api, user);
        } finally {
          await api.dispose();
        }
      })(),
    );
  }

  return cloneSessionArtifacts(await sharedRoleSessionCache.get(user)!);
}

export async function buildSessionArtifactsFromResponse(response: {
  json: () => Promise<any>;
  headersArray?: () => Array<{ name: string; value: string }>;
  headers?: () => Record<string, string>;
}): Promise<SessionArtifacts> {
  const authData = await response.json();
  const setCookieHeaders = getSetCookieHeaders(response);

  return {
    authData,
    setCookieHeaders,
    cookieHeader: toCookieHeader(setCookieHeaders),
    csrfToken: extractCookieValue(setCookieHeaders, 'cc_csrf'),
  };
}

export async function seedBrowserSession(
  page: Page,
  playwright: RequestFactory,
  user: keyof typeof SEEDED_USERS,
  options: { shared?: boolean } = {},
) {
  if (options.shared) {
    const session = await getSharedSessionArtifacts(playwright, user);
    await applySessionCookiesToPage(page, session.setCookieHeaders);
    return session.authData;
  }

  const api = await playwright.request.newContext({
    baseURL: apiOrigin,
  });

  try {
    const session = await createSessionArtifacts(api, user);
    await applySessionCookiesToPage(page, session.setCookieHeaders);
    return session.authData;
  } finally {
    await api.dispose();
  }
}
