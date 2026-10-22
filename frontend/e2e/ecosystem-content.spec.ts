import { expect, request as pwRequest, test } from '@playwright/test';

/**
 * P06 content-lane spec (publication-policy §8, phase-06 exit): anonymous
 * publication reads on the HTTPS preview stack — the same compose API +
 * self-signed next dev surfaces as the browser-sso gate. Seeding goes
 * through the staff REST lane on the API loopback (legacy JWT login, the
 * same accounts the showcase seeds activate); the browser journeys are
 * strictly anonymous — no session cookie is ever set.
 *
 * Coverage: published news list/detail, public docs list/detail,
 * revision-permalink superseded marker, VI locale render, sanitization of
 * a malicious rich-text payload, and the no-leak negatives (draft
 * announcement, draft document) answering the shared not-found surface.
 *
 * Required env (ecosystem-content-verify.mjs supplies them):
 *   SSO_PORTAL_BASE / CONTENT_API_BASE / E2E_ADMIN_PASSCODE / E2E_REVIEWER_PASSCODE
 */

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
  },
});

const PORTAL = process.env.SSO_PORTAL_BASE ?? 'https://portal.localhost:3102';
const API = process.env.CONTENT_API_BASE ?? 'http://127.0.0.1:4100';
const ADMIN = { email: 'admin@campuscore.edu', password: process.env.E2E_ADMIN_PASSCODE ?? 'password123' };
// V124: the documented Four-Eyes second approver — ADMIN role, clean flags,
// reviewer != author for every approve leg.
const REVIEWER = { email: 'admin002@campuscore.demo', password: process.env.E2E_REVIEWER_PASSCODE ?? 'password123' };

const SUFFIX = `e2e${Date.now().toString(36)}`;
const PUBLISHED_TITLE = `E2E-NEWS-${SUFFIX}`;
const DRAFT_TITLE = `E2E-DRAFT-${SUFFIX}`;
const DOC_SLUG = `e2e-doc-${SUFFIX}`;
const DOC_TITLE = `E2E Regulation ${SUFFIX}`;
const DOC_DRAFT_SLUG = `e2e-draft-doc-${SUFFIX}`;

interface Seed {
  publishedId: string;
  draftId: string;
  docSlug: string;
  draftDocSlug: string;
}

let seed: Seed;

// Every call gets a cookie-free request context: the login response sets a
// CSRF cookie, and a shared context would echo it on later POSTs without the
// matching X-XSRF-TOKEN header, tripping CSRF_INVALID. Bearer-token clients
// do not carry cookies, so each context is created and disposed per call.
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

async function staffRaw(token: string, method: string, path: string, data?: unknown) {
  const request = await pwRequest.newContext();
  try {
    const response = await request.fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: data === undefined ? undefined : JSON.stringify(data),
    });
    // The body must be read before the context is disposed — disposing the
    // context disposes the response stream with it.
    return { status: response.status(), body: await response.text() };
  } finally {
    await request.dispose();
  }
}

async function staff(token: string, method: string, path: string, data?: unknown) {
  const response = await staffRaw(token, method, path, data);
  expect(response.status, `${method} ${path}: ${response.body}`).toBeLessThan(300);
  return response.body ? JSON.parse(response.body) : null;
}

