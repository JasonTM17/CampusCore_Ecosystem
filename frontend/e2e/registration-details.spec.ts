import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 90_000 });

// Controlled API fixtures exercise the rendered UI without database mutations.
// NOTE: /dashboard/register now redirects to the dedicated registrar workspace
// at /dang-ky-hoc-phan (P4). The old page's tabs, semester dropdown and
// countdown are gone by design — this suite covers the new workspace instead.
const terms = [
  { id: 'term-3', name: 'Future term', nameEn: 'Semester 3', nameVi: 'Học kỳ 3', status: 'DRAFT' },
  { id: 'term-2', name: 'Current term', nameEn: 'Semester 2', nameVi: 'Học kỳ 2', status: 'IN_PROGRESS' },
  { id: 'term-1', name: 'Earlier term', nameEn: 'Semester 1', nameVi: 'Học kỳ 1', status: 'CLOSED' },
];
const knownSection = {
  id: 'section-mf101', sectionNumber: 'MF101-01', semesterId: 'term-3',
  course: { id: 'course-mf101', code: 'MF101', name: 'Methods', nameEn: 'Mathematical Methods', nameVi: 'Phương pháp toán học', credits: 3 },
  lecturer: { user: { firstName: 'Linh', lastName: 'Nguyễn' } },
  schedules: [
    { dayOfWeek: 2, startTime: '07:00', endTime: '09:30', classroom: { roomNumber: 'A101', building: 'Building A' } },
    { dayOfWeek: 1, startTime: '13:00', endTime: '15:30', classroom: { roomNumber: 'B202', building: 'Building B' } },
  ],
};
const enrollment = {
  id: 'enrollment-mf101', sectionId: knownSection.id, semesterId: 'term-3',
  status: 'ENROLLED', enrolledAt: '2026-09-30T10:00:00Z', section: knownSection,
};
const pendingEnrollment = {
  id: 'enrollment-ls102', sectionId: 'section-ls102', semesterId: 'term-3',
  status: 'PENDING', enrolledAt: '2026-10-01T10:00:00Z',
  section: {
    id: 'section-ls102', sectionNumber: '02',
    course: { code: 'LS102', name: 'Legacy Sunday', nameEn: 'Legacy Sunday', nameVi: 'Lịch Chủ nhật', credits: 2 },
    schedules: [{ dayOfWeek: 0, startTime: '09:45', endTime: '11:15' }],
  },
};

type FixtureOptions = {
  rounds?: 'open' | 'closed' | 'error';
  enrollmentError?: boolean;
  semesterError?: boolean;
  cohortBlocked?: boolean;
};

