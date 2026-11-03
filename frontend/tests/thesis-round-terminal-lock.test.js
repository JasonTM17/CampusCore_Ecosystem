const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// Render the real module under test with its imports replaced by stubs; the
// same TypeScript transpile harness thesis-council-integrity.test.js uses.
function loadModule(relative, aliases = {}) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: relative,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (name) => Object.prototype.hasOwnProperty.call(aliases, name)
    ? aliases[name]
    : require(name);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const uiStubs = {
  '@/components/ui/button': {
    Button: (props) => React.createElement('button', {
      type: 'button',
      'data-disabled': props.disabled ? 'yes' : 'no',
      'data-variant': props.variant || 'default',
    }, props.children),
  },
  '@/components/ui/card': {
    Card: (p) => React.createElement('div', null, p.children),
    CardContent: (p) => React.createElement('div', null, p.children),
    CardDescription: (p) => React.createElement('p', null, p.children),
    CardHeader: (p) => React.createElement('div', null, p.children),
    CardTitle: (p) => React.createElement('h3', null, p.children),
  },
  '@/components/ui/input': {
    Input: (props) => React.createElement('input', {
      disabled: !!props.disabled, value: props.value ?? '', readOnly: true,
    }),
  },
  '@/components/ui/state-block': {
    ErrorState: (p) => React.createElement('div', { role: 'alert' },
      p.title, p.description,
      p.onRetry ? React.createElement('button', { type: 'button' }, 'RETRY_ACTION') : null),
    EmptyState: () => null,
    LoadingState: () => null,
  },
  '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  '@/lib/plural': { countLabel: (count, singular, plural) => (count === 1 ? singular : plural) },
};

function loadMessages() {
  return loadModule('src/i18n/messages.ts', {
    '@/i18n/config': {},
    '@/i18n/messages-thesis-workflow': loadModule('src/i18n/messages-thesis-workflow.ts'),
    '@/i18n/messages-dean-overview': loadModule('src/i18n/messages-dean-overview.ts'),
    '@/i18n/messages-content': loadModule('src/i18n/messages-content.ts'),
    '@/i18n/messages-attendance-geofence': loadModule('src/i18n/messages-attendance-geofence.ts'),
    '@/i18n/messages-teaching-pages': loadModule('src/i18n/messages-teaching-pages.ts'),
    '@/i18n/messages-admin-pages': loadModule('src/i18n/messages-admin-pages.ts'),
    '@/i18n/messages-student-pages': loadModule('src/i18n/messages-student-pages.ts'),
  }).en;
}

function loadWorkspaceComponent() {
  const helpers = loadModule('src/features/thesis/components/thesis-helpers.tsx');
  const thesisText = loadModule('src/lib/thesis-text.ts');
  return loadModule('src/features/thesis/components/CouncilDefenseWorkspace.tsx', {
    ...uiStubs,
    '@/i18n/messages': {},
    '@/types/api': {},
    '@/lib/thesis-api': {},
    '@/features/thesis/components/thesis-helpers': helpers,
    '@/lib/thesis-text': thesisText,
    '@/lib/safe-url': loadModule('src/lib/safe-url.ts'),
  }).default;
}

function loadReviewPanel() {
  const thesisText = loadModule('src/lib/thesis-text.ts');
  return loadModule('src/features/thesis/components/GvpbReviewPanel.tsx', {
    ...uiStubs,
    '@/i18n/messages': {},
    '@/lib/thesis-api': {},
    '@/lib/thesis-text': thesisText,
    // The static renderer never runs effects, so the hook is stubbed to the
    // same fresh timestamp it would return after its first client tick.
    '@/lib/use-now': { useNow: () => Date.now() },
  }).default;
}

function loadSupervisedGroupList() {
  const Icon = () => React.createElement('span');
  return loadModule('src/features/thesis/components/SupervisedGroupList.tsx', {
    ...uiStubs,
    'lucide-react': {
      Check: Icon,
      ExternalLink: Icon,
      FileDown: Icon,
      FileText: Icon,
      UsersRound: Icon,
      X: Icon,
    },
    '@/components/thesis/MemberAvatars': { MemberAvatars: () => null },
    '@/components/thesis/StatusBadge': {
      StatusBadge: ({ status }) => React.createElement('span', null, status),
    },
    '@/components/dashboard/thesis/SupervisedGroupMembers': { SupervisedGroupMembers: () => null },
    '@/i18n/messages': {},
    '@/lib/safe-url': { isHttpUrl: () => false },
    '@/lib/thesis-api': {},
  }).default;
}

