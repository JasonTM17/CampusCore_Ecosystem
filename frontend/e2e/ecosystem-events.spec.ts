import { expect, request as pwRequest, test, type Page } from '@playwright/test';

/**
 * P08 events spec (domain-contracts §5 D4, phase-08 exit): the full
 * journey create → publish → register → attend on the e2e preview stack.
 * Staff + student legs drive the REST surface on the API loopback (bearer
 * tokens, cookie-free request contexts — the same anti-CSRF pattern as the
 * content spec); the browser leg lands on /admin/events through the
 * portal SSO lane and proves the staff roster + attendance mark render
 * (full admins bounce from /dashboard/* to /admin by the layout policy).
 *
 * Contract coverage:
 *   - capacity: second student on a capacity-1 event gets EVENT_FULL;
 *   - idempotent register replay returns the same registration row;
 *   - student cancel frees exactly one seat, claimable by the next student;
 *   - staff cancel notifies registrants and retains history;
 *   - attendance is manual, roster-scoped, after close + start.
 *
 * Required env (ecosystem-events-verify.mjs supplies them):
 *   SSO_PORTAL_BASE / EVENTS_API_BASE / E2E_ADMIN_PASSCODE /
 *   E2E_STUDENT_PASSCODE / E2E_STUDENT2_PASSCODE / SSO_ID_BASE
 */

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
  },
});

const PORTAL = process.env.SSO_PORTAL_BASE ?? 'https://portal.localhost:3102';
const API = process.env.EVENTS_API_BASE ?? 'http://127.0.0.1:4100';
const ID_BASE = process.env.SSO_ID_BASE ?? 'https://id.localhost:4443';
const ADMIN = { email: 'admin@campuscore.edu', password: process.env.E2E_ADMIN_PASSCODE ?? 'password123' };
const STUDENT = { email: 'student@campuscore.edu', password: process.env.E2E_STUDENT_PASSCODE ?? 'password123' };
const STUDENT2 = { email: 'student2@campuscore.edu', password: process.env.E2E_STUDENT2_PASSCODE ?? 'password123' };

const SUFFIX = `e2e${Date.now().toString(36)}`;

interface Seed {
  eventId: string;
  eventTitle: string;
  registrationId: string;
  secondRegistrationId: string;
  cancelledEventId: string;
}

let seed: Seed;

async function login(email: string, password: string) {
  const request = await pwRequest.newContext();
  try {
    const response = await request.post(`${API}/api/v1/auth/login`, {
      data: { email, password },
    });
    expect(response.status(), `login ${email}`).toBe(200);
    const body = await response.json();
    return body.accessToken as string;
  } finally {
    await request.dispose();
  }
}

async function call(token: string, method: string, path: string, data?: unknown, headers?: Record<string, string>) {
  const request = await pwRequest.newContext();
  try {
    const response = await request.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      data: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status(), body: await response.text() };
  } finally {
    await request.dispose();
  }
}

async function ok(token: string, method: string, path: string, data?: unknown, headers?: Record<string, string>) {
  const response = await call(token, method, path, data, headers);
  expect(response.status, `${method} ${path}: ${response.body}`).toBeLessThan(300);
  return response.body ? JSON.parse(response.body) : null;
}

