const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// Same TypeScript transpile harness thesis-round-terminal-lock.test.js uses:
// modules render against stubbed imports so no browser or bundler is needed.
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

const Icon = (name) => {
  const component = () => React.createElement('svg', { 'data-icon': name });
  component.displayName = `Icon(${name})`;
  return component;
};

const uiStubs = {
  'lucide-react': {
    Check: Icon('check'),
    Clock3: Icon('clock'),
    FileText: Icon('file'),
    FileCheck: Icon('filecheck'),
    Minus: Icon('minus'),
    Info: Icon('info'),
    UsersRound: Icon('users'),
    Users: Icon('users'),
    ExternalLink: Icon('external'),
    FileDown: Icon('filedown'),
    Shield: Icon('shield'),
  },
  '@/components/ui/button': {
    Button: (props) => React.createElement('button', {
      type: 'button',
      'data-disabled': props.disabled ? 'yes' : 'no',
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
  '@/components/ui/link-button': { LinkButton: () => null },
  '@/components/ui/select': { Select: () => null },
  '@/components/ui/page-header': { PageHeader: () => null, SectionEyebrow: () => null },
  '@/components/ProtectedRoute': { WorkspaceForbiddenState: () => null },
  '@/components/ui/state-block': {
    ErrorState: (p) => React.createElement('div', { role: 'alert' }, p.title, p.description),
    EmptyState: () => null,
    LoadingState: () => null,
  },
  '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  '@/lib/plural': { countLabel: (count, singular, plural) => (count === 1 ? singular : plural) },
};

function loadMessagesModule() {
  return loadModule('src/i18n/messages.ts', {
    '@/i18n/config': {},
    '@/i18n/messages-thesis-workflow': loadModule('src/i18n/messages-thesis-workflow.ts'),
    '@/i18n/messages-dean-overview': loadModule('src/i18n/messages-dean-overview.ts'),
    '@/i18n/messages-content': loadModule('src/i18n/messages-content.ts'),
    '@/i18n/messages-attendance-geofence': loadModule('src/i18n/messages-attendance-geofence.ts'),
    '@/i18n/messages-teaching-pages': loadModule('src/i18n/messages-teaching-pages.ts'),
    '@/i18n/messages-admin-pages': loadModule('src/i18n/messages-admin-pages.ts'),
    '@/i18n/messages-student-pages': loadModule('src/i18n/messages-student-pages.ts'),
  });
}

// renderToStaticMarkup escapes '&' as '&amp;' — message copies must be
// asserted in their rendered form so negative checks are not tautological.
const rendered = (copy) => copy.replace(/&/g, '&amp;');
const occurrences = (html, needle) => html.split(needle).length - 1;

// ---------- rendered outcome card ----------

function loadOutcomeComponent() {
  return loadModule('src/features/thesis/components/ThesisResultOutcome.tsx', uiStubs).default;
}

// ---------- progress page rendered through stubbed hooks ----------

// renderToStaticMarkup never runs effects, so the page's three useState slots
// are pre-seeded: progress, progressLoading, progressError — in call order.
function reactWithStateQueue(values) {
  const queue = [...values];
  return Object.assign({}, React, {
    useState: () => [queue.shift(), () => {}],
    useEffect: () => {},
  });
}

function loadProgressPage(locale, progress) {
  const messagesModule = loadMessagesModule();
  const messages = locale === 'vi' ? messagesModule.vi : messagesModule.en;
  const workflow = loadModule('src/i18n/messages-thesis-workflow.ts');
  const round = {
    id: 'round-1',
    name: 'Disposition round',
    thesisType: 'KLTN',
    status: 'RESULTS_PUBLISHED',
  };
  return loadModule('src/components/dashboard/thesis/ThesisProgressPage.tsx', {
    ...uiStubs,
    react: reactWithStateQueue([progress, false, '']),
    '@/context/AuthContext': {
      useRequireAuth: () => ({
        user: { roles: ['STUDENT'] },
        isLoading: false,
        hasAccess: true,
        isForbidden: false,
      }),
    },
    '@/i18n': { useI18n: () => ({ locale, messages }) },
    '@/i18n/messages-thesis-workflow': workflow,
    '@/lib/thesis-api': { thesisApi: {} },
    './useThesisWorkspace': {
      useThesisWorkspace: () => ({
        selectedRound: round,
        selectedRoundId: round.id,
        rounds: [round],
        isLoading: false,
        error: '',
        setSelectedRoundId: () => {},
        reload: async () => {},
        statusLabel: (status) => status,
      }),
    },
  }).default;
}

const ALL_MILESTONES = [
  'ROUND_SELECTED',
  'GROUP_CREATED',
  'TOPIC_ASSIGNED',
  'GROUP_APPROVED',
  'REPORT_SUBMITTED',
  'COUNCIL_ASSIGNED',
  'SCORE_FINALIZED',
  'RESULTS_PUBLISHED',
];

function notQualifiedProgress() {
  return {
    roundId: 'round-1',
    roundStatus: 'RESULTS_PUBLISHED',
    participationState: 'PARTICIPATING',
    currentMilestone: 'RESULTS_PUBLISHED',
    completedMilestones: [
      'ROUND_SELECTED',
      'GROUP_CREATED',
      'TOPIC_ASSIGNED',
      'GROUP_APPROVED',
      'REPORT_SUBMITTED',
      'RESULTS_PUBLISHED',
    ],
    skippedMilestones: ['COUNCIL_ASSIGNED', 'SCORE_FINALIZED'],
    attentionState: 'NOT_QUALIFIED',
    memberCount: 4,
    topicId: 'topic-1',
    topicTitle: 'Not qualified topic',
    groupId: 'group-1',
    groupStatus: 'APPROVED',
    finalScore: null,
    finalScoreFinalizedAt: null,
    resultStatus: 'NOT_QUALIFIED',
    resultReason: 'GVPB_BELOW_THRESHOLD',
    resultResolvedAt: '2026-06-01T00:00:00.000Z',
  };
}

// ---------- council workspace / review panel loaders (same as terminal-lock) ----------

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
    '@/lib/use-now': { useNow: () => Date.now() },
  }).default;
}

