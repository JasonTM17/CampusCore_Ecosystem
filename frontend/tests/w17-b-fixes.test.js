const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTsModule(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, require);
  return moduleRecord.exports;
}

/** Extract the notification resolver plus its type map and run it with the
 *  real safe-url helper injected. */
function loadNotificationResolver(relativePath) {
  const source = read(relativePath);
  const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let resolver;
  let typeMap;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(tree) === 'resolveNotificationTarget') {
      resolver = node;
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'NOTIFICATION_TYPE_TARGETS') {
      typeMap = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(resolver, `${relativePath} declares resolveNotificationTarget`);
  assert.ok(typeMap, `${relativePath} declares NOTIFICATION_TYPE_TARGETS`);

  const code = [
    `const ${typeMap.getText(tree)};`,
    resolver.getText(tree),
    'module.exports = { resolveNotificationTarget };',
  ].join('\n');
  const output = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const { safeInternalPath } = loadTsModule('src/lib/safe-url.ts');
  Function('module', 'exports', 'safeInternalPath', output)(
    moduleRecord,
    moduleRecord.exports,
    safeInternalPath,
  );
  return moduleRecord.exports.resolveNotificationTarget;
}

test('safeInternalPath accepts only single-slash internal paths', () => {
  const { safeInternalPath } = loadTsModule('src/lib/safe-url.ts');

  assert.equal(safeInternalPath('/dashboard'), '/dashboard');
  assert.equal(safeInternalPath('/dashboard/notifications?tab=unread'), '/dashboard/notifications?tab=unread');
  assert.equal(safeInternalPath('  /dashboard/grades  '), '/dashboard/grades', 'the trimmed path is returned');

  const attacks = [
    '//evil.example/login',
    '/\\evil.example',
    '/\\evil.example/path',
    '\\\\evil.example',
    '/foo\\bar',
    '/foo bar',
    '/foo\nbar',
    '/dashboard\u0000',
    '/%2f%2fevil.example',
    '/%2F%2Fevil.example',
    '/%5cevil.example',
    '/%5Cevil.example',
    '/redirect?next=https://evil.example',
    'https://evil.example',
    'http://evil.example',
    'javascript:alert(1)',
    'dashboard',
    '',
    '   ',
  ];
  for (const value of attacks) {
    assert.equal(safeInternalPath(value), null, `${JSON.stringify(value)} must be rejected`);
  }

  for (const value of [null, undefined, 42, {}, [], true]) {
    assert.equal(safeInternalPath(value), null, `${String(value)} is not a path`);
  }
});

test('admin notification link validation uses the shared safe-path guard', () => {
  const source = read('src/app/admin/notifications/page.tsx');
  assert.match(source, /import \{ safeInternalPath \} from '@\/lib\/safe-url'/);
  assert.match(
    source,
    /const linkValid = trimmedLink === '' \|\| safeInternalPath\(trimmedLink\) !== null;/,
  );
});

test('notification center falls back when a stored link is unsafe', () => {
  const resolve = loadNotificationResolver('src/components/dashboard/NotificationsCenterPage.tsx');
  assert.match(read('src/components/dashboard/NotificationsCenterPage.tsx'), /import \{ safeInternalPath \} from '@\/lib\/safe-url'/);

  assert.equal(resolve({ link: '/dashboard/grades' }), '/dashboard/grades');
  assert.equal(resolve({ link: '//evil.example', type: 'REGISTRATION' }), '/dashboard/register');
  assert.equal(resolve({ link: '/\\evil.example', type: 'SCHEDULE' }), '/dashboard/schedule');
  assert.equal(resolve({ link: '/%2f%2fevil.example', type: 'REGISTRATION' }), '/dashboard/register');
  assert.equal(resolve({ link: 'https://evil.example' }), '/dashboard');
  assert.equal(resolve({ link: '//evil.example' }), '/dashboard');
});