// renderToStaticMarkup escapes '&' as '&amp;' — message copies must be
// asserted in their rendered form so negative checks are not tautological.
const rendered = (copy) => copy.replace(/&/g, '&amp;');

// A KLTN round whose gvpb deadline has not passed, so only the status can
// explain a frozen control.
const round = (status) => ({
  id: 'round-1',
  name: 'Terminal-lock round',
  thesisType: 'KLTN',
  registrationStart: '2026-01-01T00:00:00.000Z',
  registrationEnd: '2026-02-01T00:00:00.000Z',
  lecturerSubmitStart: '2025-12-01T00:00:00.000Z',
  lecturerSubmitEnd: '2025-12-31T00:00:00.000Z',
  gvpbDeadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  status,
});

const defenseScore = (lecturerId) => ({ lecturerId, component: 'DEFENSE', score: 8 });

function workspaceProps(overrides) {
  return {
    messages: loadMessages(),
    councils: [{
      id: 'council',
      name: 'Council A',
      topicIds: ['topic'],
      members: [
        { lecturerId: 'chair', memberRole: 'CHAIR' },
        { lecturerId: 'member-2', memberRole: 'MEMBER' },
        { lecturerId: 'member-3', memberRole: 'MEMBER' },
      ],
    }],
    myLecturerId: 'chair',
    topics: [{ id: 'topic', title: 'Topic', finalScore: null }],
    lecturers: [],
    // Every eligible member scored, so the finalize action would be live.
    councilScores: { 'council:topic': [defenseScore('chair'), defenseScore('member-2'), defenseScore('member-3')] },
    councilScoreErrors: {},
    topicSupervisors: { topic: [] },
    topicReports: {},
    topicReportErrors: {},
    onRetryTopicReport: () => {},
    draftScores: { 'council:topic': '9' },
    draftComments: {},
    isActionPending: false,
    showProfileClaimNotice: false,
    profileClaimMissingLabel: '',
    onScoreDraftChange: () => {},
    onCommentDraftChange: () => {},
    onSubmitScore: () => {},
    onFinalizeScore: () => {},
    onDownloadReport: () => {},
    ...overrides,
  };
}

// ---------- CouncilDefenseWorkspace: a terminal round removes every mutation ----------

for (const status of ['CANCELLED', 'CLOSED', 'RESULTS_PUBLISHED']) {
  test(`council workspace renders no score/finalize controls when the round is ${status}`, () => {
    const messages = loadMessages();
    const Workspace = loadWorkspaceComponent();
    const html = renderToStaticMarkup(React.createElement(Workspace, workspaceProps({
      round: round(status),
    })));
    assert.equal(html.includes(messages.thesis.grading.saveScore), false,
      `${status}: the per-member score-save control must not render`);
    assert.equal(html.includes(rendered(messages.thesis.grading.finalizeButton)), false,
      `${status}: the finalize action must not render`);
    assert.equal(html.includes('<input'), false,
      `${status}: no score draft input may render`);
    // The workspace stays readable: the submitted score breakdown remains.
    assert.ok(html.includes(messages.thesis.grading.scoresListTitle),
      `${status}: the score breakdown must stay visible`);
  });
}

test('council workspace keeps score/finalize controls on a non-terminal round', () => {
  const messages = loadMessages();
  const Workspace = loadWorkspaceComponent();
  const html = renderToStaticMarkup(React.createElement(Workspace, workspaceProps({
    round: round('REGISTRATION_CLOSED'),
  })));
  assert.ok(html.includes(messages.thesis.grading.saveScore),
    'a live round still renders the score-save control');
  assert.ok(html.includes('<input'), 'a live round still renders the score input');
  const labelIdx = html.indexOf(rendered(messages.thesis.grading.finalizeButton));
  assert.ok(labelIdx > -1, 'a live round still renders the finalize action');
  const tag = html.slice(html.lastIndexOf('<button', labelIdx), html.indexOf('>', labelIdx) + 1);
  assert.match(tag, /data-disabled="no"/,
    'with every eligible DEFENSE score in, finalize stays enabled on a live round');
});

test('council workspace without a round prop behaves exactly like before', () => {
  const messages = loadMessages();
  const Workspace = loadWorkspaceComponent();
  const html = renderToStaticMarkup(React.createElement(Workspace, workspaceProps({})));
  assert.ok(html.includes(messages.thesis.grading.saveScore),
    'no round supplied keeps the score-save control');
  assert.ok(html.includes(rendered(messages.thesis.grading.finalizeButton)),
    'no round supplied keeps the finalize action');
});