const liveRound = (status = 'REGISTRATION_CLOSED') => ({
  id: 'round-1',
  name: 'Live round',
  thesisType: 'KLTN',
  registrationStart: '2026-01-01T00:00:00.000Z',
  registrationEnd: '2026-02-01T00:00:00.000Z',
  lecturerSubmitStart: '2025-12-01T00:00:00.000Z',
  lecturerSubmitEnd: '2025-12-31T00:00:00.000Z',
  gvpbDeadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  status,
});

// ===================== rendered NOT_QUALIFIED outcomes =====================

test('the outcome card renders the explicit outcome in both locales with no score copy', () => {
  const messages = loadMessagesModule();
  const Outcome = loadOutcomeComponent();
  for (const locale of ['en', 'vi']) {
    const copy = (locale === 'vi' ? messages.vi : messages.en).thesis.results.notQualified;
    const html = renderToStaticMarkup(React.createElement(Outcome, { label: copy }));
    assert.ok(html.includes(copy), `${locale}: the outcome line renders verbatim`);
    assert.equal(html.includes((locale === 'vi' ? messages.vi : messages.en).thesis.results.finalScore), false,
      `${locale}: no score label renders beside the outcome`);
  }
});

test('progress page renders a not-qualified outcome with neutral skipped steps (vi)', () => {
  const messages = loadMessagesModule();
  const Page = loadProgressPage('vi', notQualifiedProgress());
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.ok(html.includes(messages.vi.thesis.results.notQualified),
    'the explicit outcome must be visible on the progress timeline');
  assert.equal(occurrences(html, messages.vi.thesis.milestoneNotApplicable), 2,
    'each skipped milestone shows the not-applicable label');
  assert.equal(occurrences(html, 'data-icon="minus"'), 2,
    'skipped milestones keep a neutral marker');
  assert.equal(occurrences(html, 'data-icon="check"'), 6,
    'only reached milestones keep the completed check — skipped steps never go green');
  assert.equal(html.includes('RESULT_NOT_AVAILABLE'), false,
    'a valid disposition never renders the not-available fallback');
});

test('progress page renders a not-qualified outcome with neutral skipped steps (en)', () => {
  const messages = loadMessagesModule();
  const Page = loadProgressPage('en', notQualifiedProgress());
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.ok(html.includes(messages.en.thesis.results.notQualified),
    'the explicit outcome must be visible on the progress timeline');
  assert.equal(occurrences(html, messages.en.thesis.milestoneNotApplicable), 2,
    'each skipped milestone shows the not-applicable label');
  assert.equal(occurrences(html, 'data-icon="minus"'), 2);
  assert.equal(occurrences(html, 'data-icon="check"'), 6);
});