async function mockRegistration(page: Page, options: FixtureOptions = {}) {
  const errors: string[] = [];
  const requests: string[] = [];
  let enrollmentError = options.enrollmentError ?? false;
  let semesterError = options.semesterError ?? false;
  let account = 'student-a';
  let added = false;
  let dropped = false;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Intentionally failed HTTP requests are expected in the retry scenarios.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
  });
  await page.context().addCookies([{ name: 'cc_csrf', value: 'registration-render-fixture', url: test.info().project.use.baseURL as string }]);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    requests.push(`${method} ${path}${url.search}`);
    const user = { id: account, email: `${account}@example.test`, firstName: 'Demo', lastName: 'Student', roles: ['STUDENT'], studentId: `${account}-profile` };
    if ((path === '/api/v1/registration/rounds' && options.rounds === 'error') ||
        (path === '/api/v1/enrollments/my' && enrollmentError) ||
        (path === '/api/v1/semesters' && semesterError)) {
      await route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture service unavailable' } });
      return;
    }
    if (path === '/api/v1/enrollments/my') {
      const term = url.searchParams.get('semesterId');
      const rows = account === 'student-b' ? [] : (term === 'term-3' || term === null || term === undefined)
        ? [enrollment, pendingEnrollment,
          ...(added ? [{ ...enrollment, id: 'added-enrollment', sectionId: 'section-new', section: { ...knownSection, sectionNumber: 'NEW105-01', course: { ...knownSection.course, code: 'NEW105' } } }] : [])]
          .filter((row) => !dropped || row.id !== enrollment.id)
        : [];
      await route.fulfill({ json: rows });
      return;
    }
    if (path === '/api/v1/me/enrollments' && method === 'POST') {
      added = true;
      await route.fulfill({ json: { ...enrollment, id: 'added-enrollment', sectionId: 'section-new', status: 'ENROLLED', section: { ...knownSection, sectionNumber: 'NEW105-01', course: { ...knownSection.course, code: 'NEW105' } } } });
      return;
    }
    if (path.startsWith('/api/v1/me/enrollments/') && path.endsWith('/drop')) {
      if (path === '/api/v1/me/enrollments/enrollment-mf101/drop') dropped = true;
      await route.fulfill({ json: { message: 'Dropped' } });
      return;
    }
    if (path === '/api/v1/me/registration/wishes' && method === 'POST') {
      await route.fulfill({ json: { id: 'wish-fixture' } });
      return;
    }
    if (path === '/api/v1/auth/login') {
      account = 'student-b';
      await route.fulfill({ json: { user: { ...user, id: account, email: `${account}@example.test` } } });
      return;
    }
    const payloads: Record<string, unknown> = {
      '/api/site-appearance': {}, '/api/v1/site-appearance': {},
      '/api/v1/health/liveness': { status: 'UP' },
      '/api/v1/auth/me': user, '/api/v1/auth/logout': {},
      '/api/v1/semesters': { data: terms },
      '/api/v1/notifications/my': { data: [] }, '/api/v1/notifications/my/unread-count': { unreadCount: 0 },
      '/api/v1/assistant/conversations': [],
      '/api/v1/announcements/my': { data: [], meta: { total: 0, page: 1, totalPages: 0 } },
      '/api/v1/registration/rounds': options.rounds === 'closed' ? [] : [{
        id: 'round-fixture', semesterId: 'term-3', name: 'Fixture registration', kind: 'REGISTRATION', status: 'OPEN',
        windowStart: new Date(Date.now() - 86_400_000).toISOString(), windowEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(), creditLimit: 18,
      }],
      '/api/v1/me/registration/eligibility': options.cohortBlocked
        ? { eligible: false, code: 'COHORT_INELIGIBLE' }
        : { eligible: true, creditLimit: 18, creditsUsed: 6, creditsRemaining: 12 },
      '/api/v1/me/registration/summary': { creditLimit: 18, creditsUsed: 6, creditsRemaining: 12 },
      '/api/v1/me/registration/credit-limit-application': null,
      '/api/v1/me/registration/sections': [
        { id: knownSection.id, sectionNumber: knownSection.sectionNumber, courseId: 'course-mf101', courseCode: 'MF101', courseName: 'Mathematical Methods', credits: 3, capacity: 40, enrolledCount: 20, remainingSeats: 20, status: 'OPEN', alreadyEnrolled: !dropped, scheduleConflict: false, schedules: knownSection.schedules },
        { id: 'section-new', sectionNumber: 'NEW105-01', courseId: 'course-new', courseCode: 'NEW105', courseName: 'New registration', credits: 3, capacity: 40, enrolledCount: 20, remainingSeats: 20, status: 'OPEN', alreadyEnrolled: added, scheduleConflict: false, schedules: [{ dayOfWeek: 4, startTime: '10:00', endTime: '11:30' }] },
      ],
      '/api/v1/me/registration': {},
      '/api/v1/me/registration/roadmap': {
        curriculum: { id: 'curriculum-fixture', code: 'MATH-DEMO', name: 'Math program', nameEn: 'Math program', nameVi: 'Chương trình Toán', totalCredits: 6 },
        semesterId: 'term-3',
        courses: [
          { courseId: 'course-mf101', code: 'MF101', name: 'Methods', nameEn: 'Mathematical Methods', nameVi: 'Phương pháp toán học', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'IN_PROGRESS', prerequisites: [], prerequisitesSatisfied: true, openSectionCount: 1 },
          { courseId: 'course-new', code: 'NEW105', name: 'New registration', credits: 3, year: 1, semester: 1, isMandatory: false, status: 'NOT_STARTED', prerequisites: [], prerequisitesSatisfied: true, openSectionCount: 1 },
        ],
      },
      '/api/v1/me/registration/wishes': [],
      '/api/bursar/account': { accountId: 'acct-fixture', balance: 0, currency: 'VND', holds: [] },
      '/api/v1/me/curriculum': {
        curriculum: { id: 'curriculum-fixture', code: 'MATH-DEMO', name: 'Math program', nameEn: 'Math program', nameVi: 'Chương trình Toán', totalCredits: 6 },
        courses: [{ courseId: 'course-mf101', code: 'MF101', name: 'Methods', nameEn: 'Mathematical Methods', nameVi: 'Phương pháp toán học', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'IN_PROGRESS', prerequisites: [] }],
      },
    };
    if (!(path in payloads)) {
      errors.push(`Unexpected API request: ${path}`);
      await route.abort();
      return;
    }
    await route.fulfill({ json: payloads[path] });
  });
  return { errors, requests, recoverEnrollments: () => { enrollmentError = false; }, recoverSemesters: () => { semesterError = false; } };
}

