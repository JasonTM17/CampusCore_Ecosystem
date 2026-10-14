import { expect, test, type Page } from '@playwright/test';

/**
 * Locale-flicker regression: for an unprefixed URL the middleware/server
 * already honor the persisted cc_locale cookie, so the client must resolve
 * the SAME locale — a hydration-time flip to the default locale is a bug.
 *
 * The probe records every <html lang> value seen from the earliest possible
 * moment; a post-hydration flip would append the other locale to the set.
 */

async function installLangProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = { langs: new Set<string>() };
    (window as { __localeProbe?: typeof probe }).__localeProbe = probe;
    const record = () => {
      if (document.documentElement) {
        probe.langs.add(document.documentElement.lang);
      }
    };
    const observe = () => {
      new MutationObserver(record).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['lang'],
      });
      record();
    };
    if (document.documentElement) {
      observe();
    } else {
      document.addEventListener('DOMContentLoaded', observe, { once: true });
    }
  });
}

async function probeLangs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = (window as { __localeProbe?: { langs: Set<string> } }).__localeProbe;
    return probe ? Array.from(probe.langs) : [];
  });
}

const SETTLE_MS = 2_500;

test('an en cookie on the unprefixed login page stays English through hydration', async ({
  page,
  context,
}, testInfo) => {
  await context.addCookies([
    { name: 'cc_locale', value: 'en', url: testInfo.project.use.baseURL },
  ]);
  await installLangProbe(page);
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: /student sign-in/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(SETTLE_MS);

  expect(await page.locator('html').getAttribute('lang')).toBe('en');
  expect(await probeLangs(page)).toEqual(['en']);
  await expect(page.getByRole('heading', { name: /student sign-in/i })).toBeVisible();
});

test('no cookie on the unprefixed login page stays Vietnamese through hydration', async ({
  page,
}) => {
  await installLangProbe(page);
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: /đăng nhập sinh viên/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(SETTLE_MS);

  expect(await page.locator('html').getAttribute('lang')).toBe('vi');
  expect(await probeLangs(page)).toEqual(['vi']);
});

test('a prefixed /vi URL wins over an en cookie and rewrites it to vi', async ({
  page,
  context,
}, testInfo) => {
  await context.addCookies([
    { name: 'cc_locale', value: 'en', url: testInfo.project.use.baseURL },
  ]);
  await installLangProbe(page);
  await page.goto('/vi/login');

  await expect(page.getByRole('heading', { name: /đăng nhập sinh viên/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(SETTLE_MS);

  expect(await page.locator('html').getAttribute('lang')).toBe('vi');
  expect(await probeLangs(page)).toEqual(['vi']);
  const cookie = (await context.cookies()).find((entry) => entry.name === 'cc_locale');
  expect(cookie?.value).toBe('vi');
});

const savedViCookie = (baseURL: string) => ({
  name: 'cc_locale',
  value: 'vi',
  url: baseURL,
});

async function readLocaleCookie(page: Page) {
  return (await page.context().cookies()).find((entry) => entry.name === 'cc_locale')?.value;
}

test('speculative cross-locale fetches never overwrite a saved vi preference', async ({
  page,
  context,
}, testInfo) => {
  await context.addCookies([savedViCookie(String(testInfo.project.use.baseURL))]);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /đăng nhập sinh viên/i })).toBeVisible({
    timeout: 15_000,
  });
  const englishSwitch = page.getByRole('link', { name: /tiếng anh|english/i }).first();
  await englishSwitch.hover();
  await page.waitForTimeout(1_500);
  expect(await readLocaleCookie(page)).toBe('vi');
  expect(await page.locator('html').getAttribute('lang')).toBe('vi');

  const prefetch = await page.request.get('/en/login?reset=1', {
    headers: {
      'next-router-prefetch': '1',
      rsc: '1',
      'next-url': '/login',
      'sec-fetch-dest': 'empty',
    },
  });
  expect(prefetch.status()).toBe(200);
  expect(prefetch.headers()['set-cookie'] ?? '').not.toContain('cc_locale=en');
  const purposePrefetch = await page.request.get('/en/login?reset=1', {
    headers: { purpose: 'prefetch' },
  });
  expect(purposePrefetch.status()).toBe(200);
  expect(purposePrefetch.headers()['set-cookie'] ?? '').not.toContain('cc_locale=en');
  expect(await readLocaleCookie(page)).toBe('vi');
});

test('a committed English switch still navigates and persists en', async ({
  page,
  context,
}, testInfo) => {
  await context.addCookies([savedViCookie(String(testInfo.project.use.baseURL))]);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /đăng nhập sinh viên/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('link', { name: /tiếng anh|english/i }).first().click();
  await expect(page).toHaveURL(/\/en\/login/);
  await expect(page.getByRole('heading', { name: /student sign-in/i })).toBeVisible();
  expect(await readLocaleCookie(page)).toBe('en');
});
