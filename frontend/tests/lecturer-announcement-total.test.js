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

/** A tiny hook runtime: state survives renders, effects run when asked. */
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

const flush = () => new Promise((resolve) => setImmediate(resolve));
const dummyIcon = () => null;
const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : dummyIcon) },
);

const messages = {
  lecturerDashboard: {
    eyebrow: 'Lecturer area',
    title: 'Welcome, {name}',
    description: 'Lecturer workspace',
    errors: {
      loading: 'Loading workspace',
      unavailableTitle: 'Workspace unavailable',
      loadFailed: 'Workspace data could not be loaded.',
    },
    metrics: {
      labels: ['Classes', 'Students', 'Ready to publish', 'Announcements'],
      details: ['detail 0', 'detail 1', 'detail 2', 'detail 3'],
    },
    quickActionsTitle: 'Quick actions',
    quickActionsDescription: 'Open a teaching tool',
    quickLinks: [['Schedule', 'Open'], ['Grades', 'Open'], ['Announcements', 'Open']],
    gradingQueueTitle: 'Grading queue',
    gradingQueueDescription: 'Sections waiting for scores',
    gradingQueueEmptyTitle: 'Nothing to grade',
    gradingQueueEmptyDescription: 'No sections need scores.',
    sectionsInScopeTitle: 'Teaching sections',
    sectionsInScopeDescription: 'Assigned this term',
    sectionsInScopeEmptyTitle: 'No sections',
    sectionsInScopeEmptyDescription: 'No sections are assigned.',
    announcementsTitle: 'Announcements',
    announcementsDescription: 'Recently sent',
    announcementsEmptyTitle: 'No announcements',
    announcementsEmptyDescription: 'Nothing has been sent.',
    sectionPrefix: 'Section',
    gradedSuffix: 'graded',
    queueStatusReady: 'Ready',
    queueStatusProgress: 'In progress',
    studentsSuffix: 'students',
  },
  common: {
    statuses: { UNKNOWN: 'Unknown', ACTIVE: 'Active' },
    actions: { openTool: 'Open' },
  },
};

const section = {
  id: 'section-1',
  courseCode: 'SE101',
  courseName: 'Software Engineering',
  sectionNumber: '01',
  semester: 'HK1',
  departmentName: 'Software Engineering',
  enrolledCount: 40,
  capacity: 50,
  status: 'ACTIVE',
};

test('lecturer announcement metric reads the API total, not the page limit', async () => {
  const runtime = createRuntime();
  const pagedItems = Array.from({ length: 5 }, (_, index) => ({
    id: `announcement-${index}`,
    title: `Announcement ${index}`,
    content: 'Body',
    createdAt: '2026-10-01T00:00:00Z',
    priority: 'NORMAL',
  }));

  const Page = loadTs('src/app/dashboard/lecturer/page.tsx', {
    react: runtime.fakeReact,
    'lucide-react': iconStub,
    '@/context/AuthContext': {
      useRequireAuth: () => ({
        user: { firstName: 'Linh', lastName: 'Nguyen' },
        isLoading: false,
        hasAccess: true,
      }),
    },
    '@/lib/api': {
      sectionsApi: {
        getMySchedule: async () => [section],
        getMyGradingSections: async () => [],
      },
      announcementsApi: {
        getMy: async () => ({
          data: pagedItems,
          meta: { total: 24, page: 1, limit: 5, totalPages: 5 },
        }),
      },
    },
    '@/components/providers/SiteAppearanceProvider': {
      useOrderedPosts: (items) => items,
    },
    '@/lib/academic-content': {
      getLocalizedFlatLabel: (_locale, value) => value,
    },
    '@/components/ProtectedRoute': { WorkspaceForbiddenState: () => null },
    '@/components/ui/page-header': {
      PageHeader: ({ title, description, actions }) =>
        React.createElement('header', null, React.createElement('h1', null, title), description, actions),
      SectionEyebrow: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/status': { metricToneClass: () => '' },
    '@/components/ui/state-block': {
      EmptyState: ({ title }) => React.createElement('div', null, title),
      ErrorState: ({ title }) => React.createElement('div', { role: 'alert' }, title),
      LoadingState: ({ label }) => React.createElement('div', { role: 'status' }, label),
    },
    '@/components/dashboard/WorkspaceSurface': {
      WorkspaceMetricCard: ({ label, value }) =>
        React.createElement('div', { 'data-metric': label }, String(value)),
      WorkspacePanel: ({ title, children }) =>
        React.createElement('section', null, title, children),
      WorkspaceActionTile: () => null,
    },
    '@/components/LocalizedLink': {
      LocalizedLink: ({ href, children }) => React.createElement('a', { href }, children),
    },
    '@/i18n': {
      useI18n: () => ({
        locale: 'en',
        messages,
        formatNumber: (value) => String(value),
        formatDateTime: (value) => String(value),
      }),
    },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  }).default;

  let result = runtime.render(Page, {});
  for (const effect of result.effects) effect();
  await flush();
  await flush();
  const html = renderToStaticMarkup(runtime.render(Page, {}).tree);

  assert.match(html, /data-metric="Announcements">24</, 'the metric shows the API total (24)');
  assert.doesNotMatch(html, /data-metric="Announcements">5</, 'the metric must not stop at the page limit');
});
