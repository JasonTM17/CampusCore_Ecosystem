const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRuntime,
  installBrowserEnv,
  loadTs,
} = require('./dashboard-shell-harness');

function loadAdminEventsPage(auth, router, href) {
  const runtime = createRuntime();
  const pageModule = loadTs('src/app/admin/events/page.tsx', {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': { useRouter: () => router },
    '@/context/AuthContext': { useAuth: () => auth },
    '@/components/admin/AdminFrame': { AdminFrame: () => null },
    '@/components/events/EventsConsolePage': { EventsConsolePage: () => null },
    '@/i18n/messages-admin-ops': {
      adminOpsVi: { events: { header: { title: 'Su kien', description: '' } } },
      adminOpsEn: { events: { header: { title: 'Events', description: '' } } },
    },
    '@/i18n': { useI18n: () => ({ locale: 'en', href }) },
  }, { cache: false });
  return { Page: pageModule.default, runtime };
}

test('the non-admin forward out of the admin events console keeps the locale prefix', () => {
  installBrowserEnv();
  const replaced = [];
  const router = { replace: (target) => replaced.push(target) };
  const { Page, runtime } = loadAdminEventsPage(
    { isAdmin: false, isSuperAdmin: false, isLoading: false },
    router,
    (pathname) => `/en${pathname}`,
  );

  const rendered = runtime.render(Page, {});
  runtime.runEffects(rendered.effects);

  assert.deepEqual(replaced, ['/en/dashboard/events']);
  assert.notEqual(replaced[0], '/dashboard/events', 'the bare path drops the active locale');
});

test('a full admin stays on the admin events console without a redirect', () => {
  installBrowserEnv();
  const replaced = [];
  const router = { replace: (target) => replaced.push(target) };
  const { Page, runtime } = loadAdminEventsPage(
    { isAdmin: true, isSuperAdmin: false, isLoading: false },
    router,
    (pathname) => `/en${pathname}`,
  );

  const rendered = runtime.render(Page, {});
  runtime.runEffects(rendered.effects);

  assert.deepEqual(replaced, []);
});
