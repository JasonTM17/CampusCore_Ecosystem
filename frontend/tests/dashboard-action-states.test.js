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

const flush = () => new Promise((resolve) => setImmediate(resolve));

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
    (element) =>
      (element.type === 'button' || element.type === buttonStub) &&
      textOf(element).includes(text),
  );
}

function alerts(tree) {
  return elements(tree).filter((element) => element.props?.role === 'alert');
}

function html(tree) {
  return renderToStaticMarkup(tree);
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

function stateBlockStubs() {
  return {
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
    LoadingState: ({ label }) =>
      React.createElement('div', { role: 'status' }, label),
  };
}

function pageHeaderStub() {
  return {
    PageHeader: ({ title, description, actions }) =>
      React.createElement(
        'header',
        null,
        React.createElement('h1', null, title),
        React.createElement('p', null, description),
        actions,
      ),
    SectionEyebrow: ({ children }) => React.createElement('span', null, children),
  };
}

function baseStubs(extra = {}) {
  return {
    'lucide-react': iconStub,
    'sonner': { toast: { success: () => undefined, error: () => undefined } },
    '@/components/ui/button': { Button: buttonStub },
    '@/components/ui/input': {
      Input: (props) =>
        React.createElement('input', {
          value: props.value ?? '',
          onChange: props.onChange,
          placeholder: props.placeholder,
          'data-testid': props['data-testid'],
        }),
    },
    '@/components/ui/state-block': stateBlockStubs(),
    '@/components/ui/status': { statusToneClass: () => '', metricToneClass: () => '' },
    '@/components/ui/status-pill': {
      StatusPill: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/link-button': { LinkButton: linkStub },
    '@/components/LocalizedLink': { LocalizedLink: linkStub },
    '@/components/ProtectedRoute': { WorkspaceForbiddenState: () => null },
    '@/lib/utils': {
      cn: (...values) => values.filter(Boolean).join(' '),
      htmlToPlainText: (value) => value || '',
      stripNotificationTagPrefix: (value) => value || '',
    },
    '@/lib/safe-url': { safeInternalPath: (value) => value || '' },
    '@/lib/campus-error': { campusErrorKind: () => 'server' },
    ...extra,
  };
}

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
  empty:
    'No unread alerts right now. Announcements remain the main broadcast channel for shared updates.',
  loadFailed: 'Notifications could not be loaded right now.',
  updateFailed: 'The notification could not be updated. Try again.',
  updatedCount: '{count} notifications marked as read.',
  loading: 'Loading notifications',
  fallbackTitle: 'New update',
  fallbackContent: 'A new notification has arrived for your account.',
};

const commonMessages = {
  states: { loading: 'Loading', loadingContent: 'Loading content' },
  actions: { retry: 'Try again', openDashboard: 'Open dashboard' },
};

function notificationMessages() {
  return {
    dashboardShell: { notifications: notificationsCopy },
    common: commonMessages,
    studentPages: { notifications: { loadMore: 'Load older notifications' } },
  };
}

function loadNotificationsPage(api, fakeReact) {
  return loadTs('src/components/dashboard/NotificationsCenterPage.tsx', baseStubs({
    react: fakeReact,
    ...pageHeaderStubs(),
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
        messages: notificationMessages(),
        formatDateTime: (value) => String(value),
      }),
    },
    '@/i18n/messages-student-portal': {
      studentPortalEn: { notifications: { openRelated: 'Open related' } },
      studentPortalVi: { notifications: { openRelated: 'Mở liên quan' } },
    },
    '@/lib/api': { notificationsApi: api },
  })).default;
}

function pageHeaderStubs() {
  return { '@/components/ui/page-header': pageHeaderStub() };
}

function notificationItem(overrides = {}) {
  return {
    id: 'n1',
    title: 'Tuition deadline',
    content: 'Pay by Friday.',
    isRead: false,
    createdAt: '2026-10-30T01:00:00Z',
    ...overrides,
  };
}

test('a failed mark-read keeps the inbox visible and retries the action', async () => {
  let getMyCalls = 0;
  let markReadCalls = 0;
  const items = [notificationItem()];
  const api = {
    getMy: async () => {
      getMyCalls += 1;
      return { data: items, meta: { totalPages: 1 } };
    },
    markRead: async () => {
      markReadCalls += 1;
      throw new Error('500');
    },
    markAllRead: async () => ({ updated: 0 }),
  };

  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();
  await flush();

  const loaded = page.render();
  assert.ok(buttonByText(loaded, notificationsCopy.markRead), 'the row action is rendered');
  assert.ok(textOf(loaded).includes('Tuition deadline'), 'the inbox row is visible');

  buttonByText(loaded, notificationsCopy.markRead).props.onClick();
  await flush();
  await flush();

  const failed = page.render();
  assert.ok(
    textOf(failed).includes('Tuition deadline'),
    'a failed mark-read must not replace the inbox with an error page',
  );
  assert.ok(
    !html(failed).includes('data-testid="error-state"'),
    'the load error surface stays reserved for reads',
  );
  const actionAlert = alerts(failed).find((element) => textOf(element).includes(notificationsCopy.updateFailed));
  assert.ok(actionAlert, 'the action failure is announced inline');

  const retry = buttonByText(failed, commonMessages.actions.retry);
  assert.ok(retry, 'the inline error offers a retry');
  const getMyBeforeRetry = getMyCalls;
  retry.props.onClick();
  await flush();
  await flush();

  assert.equal(markReadCalls, 2, 'retry re-runs the mark-read action');
  assert.equal(getMyCalls, getMyBeforeRetry, 'retry must not reload the whole inbox');
});

