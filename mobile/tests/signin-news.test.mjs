import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

import { loadTs } from './helpers/load-ts.mjs';

const rules = await loadTs('src/screens/content/content-rules.ts');
const rich = await loadTs('src/screens/content/rich-text.ts');
const locale = await loadTs('src/i18n/locale.ts');

const { newsHighlights, isUrgentPriority, newsCategoryLabel, newsTargetOf } = rules;
const { summaryOrExcerpt, excerptOf } = rich;
const { formatDate } = locale;

test('newsHighlights shapes the feed as a lead article plus follow-up rows', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }];
  assert.deepEqual(newsHighlights([], 5), { featured: null, rest: [] });
  assert.deepEqual(newsHighlights([items[0]], 5), { featured: items[0], rest: [] });
  assert.deepEqual(newsHighlights(items, 5), { featured: items[0], rest: items.slice(1, 5) });
  assert.deepEqual(newsHighlights(items.slice(0, 3), 5), { featured: items[0], rest: items.slice(1, 3) });
  // A zero cap shows nothing, and the input array is never mutated.
  assert.deepEqual(newsHighlights(items, 0), { featured: null, rest: [] });
  assert.equal(items.length, 6);
});

test('isUrgentPriority only honours the server URGENT code', () => {
  assert.equal(isUrgentPriority('URGENT'), true);
  assert.equal(isUrgentPriority('HIGH'), false);
  assert.equal(isUrgentPriority('NORMAL'), false);
  assert.equal(isUrgentPriority('urgent'), false);
  assert.equal(isUrgentPriority(null), false);
  assert.equal(isUrgentPriority(undefined), false);
});

test('newsCategoryLabel normalizes server ids to the UPPER_SNAKE label keys', () => {
  const labels = { STUDENT_LIFE: 'Đời sống Sinh viên', ACADEMIC_AFFAIRS: 'Học vụ' };
  assert.equal(newsCategoryLabel(labels, 'student-life'), 'Đời sống Sinh viên');
  assert.equal(newsCategoryLabel(labels, 'STUDENT_LIFE'), 'Đời sống Sinh viên');
  assert.equal(newsCategoryLabel(labels, 'student life'), 'Đời sống Sinh viên');
  assert.equal(newsCategoryLabel(labels, ' academic_affairs '), 'Học vụ');
  // Unknown or missing ids never render a pill.
  assert.equal(newsCategoryLabel(labels, 'SPORTS'), '');
  assert.equal(newsCategoryLabel(labels, null), '');
  assert.equal(newsCategoryLabel(labels, '   '), '');
});

test('newsTargetOf prefers the permalink slug and falls back to the id', () => {
  assert.equal(newsTargetOf({ id: '42', slug: 'lich-thi-cuoi-ky' }), 'lich-thi-cuoi-ky');
  assert.equal(newsTargetOf({ id: '42' }), '42');
  assert.equal(newsTargetOf({ id: '42', slug: null }), '42');
});

test('summaryOrExcerpt prefers the authored summary and falls back to the body', () => {
  assert.equal(summaryOrExcerpt({ summary: 'Sapo ngắn', content: '<p>Dài hơn</p>' }), 'Sapo ngắn');
  assert.equal(summaryOrExcerpt({ summary: '  ', content: '<p>Đoạn đầu</p><p>Đoạn hai</p>' }), 'Đoạn đầu');
  assert.equal(summaryOrExcerpt({ content: '<p>Đoạn đầu</p><p>Đoạn hai</p>' }), 'Đoạn đầu');
  assert.equal(summaryOrExcerpt({}), '');
  // HTML never reaches the teaser and a long body is truncated with an ellipsis.
  const long = { content: `<p>${'x'.repeat(200)}</p>` };
  assert.equal(summaryOrExcerpt(long, 50).length, 50);
  assert.ok(summaryOrExcerpt(long, 50).endsWith('…'));
  assert.equal(excerptOf('<p>Hello <b>world</b></p>'), 'Hello world');
});

