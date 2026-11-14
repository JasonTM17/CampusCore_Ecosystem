const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {
  createRuntime,
  elements,
  flush,
  installBrowserEnv,
  loadTs,
} = require('./dashboard-shell-harness');

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

const messages = loadTs('src/i18n/messages.ts', { '@/i18n/config': {} }).getMessages('vi');
const copy = messages.adminPages.sections;

function sectionSnapshot(capacity) {
  return {
    id: 'sec-1',
    sectionNumber: 'SEC-01',
    courseId: 'course-1',
    semesterId: 'sem-1',
    capacity,
    status: 'OPEN',
    course: { code: 'CS101', name: 'Intro to CS' },
    semester: { name: 'HK1' },
    schedules: [{
      id: 'sch-1',
      dayOfWeek: 2,
      startTime: '09:00',
      endTime: '10:30',
      classroom: { id: 'room-1', building: 'A', roomNumber: '101' },
    }],
  };
}

function loadPage(runtime, adminSectionsApi, toasts) {
  const tableStub = ({ children }) => React.createElement('div', null, children);
  return loadTs('src/app/admin/sections/page.tsx', {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': {
      useRouter: () => ({ replace: () => {}, push: () => {} }),
    },
    'lucide-react': iconStub,
    sonner: {
      toast: {
        success: (message) => toasts.success.push(message),
        error: (message) => toasts.error.push(message),
      },
    },
    '@/context/AuthContext': {
      useAuth: () => ({
        user: { id: 'admin-1', roles: ['ADMIN'] },
        isAdmin: true,
        isSuperAdmin: false,
        isLoading: false,
        isLoggingOut: false,
      }),
    },
    '@/i18n': {
      useI18n: () => ({
        locale: 'vi',
        messages,
        formatNumber: (value) => String(value),
        href: (value) => value,
      }),
    },
    '@/lib/api': {
      adminSectionsApi,
      adminSemestersApi: { getAll: async () => ({ data: [] }) },
      coursesApi: { getAll: async () => ({ data: [] }) },
      lecturersApi: { getAll: async () => ({ data: [] }) },
      classroomsApi: { getAll: async () => ({ data: [] }) },
    },
    '@/components/admin/AdminFrame': {
      AdminFrame: ({ title, actions, children }) =>
        React.createElement('main', null, React.createElement('h1', null, title), actions, children),
    },
    '@/components/admin/AdminSurface': {
      AdminDialogFooter: tableStub,
      AdminFormField: ({ label, children }) =>
        React.createElement('label', null, label, children),
      AdminFormSection: ({ title, children }) =>
        React.createElement('section', null, React.createElement('h2', null, title), children),
      AdminPaginationFooter: () => null,
      AdminRowActions: tableStub,
      AdminTableCard: tableStub,
      AdminTableScroll: tableStub,
      AdminToolbarCard: tableStub,
    },
    '@/components/ui/button': {
      Button: ({ children, onClick, type = 'button', ...rest }) =>
        React.createElement('button', {
          type,
          onClick,
          disabled: rest.disabled,
          'aria-label': rest['aria-label'],
          title: rest.title,
        }, children),
    },
    '@/components/ui/input': {
      Input: (props) => React.createElement('input', {
        type: props.type,
        value: props.value ?? '',
        onChange: props.onChange,
        min: props.min,
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
    '@/components/ui/searchable-select': {
      SearchableSelect: ({ label, value, onValueChange, options = [] }) =>
        React.createElement('label', null, label, React.createElement('select', {
          value,
          onChange: (event) => onValueChange(event.target.value),
        }, options.map((option) => React.createElement('option', {
          key: option.value,
          value: option.value,
        }, option.label)))),
    },
    '@/components/ui/status': { statusToneClass: () => '' },
    '@/components/ui/state-block': {
      EmptyState: ({ title }) => React.createElement('div', null, title),
      ErrorState: ({ title, description }) => React.createElement('div', null, title, description),
      LoadingState: ({ label }) => React.createElement('div', { role: 'status' }, label),
    },
    '@/components/ui/use-confirmation-dialog': {
      useConfirmationDialog: () => ({ confirm: async () => false, confirmationDialog: null }),
    },
    '@/lib/campus-error': {
      campusErrorMessage: (_error, _copy, fallback) => fallback,
    },
  }, { cache: false }).default;
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

function byAriaLabel(tree, label) {
  return elements(tree).find((element) => element.props?.['aria-label'] === label);
}

function numberInput(tree) {
  return elements(tree).find((element) => element.props?.type === 'number');
}

function submitForm(tree) {
  const form = elements(tree).find((element) => element.type === 'form');
  assert.ok(form, 'the edit form is rendered');
  form.props.onSubmit({ preventDefault() {} });
}

test('a stale section save re-seeds the editor with the server row instead of keeping the stale baseline', async () => {
  installBrowserEnv();
  const toasts = { success: [], error: [] };
  let getByIdCalls = 0;
  const updateCalls = [];
  const adminSectionsApi = {
    getAll: async () => ({ data: [sectionSnapshot(30)], meta: { totalPages: 1 } }),
    getById: async () => {
      getByIdCalls += 1;
      return getByIdCalls === 1 ? sectionSnapshot(30) : sectionSnapshot(42);
    },
    update: async (id, payload) => {
      updateCalls.push({ id, payload });
      return sectionSnapshot(42);
    },
    delete: async () => ({ message: 'deleted' }),
  };

  const runtime = createRuntime();
  const Page = loadPage(runtime, adminSectionsApi, toasts);
  const loaded = await settle(runtime, Page);

  const edit = byAriaLabel(
    loaded,
    copy.editLabel
      .replace('{sectionNumber}', () => 'SEC-01')
      .replace('{courseCode}', () => 'CS101'),
  );
  assert.ok(edit, 'the edit action is rendered');
  edit.props.onClick();
  let editor = await settle(runtime, Page);
  assert.equal(numberInput(editor).props.value, 30, 'the editor starts on the loaded capacity');

  numberInput(editor).props.onChange({ target: { value: '50' } });
  editor = await settle(runtime, Page);
  assert.equal(numberInput(editor).props.value, 50, 'the admin edit is in the form');

  submitForm(editor);
  const conflicted = await settle(runtime, Page);

  assert.equal(updateCalls.length, 0, 'the stale save does not reach the update endpoint');
  assert.equal(
    numberInput(conflicted).props.value,
    42,
    'the editor shows the current server capacity after the conflict',
  );
  assert.ok(toasts.error.includes(copy.staleEdit), 'the conflict is explained');
});