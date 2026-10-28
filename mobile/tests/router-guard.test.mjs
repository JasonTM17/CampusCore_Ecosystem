import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The guard is a pure-function contract (KM-13a). route-map.ts and routes.ts
 * are transpiled to a temp dir and really executed — not source-scanned — so
 * the assertions cover runtime behavior, not text.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-router-'));
const modules = [
  ['routes', 'src/navigation/routes.ts'],
  ['route-map', 'src/navigation/route-map.ts'],
  ['capabilities', 'src/auth/capabilities.ts'],
];
for (const [name, file] of modules) {
  const src = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  fs.writeFileSync(
    path.join(tmp, `${name}.mjs`),
    outputText.replaceAll(
      /from '\.{1,2}\/(?:[a-z-]+\/)?(routes|route-map|capabilities)'/g,
      "from './$1.mjs'",
    ),
  );
}
const routeMap = await import(
  pathToFileURL(path.join(tmp, 'route-map.mjs')).href
);
const routes = await import(pathToFileURL(path.join(tmp, 'routes.mjs')).href);
const { pathFor, screenForPath, roleHomePath, resolveGuard } = routeMap;
const { screenRegistry, canAccessScreen } = routes;

test('every registry screen has a router path and round-trips', () => {
  for (const { name } of screenRegistry) {
    // Dynamic-segment screens need their id to form a complete URL — the
    // round-trip only makes sense with the param present.
    const p = name === 'thesis.detail' ? pathFor(name, { topicId: 'roundtrip' }) : pathFor(name);
    assert.ok(p.startsWith('/'), `${name} path must be absolute`);
    assert.equal(screenForPath(p), name, `${name} must round-trip via ${p}`);
  }
  assert.equal(screenRegistry.length, 37);
});

test('thesis detail/registration carry topicId on the URL (KM-5)', () => {
  // Contract §2: detail is the /thesis/[topicId] dynamic segment; the id
  // rides the path so a cold deep link keeps its target.
  assert.equal(
    pathFor('thesis.detail', { topicId: 't 1' }),
    '/thesis/t%201',
  );
  assert.equal(
    pathFor('thesis.registration', { topicId: 'abc' }),
    '/thesis/register?topicId=abc',
  );
  // Detail without an id is not a target — falls back to the topics index.
  assert.equal(pathFor('thesis.detail'), '/thesis');
  assert.equal(
    pathFor('lecturer.attendance', { sectionId: 's 1' }),
    '/lecturer/attendance?sectionId=s%201',
  );
});

test('oidc callback is never routed as a screen (KM-10)', () => {
  assert.equal(screenForPath('/auth/callback'), null);
  for (const session of ['signedOut', 'preview', 'authenticated']) {
    assert.deepEqual(resolveGuard(session, 'student', '/auth/callback'), {
      action: 'redirect',
      to: 'auth.signIn',
    });
  }
});

test('signedOut can only reach the sign-in family', () => {
  for (const p of ['/sign-in', '/sign-in-blocked', '/']) {
    assert.deepEqual(resolveGuard('signedOut', 'student', p), { action: 'allow' });
  }
  for (const p of ['/dashboard', '/admin/dashboard', '/lecturer/grading', '/wat']) {
    assert.deepEqual(resolveGuard('signedOut', 'student', p), {
      action: 'redirect',
      to: 'auth.signIn',
    });
  }
});

test('signed-in sessions bounce off sign-in and unknown paths to role home', () => {
  for (const session of ['preview', 'authenticated']) {
    assert.deepEqual(resolveGuard(session, 'student', '/sign-in'), {
      action: 'redirect',
      to: 'dashboard.student',
    });
    assert.deepEqual(resolveGuard(session, 'lecturer', '/'), {
      action: 'redirect',
      to: 'lecturer.dashboard',
    });
    assert.deepEqual(resolveGuard(session, 'admin', '/wat'), {
      action: 'redirect',
      to: 'admin.dashboard',
    });
  }
});

test('role access: student allowed own screens, denied staff screens', () => {
  assert.deepEqual(resolveGuard('authenticated', 'student', '/schedule'), {
    action: 'allow',
  });
  for (const p of ['/admin/dashboard', '/lecturer/grading']) {
    assert.deepEqual(resolveGuard('authenticated', 'student', p), {
      action: 'redirect',
      to: 'dashboard.student',
    });
  }
  assert.deepEqual(resolveGuard('preview', 'lecturer', '/lecturer/grading'), {
    action: 'allow',
  });
});

test('admin cannot reach lecturer screens — web-only ops (KM-8)', () => {
  assert.equal(canAccessScreen('admin', 'lecturer.grading'), false);
  assert.deepEqual(resolveGuard('authenticated', 'admin', '/lecturer/grading'), {
    action: 'redirect',
    to: 'admin.dashboard',
  });
  assert.deepEqual(resolveGuard('authenticated', 'admin', '/admin/students'), {
    action: 'allow',
  });
});

test('query strings and trailing slashes do not defeat the guard', () => {
  assert.equal(screenForPath('/thesis/x?source=push'), 'thesis.detail');
  assert.equal(screenForPath('/thesis/register'), 'thesis.registration');
  assert.equal(screenForPath('/thesis'), 'thesis.topics');
  assert.equal(screenForPath('/dashboard/'), 'dashboard.student');
  assert.deepEqual(resolveGuard('signedOut', 'student', '/dashboard/?a=1'), {
    action: 'redirect',
    to: 'auth.signIn',
  });
});

test('roleHomePath agrees with the guard redirect target', () => {
  assert.equal(roleHomePath('student'), '/dashboard');
  assert.equal(roleHomePath('lecturer'), '/lecturer/dashboard');
  assert.equal(roleHomePath('admin'), '/admin/dashboard');
});

test('lane paths stay out of the screen registry and the guard fails closed by default', () => {
  for (const p of ['/dashboard/dean', '/apply/review', '/careers/desk', '/library/desk', '/admin']) {
    assert.equal(screenForPath(p), null, p);
    assert.equal(
      resolveGuard('authenticated', 'admin', p).reason,
      'lane-unavailable',
      `${p} needs an explicit capability`,
    );
  }
  // Non-lane decisions carry no reason field.
  assert.deepEqual(resolveGuard('authenticated', 'student', '/wat'), {
    action: 'redirect',
    to: 'dashboard.student',
  });
});

test('root layout keeps the navigator mounted while a guard redirect is pending', () => {
  // Replacing the Stack with a bare <Redirect> makes expo-router remount the
  // root layout, which recreates SessionProvider and drops the session that
  // triggered the redirect (preview and sign-in both bounced back to /sign-in).
  const src = fs.readFileSync(path.join(mobileRoot, 'app/_layout.tsx'), 'utf8');
  const body = src.slice(src.indexOf('function RootNavigator'), src.indexOf('function ThemedStack'));
  assert.match(body, /<ThemedStack \/>/);
  assert.doesNotMatch(body, /return\s*<Redirect/);
});
