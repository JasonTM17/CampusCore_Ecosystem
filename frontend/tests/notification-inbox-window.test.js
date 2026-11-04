const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTs(relativePath, stubs = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

/** A tiny hook runtime: state survives renders and effects run once on mount. */
function createRuntime() {
  const state = [];
  const refs = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effects = [];
  const fakeReact = {
    ...React,
    useState(initial) {
      const index = stateCursor++;
      if (!(index in state)) {
        state[index] = typeof initial === 'function' ? initial() : initial;
      }
      return [
        state[index],
        (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next;
        },
      ];
    },
    useEffect(effect) {
      effects.push(effect);
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(callback) {
      return callback;
    },
    useRef(initial) {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
  };

  return {
    fakeReact,
    render(Component, props) {
      stateCursor = 0;
      refCursor = 0;
      effects = [];
      const tree = Component(props);
      return { tree, effects: [...effects] };
    },
  };
}

function mount(loader, props) {
  const runtime = createRuntime();
  const Component = loader(runtime.fakeReact);
  const first = runtime.render(Component, props);
  for (const effect of first.effects) effect();
  return { render: () => runtime.render(Component, props).tree };
}

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function elements(tree) {
  const found = [];
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || !React.isValidElement(node)) return;
    found.push(node);
    for (const value of Object.values(node.props ?? {})) {
      if (React.isValidElement(value) || Array.isArray(value)) walk(value);
    }
  }
  walk(tree);
  return found;
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf(node.props?.children);
  return '';
}

function buttonByText(tree, text) {
  return elements(tree).find(
    (element) => element.type === buttonStub && textOf(element).includes(text),
  );
}

function tabByText(tree, text) {
  return elements(tree).find(
    (element) => element.props?.role === 'tab' && textOf(element).includes(text),
  );
}

const dummyIcon = () => null;
const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : dummyIcon) },
);

const buttonStub = ({ children, onClick, disabled, type = 'button', ...rest }) =>
  React.createElement(
    'button',
    {
      type,
      onClick,
      disabled,
      'aria-label': rest['aria-label'],
      title: rest.title,
      'data-testid': rest['data-testid'],
    },
    children,
  );

const linkStub = ({ children, href, onClick }) =>
  React.createElement('a', { href, onClick }, children);

const notificationsCopy = {
  title: 'Notifications',
  description: 'Keep account alerts in one focused inbox.',
  refresh: 'Refresh notifications',
  markAllRead: 'Mark all as read',
  markRead: 'Mark as read',
  unread: 'Unread',
  all: 'All notifications',
  read: 'Read',
  noUnread: 'You have no unread notifications.',
  noAll: 'Your notification inbox is empty.',
  empty: '',
  loadFailed: 'Notifications could not be loaded right now.',
  updateFailed: 'The notification could not be updated. Try again.',
  updatedCount: '{count} notifications marked as read.',
  updatedCountOne: '{count} notification marked as read.',
  loading: 'Loading notifications',
  fallbackTitle: 'New update',
  fallbackContent: 'A new notification has arrived for your account.',
};

