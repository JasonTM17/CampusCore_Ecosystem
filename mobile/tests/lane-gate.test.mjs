import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-lane-'));
const names = ['routes', 'route-map', 'capabilities', 'lane-flags', 'lane-access', 'lane-model'];
const files = {
  routes: 'src/navigation/routes.ts',
  'route-map': 'src/navigation/route-map.ts',
  capabilities: 'src/auth/capabilities.ts',
  'lane-flags': 'src/config/lane-flags.ts',
  'lane-access': 'src/screens/lanes/lane-access.ts',
  'lane-model': 'src/screens/lanes/lane-model.ts',
};
const specifier = new RegExp(`from '(?:\\.{1,2}/)+(?:[a-z-]+/)*(${names.join('|')})'`, 'g');

for (const name of names) {
  const source = fs.readFileSync(path.join(mobileRoot, files[name]), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), outputText.replaceAll(specifier, "from './$1.mjs'"));
}
const load = (name) => import(pathToFileURL(path.join(tmp, `${name}.mjs`)).href);
const routes = await load('routes');
const routeMap = await load('route-map');
const caps = await load('capabilities');
const flagsModule = await load('lane-flags');
const access = await load('lane-access');
const lane = await load('lane-model');

const { laneScreenRegistry } = routes;
const { resolveGuard, lanePathFor } = routeMap;
const ALL_ON = { dean: true, staff: true, admin: true };
const ALL_DESKS = { desks: ['applyReview', 'careersDesk', 'libraryDesk'] };
const grant = (claims, lanes = ALL_ON, staffGrants = ALL_DESKS) => caps.resolveCapabilities({ claims, lanes, staffGrants });
const allow = (kind, role, capabilities, flags, id) => access.laneAllowed({ kind, role, capabilities, flags, id });

test('lane flags default to off in the shipped build', () => {
  assert.deepEqual(flagsModule.LANE_FLAGS, { dean: false, staff: false, admin: false });
});

test('flag off: no lane renders even with the matching capability and session', () => {
  for (const { id, role } of laneScreenRegistry) {
    const capabilities = grant(['TRUONG_KHOA', 'ADMIN']);
    const uiRole = role ?? 'admin';
    assert.equal(allow('authenticated', uiRole, capabilities, flagsModule.LANES_OFF, id), false, `${id} with flags off`);
  }
});

test('flag on but no capability: every lane is refused', () => {
  for (const { id, role } of laneScreenRegistry) {
    assert.equal(allow('authenticated', role ?? 'admin', [], ALL_ON, id), false, `${id} without grant`);
    assert.equal(allow('authenticated', role ?? 'admin', undefined, ALL_ON, id), false, `${id} undefined grant`);
  }
});

test('preview and signed-out sessions never reach a lane', () => {
  const capabilities = grant(['TRUONG_KHOA', 'ADMIN']);
  for (const { id, role } of laneScreenRegistry) {
    for (const kind of ['preview', 'signedOut']) {
      assert.equal(allow(kind, role ?? 'admin', capabilities, ALL_ON, id), false, `${id} ${kind}`);
    }
  }
});

test('flag and capability and authenticated session open exactly the granted lanes', () => {
  const deanCaps = grant(['LECTURER', 'TRUONG_KHOA']);
  assert.equal(allow('authenticated', 'lecturer', deanCaps, ALL_ON, 'dean.overview'), true);
  assert.equal(allow('authenticated', 'lecturer', deanCaps, { ...ALL_ON, dean: false }, 'dean.overview'), false);
  assert.equal(allow('authenticated', 'admin', deanCaps, ALL_ON, 'dean.overview'), false, 'dean needs the lecturer surface');

  const adminCaps = grant(['ADMIN']);
  for (const id of ['admin.overview', 'admin.attendance', 'admin.audit', 'admin.creditLimits', 'admin.enrollments', 'admin.events', 'admin.notifications']) {
    assert.equal(allow('authenticated', 'admin', adminCaps, ALL_ON, id), true, id);
    assert.equal(allow('authenticated', 'admin', adminCaps, { ...ALL_ON, admin: false }, id), false, `${id} flag`);
    assert.equal(allow('authenticated', 'lecturer', adminCaps, ALL_ON, id), false, `${id} role`);
  }
  assert.equal(allow('authenticated', 'admin', adminCaps, ALL_ON, 'dean.overview'), false);
});