test('graded progress keeps green completion and no not-applicable labels', () => {
  const Page = loadProgressPage('en', {
    ...notQualifiedProgress(),
    currentMilestone: 'RESULTS_PUBLISHED',
    completedMilestones: [...ALL_MILESTONES],
    skippedMilestones: [],
    attentionState: 'NONE',
    finalScore: 8.5,
    finalScoreFinalizedAt: '2026-06-01T00:00:00.000Z',
    resultStatus: 'GRADED',
    resultReason: null,
    resultResolvedAt: '2026-06-01T00:00:00.000Z',
  });
  const messages = loadMessagesModule();
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.equal(occurrences(html, 'data-icon="check"'), 8,
    'a graded result marks every milestone completed');
  assert.equal(occurrences(html, 'data-icon="minus"'), 0);
  assert.equal(occurrences(html, messages.en.thesis.milestoneNotApplicable), 0);
  assert.equal(html.includes(messages.en.thesis.results.notQualified), false,
    'a graded result never shows the not-qualified outcome');
});

// ===================== grading-control suppression =====================

function workspaceProps(overrides) {
  return {
    messages: loadMessagesModule().en,
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
    topics: [{ id: 'topic', title: 'Topic', finalScore: null, resultStatus: 'NOT_QUALIFIED' }],
    lecturers: [],
    councilScores: {
      'council:topic': [
        { lecturerId: 'chair', component: 'DEFENSE', score: 8 },
        { lecturerId: 'member-2', component: 'DEFENSE', score: 8 },
        { lecturerId: 'member-3', component: 'DEFENSE', score: 8 },
      ],
    },
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

test('council workspace suppresses grading controls on a resolved not-qualified topic', () => {
  const messages = loadMessagesModule();
  const Workspace = loadWorkspaceComponent();
  const html = renderToStaticMarkup(React.createElement(Workspace, workspaceProps({
    round: liveRound('REGISTRATION_CLOSED'),
  })));
  assert.equal(html.includes('<input'), false,
    'a resolved outcome must not render a score input');
  assert.equal(html.includes(messages.en.thesis.grading.saveScore), false,
    'a resolved outcome must not render the save-score control');
  assert.equal(html.includes(rendered(messages.en.thesis.grading.finalizeButton)), false,
    'a resolved outcome must not render the finalize action');
  assert.ok(html.includes(messages.en.thesis.results.notQualified),
    'the resolved outcome is labelled for staff');
});

function reviewProps(overrides) {
  return {
    messages: loadMessagesModule().en,
    reviewTopics: [{
      id: 'topic',
      title: 'Review topic',
      description: 'Topic under review',
      finalScore: null,
      resultStatus: 'NOT_QUALIFIED',
    }],
    round: liveRound('REGISTRATION_CLOSED'),
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

test('the counter-review panel freezes a resolved not-qualified topic', () => {
  const messages = loadMessagesModule();
  const Panel = loadReviewPanel();
  const html = renderToStaticMarkup(React.createElement(Panel, reviewProps({})));
  assert.equal(html.includes('<input'), false, 'no score input may render');
  assert.equal(html.includes(messages.en.thesis.grading.saveScore), false,
    'no submit control may render');
  assert.ok(html.includes(messages.en.thesis.results.notQualified),
    'the resolved outcome is shown instead of the grading form');
});

test('the counter-review panel still offers the form for an unresolved topic', () => {
  const messages = loadMessagesModule();
  const Panel = loadReviewPanel();
  const html = renderToStaticMarkup(React.createElement(Panel, reviewProps({
    reviewTopics: [{
      id: 'topic', title: 'Review topic', description: 'Topic under review', finalScore: null,
    }],
  })));
  assert.ok(html.includes('<input'), 'an unresolved topic keeps the score input');
  assert.ok(html.includes(messages.en.thesis.grading.saveScore),
    'an unresolved topic keeps the submit control');
});

// ===================== contract shape =====================

const apiSource = read('src/lib/thesis-api.ts');

test('the API types carry the nullable score and the disposition fields', () => {
  const roundResult = apiSource.match(/interface ThesisRoundResult \{[\s\S]*?\n\}/);
  assert.ok(roundResult, 'ThesisRoundResult exists');
  assert.match(roundResult[0], /finalScore: number \| null/,
    'a published result may carry no numeric score');
  for (const field of ['resultStatus', 'resultReason', 'resultResolvedAt']) {
    assert.match(roundResult[0], new RegExp(`${field}\\?:`), `ThesisRoundResult.${field} is optional-additive`);
  }
  const topic = apiSource.match(/interface ThesisTopic \{[\s\S]*?\n\}/);
  assert.ok(topic, 'ThesisTopic exists');
  for (const field of ['resultStatus', 'resultReason', 'resultResolvedAt']) {
    assert.match(topic[0], new RegExp(`${field}\\?:`), `ThesisTopic.${field} is optional-additive`);
  }
  const progress = apiSource.match(/interface ThesisProgressResponse \{[\s\S]*?\n\}/);
  assert.ok(progress, 'ThesisProgressResponse exists');
  assert.match(progress[0], /'NOT_QUALIFIED'/, 'the attention union accepts the outcome');
  for (const field of ['resultStatus', 'resultReason', 'resultResolvedAt', 'skippedMilestones']) {
    assert.match(progress[0], new RegExp(`${field}\\?:`), `ThesisProgressResponse.${field} is optional-additive`);
  }
});

// ===================== finalScore consumers stay null-safe =====================

const CONSUMER_FILES = [
  'src/app/dashboard/thesis/page.tsx',
  'src/app/admin/thesis/page.tsx',
  'src/features/thesis/components/CouncilDefenseWorkspace.tsx',
  'src/features/thesis/components/GvpbReviewPanel.tsx',
  'src/components/dashboard/thesis/ThesisProgressPage.tsx',
];

// A "value use" renders, formats or does arithmetic on a possibly-null score:
// JSX interpolation, String()/formatting helpers and arithmetic operators.
const VALUE_USE = /\{[^{}]*\bfinalScore\b[^{}]*\}|String\([^)]*\bfinalScore\b|\bfinalScore\s*\.\s*(toFixed|toPrecision|toLocaleString)|\bfinalScore\s*[*/+-]/gi;
// Tokens that prove the site already null-checks the value in scope.
const GUARD = /!= null|== null|\?\?|\?\.|!==? undefined|isFinalized|NOT_QUALIFIED|isFiniteScore|Number\.isFinite/;

test('no consumer divides, formats or renders a possibly-null finalScore without a guard', () => {
  for (const file of CONSUMER_FILES) {
    const source = read(file);
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(VALUE_USE)) {
        const context = lines.slice(Math.max(0, index - 40), index + 1).join('\n');
        assert.ok(
          GUARD.test(context),
          `${file}:${index + 1} renders "${match[0].trim()}" with no null guard in scope`,
        );
      }
    });
  }
});

test('the student result row keeps the outcome and the score in separate branches', () => {
  const source = read('src/app/dashboard/thesis/page.tsx');
  const outcomeIdx = source.indexOf("result.resultStatus === 'NOT_QUALIFIED'");
  assert.ok(outcomeIdx > -1, 'the result row branches on the resolved outcome');
  const scoreIdx = source.indexOf('{result.finalScore}');
  assert.ok(scoreIdx > outcomeIdx,
    'the numeric score renders only in the non-qualified branch');
  const outcomeComponent = source.indexOf('ThesisResultOutcome');
  assert.ok(outcomeComponent > -1,
    'the published non-graded outcome card renders on the student workspace');
  assert.match(source, /studentFinalScore != null && studentGradeInfo && \(/,
    'the graded hero card stays behind its numeric gate');
  assert.match(source, /topic\.finalScore != null \|\| topic\.resultStatus != null/,
    'a resolved outcome counts as topic history');
});

test('the admin workspace excludes resolved topics from council assignment', () => {
  const source = read('src/app/admin/thesis/page.tsx');
  const filter = source.match(/assignableTopics = topics\.filter\(\s*\(t\) =>[\s\S]*?\)\s*\)/);
  assert.ok(filter, 'the assignable-topics filter exists');
  assert.match(filter[0], /t\.finalScore == null/, 'unscored topics stay eligible');
  assert.match(filter[0], /t\.resultStatus == null/, 'a resolved topic is never offered');
});

// ===================== copy: parity and publish explanation =====================

test('the outcome and skipped-step copy exist in both locales', () => {
  const messages = loadMessagesModule();
  const en = messages.en.thesis;
  const vi = messages.vi.thesis;
  assert.equal(en.results.notQualified, 'Not eligible for defense — counter-review score below 5.0');
  assert.equal(vi.results.notQualified, 'Không đủ điều kiện bảo vệ — điểm phản biện dưới 5,0');
  assert.equal(en.milestoneNotApplicable, 'Not applicable');
  assert.equal(vi.milestoneNotApplicable, 'Không áp dụng');
});

test('the publish-results explanation warns about the below-threshold resolution', () => {
  const messages = loadMessagesModule();
  const en = messages.en.thesis.admin.transitionConfirm.publishResults;
  const vi = messages.vi.thesis.admin.transitionConfirm.publishResults;
  assert.match(en, /below 5\.0/, 'the English confirm names the threshold');
  assert.match(en, /not eligible for defense/i, 'the English confirm names the outcome');
  assert.match(vi, /dưới 5,0/, 'the Vietnamese confirm names the threshold');
  assert.match(vi, /không đủ điều kiện bảo vệ/i, 'the Vietnamese confirm names the outcome');
});