function loadNotificationsPage(api, fakeReact) {
  return loadTs('src/components/dashboard/NotificationsCenterPage.tsx', {
    react: fakeReact,
    'lucide-react': iconStub,
    '@/components/ui/button': { Button: buttonStub },
    '@/components/ui/state-block': {
      EmptyState: ({ title, description, action }) =>
        React.createElement(
          'div',
          { 'data-testid': 'empty-state' },
          React.createElement('h3', null, title),
          React.createElement('p', null, description),
          action,
        ),
      ErrorState: ({ title, description, onRetry }) =>
        React.createElement(
          'div',
          { role: 'alert', 'data-testid': 'error-state' },
          React.createElement('h3', null, title),
          React.createElement('p', null, description),
          onRetry
            ? React.createElement('button', { type: 'button', onClick: onRetry }, 'retry')
            : null,
        ),
      LoadingState: ({ label }) => React.createElement('div', { role: 'status' }, label),
    },
    '@/components/ui/status': { statusToneClass: () => '' },
    '@/components/ui/status-pill': {
      StatusPill: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/link-button': { LinkButton: linkStub },
    '@/components/LocalizedLink': { LocalizedLink: linkStub },
    '@/components/ProtectedRoute': { WorkspaceForbiddenState: () => null },
    '@/components/ui/page-header': {
      PageHeader: ({ title, description, actions }) =>
        React.createElement(
          'header',
          null,
          React.createElement('h1', null, title),
          React.createElement('p', null, description),
          actions,
        ),
      SectionEyebrow: ({ children }) => React.createElement('span', null, children),
    },
    '@/lib/utils': {
      cn: (...values) => values.filter(Boolean).join(' '),
      htmlToPlainText: (value) => value || '',
      stripNotificationTagPrefix: (value) => value || '',
    },
    '@/lib/plural': { countLabel: (count, singular, plural) => (count === 1 ? singular : plural) },
    '@/lib/safe-url': { safeInternalPath: (value) => value || '' },
    '@/lib/notification-sync': { publishNotificationsChanged: () => {} },
    '@/context/AuthContext': {
      useRequireAuth: () => ({
        user: { id: 'u1' },
        isLoading: false,
        hasAccess: true,
        isForbidden: false,
      }),
    },
    '@/i18n': {
      useI18n: () => ({
        locale: 'vi',
        messages: {
          dashboardShell: { notifications: notificationsCopy },
          common: {
            states: { loading: 'Loading', loadingContent: 'Loading content' },
            actions: { retry: 'Try again', openDashboard: 'Open dashboard' },
          },
          studentPages: { notifications: { loadMore: 'Load older notifications' } },
        },
        formatDateTime: (value) => String(value),
      }),
    },
    '@/i18n/messages-student-portal': {
      studentPortalEn: { notifications: { openRelated: 'Open related' } },
      studentPortalVi: { notifications: { openRelated: 'Mở liên quan' } },
    },
    '@/lib/api': { notificationsApi: api },
  }).default;
}

function inboxRow(index, isRead) {
  return {
    id: `n${index}`,
    title: `Notification ${index}`,
    content: `Body ${index}`,
    isRead,
    createdAt: '2026-10-30T01:00:00Z',
  };
}

function inboxApi({ rows, total = 300, totalPages = 15, unread = 7 }) {
  const calls = { getMy: [], unreadCount: 0 };
  const api = {
    getMy: async (params) => {
      calls.getMy.push(params);
      return {
        data: rows,
        meta: {
          total,
          page: params.page,
          limit: params.limit,
          totalPages,
        },
      };
    },
    unreadCount: async () => {
      calls.unreadCount += 1;
      return unread;
    },
    markRead: async () => undefined,
    markAllRead: async () => ({ updated: 1 }),
  };
  return { api, calls };
}

test('the inbox first paint reads one bounded page and the server unread count', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => inboxRow(index, index > 1));
  const { api, calls } = inboxApi({ rows });
  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();

  const tree = page.render();
  assert.equal(calls.getMy.length, 1, 'one page read renders the inbox');
  assert.equal(calls.getMy[0].page, 1);
  assert.ok(calls.getMy[0].limit <= 50, `the first page stays small, saw ${calls.getMy[0].limit}`);
  assert.equal(calls.getMy[0].isRead, undefined, 'the all tab is unfiltered');
  assert.equal(calls.unreadCount, 1, 'the badge number comes from the counter endpoint');
  assert.ok(textOf(tree).includes('7 unread'), 'the server unread count is rendered');
});

test('the unread tab asks the server for unread rows', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => inboxRow(index, index > 1));
  const unreadRows = Array.from({ length: 7 }, (_, index) => inboxRow(index, false));
  const calls = { getMy: [], unreadCount: 0 };
  const api = {
    getMy: async (params) => {
      calls.getMy.push(params);
      const data = params.isRead === false ? unreadRows : rows;
      return {
        data,
        meta: {
          total: params.isRead === false ? 7 : 300,
          page: params.page,
          limit: params.limit,
          totalPages: params.isRead === false ? 1 : 15,
        },
      };
    },
    unreadCount: async () => {
      calls.unreadCount += 1;
      return 7;
    },
    markRead: async () => undefined,
    markAllRead: async () => ({ updated: 1 }),
  };
  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();

  const tab = tabByText(page.render(), notificationsCopy.unread);
  assert.ok(tab, 'the unread tab is rendered');
  tab.props.onClick();
  await flush();

  const requested = calls.getMy[calls.getMy.length - 1];
  assert.equal(requested.isRead, false, 'the unread tab filters on the server');
  assert.equal(requested.page, 1);
  assert.ok(requested.limit <= 50);
});

