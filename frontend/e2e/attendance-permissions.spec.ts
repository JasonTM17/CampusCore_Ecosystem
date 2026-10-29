import { expect, test, type Page, type Response } from '@playwright/test';

/**
 * Runtime proof of the route-scoped geolocation Permissions-Policy: the
 * browser attendance check-in surface is the single approved consumer of a
 * position fix, so its documents must carry exactly one `geolocation=(self)`
 * policy while every other route keeps the blanket denial.
 * `document.permissionsPolicy` is the browser-enforced view of the same
 * response header — this spec exists because the static config tests cannot
 * observe what the browser actually enforces.
 *
 * Self-contained: it needs only a Next server for this app — no Java API,
 * database or auth (the check-in landing is a public client page; all
 * same-origin /api calls are stubbed below). It stays out of the general
 * e2e suite by gating on the reserved verification port:
 *
 *   cd frontend
 *   NEXT_DIST_DIR=.next-verify npx next build
 *   NEXT_DIST_DIR=.next-verify npx next start -H 127.0.0.1 -p 3100
 *   E2E_BASE_URL=http://127.0.0.1:3100 node node_modules/playwright/cli.js \
 *     test e2e/attendance-permissions.spec.ts --project=chromium
 */
const VERIFY_BASE_URLS = new Set(['http://localhost:3100', 'http://127.0.0.1:3100']);
test.skip(
  !VERIFY_BASE_URLS.has(process.env.E2E_BASE_URL ?? ''),
  'Requires the dedicated verification server on port 3100 (see header comment).',
);

const CHECKIN_POLICY =
  'camera=(), microphone=(), geolocation=(self), payment=(), usb=()';
const DENY_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

// Any id matching the session token shape exercises the dynamic segment.
const CHECKIN_PATHS = [
  '/attendance/checkin/e2e-session-01',
  '/en/attendance/checkin/e2e-session-01',
  '/vi/attendance/checkin/e2e-session-01',
];
const DENIED_PATHS = ['/', '/dashboard', '/apply'];

test.beforeEach(async ({ page }) => {
  // The assertions never depend on backend data; fail API calls fast and
  // uniformly instead of letting them hang on an absent service.
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"detail":"stubbed for header verification"}',
    }),
  );
});

/** Raw Permissions-Policy values, one entry per occurrence on the wire. */
async function permissionsPolicyValues(response: Response | null): Promise<string[]> {
  if (!response) return [];
  return (await response.headersArray())
    .filter((entry) => entry.name.toLowerCase() === 'permissions-policy')
    .map((entry) => entry.value);
}

/** The browser-enforced policy for the loaded document. */
function documentPolicy(page: Page) {
  return page.evaluate(() => {
    const doc = document as Document & {
      permissionsPolicy?: { allowsFeature(feature: string): boolean };
      featurePolicy?: { allowsFeature(feature: string): boolean };
    };
    const policy = doc.permissionsPolicy ?? doc.featurePolicy;
    if (!policy) return null;
    return {
      geolocation: policy.allowsFeature('geolocation'),
      camera: policy.allowsFeature('camera'),
      microphone: policy.allowsFeature('microphone'),
    };
  });
}

for (const path of CHECKIN_PATHS) {
  test(`${path} permits same-origin geolocation through a single policy header`, async ({
    page,
  }, testInfo) => {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), 'the check-in landing must render').toBe(true);
    await expect(page.getByTestId('checkin-landing')).toBeVisible();

    const values = await permissionsPolicyValues(response);
    await testInfo.attach('permissions-policy-response-headers', {
      body: JSON.stringify({ path, values }, null, 2),
    });
    // Exactly one header carrying the check-in value once: no duplicated
    // header and no merged double directive.
    expect(values).toEqual([CHECKIN_POLICY]);

    expect(await documentPolicy(page)).toEqual({
      geolocation: true,
      camera: false,
      microphone: false,
    });
  });
}

for (const path of DENIED_PATHS) {
  test(`${path} keeps the blanket denial`, async ({ page }, testInfo) => {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

    const values = await permissionsPolicyValues(response);
    await testInfo.attach('permissions-policy-response-headers', {
      body: JSON.stringify({ path, values }, null, 2),
    });
    expect(values).toEqual([DENY_POLICY]);

    expect(await documentPolicy(page)).toEqual({
      geolocation: false,
      camera: false,
      microphone: false,
    });
  });
}