test.beforeAll(async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const reviewer = await login(REVIEWER.email, REVIEWER.password);

  // Blatant active markup (script tag, on* handlers) never reaches the
  // database: the write lane refuses it with UNSAFE_ANNOUNCEMENT_CONTENT.
  // The sneaky payload below exercises the sanitizing render instead.
  const hostile = await staffRaw(admin, 'POST', '/api/v1/announcements', {
    title: `E2E-HOSTILE-${SUFFIX}`,
    content: '<script>window.__contentXss="script"</script>'
      + '<img src="https://invalid.invalid/x.png" onerror="window.__contentXss=\'img\'">',
    priority: 'NORMAL',
    isGlobal: true,
    targetRoles: [],
    targetYears: [],
  });
  expect(hostile.status, 'hostile write must be refused at ingest').toBe(400);
  expect(JSON.parse(hostile.body).code).toBe('UNSAFE_ANNOUNCEMENT_CONTENT');

  // Published announcement carrying payloads that pass the ingest gate but
  // must still be neutralized before the reader: an entity-encoded
  // javascript: link (the literal-scheme ingest check cannot see it, the
  // sanitizer decodes entities and strips the scheme), a <style> block, an
  // expression() style attribute, and a disallowed <marquee> tag —
  // the render lane must strip all of them (publication-policy §7).
  const published = await staff(admin, 'POST', '/api/v1/announcements', {
    title: PUBLISHED_TITLE,
    content: `<p>Fixture body ${SUFFIX} — safe paragraph.</p>`
      + '<a href="&#106;avascript:window.__contentXss=\'href\'">bad link</a>'
      + '<style>body{display:none}</style>'
      + '<p style="color:red;width:expression(alert(1))">styled text</p>'
      + '<marquee>scrolling</marquee>',
    priority: 'NORMAL',
    isGlobal: true,
    targetRoles: [],
    targetYears: [],
  });
  await staff(admin, 'POST', `/api/v1/announcements/${published.id}/submit`);
  await staff(reviewer, 'POST', `/api/v1/announcements/${published.id}/approve`);

  const draft = await staff(admin, 'POST', '/api/v1/announcements', {
    title: DRAFT_TITLE,
    content: `<p>Unpublished fixture ${SUFFIX}.</p>`,
    priority: 'NORMAL',
    isGlobal: true,
    targetRoles: [],
    targetYears: [],
  });

  // Public document: rev1 published, then rev2 published so rev1 becomes a
  // superseded permalink.
  const doc = await staff(admin, 'POST', '/api/v1/docs', {
    slug: DOC_SLUG,
    titleVi: `${DOC_TITLE} (v1)`,
    titleEn: `${DOC_TITLE} (v1)`,
    summaryVi: 'Tóm tắt fixture v1',
    summaryEn: 'Fixture summary v1',
    bodyVi: `<p>Nội dung quy định v1 ${SUFFIX}.</p>`,
    bodyEn: `<p>Regulation body v1 ${SUFFIX}.</p>`,
  });
  await staff(admin, 'POST', `/api/v1/docs/${doc.id}/submit`);
  await staff(reviewer, 'POST', `/api/v1/docs/${doc.id}/approve`);
  await staff(admin, 'PUT', `/api/v1/docs/${doc.id}`, {
    slug: DOC_SLUG,
    titleVi: `${DOC_TITLE} (v2)`,
    titleEn: `${DOC_TITLE} (v2)`,
    summaryVi: 'Tóm tắt fixture v2',
    summaryEn: 'Fixture summary v2',
    bodyVi: `<p>Nội dung quy định v2 ${SUFFIX}.</p>`,
    bodyEn: `<p>Regulation body v2 ${SUFFIX}.</p>`,
  });
  await staff(admin, 'POST', `/api/v1/docs/${doc.id}/submit`);
  await staff(reviewer, 'POST', `/api/v1/docs/${doc.id}/approve`);

  const draftDoc = await staff(admin, 'POST', '/api/v1/docs', {
    slug: DOC_DRAFT_SLUG,
    titleVi: 'Bản nháp fixture',
    titleEn: 'Fixture draft',
    bodyVi: '<p>Không được công khai.</p>',
    bodyEn: '<p>Never public.</p>',
  });

  seed = {
    publishedId: published.id,
    draftId: draft.id,
    docSlug: DOC_SLUG,
    draftDocSlug: draftDoc.slug ?? DOC_DRAFT_SLUG,
  };
});

test.describe('anonymous news lane', () => {
  test('news list shows published story and never the draft', async ({ page }) => {
    await page.goto(`${PORTAL}/news`);
    await expect(page.getByText(PUBLISHED_TITLE)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(DRAFT_TITLE)).toHaveCount(0);
  });

  test('published detail renders sanitized content only', async ({ page }) => {
    await page.goto(`${PORTAL}/news/${seed.publishedId}`);
    await expect(page.getByRole('heading', { name: PUBLISHED_TITLE })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`Fixture body ${SUFFIX}`)).toBeVisible();
    // Sanitizer contract: no javascript: link (entity form decoded to a
    // dangerous scheme is stripped), no style element, no expression()
    // style attribute, and the payload marker never lands on window. The
    // anchor and paragraph text survive; the executable parts do not.
    // Scope assertions to .announcement-content — the breadcrumb link in
    // the chrome is legitimate navigation, not content.
    await expect(page.getByText('bad link')).toBeVisible();
    await expect(page.getByText('styled text')).toBeVisible();
    await expect(page.getByText('scrolling')).toBeVisible();
    await expect(page.locator('.announcement-content a[href]')).toHaveCount(0);
    await expect(page.locator('.announcement-content style, .announcement-content script')).toHaveCount(0);
    await expect(page.locator('.announcement-content [style*="expression"]')).toHaveCount(0);
    await expect(page.locator('.announcement-content marquee')).toHaveCount(0);
    const marker = await page.evaluate(() => (window as unknown as { __contentXss?: string }).__contentXss);
    expect(marker).toBeUndefined();
  });

  test('unpublished story id answers the not-found surface', async ({ page }) => {
    await page.goto(`${PORTAL}/news/${seed.draftId}`);
    await expect(page.getByText(/story unavailable|không khả dụng|không tồn tại/i))
      .toBeVisible({ timeout: 30000 });
    await expect(page.getByText(DRAFT_TITLE)).toHaveCount(0);
  });
});