test('marking one unread row read does not skip the next row when loading older pages', async () => {
  const unreadRows = Array.from({ length: 21 }, (_, index) => inboxRow(index, false));
  let serverRows = unreadRows.slice();
  const calls = { getMy: [], unreadCount: 0 };
  const api = {
    getMy: async (params) => {
      calls.getMy.push(params);
      const offset = (params.page - 1) * params.limit;
      return {
        data: serverRows.slice(offset, offset + params.limit),
        meta: {
          total: serverRows.length,
          page: params.page,
          limit: params.limit,
          totalPages: Math.max(1, Math.ceil(serverRows.length / params.limit)),
        },
      };
    },
    unreadCount: async () => {
      calls.unreadCount += 1;
      return serverRows.length;
    },
    markRead: async (id) => {
      serverRows = serverRows.filter((row) => row.id !== id);
    },
    markAllRead: async () => ({ updated: 0 }),
  };
  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();

  tabByText(page.render(), notificationsCopy.unread).props.onClick();
  await flush();

  const markRead = buttonByText(page.render(), notificationsCopy.markRead);
  assert.ok(markRead, 'the unread row offers a mark-read action');
  markRead.props.onClick();
  await flush();

  const older = buttonByText(page.render(), 'Load older notifications');
  assert.ok(older, 'the older control stays available after the write');
  older.props.onClick();
  await flush();

  assert.ok(
    textOf(page.render()).includes('Notification 20'),
    'the oldest unread row is still rendered after one row was marked read',
  );
  assert.equal(calls.getMy[calls.getMy.length - 1].page, 1, 'the next read overlaps the window already shown');
});

test('a removal keeps already loaded older pages aligned on a longer unread list', async () => {
  const unreadRows = Array.from({ length: 41 }, (_, index) => inboxRow(index, false));
  let serverRows = unreadRows.slice();
  const calls = { getMy: [] };
  const api = {
    getMy: async (params) => {
      calls.getMy.push(params);
      const offset = (params.page - 1) * params.limit;
      return {
        data: serverRows.slice(offset, offset + params.limit),
        meta: {
          total: serverRows.length,
          page: params.page,
          limit: params.limit,
          totalPages: Math.max(1, Math.ceil(serverRows.length / params.limit)),
        },
      };
    },
    unreadCount: async () => serverRows.length,
    markRead: async (id) => {
      serverRows = serverRows.filter((row) => row.id !== id);
    },
    markAllRead: async () => ({ updated: 0 }),
  };
  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();

  tabByText(page.render(), notificationsCopy.unread).props.onClick();
  await flush();
  buttonByText(page.render(), 'Load older notifications').props.onClick();
  await flush();
  assert.equal(calls.getMy[calls.getMy.length - 1].page, 2, 'the second window is loaded');

  buttonByText(page.render(), notificationsCopy.markRead).props.onClick();
  await flush();
  buttonByText(page.render(), 'Load older notifications').props.onClick();
  await flush();

  assert.equal(calls.getMy[calls.getMy.length - 1].page, 2, 'the loaded window is read again');
  assert.ok(
    textOf(page.render()).includes('Notification 40'),
    'the last unread row is still reachable after the write',
  );
});

test('refresh forces a fresh unread count', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => inboxRow(index, index > 1));
  const calls = { getMy: [], unreadCount: [] };
  const api = {
    getMy: async (params) => {
      calls.getMy.push(params);
      return {
        data: rows,
        meta: { total: 300, page: params.page, limit: params.limit, totalPages: 15 },
      };
    },
    unreadCount: async (options) => {
      calls.unreadCount.push(options);
      return 7;
    },
    markRead: async () => undefined,
    markAllRead: async () => ({ updated: 1 }),
  };
  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();
  assert.equal(calls.unreadCount.length, 1, 'the first paint reads the count once');

  const refresh = buttonByText(page.render(), notificationsCopy.refresh);
  assert.ok(refresh, 'the refresh action is rendered');
  refresh.props.onClick();
  await flush();

  assert.equal(calls.unreadCount.length, 2, 'refresh reads the count again');
  assert.deepEqual(calls.unreadCount[1], { force: true }, 'the refreshed count bypasses the shared cache');
});

