const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let ts;
try {
  ts = require('typescript');
} catch {
  ts = require(path.resolve(__dirname, '../node_modules/typescript'));
}

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTsModule(relativePath, stubs = {}, options = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: options.jsx,
      esModuleInterop: options.esModuleInterop,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

function loadStaffDesks(apiGet) {
  return loadTsModule('src/lib/staff-desks.ts', {
    '@/lib/api': { default: { get: apiGet } },
    '@/lib/campus-error': loadTsModule('src/lib/campus-error.ts'),
  });
}

function deniedError(status, code) {
  const error = new Error(`HTTP ${status}`);
  error.response = { status, data: code ? { code } : {} };
  return error;
}

/** Scripted api.get: { [path]: { status } | { rejects: Error } }. */
function scriptedGet(script) {
  const calls = [];
  const get = async (requestPath) => {
    calls.push(requestPath);
    const entry = script[requestPath];
    if (entry === undefined) {
      throw Object.assign(new Error('unexpected path'), { response: { status: 404 } });
    }
    if (entry.rejects) {
      throw entry.rejects;
    }
    return { status: entry.status, data: [] };
  };
  return { get, calls };
}

test('the desk registry covers exactly the three existing desk routes', () => {
  const { STAFF_DESKS } = loadStaffDesks(async () => ({ status: 200 }));

  assert.deepEqual(
    STAFF_DESKS.map((desk) => [desk.key, desk.href, desk.grantsPath]),
    [
      ['admissions', '/apply/review', '/admissions/staff/grants'],
      ['careers', '/careers/desk', '/careers/staff/grants'],
      ['library', '/library/desk', '/library/staff/grants'],
    ],
  );

  // Each linked destination is a real canonical page with its locale shim,
  // and it keeps its own server-side authorization.
  for (const desk of STAFF_DESKS) {
    const canonical = path.join(root, 'src/app', desk.href.slice(1), 'page.tsx');
    const shim = path.join(root, 'src/app/[locale]', desk.href.slice(1), 'page.tsx');
    assert.ok(fs.existsSync(canonical), `${desk.href} page must exist`);
    assert.ok(fs.existsSync(shim), `${desk.href} locale shim must exist`);
  }
});

test('probe outcomes map 200 to granted, 401/403 to denied, everything else to failed', () => {
  const { deskOutcomeForStatus } = loadStaffDesks(async () => ({ status: 200 }));

  assert.equal(deskOutcomeForStatus(200), 'granted');
  assert.equal(deskOutcomeForStatus(401), 'denied');
  assert.equal(deskOutcomeForStatus(403), 'denied');
  assert.equal(deskOutcomeForStatus(404), 'failed');
  assert.equal(deskOutcomeForStatus(500), 'failed');
  assert.equal(deskOutcomeForStatus(undefined), 'failed');
});

test('every grant combination resolves to exactly its permitted desks', async () => {
  const paths = {
    admissions: '/admissions/staff/grants',
    careers: '/careers/staff/grants',
    library: '/library/staff/grants',
  };

  for (let mask = 0; mask < 8; mask += 1) {
    const script = {};
    const expected = [];
    ['admissions', 'careers', 'library'].forEach((key, index) => {
      const granted = (mask & (1 << index)) !== 0;
      script[paths[key]] = granted
        ? { status: 200 }
        : { rejects: deniedError(403, `${key.toUpperCase()}_STAFF_REQUIRED`) };
      if (granted) {
        expected.push(key);
      }
    });

    const { get, calls } = scriptedGet(script);
    const { probeStaffDesks } = loadStaffDesks(get);
    const access = await probeStaffDesks();

    assert.deepEqual(
      access.desks,
      expected,
      `grant mask ${mask.toString(2).padStart(3, '0')} must surface exactly ${expected.join(',') || '(none)'}`,
    );
    assert.equal(access.probeFailed, false, `mask ${mask} answered authoritatively`);
    assert.equal(calls.length, 3, 'every desk is probed once');
  }
});

test('a session with no desk grant resolves to an empty desk list, not an error', async () => {
  const { get } = scriptedGet({
    '/admissions/staff/grants': { rejects: deniedError(403, 'ADMISSIONS_STAFF_REQUIRED') },
    '/careers/staff/grants': { rejects: deniedError(403, 'CAREERS_STAFF_REQUIRED') },
    '/library/staff/grants': { rejects: deniedError(403, 'LIBRARY_STAFF_REQUIRED') },
  });
  const { probeStaffDesks } = loadStaffDesks(get);
  const access = await probeStaffDesks();

  assert.deepEqual(access.desks, []);
  assert.equal(access.probeFailed, false);
});

test('expired-session answers deny desks; transport failures fail closed as probe errors', async () => {
  const { get } = scriptedGet({
    '/admissions/staff/grants': { status: 200 },
    '/careers/staff/grants': { rejects: deniedError(401) },
    '/library/staff/grants': { rejects: new Error('Network Error') },
  });
  const { probeStaffDesks } = loadStaffDesks(get);
  const access = await probeStaffDesks();

  assert.deepEqual(access.desks, ['admissions']);
  assert.equal(access.probeFailed, true, 'a probe without an answer must not read as denied');
});

test('probes only read the grants capability endpoints, never domain records', async () => {
  const { get, calls } = scriptedGet({
    '/admissions/staff/grants': { status: 200 },
    '/careers/staff/grants': { status: 200 },
    '/library/staff/grants': { status: 200 },
  });
  const { probeStaffDesks } = loadStaffDesks(get);
  await probeStaffDesks();

  for (const requestPath of calls) {
    assert.match(requestPath, /\/staff\/grants$/, 'probes hit only grant listings');
    assert.doesNotMatch(
      requestPath,
      /queue|requests|applications|opportunities|titles|copies/,
      'no applicant, borrower or candidate data is fetched',
    );
  }
});

test('the staff route exists with its locale shim and the shared denied surface', () => {
  const page = read('src/app/staff/page.tsx');
  const shim = read('src/app/[locale]/staff/page.tsx');
  const component = read('src/components/staff/StaffDesksPage.tsx');
  const lib = read('src/lib/staff-desks.ts');

  assert.match(page, /StaffDesksPage/);
  assert.match(shim, /export\s*\{\s*default\s*\}\s*from\s*'\.\.\/\.\.\/staff\/page'/);

  // The page requires a session and reuses the desk access-denied behavior.
  assert.match(component, /useRequireAuth\(\)/);
  assert.match(component, /WorkspaceForbiddenState/);
  assert.match(component, /LocalizedLink/);
  assert.match(component, /probeStaffDesks/);

  // The capability client calls the existing grant listings only.
  assert.match(lib, /staff\/grants/);
  assert.doesNotMatch(component + lib, /staff\/queue|staff\/requests|staff\/applications/);
});

test('the staff route is noindex: metadata branch and robots disallow both cover it', async () => {
  const server = read('src/i18n/server.ts');
  const robots = read('src/app/robots.ts');
  const messages = read('src/i18n/messages.ts');

  assert.match(server, /\{\s*prefix:\s*'\/staff'/);
  for (const disallowed of ['/staff', '/en/staff', '/vi/staff']) {
    assert.match(robots, new RegExp(`'${disallowed.replace(/\//g, '\\/')}'`));
  }
  // Both locales carry a metadata title for the gated route.
  assert.match(messages, /staff:\s*\{\s*\n\s*title:\s*'Staff desks \| CampusUTE'/u);
  assert.match(messages, /staff:\s*\{\s*\n\s*title:\s*'Bàn làm việc cán bộ \| CampusUTE'/u);
});