test.describe('anonymous docs lane', () => {
  test('docs list and detail show the published revision', async ({ page }) => {
    await page.goto(`${PORTAL}/docs`);
    await expect(page.getByText(`${DOC_TITLE} (v2)`)).toBeVisible({ timeout: 30000 });
    await page.goto(`${PORTAL}/docs/${seed.docSlug}`);
    // Default locale is VI — the detail renders titleVi/bodyVi.
    await expect(page.getByText(`Nội dung quy định v2 ${SUFFIX}`)).toBeVisible({ timeout: 30000 });
  });

  test('revision permalink reads the superseded revision with a marker', async ({ page }) => {
    await page.goto(`${PORTAL}/docs/${seed.docSlug}?rev=1`);
    await expect(page.getByText(`Nội dung quy định v1 ${SUFFIX}`)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/older revision|phiên bản cũ/i)).toBeVisible();
  });

  test('draft document slug answers the not-found surface', async ({ page }) => {
    await page.goto(`${PORTAL}/docs/${seed.draftDocSlug}`);
    await expect(page.getByText(/document unavailable|không khả dụng|không tồn tại/i))
      .toBeVisible({ timeout: 30000 });
  });
});

test.describe('hub + locale', () => {
  test('hub renders the public entries', async ({ page }) => {
    await page.goto(`${PORTAL}/hub`);
    await expect(page.getByRole('heading', { name: /campus hub|trung tâm trường/i }))
      .toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/campus news|tin tức trường/i).first()).toBeVisible();
    await expect(page.getByText(/public documents|tài liệu công khai/i).first()).toBeVisible();
  });

  test('hub marks flagged modules planned — never a live link', async ({ page }) => {
    // publication-policy §6: planned entries render disabled with a status
    // label; no entry may claim completeness while its module is flagged.
    await page.goto(`${PORTAL}/hub`);
    await expect(page.getByRole('heading', { name: /campus hub|trung tâm trường/i }))
      .toBeVisible({ timeout: 30000 });
    const events = page.locator('article[aria-disabled="true"]', {
      hasText: /campus events|sự kiện trường/i,
    });
    await expect(events).toBeVisible();
    await expect(events.getByText(/planned|sắp ra mắt/i)).toBeVisible();
    await expect(events.locator('a')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /campus events|sự kiện trường/i })).toHaveCount(0);
  });

  test('VI locale renders Vietnamese copy on the same content', async ({ page }) => {
    await page.goto(`${PORTAL}/vi/news`);
    await expect(page.getByText(PUBLISHED_TITLE)).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: /tin tức/i }).first()).toBeVisible();
  });

  test('EN locale renders the English revision body', async ({ page }) => {
    await page.goto(`${PORTAL}/en/docs/${seed.docSlug}`);
    await expect(page.getByText(`Regulation body v2 ${SUFFIX}`)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Nội dung quy định v2')).toHaveCount(0);
  });

  test('public lanes answer no-store on the preview host', async ({ page }) => {
    // Publication-policy §8 cache-host check: anonymous publication reads on
    // a BFF surface must never gain a shared cache directive. Assert the
    // header as the browser receives it — page.request cannot resolve the
    // *.localhost hosts from Node.
    const headers = new Map<string, string>();
    page.on('response', (res) => {
      const url = res.url();
      if (
        url.includes('/api/v1/public/docs')
        || url.includes('/api/v1/announcements/public')
      ) {
        headers.set(url, res.headers()['cache-control'] ?? '');
      }
    });
    await page.goto(`${PORTAL}/news`);
    await expect(page.getByText(PUBLISHED_TITLE)).toBeVisible({ timeout: 30000 });
    await page.goto(`${PORTAL}/docs`);
    await expect(
      page.getByRole('link', { name: /open document|mở tài liệu/i }).first(),
    ).toBeVisible({ timeout: 30000 });
    const collected = [...headers.values()];
    expect(collected.length).toBeGreaterThanOrEqual(2);
    for (const cc of collected) {
      expect(cc).toContain('no-store');
    }
  });
});