test('mark-all success is visible after the list reload', async () => {
  let allRead = false;
  const items = [notificationItem()];
  const api = {
    getMy: async () => ({
      data: items.map((item) => ({ ...item, isRead: allRead })),
      meta: { totalPages: 1 },
    }),
    markRead: async () => undefined,
    markAllRead: async () => {
      allRead = true;
      return { updated: 1 };
    },
  };

  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();
  await flush();

  buttonByText(page.render(), notificationsCopy.markAllRead).props.onClick();
  await flush();
  await flush();

  const updated = page.render();
  assert.ok(
    textOf(updated).includes('1 notifications marked as read.'),
    'the success message survives the reload it triggers',
  );
});

test('the empty all-notifications tab shows only the empty-inbox sentence', async () => {
  const api = {
    getMy: async () => ({ data: [], meta: { totalPages: 1 } }),
    markRead: async () => undefined,
    markAllRead: async () => ({ updated: 0 }),
  };

  const page = mount((fakeReact) => loadNotificationsPage(api, fakeReact), {});
  await flush();
  await flush();

  const empty = html(page.render());
  assert.ok(empty.includes('data-testid="empty-state"'), 'the empty state renders');
  assert.ok(empty.includes(notificationsCopy.noAll), 'the inbox sentence is present');
  assert.ok(!empty.includes(notificationsCopy.empty), 'the unread/announcement tagline is gone');
  assert.ok(!empty.includes(notificationsCopy.noUnread), 'the unread sentence stays on the unread tab');
});

const libraryCopy = loadTs('src/i18n/library-messages.ts').libraryMessages.vi;

function loadLibraryPage(api, fakeReact) {
  return loadTs('src/components/library/LibraryCataloguePage.tsx', baseStubs({
    react: fakeReact,
    ...pageHeaderStubs(),
    '@/context/AuthContext': { useRequireAuth: () => ({ isLoading: false }) },
    '@/i18n': {
      useI18n: () => ({
        locale: 'vi',
        formatDateTime: (value) => String(value),
        messages: {
          common: {
            states: {
              showingResults: 'Showing',
              to: 'to',
              of: 'of',
              results: 'results',
              page: 'Page',
              goToPreviousPage: 'Previous',
              goToNextPage: 'Next',
            },
          },
        },
      }),
    },
    '@/i18n/library-messages': { libraryMessages: { vi: libraryCopy, en: libraryCopy } },
    '@/lib/library-api': {
      libraryApi: api,
      newLibraryIdempotencyKey: () => 'idempotency-key',
    },
  })).LibraryCataloguePage;
}

test('a failed hold keeps the catalogue and pager visible with an inline error', async () => {
  const title = {
    id: 't1',
    title: 'Clean Code',
    author: 'Robert C. Martin',
    category: 'Software',
    isbn: '9780132350884',
    availableCopies: 1,
    totalCopies: 1,
    copies: [{ id: 'c1', barcode: 'BC-1', status: 'AVAILABLE' }],
  };
  const api = {
    cataloguePage: async () => ({ items: [title], total: 1 }),
    myLoans: async () => [],
    request: async () => {
      throw { response: { data: { code: 'COPY_UNAVAILABLE' } } };
    },
    cancel: async () => undefined,
  };

  const page = mount((fakeReact) => loadLibraryPage(api, fakeReact), {});
  await flush();
  await flush();

  const loaded = page.render();
  assert.ok(html(loaded).includes('data-testid="library-title-t1"'), 'the catalogue renders');
  const hold = buttonByText(loaded, libraryCopy.requestHold);
  assert.ok(hold, 'the hold action is rendered');

  hold.props.onClick();
  await flush();
  await flush();

  const failed = page.render();
  const failedHtml = html(failed);
  assert.ok(
    failedHtml.includes('data-testid="library-title-t1"'),
    'a failed hold must not hide the catalogue',
  );
  assert.ok(
    failedHtml.includes('data-testid="library-pagination-summary"'),
    'the pager stays visible',
  );
  assert.ok(
    !failedHtml.includes('data-testid="error-state"'),
    'the load error surface stays reserved for reads',
  );
  const actionAlert = alerts(failed).find((element) =>
    textOf(element).includes(libraryCopy.copyUnavailable),
  );
  assert.ok(actionAlert, 'the copy-unavailable failure is shown inline');
});
