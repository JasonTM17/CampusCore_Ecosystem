const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

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

// Executes a page-level useMemo value with its closure dependencies injected.
function pageMemo(file, name, dependencies) {
  const source = read(file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(declaration, `page value ${name} exists`);
  const output = ts.transpileModule(`const ${declaration.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), 'useMemo', `${output}; return ${name};`)(
    ...Object.values(dependencies), (factory) => factory(),
  );
}

const passThrough = (tag) => {
  const Component = ({ children }) => React.createElement(tag, null, children);
  Component.displayName = `PassThrough(${tag})`;
  return Component;
};
const buttonStub = ({ children, onClick, disabled, type = 'button' }) =>
  React.createElement('button', { type, onClick, disabled }, children);
const iconStub = new Proxy({}, { get: () => () => null });

const rosterCopy = {
  thesis: {
    groups: 'groups',
    noSupervisedGroups: 'No supervised groups',
    supervisedGroupsDescription: 'Groups under your supervision.',
    approve: 'Approve',
    reject: 'Reject',
    memberCount: '{count} members',
    rejectionReason: 'Reason',
  },
  thesisWorkflow: {
    page: {
      thesisReportLabel: 'Report',
      projectDocumentsFallback: 'Document',
      reportNotSubmitted: 'Not submitted',
    },
  },
};

function renderRoster(groups, canReviewGroup = () => true) {
  const Roster = loadTs('src/features/thesis/components/SupervisedGroupList.tsx', {
    'lucide-react': iconStub,
    '@/components/ui/button': { Button: buttonStub },
    '@/components/ui/card': {
      Card: passThrough('section'),
      CardContent: passThrough('div'),
      CardDescription: passThrough('p'),
      CardHeader: passThrough('div'),
      CardTitle: passThrough('h3'),
    },
    '@/components/ui/state-block': { EmptyState: () => React.createElement('div', null, 'empty') },
    '@/components/thesis/MemberAvatars': { MemberAvatars: () => null },
    '@/components/thesis/StatusBadge': {
      StatusBadge: ({ status }) => React.createElement('span', null, status),
    },
    '@/components/dashboard/thesis/SupervisedGroupMembers': { SupervisedGroupMembers: () => null },
    '@/lib/safe-url': { isHttpUrl: () => false },
  }).default;
  return renderToStaticMarkup(React.createElement(Roster, {
    messages: rosterCopy,
    title: 'Supervision',
    description: 'Groups',
    groups,
    reportsByGroup: {},
    isActionPending: false,
    getTopicTitle: (topicId) => (topicId ? `Topic ${topicId}` : '-'),
    isRoundOpen: () => true,
    canReviewGroup,
    onGroupUpdated: () => undefined,
    onApprove: () => undefined,
    onReject: () => undefined,
    onDownloadReport: () => undefined,
  }));
}

const pendingGroup = (overrides = {}) => ({
  id: 'group-pending',
  roundId: 'round-1',
  leaderStudentId: 'student-1',
  topicId: null,
  status: 'DRAFT',
  approvalStatus: 'PENDING',
  memberStudentIds: ['student-1', 'student-2', 'student-3'],
  ...overrides,
});

test('the supervision roster includes topic-less pending groups for governance', () => {
  const visible = pageMemo('src/app/dashboard/thesis/page.tsx', 'supervisedGroups', {
    isSupervisorOrAdmin: true,
    isAdmin: true,
    groups: [
      pendingGroup(),
      pendingGroup({ id: 'group-review', topicId: 'topic-1', status: 'SUBMITTED' }),
      pendingGroup({ id: 'group-other', topicId: 'topic-2', status: 'SUBMITTED' }),
    ],
    myTopicIds: new Set(['topic-1']),
    supervisedTopicIds: new Set(),
  });
  assert.deepEqual(visible.map((group) => group.id), ['group-pending', 'group-review', 'group-other']);

  const lecturerView = pageMemo('src/app/dashboard/thesis/page.tsx', 'supervisedGroups', {
    isSupervisorOrAdmin: true,
    isAdmin: false,
    groups: [
      pendingGroup(),
      pendingGroup({ id: 'group-review', topicId: 'topic-1', status: 'SUBMITTED' }),
    ],
    myTopicIds: new Set(['topic-1']),
    supervisedTopicIds: new Set(),
  });
  assert.deepEqual(lecturerView.map((group) => group.id), ['group-review']);
});

test('a topic-less pending group offers reject without approve', () => {
  const html = renderRoster([pendingGroup()]);
  assert.match(html, />Reject</);
  assert.doesNotMatch(html, />Approve</);
});

test('a submitted group with a topic still offers both review actions', () => {
  const html = renderRoster([pendingGroup({ topicId: 'topic-1', status: 'SUBMITTED' })]);
  assert.match(html, />Reject</);
  assert.match(html, />Approve</);
});

test('thesis repository uses the server-owned projection and opaque download route', () => {
  const api = read('src/lib/thesis-api.ts');
  const page = read('src/app/dashboard/thesis/page.tsx');

  assert.match(api, /listRoundRepository/);
  assert.match(api, /\/thesis\/rounds\/.*\/repository/);
  assert.match(api, /downloadRepositoryReportFile/);
  assert.match(api, /\/thesis\/reports\/.*\/file/);
  assert.match(page, /listRoundRepositoryPage\(\s*selectedRoundId/);
  assert.doesNotMatch(page, /listRoundRepository\(selectedRoundId\)/);
  assert.match(page, /report\.reportId/);
  assert.doesNotMatch(page, /report\.submittedBy\b/);
  assert.doesNotMatch(page, /groups\.find\(\(g\) => g\.id === report\.groupId\)/);
});

test('thesis progress renders evidence-backed backend milestones', () => {
  const api = read('src/lib/thesis-api.ts');
  const page = read('src/components/dashboard/thesis/ThesisProgressPage.tsx');

  assert.match(api, /getMyProgress/);
  assert.match(api, /\/thesis\/me\/progress/);
  assert.match(page, /PROGRESS_MILESTONES/);
  assert.match(page, /thesisApi\.getMyProgress\(selectedRound\.id\)/);
  assert.doesNotMatch(page, /getProgressIndex/);
});

test('report submission UI exposes writing controls only to the group leader', () => {
  const page = read('src/app/dashboard/thesis/page.tsx');
  assert.match(page, /isGroupLeader \? \(/);
  assert.match(page, /submitReportFile/);
  assert.match(page, /submitReport\(currentGroup\.id/);
});

test('faculty-head role reaches the dean observation workspace and thesis administration', () => {
  const auth = read('src/lib/login-portal.ts');
  const adminPage = read('src/app/admin/thesis/page.tsx');
  const workspace = read('src/app/dashboard/thesis/page.tsx');
  const deanPage = read('src/app/dashboard/dean/page.tsx');

  // TRUONG_KHOA routing lives in the portal module: the dean tab and every
  // privileged pass-through land on the faculty observation dashboard.
  assert.match(auth, /TRUONG_KHOA/);
  assert.match(auth, /\/dashboard\/dean/);
  assert.match(deanPage, /isFacultyHead/);
  assert.match(adminPage, /isFacultyHead/);
  assert.match(workspace, /isFacultyHead/);
});

test('global thesis workspaces do not call the lecturer-only workload endpoint', () => {
  const page = read('src/app/dashboard/thesis/page.tsx');

  assert.match(page, /if \(!isLecturer \|\| !selectedRoundId\) return;/);
  assert.match(page, /thesisApi\s*\.myWorkload\(\)/);
});

test('report window lock keeps the backend REPORT_WINDOW_CLOSED code localized', () => {
  const page = read('src/app/dashboard/thesis/page.tsx');
  const messages = read('src/i18n/messages.ts');

  // ThesisReportService answers 409 REPORT_WINDOW_CLOSED until the round
  // reaches REGISTRATION_CLOSED: the panel must map that code and the
  // dictionary must keep both the English and Vietnamese copies.
  assert.ok(
    page.includes('REPORT_WINDOW_CLOSED') &&
      (messages.match(/REPORT_WINDOW_CLOSED:/g) || []).length === 2,
    'REPORT_WINDOW_CLOSED must be mapped by the thesis page and localized in en + vi',
  );
});

test('the student score card needs an approved group before it prints a published topic score', () => {
  const page = read('src/app/dashboard/thesis/page.tsx');
  assert.match(
    page,
    /const studentFinalScore = currentGroup\?\.approvalStatus === 'APPROVED'\s*\?\s*currentTopic\?\.finalScore \?\? myResultItem\?\.finalScore \?\? null\s*:\s*null;/,
  );
});
