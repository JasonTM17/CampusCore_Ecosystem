import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { loadTs } from './helpers/load-ts.mjs';

const { createSessionStore } = await loadTs('src/auth/session-store.ts');
const { decodeJwtPayload, roleFromClaims } = await loadTs('src/auth/oidc-core.ts');

// Like signin-news.test.mjs, execute the actual callbacks with native/React
// boundaries injected. Do not copy the epoch checks or credential-write logic.
function callbackFactory(file, name) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      const initializer = node.initializer;
      callback = ts.isCallExpression(initializer) ? initializer.arguments[0] : initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, `Production callback ${name} exists`);
  const { outputText } = ts.transpileModule(`const callback = ${callback.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return (deps) => new Function(...Object.keys(deps), `${outputText}; return callback;`)(...Object.values(deps));
}

const makeBoot = callbackFactory('../src/session/SessionContext.tsx', 'runBoot');
const makeCompleteSignIn = callbackFactory('../src/session/SessionContext.tsx', 'completeSignIn');
const makeNavigationComplete = callbackFactory('../src/navigation/router-adapter.ts', 'completeSignIn');
const makeSignIn = callbackFactory('../src/screens/auth/SignInScreen.tsx', 'handleSignIn');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function syntheticAccess(accountId, role) {
  return `e30.${Buffer.from(JSON.stringify({
    sub: accountId, roles: [role], exp: Math.floor(Date.now() / 1000) + 600,
  })).toString('base64url')}.synthetic`;
}

function harness() {
  const accessA = syntheticAccess('account-A', 'STUDENT');
  const accessB = syntheticAccess('account-B', 'LECTURER');
  const secure = new Map([
    ['cu.install', JSON.stringify({ appInstanceId: 'test-install' })],
    ['cu.refresh', 'synthetic-refresh-A'],
  ]);
  const writes = [];
  let refreshReady = false;
  const sessionStore = createSessionStore({
    issuer: 'https://issuer.test',
    secure: {
      getItemAsync: async (key) => secure.get(key) ?? null,
      setItemAsync: async (key, value) => { writes.push([key, value]); secure.set(key, value); },
      deleteItemAsync: async (key) => { secure.delete(key); },
    },
    sandbox: {
      getItem: async () => JSON.stringify({ appInstanceId: 'test-install' }),
      setItem: async () => {}, removeItem: async () => {},
    },
    fetchImpl: async () => refreshReady
      ? new Response(JSON.stringify({ access_token: accessA, refresh_token: 'synthetic-rotated-A' }))
      : new Response('{}', { status: 503 }),
  });
  const stateRef = { current: { kind: 'signedOut', role: 'student', accountId: null } };
  const route = { current: '/sign-in' };
  const navigations = [];
  let bootStatus;
  let uiEpoch = 0;
  const setState = (next) => { stateRef.current = next; }; // Committed render mirror.
  const updateBootStatus = (next) => { bootStatus = next; };
  const setEpoch = (update) => { uiEpoch = update(uiEpoch); };
  const capabilitiesOf = () => ({});
  const apiClient = { mode: 'live' };
  const boot = makeBoot({
    sessionStore, apiClient, setEpoch, setState, updateBootStatus,
    mounted: { current: true }, bootFlight: { current: null },
    foregroundRetrySafe: { current: false }, setBooted: () => {},
    decodeJwtPayload, roleFromClaims, capabilitiesOf,
    claimsOf: (access) => decodeJwtPayload(access)?.roles ?? [],
    hasApplicantSurface: () => false, APPLICANT_UI_ROLE: 'student',
  });
  const completeSignIn = makeCompleteSignIn({
    stateRef, apiClient, sessionStore, setEpoch, setState, updateBootStatus, capabilitiesOf,
  });
  const roleHomePath = (role) => `/(app)/${role}`;
  const navigation = {
    completeSignIn: makeNavigationComplete({
      session: { completeSignIn, accountId: null }, roleHomePath,
      router: { replace: (path) => { navigations.push(path); route.current = path; } },
    }),
  };
  const oidc = deferred();
  const errors = [];
  const signIn = makeSignIn({
    sessionStore, navigation, signInFlight: { current: false },
    setError: (error) => { if (error) errors.push(error); }, setIsSubmitting: () => {},
    sessionStoreIssuer: () => sessionStore.issuer, signInWithOidc: () => oidc.promise,
    copy: { storage: 'storage', invalid: 'invalid', unreachable: 'unreachable' },
  });
  return {
    boot, signIn, sessionStore, secure, writes, accessA, accessB, stateRef, route, navigations, errors,
    bootStatus: () => bootStatus,
    recoverRefresh: () => { refreshReady = true; },
    acceptBootRoute: () => { route.current = roleHomePath(stateRef.current.role); },
    resolveOidc: () => oidc.resolve({
      kind: 'signedIn', role: 'lecturer', accountId: 'account-B',
      accessToken: accessB, refreshToken: 'synthetic-refresh-B',
    }),
  };
}

test('boot commit of A fences a deferred OIDC callback for B before credential writes', async () => {
  const view = harness();
  await view.boot();
  assert.equal(view.bootStatus(), 'unavailable');
  assert.equal(view.stateRef.current.kind, 'signedOut');
  const pendingB = view.signIn();

  view.recoverRefresh();
  await view.boot();
  assert.equal(view.bootStatus(), 'ready');
  assert.equal(view.stateRef.current.accountId, 'account-A');
  view.acceptBootRoute(); // Model the app guard routing the committed account.
  const writesAfterBoot = [...view.writes];

  view.resolveOidc();
  await pendingB;
  assert.deepEqual(view.writes, writesAfterBoot, 'Stale B must not write any credentials');
  assert.equal(view.secure.get('cu.refresh'), 'synthetic-rotated-A');
  assert.equal(view.sessionStore.getAccessToken(), view.accessA);
  assert.equal(view.stateRef.current.kind, 'authenticated');
  assert.equal(view.stateRef.current.accountId, 'account-A');
  assert.equal(view.stateRef.current.role, 'student');
  assert.equal(view.route.current, '/(app)/student');
  assert.deepEqual(view.navigations, [], 'Stale B must not navigate');
  assert.deepEqual(view.errors, []);
});

test('normal OIDC sign-in without a boot commit persists B and navigates to B', async () => {
  const view = harness();
  await view.boot();
  assert.equal(view.bootStatus(), 'unavailable');
  const pendingB = view.signIn();
  view.resolveOidc();
  await pendingB;

  assert.deepEqual(view.writes, [['cu.refresh', 'synthetic-refresh-B']]);
  assert.equal(view.secure.get('cu.refresh'), 'synthetic-refresh-B');
  assert.equal(view.sessionStore.getAccessToken(), view.accessB);
  assert.equal(view.stateRef.current.kind, 'authenticated');
  assert.equal(view.stateRef.current.accountId, 'account-B');
  assert.equal(view.stateRef.current.role, 'lecturer');
  assert.equal(view.route.current, '/(app)/lecturer');
  assert.deepEqual(view.navigations, ['/(app)/lecturer']);
  assert.deepEqual(view.errors, []);
});
