const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {
  createRuntime,
  elements,
  flush,
  installBrowserEnv,
  loadTs,
  textOf,
} = require('./dashboard-shell-harness');

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

const messages = loadTs('src/i18n/messages.ts', { '@/i18n/config': {} }).getMessages('vi');
const copy = messages.adminPages.users;

class FakeSearchParams {
  constructor(search = '') {
    this.params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  }

  get(name) {
    return this.params.get(name);
  }

  toString() {
    return this.params.toString();
  }
}

function loadPage(runtime, initialSearch = '?role=STUDENT&page=2') {
  let currentSearchParams = new FakeSearchParams(initialSearch);
  const replaced = [];
  const router = {
    replace: (url) => {
      replaced.push(url);
      const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
      currentSearchParams = new FakeSearchParams(query);
    },
    push: (url) => replaced.push(url),
  };
  const adminUserGuards = loadTs('src/lib/admin-user-guards.ts', {});
  const stubs = {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': {
      useRouter: () => router,
      useSearchParams: () => currentSearchParams,
      usePathname: () => '/admin/users',
    },
    'lucide-react': iconStub,
    sonner: { toast: { success: () => {}, error: () => {} } },
    '@/context/AuthContext': {
      useAuth: () => ({
        user: { id: 'admin-1', roles: ['SUPER_ADMIN'] },
        isAdmin: true,
        isSuperAdmin: true,
        isLoading: false,
        isLoggingOut: false,
      }),
    },
    '@/i18n': {
      useI18n: () => ({
        locale: 'vi',
        messages,
        formatDate: (value) => String(value),
        href: (value) => value,
      }),
    },
    '@/lib/api': {
      usersApi: {
        getAll: async () => ({ data: [], meta: { total: 0, totalPages: 1 } }),
        update: async () => ({}),
        create: async () => ({}),
        delete: async () => ({}),
        resetPassword: async () => ({}),
      },
      fetchAllPages: async () => [],
      departmentsApi: { getAll: async () => ({ data: [] }) },
      curriculaApi: { getAll: async () => ({ data: [] }) },
    },
    '@/types/api': {},
    '@/components/admin/AdminFrame': {
      AdminFrame: ({ title, actions, children }) =>
        React.createElement('main', null, React.createElement('h1', null, title), actions, children),
    },
    '@/components/admin/AdminSurface': {
      AdminDialogFooter: ({ children }) => React.createElement('div', null, children),
      AdminFormField: ({ label, children }) =>
        React.createElement('label', null, label, children),
      AdminPaginationFooter: () => null,
      AdminRowActions: ({ children }) => React.createElement('div', null, children),
      AdminTableCard: ({ children }) => React.createElement('div', null, children),
      AdminTableScroll: ({ children }) => React.createElement('div', null, children),
      AdminToolbarCard: ({ children }) => React.createElement('div', null, children),
      AdminToolbarMeta: ({ summary, actions }) =>
        React.createElement('div', null, summary, actions),
    },
    '@/components/ui/button': {
      Button: ({ children, onClick, ...rest }) =>
        React.createElement('button', {
          type: 'button',
          onClick,
          disabled: rest.disabled,
          'aria-pressed': rest['aria-pressed'],
          title: rest.title,
        }, children),
    },
    '@/components/ui/input': {
      Input: (props) => React.createElement('input', {
        type: props.type,
        value: props.value ?? '',
        onChange: props.onChange,
        'aria-label': props['aria-label'],
      }),
    },
    '@/components/ui/modal': {
      Modal: ({ isOpen, children }) => (isOpen
        ? React.createElement('div', { 'data-testid': 'editor-modal' }, children)
        : null),
    },
    '@/components/ui/select': {
      Select: ({ label, value, onChange, options = [] }) =>
        React.createElement('label', null, label, React.createElement('select', {
          value,
          onChange,
        }, options.map((option) => React.createElement('option', {
          key: option.value,
          value: option.value,
        }, option.label)))),
    },
    '@/components/ui/status': { roleSolidClass: () => '', roleToneClass: () => '' },
    '@/components/ui/status-pill': {
      StatusPill: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/state-block': {
      EmptyState: ({ title }) => React.createElement('div', null, title),
      ErrorState: ({ title, description }) => React.createElement('div', null, title, description),
      LoadingState: ({ label }) => React.createElement('div', { role: 'status' }, label),
    },
    '@/components/ui/use-confirmation-dialog': {
      useConfirmationDialog: () => ({ confirm: async () => false, confirmationDialog: null }),
    },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/lib/campus-error': {
      campusErrorMessage: (_error, _copy, fallback) => fallback,
    },
    '@/lib/admin-user-guards': adminUserGuards,
  };
  return {
    Page: loadTs('src/app/admin/users/page.tsx', stubs, { cache: false }).default,
    replaced,
    setSearch: (search) => { currentSearchParams = new FakeSearchParams(search); },
  };
}

async function settle(runtime, Page) {
  let tree = null;
  for (let index = 0; index < 8; index += 1) {
    const rendered = runtime.render(Page, {});
    runtime.runEffects(rendered.effects);
    tree = rendered.tree;
    await flush();
    await flush();
  }
  return tree;
}

function roleTab(tree, role) {
  return elements(tree).find(
    (element) => typeof element.props?.active === 'boolean'
      && textOf(element) === copy.roles[role],
  );
}

function allTab(tree) {
  const labelPrefix = copy.filterAll.split('{count}')[0];
  return elements(tree).find((element) => {
    if (typeof element.props?.active !== 'boolean') return false;
    const label = textOf(element);
    return label === copy.filterAllNoCount || label.startsWith(labelPrefix);
  });
}

test('changing the role tab writes the role back to the deep link and keeps other params', async () => {
  installBrowserEnv();
  const runtime = createRuntime();
  const { Page, replaced } = loadPage(runtime);
  let tree = await settle(runtime, Page);

  assert.equal(roleTab(tree, 'STUDENT').props.active, true, 'the URL role is selected');

  roleTab(tree, 'LECTURER').props.onClick();
  tree = await settle(runtime, Page);

  assert.deepEqual(replaced, ['/admin/users?role=LECTURER&page=2']);
  assert.equal(roleTab(tree, 'LECTURER').props.active, true);

  allTab(tree).props.onClick();
  tree = await settle(runtime, Page);

  assert.deepEqual(replaced, ['/admin/users?role=LECTURER&page=2', '/admin/users?page=2']);
  assert.equal(allTab(tree).props.active, true);
});

test('leaving the deep link without a role clears the filter instead of keeping the old one', async () => {
  installBrowserEnv();
  const runtime = createRuntime();
  const { Page, setSearch } = loadPage(runtime);
  let tree = await settle(runtime, Page);

  assert.equal(roleTab(tree, 'STUDENT').props.active, true, 'the URL role is selected');

  setSearch('');
  tree = await settle(runtime, Page);

  assert.equal(
    allTab(tree).props.active,
    true,
    'a URL without a role falls back to the unfiltered list',
  );
  assert.equal(roleTab(tree, 'STUDENT').props.active, false);
});