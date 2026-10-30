/**
 * Local verification harness for the geofenced-attendance web surfaces (G5).
 *
 * Boots `next dev` on a dedicated port, mocks every /api/v1/* call at the
 * network layer (no backend required) and captures the new pages at the
 * 390px and 1280px checkpoints into artifacts/verification/web-attendance/.
 *
 *   node scripts/verify-attendance-geofence.mjs
 */

import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const OUT_DIR = path.resolve(FRONTEND, '..', 'artifacts', 'verification', 'web-attendance');
const PORT = 3112;
const BASE = `http://127.0.0.1:${PORT}`;

const SESSION_ID = 'sess-mock-0412';
const nowPlus = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();

const LECTURER = {
  id: 'u-lecturer-1',
  email: 'lecturer@campuscore.edu',
  firstName: 'Minh',
  lastName: 'Tran',
  roles: ['LECTURER'],
  status: 'ACTIVE',
};

const ADMIN = {
  id: 'u-admin-1',
  email: 'admin@campuscore.edu',
  firstName: 'An',
  lastName: 'Nguyen',
  roles: ['ADMIN'],
  status: 'ACTIVE',
};

const SESSION = () => ({
  id: SESSION_ID,
  sectionId: 'sec-1',
  date: new Date().toISOString().slice(0, 10),
  geofenceId: 'geo-1',
  opensAt: nowPlus(-60),
  closesAt: nowPlus(15 * 60),
  lateAfterMinutes: 10,
  status: 'OPEN',
  accepted: 3,
  pending: 1,
  rejected: 0,
  enrolled: 2,
  requireCode: true,
});

