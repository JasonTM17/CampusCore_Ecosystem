import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const verifierSource = fs.readFileSync(path.join(scriptDir, 'ecosystem-devices-verify.mjs'), 'utf8');
const LANES = ['/news', '/docs', '/careers', '/library', '/apply', '/attendance/checkin'];
const CHECKIN_AASA_PATH = '/attendance/checkin/*';

function createFixture({ missingAasa = false, missingAndroid = false, missingWebRoute = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-devices-verify-'));
  const fixturePath = (relativePath) => path.join(root, relativePath);
  const writeJson = (relativePath, value) => {
    const filePath = fixturePath(relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  };

  fs.mkdirSync(fixturePath('scripts'), { recursive: true });
  fs.writeFileSync(fixturePath('scripts/ecosystem-devices-verify.mjs'), verifierSource);

  const aasaLanes = missingAasa ? LANES.filter((lane) => lane !== '/attendance/checkin') : LANES;
  const androidLanes = missingAndroid ? LANES.filter((lane) => lane !== '/attendance/checkin') : LANES;
  const aasaPath = (lane) => lane === '/attendance/checkin' ? CHECKIN_AASA_PATH : lane;

  writeJson('frontend/public/.well-known/apple-app-site-association', {
    applinks: {
      details: [{
        appIDs: ['SYNTH00000.io.campuscore.mobile'],
        components: [
          { '/': '/session/*', exclude: true },
          { '/': '/api/*', exclude: true },
          ...aasaLanes.map((lane) => ({ '/': aasaPath(lane) })),
        ],
      }],
    },
    webcredentials: { apps: [] },
  });

  writeJson('frontend/public/.well-known/assetlinks.json', [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'io.campuscore.mobile',
      sha256_cert_fingerprints: ['00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00'],
    },
  }]);

  writeJson('mobile/app.json', {
    expo: {
      ios: { associatedDomains: ['applinks:www.campusute.io.vn'] },
      android: {
        intentFilters: [{
          autoVerify: true,
          data: androidLanes.map((lane) => ({
            scheme: 'https',
            host: 'www.campusute.io.vn',
            ...(lane === '/attendance/checkin' ? { pathPrefix: lane } : { path: lane }),
          })),
        }],
      },
    },
  });

  const routeEntries = LANES.map((lane, index) => `lane${index}: '${lane}'`).join(',\n');
  const routeMapPath = fixturePath('mobile/src/navigation/route-map.ts');
  fs.mkdirSync(path.dirname(routeMapPath), { recursive: true });
  fs.writeFileSync(routeMapPath, `// auth/callback is ABSENT from screen routes.\nconst pathByScreen = {\n${routeEntries}\n};\n`);

  const webRouteFiles = [
    ['frontend/src/app/attendance/checkin/[sessionId]/page.tsx', 'default'],
    ['frontend/src/app/[locale]/attendance/checkin/[sessionId]/page.tsx', 'locale'],
  ];
  for (const [relativePath, kind] of webRouteFiles) {
    if (missingWebRoute === kind) continue;
    const filePath = fixturePath(relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export default function FixturePage() {}\n');
  }

  return {
    root,
    run() {
      return spawnSync(process.execPath, [fixturePath('scripts/ecosystem-devices-verify.mjs')], {
        encoding: 'utf8',
      });
    },
    cleanup() {
      const tempPrefix = `${path.resolve(os.tmpdir())}${path.sep}campus-devices-verify-`;
      const resolvedRoot = path.resolve(root);
      assert.ok(resolvedRoot.startsWith(tempPrefix), 'fixture cleanup must stay within its temporary directory');
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    },
  };
}

function withFixture(options, verify) {
  const fixture = createFixture(options);
  try {
    verify(fixture.run());
  } finally {
    fixture.cleanup();
  }
}

test('rejects a check-in path missing from the iOS association declaration', () => {
  withFixture({ missingAasa: true }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AASA claimed lanes drifted/);
  });
});

test('rejects a check-in path missing from the Android intent filter', () => {
  withFixture({ missingAndroid: true }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /android claim set must mirror the AASA lanes/);
  });
});

test('rejects a missing default attendance check-in web route', () => {
  withFixture({ missingWebRoute: 'default' }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /web route missing.*\/attendance\/checkin/);
  });
});

test('rejects a missing /en and /vi attendance check-in web route mirror', () => {
  withFixture({ missingWebRoute: 'locale' }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /web route missing.*\/(en|vi)\/attendance\/checkin/);
  });
});

test('accepts complete iOS, Android, and default plus locale web check-in declarations', () => {
  withFixture({}, (result) => {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"verdict": "PASS"/);
  });
});
