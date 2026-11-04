const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {
  createDashboardShell,
  createRuntime,
  elements,
  flush,
  installBrowserEnv,
  loadMessages,
  loadTs,
  textOf,
} = require('./dashboard-shell-harness');

const STUDENT = {
  id: 'student-1',
  email: 'student@campuscore.edu',
  firstName: 'An',
  lastName: 'Nguyen',
  roles: ['STUDENT'],
};

const unreadRow = {
  id: 'n1',
  title: 'Tuition deadline',
  content: 'Pay before Friday.',
  type: 'INFO',
  link: '/dashboard/tuition',
  isRead: false,
  createdAt: '2026-11-01T09:00:00Z',
};

function notificationElement(tree, ariaControls) {
  return elements(tree).find(
    (element) => element.props?.['aria-controls'] === ariaControls,
  );
}

function buttonByText(tree, label) {
  return elements(tree).find(
    (element) => element.props?.onClick && textOf(element).includes(label),
  );
}

function centreStubs(runtime, api, messages, onPublish) {
  const iconStub = new Proxy(
    {},
    { get: (_target, property) => (property === '__esModule' ? true : () => null) },
  );
  return {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': iconStub,
    '@/context/AuthContext': {
      useRequireAuth: () => ({
        user: STUDENT,
        isLoading: false,
        hasAccess: true,
        isForbidden: false,
      }),
    },
    '@/i18n': {
      useI18n: () => ({
        locale: 'vi',
        messages,
        formatDateTime: (value) => String(value),
        href: (value) => value,
      }),
    },
    '@/lib/api': { notificationsApi: api },
    '@/lib/notification-sync': { publishNotificationsChanged: onPublish },
    '@/lib/utils': {
      cn: (...values) => values.filter(Boolean).join(' '),
      htmlToPlainText: (value) => value || '',
      stripNotificationTagPrefix: (value) => value || '',
    },
    '@/lib/safe-url': { safeInternalPath: (value) => value },
    '@/i18n/messages-student-portal': {
      studentPortalEn: { notifications: { openRelated: 'Open related' } },
      studentPortalVi: { notifications: { openRelated: 'Mo lien quan' } },
    },
    '@/components/ui/button': {
      Button: ({ children, onClick, disabled }) =>
        React.createElement('button', { type: 'button', onClick, disabled }, children),
    },
    '@/components/ui/link-button': {
      LinkButton: ({ children, href }) => React.createElement('a', { href }, children),
    },
    '@/components/LocalizedLink': {
      LocalizedLink: ({ children, href }) => React.createElement('a', { href }, children),
    },
    '@/components/ProtectedRoute': { WorkspaceForbiddenState: () => null },
    '@/components/ui/page-header': {
      PageHeader: ({ title, actions }) =>
        React.createElement('header', null, React.createElement('h1', null, title), actions),
    },
    '@/components/ui/state-block': {
      EmptyState: ({ title }) => React.createElement('div', null, title),
      ErrorState: ({ title }) => React.createElement('div', { role: 'alert' }, title),
      LoadingState: ({ label }) => React.createElement('div', { role: 'status' }, label),
    },
    '@/components/ui/status': { statusToneClass: () => '' },
    '@/components/ui/status-pill': {
      StatusPill: ({ children }) => React.createElement('span', null, children),
    },
  };
}

async function mountCentre(api, onPublish) {
  installBrowserEnv();
  const messages = loadMessages('vi');
  const runtime = createRuntime();
  const Page = loadTs(
    'src/components/dashboard/NotificationsCenterPage.tsx',
    centreStubs(runtime, api, messages, onPublish),
    { cache: false },
  ).default;

  let tree = null;
  for (let index = 0; index < 5; index += 1) {
    const rendered = runtime.render(Page, {});
    runtime.runEffects(rendered.effects);
    tree = rendered.tree;
    await flush();
    await flush();
  }
  return { Page, runtime, tree, messages };
}

test('a write in the notifications centre updates the shell bell without a reload', async () => {
  let readAll = false;
  const shell = createDashboardShell({
    user: STUDENT,
    pathname: '/dashboard',
    notifications: {
      getMy: async () => ({
        data: readAll ? [] : [unreadRow],
        meta: { totalPages: 1 },
      }),
      unreadCount: async () => (readAll ? 0 : 3),
    },
  });

  const loaded = await shell.pump();
  const bell = notificationElement(loaded, 'dashboard-notifications-panel');
  assert.ok(bell, 'the bell trigger is rendered');
  assert.match(bell.props['aria-label'], /3/, 'the badge count reaches the accessible name');

  bell.props.onClick();
  const opened = await shell.pump(1);
  assert.ok(textOf(opened).includes(unreadRow.title), 'the preview lists the unread row');
  assert.equal(shell.apiCalls.getMy.length, 1);

  readAll = true;
  const { publishNotificationsChanged } = loadTs('src/lib/notification-sync.ts', {});
  publishNotificationsChanged();
  await flush();
  await flush();
  const refreshed = await shell.pump(1);

  assert.equal(shell.apiCalls.getMy.length, 2, 'the preview rows are refetched');
  assert.deepEqual(shell.apiCalls.getMy[1], { limit: 5, isRead: false });
  assert.equal(shell.apiCalls.unreadCount.length, 2, 'the badge count is refetched');
  assert.deepEqual(shell.apiCalls.unreadCount[1], { force: true }, 'the 60s cache is bypassed');

  const refreshedBell = notificationElement(refreshed, 'dashboard-notifications-panel');
  assert.doesNotMatch(refreshedBell.props['aria-label'], /3/, 'the stale badge count is gone');
  assert.ok(!textOf(refreshed).includes(unreadRow.title), 'the read row leaves the preview');
  assert.ok(
    textOf(refreshed).includes(loadMessages('vi').dashboardShell.notifications.empty),
    'the empty preview is rendered',
  );
});

test('mark-all-read in the centre publishes the change to the shell', async () => {
  let published = 0;
  const messages = loadMessages('vi');
  const api = {
    getMy: async () => ({ data: [unreadRow], meta: { totalPages: 1 } }),
    unreadCount: async () => 1,
    markRead: async () => undefined,
    markAllRead: async () => ({ updated: 1 }),
  };
  const { tree } = await mountCentre(api, () => {
    published += 1;
  });

  const markAll = buttonByText(tree, messages.dashboardShell.notifications.markAllRead);
  assert.ok(markAll, 'the mark-all control is rendered');
  markAll.props.onClick();
  await flush();
  await flush();

  assert.equal(published, 1);
});

test('marking a single row read in the centre publishes the change to the shell', async () => {
  let published = 0;
  const messages = loadMessages('vi');
  const api = {
    getMy: async () => ({ data: [unreadRow], meta: { totalPages: 1 } }),
    unreadCount: async () => 1,
    markRead: async () => undefined,
    markAllRead: async () => ({ updated: 0 }),
  };
  const { tree } = await mountCentre(api, () => {
    published += 1;
  });

  const markRead = buttonByText(tree, messages.dashboardShell.notifications.markRead);
  assert.ok(markRead, 'the row action is rendered');
  markRead.props.onClick();
  await flush();
  await flush();

  assert.equal(published, 1);
});
