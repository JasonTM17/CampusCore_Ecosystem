import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Grade row versions: the loaded sheet carries `Enrollment.version`, the draft
 * sends the version each row was loaded with, a legacy row omits it, and a
 * version-only server change counts as a changed baseline. The client mapping
 * and request body run against a stubbed fetch, so no server is involved.
 */
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-grade-version-'));

function transpile(file, fileName, rewrite = (output) => output) {
  const source = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName,
  });
  const out = path.join(tempRoot, fileName.replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(out, rewrite(outputText));
  return out;
}

transpile('src/i18n/locale.ts', 'locale.ts');
const modelPath = transpile('src/screens/operations/lecturer-model.ts', 'lecturer-model.ts',
  (output) => output.replace("'../../i18n/locale'", "'./locale.mjs'"));
const model = await import(pathToFileURL(modelPath).href);

const MODULES = {
  'react-native': 'react-native.mjs',
  '../auth/mobile-session-store': 'mobile-session-store.mjs',
  './assistant-stream': 'assistant-stream.mjs',
  './observability': 'observability.mjs',
  './base-url': 'base-url.mjs',
};
const rewriteImports = (output) => output.replace(/from '([^']+)'/g, (match, specifier) =>
  MODULES[specifier] ? `from './${MODULES[specifier]}'` : match);

fs.writeFileSync(path.join(tempRoot, 'react-native.mjs'), "export const Platform = { OS: 'ios' };\n");
fs.writeFileSync(path.join(tempRoot, 'mobile-session-store.mjs'), `
export const sessionStore = {
  getAccessToken: () => null,
  setAccessToken: () => {},
  refreshAccessToken: async () => ({ accessToken: null }),
  sessionEpoch: () => 0,
};
`);
fs.writeFileSync(path.join(tempRoot, 'assistant-stream.mjs'), 'export const createSseTransport = () => ({});\n');
transpile('src/api/observability.ts', 'observability.ts', rewriteImports);
transpile('src/api/base-url.ts', 'base-url.ts', rewriteImports);
process.env.EXPO_PUBLIC_API_MODE = 'live';
process.env.EXPO_PUBLIC_API_URL = 'https://api.test/api/v1';
const clientPath = transpile('src/api/client.ts', 'client.ts', rewriteImports);
const client = await import(pathToFileURL(clientPath).href);

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Installs a scripted fetch and records the outgoing request bodies. */
function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), init, body: init.body };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const sheetRows = [
  { enrollmentId: 'e1', processScore: null, finalExamScore: 5, gradeStatus: 'DRAFT', version: 3 },
  { enrollmentId: 'e2', processScore: 4, finalExamScore: null, gradeStatus: 'DRAFT', version: 8 },
];

test('the draft sends the version each changed row was loaded with', () => {
  const draft = model.buildGradeDraft(sheetRows, {
    e1: { processScore: '7' },
    e2: { finalExamScore: '6' },
  });
  assert.deepEqual(draft.changes, [
    { enrollmentId: 'e1', processScore: 7, finalExamScore: 5, version: 3 },
    { enrollmentId: 'e2', processScore: 4, finalExamScore: 6, version: 8 },
  ]);
  assert.deepEqual(draft.problems, {});
});

test('a version 0 baseline and an untouched row are both handled', () => {
  const rows = [
    { enrollmentId: 'e1', processScore: 1, finalExamScore: 2, version: 0 },
    { enrollmentId: 'e2', processScore: 1, finalExamScore: 2, version: 9 },
  ];
  const draft = model.buildGradeDraft(rows, { e1: { processScore: '2' }, e2: { processScore: '1' } });
  assert.deepEqual(draft.changes, [{ enrollmentId: 'e1', processScore: 2, finalExamScore: 2, version: 0 }]);
});

test('a legacy sheet without versions still saves and carries no version key', () => {
  const legacyRows = [{ enrollmentId: 'e1', processScore: null, finalExamScore: 5, gradeStatus: 'DRAFT' }];
  const draft = model.buildGradeDraft(legacyRows, { e1: { processScore: '7' } });
  assert.deepEqual(draft.changes, [{ enrollmentId: 'e1', processScore: 7, finalExamScore: 5 }]);
  assert.equal(Object.prototype.hasOwnProperty.call(draft.changes[0], 'version'), false);
  assert.equal(JSON.stringify(draft.changes), '[{"enrollmentId":"e1","processScore":7,"finalExamScore":5}]');
});

