const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {
  createRuntime,
  elements,
  flush,
  loadMessages,
  loadTs,
  textOf,
} = require('./dashboard-shell-harness');

const messages = loadMessages('vi');
const copy = loadTs('src/i18n/messages-thesis-workflow.ts').thesisWorkflowVi.advisorDirectory;

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

const LECTURER = {
  id: 'lec-1',
  employeeId: 'GV-001',
  title: 'TS.',
  specialization: 'Distributed systems',
  departmentId: 'dept-1',
  user: { id: 'user-1', firstName: 'An', lastName: 'Nguyen', email: 'an@campuscore.edu' },
};

const lecturerUser = { id: 'user-9', roles: ['LECTURER'], role: 'LECTURER' };

function directoryStubs(runtime, { listTopics }) {
  return {
    react: { ...runtime.fakeReact, useId: () => 'directory-test-id' },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': {
      useSearchParams: () => new URLSearchParams(''),
    },
    'lucide-react': iconStub,
    '@/components/LocalizedLink': {
      LocalizedLink: ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children),
    },
    '@/components/ui/link-button': {
      LinkButton: ({ href, children }) => React.createElement('a', { href }, children),
    },
    '@/components/ui/button': {
      Button: ({ children, ...rest }) => React.createElement(
        'button',
        {
          type: rest.type ?? 'button',
          disabled: rest.disabled,
          onClick: rest.onClick,
          'aria-label': rest['aria-label'],
        },
        children,
      ),
    },
    '@/components/ui/card': {
      Card: ({ children, ...rest }) => React.createElement('div', rest, children),
    },
    '@/components/ui/input': {
      Input: ({ icon, endAction, ...rest }) => React.createElement('input', rest),
    },
    '@/components/ui/select': {
      Select: ({ options = [], children, ...rest }) => React.createElement(
        'select',
        { 'aria-label': rest['aria-label'], disabled: rest.disabled },
        options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
      ),
    },
    '@/components/ui/modal': {
      Modal: ({ isOpen, title, children }) =>
        (isOpen ? React.createElement('div', null, title, children) : null),
    },
    '@/components/ui/state-block': {
      EmptyState: ({ title, description, action }) => React.createElement('div', null, title, description, action),
      ErrorState: ({ title, description }) => React.createElement('div', null, title, description),
      LoadingState: ({ label }) => React.createElement('div', null, label),
    },
    '@/components/ui/page-header': {
      PageHeader: ({ title, description, actions, eyebrow }) => React.createElement('div', null, eyebrow, title, description, actions),
      SectionEyebrow: ({ children }) => React.createElement('div', null, children),
    },
    '@/components/ui/status': {
      statusToneClass: () => '',
    },
    '@/context/AuthContext': {
      useAuth: () => ({ user: lecturerUser }),
      useRequireAuth: () => ({
        user: lecturerUser,
        isLoading: false,
        hasAccess: true,
        isForbidden: false,
      }),
    },
    '@/components/ProtectedRoute': { WorkspaceForbiddenState: () => null },
    '@/i18n': {
      useI18n: () => ({ href: (value) => value, messages, locale: 'vi' }),
    },
    '@/lib/api': {
      lecturersApi: { getAll: async () => ({ data: [LECTURER] }) },
      departmentsApi: { getAll: async () => ({ data: [] }) },
      fetchAllPages: async (fetcher) => (await fetcher(0, 100)).data,
    },
    '@/lib/thesis-api': {
      thesisApi: {
        listRounds: async () => [{ id: 'round-1' }],
        listTopics,
      },
    },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  };
}

/** Renders the real directory page until its async loads settle. */
async function renderDirectory({ listTopics }) {
  const runtime = createRuntime();
  const page = loadTs(
    'src/components/dashboard/thesis/ThesisAdvisorDirectoryPage.tsx',
    directoryStubs(runtime, { listTopics }),
    { cache: false },
  );
  let tree = null;
  for (let pass = 0; pass < 6; pass += 1) {
    const rendered = runtime.render(page.default, {});
    runtime.runEffects(rendered.effects);
    tree = rendered.tree;
    await flush();
  }
  return { tree, runtime, page };
}

