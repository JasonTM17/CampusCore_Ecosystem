import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(mobileRoot, '..');
const javaRoot = path.join(
  repoRoot,
  'java-services/restful-api/src/main/java/io/campuscore/restfulapi',
);

/**
 * route-map, capabilities, routes and push-routes are transpiled and really
 * executed: the allowlist is a runtime contract, not a text match.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-push-routes-'));
const url = (name) => pathToFileURL(path.join(tmp, `${name}.mjs`)).href;

function transpile(name, file, map = {}) {
  const src = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const rewritten = outputText.replace(/from (['"])([^'"]+)\1/g, (whole, quote, spec) =>
    map[spec] ? `from ${quote}${map[spec]}${quote}` : whole);
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), rewritten);
}

transpile('capabilities', 'src/auth/capabilities.ts');
const navMap = { '../auth/capabilities': url('capabilities'), './routes': url('routes') };
transpile('routes', 'src/navigation/routes.ts', navMap);
transpile('route-map', 'src/navigation/route-map.ts', navMap);
transpile('push-routes', 'src/api/push-routes.ts', {
  '../auth/capabilities': url('capabilities'),
  '../navigation/route-map': url('route-map'),
});
const {
  NOTIFICATION_PRODUCER_ROUTES,
  notificationIdFromPushData,
  resolveNotificationRoute,
  resolveNotificationTap,
} = await import(url('push-routes'));

const student = { kind: 'authenticated', role: 'student', capabilities: [] };
const lecturer = { kind: 'authenticated', role: 'lecturer', capabilities: [] };
const admin = { kind: 'authenticated', role: 'admin', capabilities: [] };
const adminGranted = { kind: 'authenticated', role: 'admin', capabilities: ['admin.oversight'] };
const signedOut = { kind: 'signedOut', role: 'student', capabilities: [] };

// --- producer table ----------------------------------------------------------

const producerFiles = {
  AdmissionService: 'admissions/service/AdmissionService.java',
  CareerService: 'careers/service/CareerService.java',
  AnnouncementStudentNotifier: 'engagement/service/AnnouncementStudentNotifier.java',
  GradePublishNotifier: 'engagement/service/GradePublishNotifier.java',
  EventService: 'events/service/EventService.java',
  EventStudentService: 'events/service/EventStudentService.java',
  LearningService: 'learning/service/LearningService.java',
  LibraryService: 'library/service/LibraryService.java',
  ThesisNotificationService: 'thesis/service/ThesisNotificationService.java',
};
const readJava = (relative) => fs.readFileSync(path.join(javaRoot, relative), 'utf8');

test('producer table matches the Java writers of the notification inbox', () => {
  const producers = new Set(
    NOTIFICATION_PRODUCER_ROUTES.flatMap((row) => row.producer.split(',').map((name) => name.trim())),
  );
  for (const name of producers) assert.ok(producerFiles[name], `${name} must be a known producer`);

  for (const row of NOTIFICATION_PRODUCER_ROUTES) {
    const sources = row.producer.split(',').map((name) => readJava(producerFiles[name.trim()]));
    assert.ok(
      sources.some((source) => source.includes(`"${row.link}`)),
      `${row.domain}: link ${row.link} is not written by ${row.producer}`,
    );
    for (const type of row.types) {
      assert.ok(
        sources.some((source) => source.includes(`"${type}"`)),
        `${row.domain}: type ${type} is not written by ${row.producer}`,
      );
    }
  }

  // A new writer of CreateNotificationCommand must be added to the table.
  const writers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.java') && fs.readFileSync(full, 'utf8').includes('new CreateNotificationCommand(')) {
        writers.push(path.relative(javaRoot, full).split(path.sep).join('/'));
      }
    }
  };
  walk(javaRoot);
  const known = new Set([
    ...Object.values(producerFiles),
    'notification/service/NotificationWriteService.java',
  ]);
  assert.deepEqual(writers.filter((file) => !known.has(file)), [], 'unlisted notification writer');
});

test('severity is the only type; the push payload carries just the inbox id', () => {
  const service = readJava('notification/service/NotificationWriteService.java');
  assert.match(service, /Set\.of\("INFO", "WARNING", "ERROR", "SUCCESS"\)/);
  const provider = readJava('notification/push/PushProvider.java');
  assert.match(provider, /record PushPayload\(String title, String body, String notificationId\)/);
  for (const row of NOTIFICATION_PRODUCER_ROUTES) {
    for (const type of row.types) assert.ok(['INFO', 'SUCCESS', 'WARNING', 'ERROR'].includes(type));
  }
});

test('every producer link opens its mapped screen for the right session', () => {
  const expected = {
    '/apply': ['/apply', 'admissions'],
    '/careers': ['/careers', 'careers'],
    '/dashboard/announcements': ['/announcements', 'announcements'],
    '/dashboard/transcript': ['/transcript', 'transcript'],
    '/dashboard/events': ['/events', 'events'],
    '/dashboard/learn': ['/learning', 'learning'],
    '/library': ['/library', 'library'],
    '/dashboard/thesis': ['/thesis', 'thesis.topics'],
  };
  for (const row of NOTIFICATION_PRODUCER_ROUTES.filter((entry) => entry.route !== null)) {
    const [href, screen] = expected[row.link];
    assert.equal(row.route, href, row.domain);
    assert.deepEqual(resolveNotificationRoute(row.link, student), { action: 'open', href, screen, lane: null }, row.domain);
    assert.deepEqual(
      resolveNotificationRoute(`${row.link}?event=e-1`, student),
      { action: 'open', href, screen, lane: null },
      `${row.domain}: query is dropped`,
    );
  }
  assert.equal(Object.keys(expected).length, NOTIFICATION_PRODUCER_ROUTES.filter((entry) => entry.route !== null).length);
});

test('lecturer thesis link is web-only and refused with the role home', () => {
  assert.deepEqual(resolveNotificationRoute('/dashboard/lecturer/thesis', lecturer), {
    action: 'refuse',
    reason: 'web-only',
    fallbackHref: '/lecturer/dashboard',
  });
});

// --- fail-closed refusals ----------------------------------------------------

test('unknown, malformed and foreign targets are refused to the safe fallback', () => {
  const refused = [
    '/no-such-screen',
    '/dashboard/unknown',
    '/auth/callback',
    'campuscore://auth/callback',
    '/../admin/audit',
    '/thesis/%2e%2e/admin',
    '/grades/..',
    'https://evil.example/transcript',
    'http://campusute.io.vn/transcript',
    'javascript:alert(1)',
    'file:///etc/passwd',
    '//evil.example/transcript',
    '/transcript\\..\\admin',
    '/transcript\u0000',
    '/transcript#frag',
    '',
    'transcript',
  ];
  for (const target of refused) {
    const decision = resolveNotificationRoute(target, student);
    assert.equal(decision.action, 'refuse', `must refuse ${JSON.stringify(target)}`);
    assert.equal(decision.fallbackHref, '/dashboard');
  }
  for (const target of [undefined, null, 42, {}, ['/transcript']]) {
    assert.equal(resolveNotificationRoute(target, student).action, 'refuse');
  }
  assert.equal(resolveNotificationRoute('x'.repeat(3000), student).action, 'refuse');
});

test('signed-out sessions open nothing and fall back to sign-in', () => {
  for (const target of ['/transcript', '/dashboard/transcript', '/news', '/sign-in', '/admin/audit']) {
    assert.deepEqual(resolveNotificationRoute(target, signedOut), {
      action: 'refuse',
      reason: 'blocked',
      fallbackHref: '/sign-in',
    }, target);
  }
});

test('a route the role cannot reach is refused to that role home', () => {
  assert.deepEqual(resolveNotificationRoute('/dashboard/transcript', lecturer), {
    action: 'refuse',
    reason: 'blocked',
    fallbackHref: '/lecturer/dashboard',
  });
  assert.deepEqual(resolveNotificationRoute('/lecturer/dashboard', student), {
    action: 'refuse',
    reason: 'blocked',
    fallbackHref: '/dashboard',
  });
});

test('a lane opens only with the capability grant', () => {
  for (const session of [student, lecturer, admin]) {
    const decision = resolveNotificationRoute('/admin/audit', session);
    assert.equal(decision.action, 'refuse', session.role);
    assert.equal(decision.reason, 'blocked');
  }
  assert.deepEqual(resolveNotificationRoute('campuscore://admin/audit', adminGranted), {
    action: 'open',
    href: '/admin/audit',
    screen: null,
    lane: 'admin.audit',
  });
  // Grant revoked: the same target is refused again, to the role home.
  assert.deepEqual(resolveNotificationRoute('/admin/audit', { ...adminGranted, capabilities: [] }), {
    action: 'refuse',
    reason: 'blocked',
    fallbackHref: '/admin/dashboard',
  });
});

test('thesis detail carries its topic id from the path', () => {
  assert.deepEqual(resolveNotificationRoute('/thesis/topic-7', student), {
    action: 'open',
    href: '/thesis/topic-7',
    screen: 'thesis.detail',
    lane: null,
    topicId: 'topic-7',
  });
  assert.equal(resolveNotificationRoute('/thesis/a%20b', student).topicId, 'a b');
  assert.equal(resolveNotificationRoute('/thesis/topic', student).action, 'refuse');
});

test('a preview session may open registry routes but not a lane', () => {
  const preview = { kind: 'preview', role: 'student', capabilities: [] };
  assert.equal(resolveNotificationRoute('/dashboard/transcript', preview).action, 'open');
  assert.equal(resolveNotificationRoute('/admin/audit', preview).action, 'refuse');
});

// --- tap resolution ----------------------------------------------------------

test('tap re-reads the inbox record and never builds a path from the push id', async () => {
  const calls = [];
  const fetchNotification = async (id) => {
    calls.push(id);
    return { link: '/dashboard/transcript' };
  };
  assert.deepEqual(await resolveNotificationTap('notice-1', fetchNotification, student), {
    action: 'open',
    href: '/transcript',
    screen: 'transcript',
    lane: null,
  });
  assert.deepEqual(calls, ['notice-1']);

  for (const id of ['', '../admin', 'a/b', 'x'.repeat(101), 7, null, undefined]) {
    const before = calls.length;
    assert.equal((await resolveNotificationTap(id, fetchNotification, student)).action, 'refuse');
    assert.equal(calls.length, before, 'an invalid id must not reach the API');
  }

  const failing = async () => { throw new Error('offline'); };
  assert.equal((await resolveNotificationTap('notice-2', failing, student)).action, 'refuse');
  assert.equal((await resolveNotificationTap('notice-3', async () => ({}), student)).action, 'refuse');
  assert.equal(
    (await resolveNotificationTap('notice-4', async () => ({ link: 'https://evil.example/' }), student)).action,
    'refuse',
  );
});

test('notification id is read only from the payload field and validated', () => {
  assert.equal(notificationIdFromPushData({ notificationId: 'abc-123' }), 'abc-123');
  for (const data of [null, undefined, 'abc', {}, { notificationId: '' }, { notificationId: '../x' }, { notificationId: 5 }]) {
    assert.equal(notificationIdFromPushData(data), null);
  }
  // A route in the payload is not an input here.
  assert.equal(notificationIdFromPushData({ link: '/transcript' }), null);
});