test('dashboard bell falls back when a stored link is unsafe', () => {
  const resolve = loadNotificationResolver('src/app/dashboard/layout.tsx');
  assert.match(read('src/app/dashboard/layout.tsx'), /import \{ safeInternalPath \} from '@\/lib\/safe-url'/);

  assert.equal(resolve({ link: '/dashboard/schedule' }), '/dashboard/schedule');
  assert.equal(resolve({ link: '//evil.example', type: 'REGISTRATION' }), '/dashboard/register');
  assert.equal(resolve({ link: '/\\evil.example' }), '/dashboard/notifications');
  assert.equal(resolve({ link: '/%5cevil.example', type: 'SCHEDULE' }), '/dashboard/schedule');
  assert.equal(resolve({ link: 'javascript:alert(1)' }), '/dashboard/notifications');
});

test('admin recipient search ignores stale responses and re-searches on Enter', () => {
  const source = read('src/app/admin/notifications/page.tsx');
  assert.match(source, /const recipientSearchRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+recipientSearchRequestRef\.current/);
  assert.equal(
    (source.match(/if \(recipientSearchRequestRef\.current !== requestId\) return;/g) || []).length,
    2,
    'success and failure paths both check freshness',
  );
  assert.doesNotMatch(source, /if \(!term \|\| recipientSearching\)/);
  assert.match(source, /const handleRecipientInputChange = \(value: string\) => \{/);
  assert.match(source, /onChange=\{\(event\) => handleRecipientInputChange\(event\.target\.value\)\}/);
  assert.match(source, /recipientSearchRequestRef\.current \+= 1/);
});

test('admin recipient search discloses truncation and suggests refining', () => {
  const source = read('src/app/admin/notifications/page.tsx');
  assert.match(source, /const \[recipientTotal, setRecipientTotal\] = useState\(0\)/);
  assert.match(source, /response\.meta\?\.total/);
  assert.match(source, /recipientTotal > recipientResults\.length/);

  const messages = read('src/i18n/messages.ts');
  assert.equal(
    (messages.match(/recipientRefineHint:/g) || []).length,
    2,
    'the refine hint is localized in English and Vietnamese',
  );
});

test('notification type radios show a visible focus ring', () => {
  const source = read('src/app/admin/notifications/page.tsx');
  assert.match(source, /focus-within:ring-2 focus-within:ring-ring/);
});

test('admin thesis round validation is shown inside the modal', () => {
  const source = read('src/app/admin/thesis/page.tsx');
  assert.match(source, /const \[roundFormError, setRoundFormError\] = useState\(''\)/);

  const createRound = source.slice(
    source.indexOf('const createRound = async'),
    source.indexOf('const transitionRound = async'),
  );
  assert.match(createRound, /setRoundFormError\(messages\.thesis\.admin\.createIncomplete\)/);
  assert.doesNotMatch(createRound, /setError\(messages\.thesis\.admin\.createIncomplete\)/);

  const updateRound = source.slice(
    source.indexOf('const updateRound = async'),
    source.indexOf('const cancelRound = async'),
  );
  assert.match(updateRound, /setRoundFormError\(messages\.thesis\.admin\.createIncomplete\)/);
  assert.doesNotMatch(updateRound, /setError\(messages\.thesis\.admin\.createIncomplete\)/);

  const createModal = source.slice(
    source.indexOf('isOpen={showCreateModal}'),
    source.indexOf('{/* Create Council Modal */}'),
  );
  assert.match(createModal, /roundFormError/);
  const editModal = source.slice(
    source.indexOf('isOpen={showEditRoundModal}'),
    source.indexOf('{/* Assign Topic Modal */}'),
  );
  assert.match(editModal, /roundFormError/);
});

test('admin thesis council block waits for detail before offering create', () => {
  const source = read('src/app/admin/thesis/page.tsx');
  assert.match(source, /disabled=\{detailLoading \|\| Boolean\(loadError\)\}/);
  assert.match(
    source,
    /\{detailLoading \? \([\s\S]*?\) : loadError \? null : councils\.length === 0 \? \(/,
    'the empty state waits for the detail load and a load failure',
  );
});

test('admin thesis mutation success is not turned into a failure by a refresh error', () => {
  const source = read('src/app/admin/thesis/page.tsx');
  assert.match(source, /const refreshCouncils = async \(roundId: string\)/);

  const refresh = source.slice(
    source.indexOf('const refreshCouncils = async'),
    source.indexOf('const handleCreateCouncil'),
  );
  assert.match(refresh, /catch \{/);
  assert.match(refresh, /setCouncilRefreshError\(messages\.thesis\.loadFailed\)/);

  const create = source.slice(
    source.indexOf('const handleCreateCouncil'),
    source.indexOf('const handleAddMember'),
  );
  assert.doesNotMatch(create, /thesisApi\.listCouncils/, 'the create mutation no longer refreshes inside its catch');
  assert.match(create, /await refreshCouncils\(roundId\)/);

  const addMember = source.slice(
    source.indexOf('const handleAddMember'),
    source.indexOf('const handleRemoveMember'),
  );
  assert.doesNotMatch(addMember, /thesisApi\.listCouncils/);
  assert.match(addMember, /await refreshCouncils\(roundId\)/);

  const removeMember = source.slice(
    source.indexOf('const handleRemoveMember'),
    source.indexOf('const handleAssignTopic'),
  );
  assert.doesNotMatch(removeMember, /thesisApi\.listCouncils/);
  assert.match(removeMember, /await refreshCouncils\(roundId\)/);

  const assignTopic = source.slice(
    source.indexOf('const handleAssignTopic'),
    source.indexOf('const toggleExpand'),
  );
  assert.doesNotMatch(assignTopic, /thesisApi\.listCouncils/);
  assert.match(assignTopic, /await refreshCouncils\(roundId\)/);
});

test('attendance save ignores completion after the selection changed', () => {
  const source = read('src/app/dashboard/lecturer/attendance/page.tsx');
  assert.match(source, /const saveSelectionRef = useRef\(0\)/);
  assert.match(source, /const saveGeneration = \+\+saveSelectionRef\.current/);
  assert.match(source, /saveSelectionRef\.current === saveGeneration/);
  assert.match(source, /selectionRef\.current\.sectionId === savedSectionId/);
  assert.match(source, /selectionRef\.current\.date === savedDate/);

  assert.match(
    source,
    /onChange=\{\(e\) => handleSemesterChange\(e\.target\.value\)\}\s+className="w-full"\s+disabled=\{isSaving\}/,
  );
  assert.match(source, /disabled=\{isSaving \|\| isLoadingSections \|\| sections\.length === 0\}/);
  assert.match(
    source,
    /onChange=\{\(e\) => handleDateChange\(e\.target\.value\)\}\s+className="w-full"\s+disabled=\{isSaving\}/,
  );
});

test('projector replaces an expired code when a rotation fetch fails', () => {
  const source = read('src/components/lecturer/ProjectorCodeOverlay.tsx');
  assert.match(source, /setCode\(null\);\s*setCodeFailed\(true\);/);
  assert.doesNotMatch(source, /codeFailed && !code/);
  assert.match(source, /\) : codeFailed \? \(/);
});

test('grade import file picker is keyboard reachable', () => {
  const source = read('src/components/lecturer/GradeImportPanel.tsx');
  assert.doesNotMatch(source, /className="hidden"/);
  assert.match(source, /className="sr-only"/);
  assert.match(source, /focus-within:ring-2 focus-within:ring-ring/);
});

test('lecturer schedule surfaces a semester load failure with retry', () => {
  const source = read('src/app/dashboard/lecturer/schedule/page.tsx');
  assert.match(source, /const \[semesterError, setSemesterError\] = useState\(''\)/);
  assert.match(source, /setSemesterError\(messages\.lecturerGrades\.errors\.semestersFailed\)/);
  assert.match(source, /onClick=\{\(\) => void fetchSemesters\(\)\}/);
  assert.match(source, /role="alert"/);
});