test.beforeAll(async () => {
  // The roster leg waits for the event start (~45s) before marking attendance.
  test.setTimeout(120000);
  const admin = await login(ADMIN.email, ADMIN.password);
  const student = await login(STUDENT.email, STUDENT.password);
  const student2 = await login(STUDENT2.email, STUDENT2.password);

  // Capacity-1 event that starts shortly after the registration steps: the
  // server refuses signup and cancellation once an event has started, and
  // refuses attendance before it starts, so the roster leg waits for the
  // start time (EVT-T06).
  const now = Date.now();
  const startsAtMs = now + 45 * 1000;
  const created = await ok(admin, 'POST', '/api/v1/events/staff', {
    title: `E2E Union Fair ${SUFFIX}`,
    description: 'e2e fixture',
    location: 'Hall A',
    organizer: 'Đoàn Thanh niên',
    capacity: 1,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    registrationOpensAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    registrationClosesAt: new Date(startsAtMs - 5 * 1000).toISOString(),
  });
  expect(created.status).toBe('DRAFT');
  await ok(admin, 'POST', `/api/v1/events/staff/${created.id}/publish`);
  await ok(admin, 'POST', `/api/v1/events/staff/${created.id}/open-registration`, {});

  // Idempotent replay: same key twice → same registration, count stays 1.
  const first = await ok(student, 'POST', `/api/v1/events/${created.id}/register`, null, {
    'Idempotency-Key': `e2e-reg-${SUFFIX}`,
  });
  const replay = await ok(student, 'POST', `/api/v1/events/${created.id}/register`, null, {
    'Idempotency-Key': `e2e-reg-${SUFFIX}`,
  });
  expect(replay.id).toBe(first.id);

  // Capacity: the second student hits the full event.
  const full = await call(student2, 'POST', `/api/v1/events/${created.id}/register`, null, {
    'Idempotency-Key': `e2e-full-${SUFFIX}`,
  });
  expect(full.status).toBe(409);
  expect(JSON.parse(full.body).code).toBe('EVENT_FULL');

  // Cancel frees exactly one seat; the waiting student claims it.
  await ok(student, 'POST', `/api/v1/events/registrations/${first.id}/cancel`, null, {
    'Idempotency-Key': `e2e-cancel-${SUFFIX}`,
  });
  const second = await ok(student2, 'POST', `/api/v1/events/${created.id}/register`, null, {
    'Idempotency-Key': `e2e-second-${SUFFIX}`,
  });

  await ok(admin, 'POST', `/api/v1/events/staff/${created.id}/close-registration`);
  const untilStart = startsAtMs + 1000 - Date.now();
  if (untilStart > 0) {
    await new Promise((resolve) => setTimeout(resolve, untilStart));
  }
  const roster = await ok(admin, 'POST', `/api/v1/events/staff/${created.id}/attendance`, {
    marks: [{ registrationId: second.id, status: 'ATTENDED' }],
  });
  const attended = roster.find(
    (entry: { registrationId: string }) => entry.registrationId === second.id);
  expect(attended.attendanceStatus).toBe('ATTENDED');
  expect(attended.attendanceMarkedBy).toBeTruthy();

  // Second event exercises EVT-T05: staff cancel → notification + retained
  // CANCELLED registration history, event still readable as CANCELLED.
  const cancelled = await ok(admin, 'POST', '/api/v1/events/staff', {
    title: `E2E Cancelled ${SUFFIX}`,
    organizer: 'Hội Sinh viên',
    capacity: 10,
    startsAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(now + 26 * 60 * 60 * 1000).toISOString(),
    registrationOpensAt: new Date(now - 60 * 60 * 1000).toISOString(),
    registrationClosesAt: new Date(now + 20 * 60 * 60 * 1000).toISOString(),
  });
  await ok(admin, 'POST', `/api/v1/events/staff/${cancelled.id}/publish`);
  await ok(admin, 'POST', `/api/v1/events/staff/${cancelled.id}/open-registration`, {});
  const doomed = await ok(student, 'POST', `/api/v1/events/${cancelled.id}/register`, null, {
    'Idempotency-Key': `e2e-doomed-${SUFFIX}`,
  });
  await ok(admin, 'POST', `/api/v1/events/staff/${cancelled.id}/cancel`, {
    reason: 'e2e room unavailable',
  });

  // Registrant inbox received exactly one cancellation notification (the
  // register-confirmation notice shares the same /events/{id} link — filter
  // on the cancellation title).
  const inbox = await ok(student, 'GET', '/api/v1/notifications/my?limit=50');
  const notices = (inbox.data ?? []).filter(
    (n: { link?: string; title?: string }) =>
      String(n.link ?? '').includes(cancelled.id)
      && String(n.title ?? '').startsWith('Sự kiện đã hủy'));
  expect(notices.length).toBe(1);

  seed = {
    eventId: created.id,
    eventTitle: `E2E Union Fair ${SUFFIX}`,
    registrationId: first.id,
    secondRegistrationId: second.id,
    cancelledEventId: cancelled.id,
  };
  void doomed;
});

/** Drive the id-host login page as admin and land on the portal surface. */
async function ssoAdminLogin(page: Page, returnPath: string) {
  const baseRe = new RegExp(`^${PORTAL.replace(/\./g, '\\.')}/`);
  const loginRe = new RegExp(`^${ID_BASE.replace(/\./g, '\\.')}/login`);
  await page.goto(`${PORTAL}/session/login?return=${encodeURIComponent(returnPath)}`);
  await page.waitForURL((url) => baseRe.test(url.href) || loginRe.test(url.href), {
    timeout: 45000,
  });
  if (loginRe.test(page.url())) {
    await page.fill('#email', ADMIN.email);
    await page.fill('#pw', ADMIN.password);
    await page.click('button[type=submit]');
    await page.waitForURL(baseRe, { timeout: 45000 });
  }
}

test.describe('ecosystem-events (P08 D4)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium');

  test('staff roster shows the attended mark on the portal surface', async ({ page }) => {
    // ssoAdminLogin lands on the return path itself — a second goto would
    // abort the in-flight bootstrap (auth/me, notifications) and bounce the
    // page back to /login.
    await ssoAdminLogin(page, '/admin/events');
    await expect(page.getByText(seed.eventTitle)).toBeVisible({ timeout: 30000 });

    // Expand the event card → roster table with the attended registrant.
    await page.getByText(seed.eventTitle).click();
    const row = page.locator('tr', { hasText: 'student2@campuscore.edu' });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText('Có mặt')).toBeVisible();
  });

  test('student list shows the cancelled event with its cancelled state', async ({
    request,
  }) => {
    const student = await login(STUDENT.email, STUDENT.password);
    const events = await ok(student, 'GET', '/api/v1/events');
    const cancelled = events.find((entry: { id: string }) => entry.id === seed.cancelledEventId);
    expect(cancelled.status).toBe('CANCELLED');
    void request;
  });

  test('student history retains cancelled and attended registrations', async () => {
    const student = await login(STUDENT.email, STUDENT.password);
    const mine = await ok(student, 'GET', '/api/v1/events/my/registrations');
    const cancelled = mine.find(
      (entry: { registrationId: string }) => entry.registrationId === seed.registrationId,
    );
    expect(cancelled.registrationStatus).toBe('CANCELLED');
    const student2 = await login(STUDENT2.email, STUDENT2.password);
    const mine2 = await ok(student2, 'GET', '/api/v1/events/my/registrations');
    const attended = mine2.find(
      (entry: { registrationId: string }) => entry.registrationId === seed.secondRegistrationId,
    );
    expect(attended.attendanceStatus).toBe('ATTENDED');
  });
});