const LECTURER_MOCKS = [
  { method: 'GET', match: /\/api\/v1\/auth\/me$/, body: LECTURER },
  {
    method: 'GET',
    match: /\/api\/v1\/semesters/,
    body: {
      data: [
        { id: 'sem-1', name: 'HK I 2025-2026', nameEn: 'Fall 2025', nameVi: 'Học kỳ I 2025-2026' },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  },
  {
    method: 'GET',
    match: /\/api\/v1\/sections\/my\/grading/,
    body: [
      {
        sectionId: 'sec-1',
        courseCode: 'CS101',
        courseName: 'Introduction to Computer Science',
        courseNameEn: 'Introduction to Computer Science',
        courseNameVi: 'Nhập môn Khoa học Máy tính',
        sectionNumber: '01',
        semesterId: 'sem-1',
        departmentName: 'Information Technology',
        departmentNameEn: 'Information Technology',
        departmentNameVi: 'Công nghệ Thông tin',
      },
    ],
  },
  {
    method: 'GET',
    match: /\/api\/v1\/attendance\/section\/sec-1\/roster$/,
    body: [
      { studentId: 'stu-1', studentCode: '21110001', firstName: 'An', lastName: 'Nguyen Van', enrollmentStatus: 'ENROLLED' },
      { studentId: 'stu-2', studentCode: '21110002', firstName: 'Binh', lastName: 'Tran Thi', enrollmentStatus: 'ENROLLED' },
    ],
  },
  { method: 'GET', match: /\/api\/v1\/attendance\/section\/sec-1\/summary$/, body: { totalSessions: 8, attendanceRate: 92.5 } },
  { method: 'GET', match: /\/api\/v1\/attendance\/section\/sec-1(\?.*)?$/, body: [] },
  {
    method: 'GET',
    match: /\/api\/v1\/attendance\/geofences\/active$/,
    body: [
      { id: 'geo-1', name: 'HCM-UTE Vo Van Ngan', campusCode: 'UTE-MAIN', centerLat: 10.8506, centerLng: 106.7719, radiusMeters: 150 },
    ],
  },
  { method: 'POST', match: /\/api\/v1\/attendance\/sessions$/, body: SESSION },
  { method: 'GET', match: new RegExp(`/api/v1/attendance/sessions/${SESSION_ID}$`), body: SESSION },
  {
    method: 'GET',
    match: new RegExp(`/api/v1/attendance/sessions/${SESSION_ID}/checkins$`),
    body: () => [
      {
        id: 'ci-1', sessionId: SESSION_ID, studentId: 'stu-1', decision: 'ACCEPTED',
        reason: 'INSIDE', capturedAt: nowPlus(-90), distanceMeters: 12, accuracyMeters: 8, mockProvider: false,
      },
      {
        id: 'ci-2', sessionId: SESSION_ID, studentId: 'stu-2', decision: 'PENDING_REVIEW',
        reason: 'BORDERLINE,LOW_ACCURACY', capturedAt: nowPlus(-45), distanceMeters: 141, accuracyMeters: 60, mockProvider: false,
      },
    ],
  },
  {
    method: 'GET',
    match: new RegExp(`/api/v1/attendance/sessions/${SESSION_ID}/code$`),
    body: () => ({ code: '482-917', expiresAt: nowPlus(30), stepSeconds: 30 }),
  },
];

const ADMIN_MOCKS = [
  { method: 'GET', match: /\/api\/v1\/auth\/me$/, body: ADMIN },
  {
    method: 'GET',
    match: /\/api\/v1\/admin\/attendance\/geofences$/,
    body: [
      {
        id: 'ute-main-placeholder',
        name: 'HCM-UTE Vo Van Ngan (UNVERIFIED PLACEHOLDER)',
        campusCode: 'UTE-MAIN',
        centerLat: 10.8506,
        centerLng: 106.7719,
        radiusMeters: 150,
        isActive: false,
        note: 'APPROXIMATE seeded coordinates — verify before activation',
      },
      {
        id: 'geo-verified-1',
        name: 'HCM-UTE Vo Van Ngan campus',
        campusCode: 'UTE-MAIN',
        centerLat: 10.8505,
        centerLng: 106.7721,
        radiusMeters: 180,
        isActive: true,
        note: 'Verified against campus survey 2025-11.',
      },
    ],
  },
];

async function installMocks(page, mocks) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname + new URL(request.url()).search;
    for (const mock of mocks) {
      if (mock.method !== request.method()) continue;
      if (!mock.match.test(pathname)) continue;
      const body = typeof mock.body === 'function' ? mock.body() : mock.body;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  [shot] ${name}.png`);
}

async function newPage(browser, { locale = 'vi', width = 1280 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    deviceScaleFactor: 1,
    locale: locale === 'en' ? 'en-US' : 'vi-VN',
  });
  await context.addCookies([
    { name: 'cc_csrf', value: 'verify-mock-csrf', url: BASE },
    { name: 'cc_locale', value: locale, url: BASE },
  ]);
  return context.newPage();
}

async function waitForServer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/`, { cache: 'no-store', redirect: 'manual' });
      if (response.status < 500) return true;
    } catch {
      /* still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return false;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[verify] starting next dev on :${PORT}`);
  const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    cwd: FRONTEND,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  dev.stdout.on('data', () => {});
  dev.stderr.on('data', () => {});

  try {
    const up = await waitForServer();
    if (!up) throw new Error('dev server did not come up in time');
    console.log('[verify] dev server is up');

    const browser = await chromium.launch({ headless: true });
    try {
      // --- Landing page (public, no auth, no fetch) ----------------------
      for (const [width, locale, suffix] of [
        [390, 'vi', 'landing-valid-390'],
        [1280, 'en', 'landing-valid-1280'],
      ]) {
        const page = await newPage(browser, { locale, width });
        await page.goto(`${BASE}/attendance/checkin/${SESSION_ID}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForSelector('[data-testid="checkin-deep-link"]', { timeout: 30_000 });
        await shot(page, suffix);
        await page.context().close();
      }
      {
        const page = await newPage(browser, { locale: 'en', width: 390 });
        await page.goto(`${BASE}/attendance/checkin/bad.id`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForSelector('[data-testid="checkin-landing"]', { timeout: 30_000 });
        await shot(page, 'landing-invalid-390');
        await page.context().close();
      }

      // --- Lecturer attendance panel -------------------------------------
      {
        const page = await newPage(browser, { locale: 'vi', width: 390 });
        await installMocks(page, LECTURER_MOCKS);
        await page.goto(`${BASE}/dashboard/lecturer/attendance`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForSelector('[data-testid="checkin-open-form"]', { timeout: 45_000 });
        await shot(page, 'lecturer-open-form-390');
        await page.context().close();
      }
      {
        const page = await newPage(browser, { locale: 'en', width: 1280 });
        await installMocks(page, LECTURER_MOCKS);
        await page.goto(`${BASE}/dashboard/lecturer/attendance`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForSelector('[data-testid="checkin-open-form"]', { timeout: 45_000 });
        await shot(page, 'lecturer-open-form-1280');

        const form = page.locator('form[data-testid="checkin-open-form"]');
        await form.locator('select').first().selectOption('geo-1');
        await form.locator('button[type="submit"]').click();
        await page.waitForSelector('[data-testid="checkin-session"]', { timeout: 30_000 });
        await shot(page, 'lecturer-session-1280');

        await page.getByRole('button', { name: /Projector|Trình chiếu/i }).first().click();
        await page.waitForSelector('[data-testid="checkin-projector"]', { timeout: 15_000 });
        await page.waitForTimeout(600); // let the first code fetch resolve
        await shot(page, 'lecturer-projector-1280');
        await page.context().close();
      }

      // --- Admin geofence console ----------------------------------------
      for (const [width, locale, suffix] of [
        [390, 'vi', 'admin-geofences-390'],
        [1280, 'en', 'admin-geofences-1280'],
      ]) {
        const page = await newPage(browser, { locale, width });
        await installMocks(page, ADMIN_MOCKS);
        await page.goto(`${BASE}/admin/attendance-geofences`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForSelector('[data-testid="checkin-geofences"] table', { timeout: 45_000 });
        await shot(page, suffix);
        await page.context().close();
      }
    } finally {
      await browser.close();
    }

    writeFileSync(
      path.join(OUT_DIR, 'README.txt'),
      [
        'G5 geofenced-attendance web verification captures.',
        `Captured ${new Date().toISOString()} with next dev :${PORT}, all /api/v1/* responses mocked.`,
        'Landing page needs no mocks (public, fetch-free). Lecturer/admin pages use a',
        'mocked /auth/me (cc_csrf cookie) plus the listed endpoint stubs.',
      ].join('\n'),
    );
    console.log(`[verify] done — captures in ${OUT_DIR}`);
  } finally {
    // shell:true wraps next dev in cmd.exe; kill the whole tree on Windows.
    try {
      execSync(`taskkill /PID ${dev.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      dev.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error('[verify] FAILED:', error);
  process.exitCode = 1;
});