test('a department head claim gets no dean lane', () => {
  const capabilities = grant(['LECTURER', 'TRUONG_BO_MON']);
  assert.equal(allow('authenticated', 'lecturer', capabilities, ALL_ON, 'dean.overview'), false);
});

test('staff desks follow the per-desk grant, not the role', () => {
  const one = grant(['LECTURER'], ALL_ON, { desks: ['libraryDesk'] });
  assert.equal(allow('authenticated', 'lecturer', one, ALL_ON, 'staff.libraryDesk'), true);
  assert.equal(allow('authenticated', 'lecturer', one, ALL_ON, 'staff.careersDesk'), false);
  assert.equal(allow('authenticated', 'lecturer', one, ALL_ON, 'staff.applyReview'), false);
  assert.equal(allow('authenticated', 'lecturer', one, { ...ALL_ON, staff: false }, 'staff.libraryDesk'), false);
});

test('the router guard refuses every lane path for an ungranted or preview session', () => {
  for (const { id } of laneScreenRegistry) {
    const lanePath = lanePathFor(id);
    for (const session of ['preview', 'authenticated']) {
      const decision = resolveGuard(session, 'admin', lanePath, []);
      assert.equal(decision.action, 'redirect', `${id} ${session}`);
      assert.equal(decision.reason, 'lane-unavailable');
    }
    assert.equal(resolveGuard('signedOut', 'admin', lanePath, grant(['ADMIN'])).action, 'redirect');
  }
  assert.equal(resolveGuard('preview', 'admin', '/admin', grant(['ADMIN'])).action, 'redirect');
  assert.equal(resolveGuard('authenticated', 'admin', '/admin', grant(['ADMIN'])).action, 'allow');
});

test('every lane has a route file, a registry component, and stays out of the plain registry', () => {
  const host = fs.readFileSync(path.join(mobileRoot, 'src/screens/lanes/lane-registry.tsx'), 'utf8');
  const plain = fs.readFileSync(path.join(mobileRoot, 'src/screens/index.ts'), 'utf8');
  for (const { id } of laneScreenRegistry) {
    const routePath = lanePathFor(id);
    const base = path.join(mobileRoot, 'app', '(app)', ...routePath.split('/').filter(Boolean));
    const file = [`${base}.tsx`, path.join(base, 'index.tsx')].find((candidate) => fs.existsSync(candidate));
    assert.ok(file, `${id} needs a route file for ${routePath}`);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`<LaneRoute id="${id}" />`), `${id} route host`);
    assert.ok(host.includes(`'${id}':`), `${id} in laneComponents`);
  }
  assert.ok(!/lane-registry|lanes\//.test(plain), 'screenComponents must not import lane screens');
  assert.match(host, /laneAllowed\(/, 'LaneRoute re-checks access at render time');
});

test('admissions, careers and library actions follow the server state machines', () => {
  assert.deepEqual(lane.admissionsActions('SUBMITTED'), ['claim']);
  assert.deepEqual(lane.admissionsActions('IN_REVIEW'), ['accept', 'reject', 'return']);
  assert.deepEqual(lane.admissionsActions('ACCEPTED'), []);
  assert.deepEqual(lane.careersActions('SUBMITTED'), ['toReviewing', 'reject']);
  assert.deepEqual(lane.careersActions('OFFER'), ['reject']);
  assert.deepEqual(lane.careersActions('REJECTED'), []);
  assert.deepEqual(lane.libraryActions('REQUESTED'), ['approve', 'cancel']);
  assert.deepEqual(lane.libraryActions('APPROVED'), ['issue', 'cancel']);
  assert.deepEqual(lane.libraryActions('ISSUED'), ['returnLoan']);
  assert.deepEqual(lane.libraryActions('RETURNED'), []);
  for (const action of ['return', 'reject', 'cancel']) assert.ok(lane.NEEDS_TEXT.has(action), action);
  assert.ok(!lane.NEEDS_TEXT.has('approve'));
});

