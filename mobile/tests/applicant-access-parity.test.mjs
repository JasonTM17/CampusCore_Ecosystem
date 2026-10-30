import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(mobileRoot, 'package.json'));

/**
 * Applicant-session parity: a roleless authenticated account whose access
 * token carries the issuer-minted `capabilities: ["admissions:self"]` grant
 * signs in, lands on SELF admissions, and is denied every other surface —
 * without any academic role, permission, or principal change. The pure
 * modules are transpiled and really executed; React/expo seams are stubbed,
 * the same convention as role-capabilities.test.mjs.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-applicant-'));
const url = (name) => pathToFileURL(path.join(tmp, `${name}.mjs`)).href;

function transpile(name, file, { jsx = false, map = {} } = {}) {
  const src = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
    fileName: file,
  });
  const rewritten = outputText.replace(/from (['"])([^'"]+)\1/g, (whole, quote, spec) => {
    const target = map[spec];
    return target ? `from ${quote}${target}${quote}` : whole;
  });
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), rewritten);
}

for (const [name, file] of [
  ['lane-flags', 'src/config/lane-flags.ts'],
  ['features', 'src/config/features.ts'],
  ['query-cache', 'src/hooks/query-cache.ts'],
  ['capabilities', 'src/auth/capabilities.ts'],
  ['oidc-core', 'src/auth/oidc-core.ts'],
]) {
  transpile(name, file);
}
const navMap = { '../auth/capabilities': url('capabilities'), './routes': url('routes') };
transpile('routes', 'src/navigation/routes.ts', { map: navMap });

const { LANES_OFF } = await import(url('lane-flags'));
const capabilities = await import(url('capabilities'));
const routes = await import(url('routes'));
const oidcCore = await import(url('oidc-core'));
const queryCache = await import(url('query-cache'));

const {
  ADMISSIONS_SELF_CLAIM,
  APPLICANT_UI_ROLE,
  NO_CAPABILITIES,
  capabilityClaimsFromPayload,
  hasApplicantSurface,
  resolveCapabilities,
} = capabilities;
const { canAccessScreen } = routes;
const { roleFromClaims, sessionEntryFromClaims } = oidcCore;

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
const FUTURE = 4_000_000_000;

const applicantToken = jwt({
  sub: 'acct-applicant',
  roles: [],
  capabilities: ['admissions:self'],
  exp: FUTURE,
});
const rolelessTokenNoGrant = jwt({ sub: 'acct-x', roles: [], exp: FUTURE });

// --- token claim parsing -----------------------------------------------------

test('the capabilities claim parses as a string array only', () => {
  assert.equal(ADMISSIONS_SELF_CLAIM, 'admissions:self');
  assert.deepEqual(
    capabilityClaimsFromPayload({ capabilities: ['admissions:self', 'x'] }),
    ['admissions:self', 'x'],
  );
  assert.deepEqual(capabilityClaimsFromPayload({}), []);
  assert.deepEqual(capabilityClaimsFromPayload(null), []);
  assert.deepEqual(capabilityClaimsFromPayload({ capabilities: 'admissions:self' }), []);
  assert.deepEqual(capabilityClaimsFromPayload({ capabilities: [1, 'admissions:self', null] }), [
    'admissions:self',
  ]);
});

// --- session entry selection -------------------------------------------------

test('a roleless account enters only through the minted SELF grant', () => {
  assert.deepEqual(sessionEntryFromClaims([], ['admissions:self']), { kind: 'applicant' });
  // The grant is never inferred: no claim, no entry — same as before.
  assert.equal(sessionEntryFromClaims([], []), null);
  assert.equal(sessionEntryFromClaims([], ['other:grant']), null);
  // A claim string that resolves to no UI role is still a roleless account:
  // with the minted grant it enters the applicant surface like any other.
  assert.deepEqual(sessionEntryFromClaims(['unknown-role'], ['admissions:self']), {
    kind: 'applicant',
  });
});

test('recognized roles keep their precedence even with the grant present', () => {
  assert.deepEqual(sessionEntryFromClaims(['STUDENT'], ['admissions:self']), {
    kind: 'role',
    role: 'student',
  });
  assert.deepEqual(sessionEntryFromClaims(['LECTURER'], []), { kind: 'role', role: 'lecturer' });
  assert.deepEqual(sessionEntryFromClaims(['ADMIN'], ['admissions:self']), {
    kind: 'role',
    role: 'admin',
  });
});

// --- capability resolution ----------------------------------------------------

test('the minted grant resolves to admissions.self plus the surface marker only when roleless', () => {
  assert.deepEqual(
    resolveCapabilities({
      claims: [],
      lanes: LANES_OFF,
      capabilityClaims: ['admissions:self'],
      role: null,
    }),
    ['admissions.self', 'applicant.surface'],
  );
  // A real student with the same claim keeps the normal student surface —
  // the marker never attaches to a resolved role.
  assert.deepEqual(
    resolveCapabilities({
      claims: ['STUDENT'],
      lanes: LANES_OFF,
      capabilityClaims: ['admissions:self'],
      role: 'student',
    }),
    ['admissions.self'],
  );
  assert.deepEqual(
    resolveCapabilities({
      claims: ['ADMIN'],
      lanes: LANES_OFF,
      capabilityClaims: ['admissions:self'],
      role: 'admin',
    }),
    ['admissions.self'],
  );
  // Tokens minted before the claim existed resolve exactly like before.
  assert.deepEqual(resolveCapabilities({ claims: ['STUDENT'], lanes: LANES_OFF }), []);
  assert.equal(hasApplicantSurface(NO_CAPABILITIES), false);
  assert.equal(hasApplicantSurface(undefined), false);
});

// --- surface scoping -----------------------------------------------------------

test('the applicant surface reaches admissions and nothing else', () => {
  const applicantCaps = resolveCapabilities({
    claims: [],
    lanes: LANES_OFF,
    capabilityClaims: ['admissions:self'],
    role: null,
  });
  assert.equal(canAccessScreen(APPLICANT_UI_ROLE, 'admissions', applicantCaps), true);
  assert.equal(canAccessScreen(APPLICANT_UI_ROLE, 'dashboard.student', applicantCaps), false);
  assert.equal(canAccessScreen(APPLICANT_UI_ROLE, 'schedule', applicantCaps), false);
  assert.equal(canAccessScreen(APPLICANT_UI_ROLE, 'grades', applicantCaps), false);
  assert.equal(canAccessScreen(APPLICANT_UI_ROLE, 'admin.dashboard', applicantCaps), false);
});

test('sessions without the marker keep the historical role checks', () => {
  // Registry-only behavior is untouched: students reach admissions,
  // admins stay denied, and a caller passing no capabilities sees the
  // exact old predicate.
  assert.equal(canAccessScreen('student', 'admissions'), true);
  assert.equal(canAccessScreen('admin', 'admissions'), false);
  const adminCaps = resolveCapabilities({
    claims: ['ADMIN'],
    lanes: LANES_OFF,
    capabilityClaims: ['admissions:self'],
    role: 'admin',
  });
  assert.equal(canAccessScreen('admin', 'admissions', adminCaps), false);
});

// --- the real session path -----------------------------------------------------

const pkgJson = JSON.stringify(path.join(mobileRoot, 'package.json'));
const stubs = {
  react: `import { createRequire } from 'node:module';
const R = createRequire(${pkgJson})('react');
export const { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } = R;
export default R;`,
  'jsx-runtime': `import { createRequire } from 'node:module';
const J = createRequire(${pkgJson})('react/jsx-runtime');
export const { jsx, jsxs, Fragment } = J;`,
  'react-native': `export const AppState = { addEventListener: () => ({ remove() {} }) };`,
  client: `export const apiClient = { mode: 'live', setOnSessionExpired() {} };
export const campusApi = {};`,
  push: 'export async function unregisterPushBestEffort() {}',
  oidcSession: `export { decodeJwtPayload, roleFromClaims } from ${JSON.stringify(url('oidc-core'))};`,
  store: `export const sessionStore = new Proxy({}, {
  get: (_target, key) => (...args) => globalThis.__sessionStoreStub[key](...args),
});`,
};
for (const [name, source] of Object.entries(stubs)) {
  fs.writeFileSync(path.join(tmp, `stub-${name}.mjs`), source);
}

async function mountSession() {
  const tag = `session-${Math.random().toString(36).slice(2)}`;
  transpile(`${tag}-lane-flags`, 'src/config/lane-flags.ts');
  transpile(tag, 'src/session/SessionContext.tsx', {
    jsx: true,
    map: {
      react: url('stub-react'),
      'react/jsx-runtime': url('stub-jsx-runtime'),
      'react-native': url('stub-react-native'),
      '../api/client': url('stub-client'),
      '../api/push-notifications': url('stub-push'),
      '../auth/capabilities': url('capabilities'),
      '../auth/oidc-session': url('stub-oidcSession'),
      '../auth/mobile-session-store': url('stub-store'),
      '../config/features': url('features'),
      '../config/lane-flags': url(`${tag}-lane-flags`),
      '../hooks/query-cache': url('query-cache'),
    },
  });
  return import(url(tag));
}

async function withSession(accessToken, body) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__sessionStoreStub = {
    loadBootstrap: async () => ({ refreshToken: null }),
    refreshAccessToken: async () => ({ accessToken: null }),
    getAccessToken: () => accessToken,
    sessionEpoch: () => 0,
    signOut: async () => {},
  };
  const { SessionProvider, useSession } = await mountSession();
  const React = require('react');
  const TestRenderer = require('react-test-renderer');
  const holder = { current: null };
  const Probe = () => {
    holder.current = useSession();
    return null;
  };
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SessionProvider, null, React.createElement(Probe)),
    );
  });
  try {
    await body(holder, (fn) => TestRenderer.act(fn));
  } finally {
    await TestRenderer.act(async () => renderer.unmount());
    queryCache.clearQueryCache();
  }
}

test('sign-in derives the applicant surface from the token, not the caller', async () => {
  await withSession(applicantToken, async (holder, act) => {
    await act(async () => {
      holder.current.completeSignIn(APPLICANT_UI_ROLE, 'acct-applicant');
    });
    const state = holder.current;
    assert.equal(state.kind, 'authenticated');
    assert.equal(state.role, APPLICANT_UI_ROLE);
    assert.equal(state.accountId, 'acct-applicant');
    assert.ok(hasApplicantSurface(state.capabilities));
    assert.ok(state.capabilities.includes('admissions.self'));
    assert.deepEqual(canAccessScreen(state.role, 'admissions', state.capabilities), true);
    assert.deepEqual(canAccessScreen(state.role, 'dashboard.student', state.capabilities), false);
  });
});

test('sign-in without the minted grant stays an ordinary role session', async () => {
  await withSession(rolelessTokenNoGrant, async (holder, act) => {
    await act(async () => {
      holder.current.completeSignIn('student', 'acct-x');
    });
    const state = holder.current;
    assert.equal(state.kind, 'authenticated');
    assert.equal(hasApplicantSurface(state.capabilities), false);
    // No marker means the plain registry check — the session cannot shrink
    // itself into the applicant surface by naming a role.
    assert.equal(canAccessScreen(state.role, 'dashboard.student', state.capabilities), true);
  });
});