// ---------- GvpbReviewPanel: a terminal round freezes the review form ----------

function reviewProps(overrides) {
  return {
    messages: loadMessages(),
    reviewTopics: [{ id: 'topic', title: 'Review topic', description: 'Topic under review', finalScore: null }],
    round: round('REGISTRATION_CLOSED'),
    gvpbScores: {},
    draftScores: { topic: '8.5' },
    draftComments: {},
    isActionPending: false,
    formatDateTime: (value) => String(value),
    onScoreDraftChange: () => {},
    onCommentDraftChange: () => {},
    onSubmit: () => {},
    ...overrides,
  };
}

test('a terminal round freezes the counter-review form behind the roundClosed copy', () => {
  const messages = loadMessages();
  const Panel = loadReviewPanel();
  let submitted = false;
  const html = renderToStaticMarkup(React.createElement(Panel, reviewProps({
    round: round('CANCELLED'),
    onSubmit: () => { submitted = true; },
  })));
  assert.ok(html.includes(messages.thesis.review.roundClosed),
    'the terminal-round locked message must render');
  assert.equal(html.includes(messages.thesis.review.deadlinePassed), false,
    'the lock reason is the ended round, not the deadline');
  assert.equal(html.includes('<input'), false, 'no score draft input may render');
  assert.equal(html.includes(messages.thesis.grading.saveScore), false,
    'no review submit control may render');
  assert.equal(submitted, false, 'rendering must not invoke the submit path');
});

test('a live round still renders the counter-review form', () => {
  const messages = loadMessages();
  const Panel = loadReviewPanel();
  const html = renderToStaticMarkup(React.createElement(Panel, reviewProps({})));
  assert.ok(html.includes('<input'), 'a live round renders the score input');
  assert.ok(html.includes(messages.thesis.grading.saveScore),
    'a live round renders the submit control');
  assert.equal(html.includes(messages.thesis.review.roundClosed), false,
    'the round-closed copy must not render for a live round');
});

function supervisedGroupProps(overrides) {
  return {
    messages: loadMessages(),
    title: 'Supervised groups',
    description: 'Groups under supervision',
    groups: [
      {
        id: 'group-1',
        roundId: 'round-1',
        topicId: null,
        status: 'DRAFT',
        approvalStatus: 'PENDING',
        rejectionReason: null,
        memberStudentIds: ['student-1'],
        members: [],
      },
      {
        id: 'group-2',
        roundId: 'round-1',
        topicId: 'topic-1',
        status: 'SUBMITTED',
        approvalStatus: 'PENDING',
        rejectionReason: null,
        memberStudentIds: [],
        members: [],
      },
    ],
    reportsByGroup: {},
    isActionPending: false,
    getTopicTitle: (topicId) => topicId ? 'Submitted group' : 'Topicless draft group',
    isRoundOpen: () => false,
    canReviewGroup: () => true,
    onGroupUpdated: () => {},
    onApprove: () => {},
    onReject: () => {},
    onDownloadReport: () => {},
    ...overrides,
  };
}

for (const status of ['CANCELLED', 'RESULTS_PUBLISHED', 'CLOSED']) {
  test(`supervised group review actions are hidden when the round is ${status}`, () => {
    const messages = loadMessages();
    const GroupList = loadSupervisedGroupList();
    const html = renderToStaticMarkup(React.createElement(GroupList, supervisedGroupProps({
      roundStatus: status,
    })));

    assert.ok(html.includes('Topicless draft group'), `${status}: the row remains readable`);
    assert.ok(html.includes('Submitted group'), `${status}: submitted rows remain readable`);
    assert.ok(html.includes('PENDING'), `${status}: the approval state remains readable`);
    assert.equal(html.includes(messages.thesis.approve), false,
      `${status}: the approve action must not render`);
    assert.equal(html.includes(messages.thesis.reject), false,
      `${status}: the reject action must not render`);
  });
}

test('supervised group review actions remain available in a registration-closed round', () => {
  const messages = loadMessages();
  const GroupList = loadSupervisedGroupList();
  const html = renderToStaticMarkup(React.createElement(GroupList, supervisedGroupProps({
    roundStatus: 'REGISTRATION_CLOSED',
  })));

  assert.ok(html.includes(messages.thesis.reject),
    'the topicless pending group can still be rejected before results are published');
  assert.ok(html.includes(messages.thesis.approve),
    'a submitted group can still be approved before results are published');
});