const names = {
  en: { retry: /Try again|Retry/, searchLabel: 'Search sections by code or name', drop: /^Drop course$/i, register: /^Register$/i },
  vi: { retry: /Thử lại|Retry/i, searchLabel: 'Tìm lớp học phần theo mã hoặc tên', drop: /^Hủy đăng ký$/i, register: /^Đăng ký$/i },
};

const gotoWorkspace = (page: Page, locale: 'en' | 'vi', query = '') =>
  page.goto(`/${locale}/dang-ky-hoc-phan${query}`);

test('catalog groups sections under labeled course regions', async ({ page }) => {
  const fixture = await mockRegistration(page);
  await gotoWorkspace(page, 'en');
  const known = page.getByRole('region', { name: 'MF101 Mathematical Methods' });
  await expect(known).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: /NEW105/ })).toBeVisible();
  // The enrolled MF101 row offers Drop, not Register.
  await expect(known.getByRole('button', { name: names.en.drop })).toBeVisible();
  await expect(known.getByRole('button', { name: names.en.register })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /NEW105/ }).getByRole('button', { name: names.en.register })).toBeVisible();
  await expect(page.getByTestId('credit-limit-policy')).toBeVisible();
  await expect(page.getByTestId('registered-timetable')).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('enrollment failure cannot look like an empty cart and retry recovers', async ({ page }) => {
  const fixture = await mockRegistration(page, { enrollmentError: true });
  await gotoWorkspace(page, 'en');
  await expect(page.getByText('Registered courses could not be loaded')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nothing registered yet', { exact: false })).toHaveCount(0);
  fixture.recoverEnrollments();
  await page.getByRole('button', { name: names.en.retry }).click();
  await expect(page.getByRole('region', { name: 'MF101 Mathematical Methods' })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('catalog load failure offers retry and recovers', async ({ page }) => {
  const fixture = await mockRegistration(page);
  let failing = true;
  const sectionsPayload = [{ id: knownSection.id, sectionNumber: knownSection.sectionNumber, courseId: 'course-mf101', courseCode: 'MF101', courseName: 'Mathematical Methods', credits: 3, capacity: 40, enrolledCount: 20, remainingSeats: 20, status: 'OPEN', alreadyEnrolled: true, scheduleConflict: false, schedules: knownSection.schedules }];
  await page.route('**/api/v1/me/registration/sections*', (route) =>
    route.fulfill(failing ? { status: 503, json: { code: 'SERVICE_UNAVAILABLE' } } : { json: sectionsPayload }));
  await gotoWorkspace(page, 'en');
  await expect(page.getByText('Course registration data could not be loaded.')).toBeVisible({ timeout: 15_000 });
  failing = false;
  await page.getByRole('button', { name: names.en.retry }).click();
  await expect(page.getByRole('region', { name: 'MF101 Mathematical Methods' })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('register then drop updates the cart without a reload', async ({ page }) => {
  const fixture = await mockRegistration(page);
  await gotoWorkspace(page, 'en');
  const newGroup = page.getByRole('region', { name: /NEW105/ });
  await newGroup.getByRole('button', { name: names.en.register }).click();
  await page.getByRole('dialog').getByRole('button', { name: names.en.register }).click();
  await expect(page.getByText('NEW105').first()).toBeVisible();
  // Drop the fixture enrollment straight from the cart.
  await page.getByRole('button', { name: names.en.drop }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: names.en.drop }).click();
  await expect(page.getByRole('region', { name: 'MF101 Mathematical Methods' }).getByRole('button', { name: names.en.register })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('register mutation failure leaves durable visible feedback near the catalog', async ({ page }) => {
  const fixture = await mockRegistration(page);
  await page.route('**/api/v1/me/enrollments', (route) => route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }));
  await gotoWorkspace(page, 'en');
  await page.getByRole('region', { name: /NEW105/ }).getByRole('button', { name: names.en.register }).click();
  await page.getByRole('dialog').getByRole('button', { name: names.en.register }).click();
  const error = page.getByTestId('registration-action-error');
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toHaveAttribute('role', 'alert');
  const box = await error.boundingBox();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(fixture.errors).toEqual([]);
});

test('closed round shows an honest empty state instead of the catalog', async ({ page }) => {
  const fixture = await mockRegistration(page, { rounds: 'closed' });
  await gotoWorkspace(page, 'en');
  await expect(page.getByText('No registration round is open right now.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: /MF101/ })).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test('cohort-blocked eligibility explains the restriction distinctly from a closed round', async ({ page }) => {
  const fixture = await mockRegistration(page, { cohortBlocked: true });
  await gotoWorkspace(page, 'en');
  await expect(page.getByText('You are not in the audience for this registration round.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No registration round is open right now.')).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test('?q= seeds the catalog search and unknown params survive a reload', async ({ page }) => {
  const fixture = await mockRegistration(page);
  await gotoWorkspace(page, 'en', '?q=MF101&keep=academic');
  await expect(page.getByLabel(names.en.searchLabel)).toHaveValue('MF101');
  await expect(page.getByRole('region', { name: 'MF101 Mathematical Methods' })).toBeVisible();
  await expect(page.getByRole('region', { name: /NEW105/ })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('keep')).toBe('academic');
  await page.reload();
  await expect(page.getByLabel(names.en.searchLabel)).toHaveValue('MF101');
  expect(new URL(page.url()).searchParams.get('keep')).toBe('academic');
  expect(fixture.errors).toEqual([]);
});

test('workspace renders localized chrome in Vietnamese', async ({ page }) => {
  const fixture = await mockRegistration(page);
  await gotoWorkspace(page, 'vi');
  await expect(page.getByRole('heading', { name: /đăng ký học phần/i }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: /MF101/ })).toBeVisible();
  await expect(page.getByRole('button', { name: names.vi.drop }).first()).toBeVisible();
  await expect(page.getByLabel(names.vi.searchLabel)).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('the legacy /dashboard/register deep link lands on the workspace', async ({ page }) => {
  const fixture = await mockRegistration(page);
  await page.goto('/en/dashboard/register?q=MF101');
  await expect(page).toHaveURL(/\/en\/dang-ky-hoc-phan/);
  await expect(page.getByLabel(names.en.searchLabel)).toHaveValue('MF101');
  expect(fixture.errors).toEqual([]);
});