test('a locked row never carries a change even when it has a version', () => {
  const rows = [{ enrollmentId: 'e1', processScore: 1, finalExamScore: 2, gradeStatus: 'PUBLISHED', version: 4 }];
  assert.deepEqual(model.buildGradeDraft(rows, { e1: { processScore: '9' } }).changes, []);
});

test('sheet equality includes the row versions', () => {
  const loaded = { sectionId: 's1', rows: sheetRows };
  assert.equal(model.sameGradeSheet(loaded, { sectionId: 's1', rows: sheetRows.map((row) => ({ ...row })) }), true);
  assert.equal(
    model.sameGradeSheet(loaded, { sectionId: 's1', rows: [{ ...sheetRows[0], version: 4 }, sheetRows[1]] }),
    false,
  );
  assert.equal(
    model.sameGradeSheet(loaded, { sectionId: 's1', rows: [{ ...sheetRows[0], finalExamScore: 6 }, sheetRows[1]] }),
    false,
  );
  const legacy = { sectionId: 's1', rows: [{ enrollmentId: 'e1', processScore: 1, finalExamScore: 2 }] };
  assert.equal(model.sameGradeSheet(legacy, { sectionId: 's1', rows: [{ enrollmentId: 'e1', processScore: 1, finalExamScore: 2 }] }), true);
});

test('a refetched baseline lists exactly the rows that moved', () => {
  const nextRows = [
    { ...sheetRows[0], processScore: 6, version: 4 },
    sheetRows[1],
    { enrollmentId: 'e3', processScore: null, finalExamScore: null, version: 1 },
  ];
  assert.deepEqual(model.changedGradeRows(sheetRows, nextRows), ['e1', 'e3']);
  assert.deepEqual(model.changedGradeRows(sheetRows, sheetRows.map((row) => ({ ...row }))), []);
});

test('the client mapping keeps an enrollment version and leaves legacy rows unversioned', () => {
  const rows = client.sectionGradeRows({
    sectionId: 's1',
    enrollments: [
      { id: 'e1', studentId: 's1', studentName: 'Alpha', studentCode: 'A1', processScore: 7, finalExamScore: null, version: 6 },
      { id: 'e2', studentId: 's2', studentName: 'Bravo', studentCode: 'B1', processScore: null, finalExamScore: null },
    ],
  });
  assert.equal(rows[0].version, 6);
  assert.equal(rows[0].enrollmentId, 'e1');
  assert.equal(rows[1].version, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[1], 'version'), true);
});

test('a versioned grade save puts the loaded version in the PUT body', async () => {
  const fetchStub = installFetch(() => json(200, { message: 'saved' }));
  try {
    await client.campusApi.saveSectionGrades('s-1', [
      { enrollmentId: 'e1', processScore: 7, finalExamScore: 5, version: 6 },
    ]);
    assert.equal(fetchStub.calls.length, 1);
    assert.match(fetchStub.calls[0].url, /\/sections\/s-1\/grades$/);
    assert.equal(fetchStub.calls[0].init.method, 'PUT');
    assert.deepEqual(JSON.parse(fetchStub.calls[0].body), {
      grades: [{ enrollmentId: 'e1', processScore: 7, finalExamScore: 5, version: 6 }],
    });
  } finally {
    fetchStub.restore();
  }
});

test('a legacy grade save omits the version property from the PUT body', async () => {
  const fetchStub = installFetch(() => json(200, { message: 'saved' }));
  try {
    await client.campusApi.saveSectionGrades('s-1', [
      { enrollmentId: 'e1', processScore: 7, finalExamScore: null },
    ]);
    const body = JSON.parse(fetchStub.calls[0].body);
    assert.deepEqual(body, { grades: [{ enrollmentId: 'e1', processScore: 7, finalExamScore: null }] });
    assert.equal(Object.prototype.hasOwnProperty.call(body.grades[0], 'version'), false);
  } finally {
    fetchStub.restore();
  }
});
