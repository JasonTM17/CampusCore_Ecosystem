import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * G3B check-in routing contract: the lecturer link → app path → lane → guard,
 * plus the pending-destination store that survives the sign-in detour.
 * Transpiled and executed for real, like router-guard.test.mjs.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-checkin-route-'));
const names = ['routes', 'route-map', 'capabilities', 'checkin-link', 'pending-checkin'];
const files = {
  routes: 'src/navigation/routes.ts',
  'route-map': 'src/navigation/route-map.ts',
  capabilities: 'src/auth/capabilities.ts',
  'checkin-link': 'src/attendance-checkin/checkin-link.ts',
  'pending-checkin': 'src/navigation/pending-checkin.ts',
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
const routeMap = await load('route-map');
const caps = await load('capabilities');
const link = await load('checkin-link');
const pending = await load('pending-checkin');

const { normalizeDeepLink, resolveCapabilities } = caps;
const { resolveDeepLink, resolveGuard, lanePathFor } = routeMap;
const { parseCheckinLink } = link;
const { rememberCheckinPath, consumePendingCheckinPath } = pending;

const ID = '9e107d9d-372b-4c81-8d1f-8f0b9f9f0001';
const SCHEME = `campuscore://attendance/checkin/${ID}`;
const HTTPS = `https://www.campusute.io.vn/attendance/checkin/${ID}`;
const ALL_ON = { dean: true, staff: true, admin: true, checkin: true };
const studentCaps = resolveCapabilities({ claims: ['STUDENT'], lanes: ALL_ON });

test('both lecturer link forms normalize to the lane path', () => {
  for (const url of [SCHEME, HTTPS]) {
    assert.equal(normalizeDeepLink(url), `/attendance/checkin/${ID}`, url);
    assert.deepEqual(parseCheckinLink(url), { ok: true, sessionId: ID }, url);
  }
});

test('foreign or malformed check-in links are refused before routing', () => {
  const bad = [
    `ftp://attendance/checkin/${ID}`,
    `https://campusute.io.vn/attendance/checkin/${ID}`, // look-alike host (no www)
    `https://www.campusute.io.vn.evil.test/attendance/checkin/${ID}`,
    `https://user@www.campusute.io.vn/attendance/checkin/${ID}`,
    `https://www.campusute.io.vn:8443/attendance/checkin/${ID}`,
    `campuscore://attendance/checkin/${ID}#frag`,
    `campuscore://attendance\\checkin\\${ID}`,
    `campuscore://attendance/checkin/${ID.slice(0, -1)}x`,
    'campuscore://attendance/checkin/not-a-uuid',
    `campuscore://attendance/checkin/${ID}/extra`,
    `campuscore://attendance/checkin/`,
    `campuscore://attendance/checkin/${ID}\n`,
    `campuscore://attendance/checkin/${ID}%2f..`,
    `campuscore://attendance/checkin/../${ID}`,
  ];
  for (const url of bad) {
    const normalized = normalizeDeepLink(url);
    assert.equal(normalized === null || parseCheckinLink(url).ok === false, true, url);
    if (normalized !== null) {
      // Whatever normalization kept, it must never open as the session lane.
      assert.equal(resolveGuard('authenticated', 'student', normalized, studentCaps, ALL_ON).action !== 'allow'
        || !/^\/attendance\/checkin\/[^/]+$/.test(normalized)
        || !link.SESSION_ID_PATTERN.test(normalized.split('/').pop()), true, url);
    }
  }
});

test('resolveDeepLink opens the check-in lane for a granted student', () => {
  for (const url of [SCHEME, HTTPS]) {
    assert.deepEqual(resolveDeepLink(url, 'authenticated', 'student', studentCaps), {
      action: 'open',
      href: `/attendance/checkin/${ID}`,
    });
  }
});

test('signed-out check-in links bounce to sign-in and the intent is preserved', () => {
  assert.deepEqual(resolveDeepLink(SCHEME, 'signedOut', 'student'), {
    action: 'redirect',
    href: '/sign-in',
  });
  // The store keeps only well-formed session links, in memory, once.
  rememberCheckinPath(`/attendance/checkin/${ID}`);
  assert.equal(consumePendingCheckinPath(), `/attendance/checkin/${ID}`);
  assert.equal(consumePendingCheckinPath(), null, 'consumed once');
  for (const bad of ['/attendance/checkin/not-a-uuid', '/attendance/checkin', '/dashboard', 'garbage']) {
    rememberCheckinPath(bad);
    assert.equal(consumePendingCheckinPath(), null, bad);
  }
});

test('pending intent goes stale so an old link cannot hijack a later sign-in', () => {
  const t0 = 1_700_000_000_000;
  const realNow = Date.now;
  try {
    Date.now = () => t0;
    rememberCheckinPath(`/attendance/checkin/${ID}`);
    assert.equal(consumePendingCheckinPath(t0 + 10 * 60_000), null);
  } finally {
    Date.now = realNow;
  }
});

test('the dynamic route file exists next to the lane index route', () => {
  const base = path.join(mobileRoot, 'app', '(app)', ...lanePathFor('attendance.checkin').split('/').filter(Boolean));
  assert.ok(fs.existsSync(path.join(base, 'index.tsx')), 'list entry route');
  assert.ok(fs.existsSync(path.join(base, '[sessionId].tsx')), 'deep-link route');
});