test('transitions carry the row version and a trimmed reason only when given', () => {
  assert.deepEqual(lane.transitionBody({ version: 3 }), { expectedVersion: 3 });
  assert.deepEqual(lane.transitionBody({ version: 3 }, '  hết hạn  '), { expectedVersion: 3, reason: 'hết hạn' });
  assert.deepEqual(lane.transitionBody({}, '   '), {});
});

test('event actions and attendance marks respect the event status', () => {
  assert.deepEqual(lane.eventActions('DRAFT'), ['publish', 'cancel']);
  assert.deepEqual(lane.eventActions('REGISTRATION_OPEN'), ['closeRegistration', 'cancel']);
  assert.deepEqual(lane.eventActions('COMPLETED'), []);
  assert.equal(lane.canMarkAttendance('REGISTRATION_CLOSED'), true);
  assert.equal(lane.canMarkAttendance('PUBLISHED'), false);
  assert.deepEqual(lane.attendanceMark({ registrationId: 'r1', version: 2 }, 'ABSENT'), { registrationId: 'r1', status: 'ABSENT', version: 2 });
  assert.equal(lane.attendanceMark({ registrationId: 'r1' }, 'ATTENDED'), null, 'no version, no write');
});

test('notification drafts validate the recipient, lengths and exact body', () => {
  const ok = { userId: '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b', title: ' Hello ', message: ' Body ', type: 'INFO' };
  assert.deepEqual(lane.validateNotification(ok), []);
  assert.deepEqual(lane.notificationBody(ok), { userId: ok.userId, title: 'Hello', message: 'Body', type: 'INFO' });
  assert.deepEqual(lane.validateNotification({ ...ok, userId: 'not-a-uuid' }), ['recipient']);
  assert.deepEqual(lane.validateNotification({ ...ok, title: '   ' }), ['title']);
  assert.deepEqual(lane.validateNotification({ ...ok, title: 'x'.repeat(201) }), ['title']);
  assert.deepEqual(lane.validateNotification({ ...ok, message: '' }), ['message']);
  assert.deepEqual(lane.validateNotification({ ...ok, message: 'x'.repeat(2001) }), ['message']);
  assert.deepEqual(Object.keys(lane.notificationBody(ok)).sort(), ['message', 'title', 'type', 'userId']);
});

test('list parsing is tolerant and never invents rows', () => {
  assert.deepEqual(lane.parseList(null), []);
  assert.deepEqual(lane.parseList({ data: [1] }), []);
  assert.deepEqual(lane.parseList([1, 2]), [1, 2]);
  const page = lane.parseMetaPage({ data: [{ id: 'a' }], meta: { total: 45, page: 2, limit: 20, totalPages: 3 } }, 2, 20);
  assert.equal(page.items.length, 1);
  assert.equal(page.meta.total, 45);
  assert.equal(page.hasMore, true);
  const empty = lane.parseMetaPage('garbage', 1, 20);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.hasMore, false);
});

test('query strings encode only defined, non-blank values', () => {
  assert.equal(lane.queryString({ a: 'x y', b: '', c: undefined, d: 3 }), '?a=x%20y&d=3');
  assert.equal(lane.queryString({}), '');
  assert.equal(lane.percentOf(1, 3), 33);
  assert.equal(lane.percentOf(1, 0), 0);
});

test('failures map to the state a lane screen reacts to', () => {
  assert.equal(lane.failureKind({ status: 0 }), 'offline');
  assert.equal(lane.failureKind(new TypeError('network')), 'offline');
  assert.equal(lane.failureKind({ status: 401 }), 'unauthorized');
  assert.equal(lane.failureKind({ status: 403 }), 'denied');
  assert.equal(lane.failureKind({ status: 409 }), 'conflict');
  assert.equal(lane.failureKind({ status: 412 }), 'conflict');
  assert.equal(lane.failureKind({ status: 422 }), 'invalid');
  assert.equal(lane.failureKind({ status: 500 }), 'other');
  assert.equal(lane.failureKind(null), 'other');
});