test('formatDate localizes publish dates and degrades invalid input quietly', () => {
  assert.equal(formatDate('2026-10-20', 'vi'), '20/10/2026');
  assert.equal(formatDate('2026-10-20', 'en'), '10/20/2026');
  assert.equal(formatDate('not-a-date', 'vi'), '—');
  assert.equal(formatDate(undefined, 'vi'), '—');
});

// Execute the screen's actual handler with isolated native/service boundaries.
const screenSource = fs.readFileSync(new URL('../src/screens/auth/SignInScreen.tsx', import.meta.url), 'utf8');
const screenAst = ts.createSourceFile('SignInScreen.tsx', screenSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(screenAst) === 'handleSignIn') handler = node.initializer.getText(screenAst);
  ts.forEachChild(node, visit);
}
visit(screenAst);
const handlerJs = ts.transpileModule(`const handle = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const makeHandler = new Function('deps', `const {setError,setIsSubmitting,signInWithOidc,sessionStoreIssuer,sessionStore,session,navigation,copy,signInFlight}=deps; ${handlerJs}; return handle;`);

function signinHarness(overrides = {}) {
  const errors = [];
  const blocked = [];
  const completed = [];
  const deps = {
    setError: (value) => errors.push(value), setIsSubmitting: () => {},
    signInWithOidc: async () => ({ kind: 'signedIn', role: 'student', accountId: 'user', refreshToken: 'synthetic', accessToken: 'synthetic' }),
    sessionStoreIssuer: () => 'https://issuer.test',
    sessionStore: { bumpEpoch() {}, saveRefresh: async () => {}, setAccessToken() {}, sessionEpoch: () => 1 },
    session: { markBlocked: (value) => blocked.push(value) },
    navigation: { completeSignIn: (...args) => completed.push(args) },
    copy: { unreachable: 'network', storage: 'storage', invalid: 'validation' },
    signInFlight: { current: false },
    ...overrides,
  };
  return { run: makeHandler(deps), errors, blocked, completed };
}

test('sign-in storage failure is distinct from issuer transport failure', async () => {
  const storage = signinHarness({ sessionStore: { bumpEpoch() {}, sessionEpoch: () => 1, saveRefresh: async () => { throw new Error('private storage detail'); } } });
  await storage.run();
  assert.equal(storage.errors.at(-1), 'storage');
  assert.equal(storage.completed.length, 0);
  const network = signinHarness({ signInWithOidc: async () => { throw new Error('private transport detail'); } });
  await network.run();
  assert.equal(network.errors.at(-1), 'network');
});

test('sign-in validation failure never exposes raw provider text', async () => {
  const validation = signinHarness({ signInWithOidc: async () => ({ kind: 'blocked', reason: 'private provider text' }) });
  await validation.run();
  assert.equal(validation.errors.at(-1), 'validation');
  assert.equal(validation.blocked.length, 0);
  assert.equal(validation.completed.length, 0);
});

test('one sign-in attempt cannot be duplicated while the browser is pending', async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const view = signinHarness({ signInWithOidc: () => { calls++; return pending; } });
  const first = view.run();
  const second = view.run();
  release({ kind: 'cancelled' });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(view.completed.length, 0);
});

test('sign-out while the browser is pending invalidates that sign-in attempt', async () => {
  let epoch = 1;
  let release;
  let writes = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const view = signinHarness({
    signInWithOidc: () => pending,
    sessionStore: { sessionEpoch: () => epoch, bumpEpoch: () => { epoch++; }, saveRefresh: async () => { writes++; }, setAccessToken() {} },
  });
  const signin = view.run();
  epoch++;
  release({ kind: 'signedIn', role: 'student', accountId: 'old-account' });
  await signin;
  assert.equal(writes, 0);
  assert.equal(view.completed.length, 0);
});
