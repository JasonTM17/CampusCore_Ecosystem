const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadModule(relativePath, aliases = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  Function('module', 'exports', 'require', js)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

const loginPortal = loadModule('src/lib/login-portal.ts');
const hubModules = loadModule('src/lib/hub-modules.ts');

const effects = [];
const pushes = [];
let authValue = null;

const fakeReact = {
  createContext: (value) => ({ value }),
  useContext: () => authValue,
  useState: (value) => [value, () => undefined],
  useEffect: (callback) => effects.push(callback),
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
  useRef: (value) => ({ current: value }),
};
fakeReact.default = fakeReact;

const authContext = loadModule('src/context/AuthContext.tsx', {
  react: fakeReact,
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') },
  'next/navigation': {
    useRouter: () => ({
      push: (href) => pushes.push(href),
      replace: (href) => pushes.push(href),
    }),
    usePathname: () => '/apply',
  },
  '@/i18n': { useI18n: () => ({ href: (pathname) => pathname }) },
  '@/lib/surfaces': { surfaceFromHost: () => null },
  '@/lib/api': {
    authApi: { me: async () => null, login: async () => null, logout: async () => null },
    refreshSessionSingleFlight: async () => undefined,
    waitForPendingSessionRefresh: async () => undefined,
    SessionVerificationError: class extends Error {},
  },
  '@/lib/two-factor': { isTwoFactorChallenge: () => false },
  '@/lib/session-hint': {
    clearLogoutInProgress() {},
    hasCsrfSessionHint: () => false,
    markLogoutInProgress() {},
    readCsrfSessionHint: () => null,
  },
  '@/lib/login-portal': loginPortal,
  '@/lib/query': { getBrowserQueryClient: () => ({ clear() {} }) },
  '@/lib/session-sync': {
    publishSessionChange() {},
    subscribeSessionChanges: () => () => undefined,
  },
});

/**
 * Runs the real useRequireAuth hook from AuthContext with a fake React runtime
 * and a controlled auth context. The returned effect is executed so redirects
 * are observed exactly as they would run after a render.
 */
function gate(user, requiredRoles, state = {}) {
  authValue = {
    user,
    isLoading: state.isLoading ?? false,
    isLoggingOut: state.isLoggingOut ?? false,
  };
  effects.length = 0;
  pushes.length = 0;
  const result = authContext.useRequireAuth(requiredRoles);
  for (const effect of effects) effect();
  return { ...result, redirects: [...pushes] };
}

const APPLICANT = { id: 'applicant-1', email: 'applicant@campuscore.edu', roles: [] };
const STUDENT = { id: 'student-1', email: 'student@campuscore.edu', roles: ['STUDENT'] };
const LECTURER = { id: 'lecturer-1', email: 'lecturer@campuscore.edu', roles: ['LECTURER'] };
const ADMIN = { id: 'admin-1', email: 'admin@campuscore.edu', roles: ['ADMIN'] };
const SUPER_ADMIN = { id: 'admin-2', email: 'admin2@campuscore.edu', roles: ['SUPER_ADMIN'] };

test('the /apply-style bare gate admits every authenticated identity, including a roleless applicant', () => {
  for (const user of [
    APPLICANT,
    STUDENT,
    LECTURER,
    ADMIN,
    SUPER_ADMIN,
    { id: 'dean-1', roles: ['TRUONG_KHOA'] },
    { id: 'head-1', roles: ['TRUONG_BO_MON'] },
  ]) {
    const result = gate(user);
    assert.equal(result.hasAccess, true, `bare gate must admit ${JSON.stringify(user.roles)}`);
    assert.equal(result.isForbidden, false);
    assert.deepEqual(result.redirects, []);
  }
});

test('the bare gate rejects an unauthenticated visitor with the login redirect', () => {
  const result = gate(null);

  assert.equal(result.hasAccess, false);
  assert.equal(result.isForbidden, false);
  assert.deepEqual(result.redirects, ['/login?portal=student&reason=session-expired']);
});

test('an applicant is denied every student-only surface and redirected away from it', () => {
  for (const requiredRoles of [['STUDENT'], ['LECTURER'], ['ADMIN'], ['STUDENT', 'LECTURER']]) {
    const result = gate(APPLICANT, requiredRoles);
    assert.equal(result.hasAccess, false, `applicant must not pass ${requiredRoles.join(',')}`);
    assert.equal(result.isForbidden, true);
    assert.equal(result.redirects.length, 1, 'a denied session is redirected somewhere');
  }
});

test('role-gated surfaces redirect each denied role to its own workspace', () => {
  const cases = [
    [STUDENT, ['LECTURER'], '/dashboard'],
    [LECTURER, ['STUDENT'], '/dashboard/lecturer'],
    [ADMIN, ['STUDENT'], '/admin'],
    [{ id: 'dean-1', roles: ['TRUONG_KHOA'] }, ['STUDENT'], '/dashboard/dean'],
    [{ id: 'head-1', roles: ['TRUONG_BO_MON'] }, ['STUDENT'], '/dashboard/thesis'],
  ];

  for (const [user, requiredRoles, target] of cases) {
    const result = gate(user, requiredRoles);
    assert.equal(result.hasAccess, false);
    assert.equal(result.isForbidden, true);
    assert.deepEqual(result.redirects, [target]);
  }
});

test('role matching is additive across multi-role accounts and treats SUPER_ADMIN as ADMIN', () => {
  assert.equal(gate(STUDENT, ['STUDENT']).hasAccess, true);
  assert.equal(gate(LECTURER, ['LECTURER']).hasAccess, true);
  assert.equal(gate(ADMIN, ['ADMIN']).hasAccess, true);
  assert.equal(gate(SUPER_ADMIN, ['ADMIN']).hasAccess, true);
  assert.equal(gate({ id: 'both', roles: ['STUDENT', 'LECTURER'] }, ['LECTURER']).hasAccess, true);
  assert.equal(
    gate({ id: 'both', roles: ['STUDENT', 'LECTURER'] }, ['STUDENT', 'LECTURER']).hasAccess,
    true,
  );
});

test('an exact SUPER_ADMIN or unknown role requirement fails closed for lesser roles', () => {
  assert.equal(gate(ADMIN, ['SUPER_ADMIN']).hasAccess, false);
  assert.equal(gate(STUDENT, ['SUPER_ADMIN']).hasAccess, false);
  assert.equal(gate({ id: 'unknown', roles: ['APPLICANT'] }, ['STUDENT']).hasAccess, false);
  assert.equal(gate({ id: 'lowercase', roles: ['student'] }, ['STUDENT']).hasAccess, false);
});

test('a missing or empty roles array is authenticated but carries no academic capability', () => {
  for (const user of [
    { id: 'no-roles' },
    { id: 'empty-roles', roles: [] },
    { id: 'legacy-role-only', role: 'STUDENT' },
  ]) {
    const bare = gate(user);
    assert.equal(bare.hasAccess, true, 'authentication alone opens the admissions surface');
    const studentOnly = gate(user, ['STUDENT']);
    assert.equal(studentOnly.hasAccess, false, 'no role claim must never infer a student capability');
    assert.equal(studentOnly.isForbidden, true);
  }
});

test('the resolving states never redirect or flag a forbidden page', () => {
  for (const state of [
    { isLoading: true },
    { isLoggingOut: true },
  ]) {
    const anonymous = gate(null, undefined, state);
    assert.equal(anonymous.hasAccess, false);
    assert.equal(anonymous.isForbidden, false);
    assert.deepEqual(anonymous.redirects, []);

    const applicant = gate(APPLICANT, ['STUDENT'], state);
    assert.equal(applicant.hasAccess, false);
    assert.equal(applicant.isForbidden, false);
    assert.deepEqual(applicant.redirects, []);
  }
});

test('the hub keeps the admissions entry public while hiding staff workspace entries from an applicant', () => {
  const publicEntries = hubModules.publicHubModules().map((entry) => entry.key);
  assert.ok(publicEntries.includes('admissions'));
  assert.ok(publicEntries.includes('news'));

  const applicantEntries = hubModules
    .workspaceHubModules({ signedIn: true, student: false, lecturer: false, admin: false })
    .map((entry) => entry.key);
  assert.equal(applicantEntries.includes('lecturer'), false);
  assert.equal(applicantEntries.includes('admin'), false);
  assert.equal(applicantEntries.includes('learning'), false);
  assert.equal(applicantEntries.includes('careers'), false);

  const studentEntries = hubModules
    .workspaceHubModules({ signedIn: true, student: true, lecturer: false, admin: false })
    .map((entry) => entry.key);
  assert.ok(studentEntries.includes('dashboard'));
  assert.ok(studentEntries.includes('careers'));

  const adminEntries = hubModules
    .workspaceHubModules({ signedIn: true, student: false, lecturer: false, admin: true })
    .map((entry) => entry.key);
  assert.ok(adminEntries.includes('admin'));
});

test('the applicant session carries only the admissions-granted surface, not an academic portal capability', () => {
  // The mobile capability lane mints admissions.self for a roleless applicant;
  // the web session has no equivalent applicant portal, so the roleless account
  // is deliberately not treated as a student or lecturer by the portal matcher.
  assert.deepEqual(loginPortal.userRoles({ roles: [] }), []);
  assert.equal(loginPortal.portalMatchesUser('student', APPLICANT), false);
  assert.equal(loginPortal.portalMatchesUser('lecturer', APPLICANT), false);
  assert.equal(loginPortal.portalMatchesUser('dean', APPLICANT), false);
  assert.equal(loginPortal.portalMatchesUser('admin', APPLICANT), false);
  assert.equal(loginPortal.portalMatchesUser('student', STUDENT), true);
  assert.equal(loginPortal.portalMatchesUser('lecturer', LECTURER), true);
  assert.equal(loginPortal.portalMatchesUser('admin', ADMIN), true);
  assert.equal(loginPortal.portalMatchesUser('admin', SUPER_ADMIN), true);
});