/** The harness does not invoke child components; find them by type name. */
function named(tree, name) {
  return elements(tree).filter((node) => node.type?.name === name);
}

test('a failed topic read is announced as unavailable, never as a 0/5 quota', async () => {
  const { tree } = await renderDirectory({
    listTopics: async () => {
      throw new Error('topic service down');
    },
  });
  const text = textOf(tree);

  assert.doesNotMatch(
    text,
    /0\s*\/\s*5/,
    'a fabricated empty quota must not stand in for a failed read',
  );
  assert.ok(
    text.includes(copy.quotaUnavailable),
    'the workload cell names the outage instead of inventing a quota',
  );
  assert.ok(
    !text.includes(copy.cardAvailable),
    'the availability pill cannot claim a quota nobody loaded',
  );
  assert.doesNotMatch(
    text,
    new RegExp(`${copy.statsAcceptingStudents}\\d`),
    'the accepting-students statistic cannot be counted from fabricated zeros',
  );
  assert.match(
    text,
    new RegExp(`${copy.statsAcceptingStudents}—`),
    'the statistic prints the missing-data dash while the read is down',
  );
});

test('the quota filter cannot answer "available" while the read failed', async () => {
  const { tree } = await renderDirectory({
    listTopics: async () => {
      throw new Error('topic service down');
    },
  });

  const quotaSelect = named(tree, 'Select').find(
    (node) => node.props['aria-label'] === copy.quotaFilterLabel,
  );
  assert.ok(quotaSelect, 'the quota filter select renders');
  assert.equal(
    quotaSelect.props.disabled,
    true,
    'a filter that cannot know the answer stays disabled',
  );
});

test('the workload column keeps the unavailable state in table view and in the detail dialog', async () => {
  const { tree, runtime, page } = await renderDirectory({
    listTopics: async () => {
      throw new Error('topic service down');
    },
  });

  const segmented = named(tree, 'Segmented')[0];
  assert.ok(segmented, 'the view toggle renders');
  segmented.props.onChange('table');

  const viewBio = named(tree, 'Button').find((node) => textOf(node) === copy.viewBio);
  assert.ok(viewBio, 'the bio action renders');
  viewBio.props.onClick();

  let next = null;
  for (let pass = 0; pass < 4; pass += 1) {
    const rendered = runtime.render(page.default, {});
    runtime.runEffects(rendered.effects);
    next = rendered.tree;
    await flush();
  }

  const dataTable = named(next, 'DataTable')[0];
  assert.ok(dataTable, 'the table view renders');
  const workloadColumn = dataTable.props.columns.find((column) => column.key === 'workload');
  const cellText = textOf(workloadColumn.render(LECTURER));
  assert.doesNotMatch(cellText, /0\s*\/\s*5/, 'the table cell keeps the fabrication out');
  assert.ok(cellText.includes(copy.quotaUnavailable), 'the table cell names the outage');

  const modal = named(next, 'Modal')[0];
  assert.ok(modal?.props.isOpen, 'the detail dialog opened');
  const modalText = textOf(modal);
  assert.doesNotMatch(modalText, /0\s*\/\s*5/, 'the dialog keeps the fabrication out');
  assert.ok(modalText.includes(copy.quotaUnavailable), 'the dialog names the outage');
});

test('a successful topic read still shows the real quota and statistic', async () => {
  const { tree } = await renderDirectory({
    listTopics: async () => [{ id: 'topic-1', createdBy: 'user-1' }],
  });
  const text = textOf(tree);

  assert.match(text, /1\s*\/\s*5/, 'a loaded projection still renders its quota');
  assert.match(
    text,
    new RegExp(`${copy.statsAcceptingStudents}1`),
    'the statistic still counts loaded availability',
  );
  const quotaSelect = named(tree, 'Select').find(
    (node) => node.props['aria-label'] === copy.quotaFilterLabel,
  );
  assert.equal(quotaSelect.props.disabled, false, 'the filter stays usable when the read worked');
});