test('a failed refresh after a successful mark-all keeps the write success and shows the read error', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => inboxRow(index, false));
  let failList = false;
  let markAllRead;
  const api = {
    getMy: async (params) => {
      if (failList) throw new Error('list read failed');
      return {
        data: rows,
        meta: { total: rows.length, page: params.page, limit: params.limit, totalPages: 1 },
      };
    },
    unreadCount: async () => 5,
    markRead: async () => undefined,
    markAllRead: async () => {
      markAllRead = true;
      failList = true;
      return { updated: 1 };
    },
  };
  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();

  buttonByText(page.render(), notificationsCopy.markAllRead).props.onClick();
  await flush();

  const tree = page.render();
  const text = textOf(tree);
  const errorState = elements(tree).find(
    (element) => element.props?.description === notificationsCopy.loadFailed,
  );
  assert.equal(markAllRead, true);
  assert.ok(text.includes('1 notification marked as read.'), 'the committed write is reported as a success');
  assert.equal(errorState?.props.description, notificationsCopy.loadFailed, 'the failed read is reported as a load error');
  assert.equal(buttonByText(tree, 'Try again'), undefined, 'no retry is offered for the committed write');
});

test('load older keeps the small page size and the active read filter', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => inboxRow(index, index > 1));
  const unreadRows = Array.from({ length: 7 }, (_, index) => inboxRow(index, false));
  const calls = { getMy: [], unreadCount: 0 };
  const api = {
    getMy: async (params) => {
      calls.getMy.push(params);
      const unreadPage = params.isRead === false;
      return {
        data: unreadPage ? unreadRows : rows,
        meta: {
          total: unreadPage ? 7 : 300,
          page: params.page,
          limit: params.limit,
          totalPages: unreadPage ? 1 : 15,
        },
      };
    },
    unreadCount: async () => {
      calls.unreadCount += 1;
      return 7;
    },
    markRead: async () => undefined,
    markAllRead: async () => ({ updated: 1 }),
  };
  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();

  const older = buttonByText(page.render(), 'Load older notifications');
  assert.ok(older, 'an explicit load-older control stays available');
  older.props.onClick();
  await flush();

  const requested = calls.getMy[calls.getMy.length - 1];
  assert.equal(requested.page, 2);
  assert.ok(requested.limit <= 50, 'older pages keep the same bounded window');
  assert.equal(requested.isRead, undefined, 'the all tab stays unfiltered');
});

test('a row marked read while an older page is in flight still steps the cursor back', async () => {
  let serverRows = Array.from({ length: 41 }, (_, index) => inboxRow(index, false));
  const calls = { getMy: [] };
  let release = null;
  let holdNext = false;
  const slice = (params, rows) => {
    const offset = (params.page - 1) * params.limit;
    return {
      data: rows.slice(offset, offset + params.limit),
      meta: {
        total: rows.length,
        page: params.page,
        limit: params.limit,
        totalPages: Math.max(1, Math.ceil(rows.length / params.limit)),
      },
    };
  };
  const api = {
    getMy: (params) => {
      calls.getMy.push(params);
      const snapshot = serverRows.slice();
      if (holdNext) {
        holdNext = false;
        return new Promise((resolve) => {
          release = () => resolve(slice(params, snapshot));
        });
      }
      return Promise.resolve(slice(params, snapshot));
    },
    unreadCount: async () => serverRows.length,
    markRead: async (id) => {
      serverRows = serverRows.filter((row) => row.id !== id);
    },
    markAllRead: async () => ({ updated: 0 }),
  };
  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();
  tabByText(page.render(), notificationsCopy.unread).props.onClick();
  await flush();

  holdNext = true;
  buttonByText(page.render(), 'Load older notifications').props.onClick();
  await flush();
  assert.ok(release, 'the second window is in flight');

  buttonByText(page.render(), notificationsCopy.markRead).props.onClick();
  await flush();
  release();
  await flush();

  buttonByText(page.render(), 'Load older notifications').props.onClick();
  await flush();
  assert.equal(calls.getMy[calls.getMy.length - 1].page, 2, 'the window read before the write is read again');
});
