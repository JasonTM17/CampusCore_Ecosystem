const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTs(relativePath) {
  const ts = require('typescript');
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, () => ({}));
  return moduleRecord.exports;
}

const {
  UPLOAD_MAX_BYTES,
  UPLOAD_ACCEPT_DOCUMENTS,
  UPLOAD_ACCEPT_COURSEWORK,
  UploadValidationError,
  assertUploadFile,
  validateUploadFile,
} = loadTs('src/lib/upload-validation.ts');

const file = (name, size, type) => ({ name, size, type });

// WEB-01/02/03: the three base64 JSON upload lanes used to accept any file
// into memory and let the server reject it (or worse, blow the 1 MiB JSON
// body cap mid-request). The client must now refuse the file before the
// bytes are ever read.

test('the size cap refuses a file one byte over and accepts the boundary', () => {
  assert.equal(validateUploadFile(file('evidence.pdf', UPLOAD_MAX_BYTES, 'application/pdf'), 'documents'), null);
  assert.equal(validateUploadFile(file('evidence.pdf', UPLOAD_MAX_BYTES + 1, 'application/pdf'), 'documents'), 'too-large');
  assert.equal(validateUploadFile(file('evidence.pdf', UPLOAD_MAX_BYTES + 1, 'application/pdf'), 'coursework'), 'too-large');
});

test('the documents lane mirrors the backend DOCUMENTS allowlist', () => {
  for (const type of ['application/pdf', 'image/png', 'image/jpeg', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
    assert.equal(validateUploadFile(file('cv', 1024, type), 'documents'), null, type);
  }
  for (const type of ['application/x-msdownload', 'text/html', 'image/gif',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'text/plain']) {
    assert.equal(validateUploadFile(file('cv', 1024, type), 'documents'), 'type-unsupported', type);
  }
});

test('the coursework lane adds the COURSEWORK extras but still refuses the rest', () => {
  for (const type of ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'text/plain']) {
    assert.equal(validateUploadFile(file('lab', 1024, type), 'coursework'), null, type);
  }
  assert.equal(validateUploadFile(file('run', 1024, 'application/x-msdownload'), 'coursework'), 'type-unsupported');
});

test('a missing MIME type falls back to the extension the accept filter advertised', () => {
  assert.equal(validateUploadFile(file('transcript.PDF', 1024, ''), 'documents'), null);
  assert.equal(validateUploadFile(file('notes.xlsx', 1024, ''), 'coursework'), null);
  assert.equal(validateUploadFile(file('notes.xlsx', 1024, ''), 'documents'), 'type-unsupported');
  assert.equal(validateUploadFile(file('payload.exe', 1024, ''), 'coursework'), 'type-unsupported');
});

test('assertUploadFile throws a coded UploadValidationError before any bytes are read', () => {
  assert.throws(
    () => assertUploadFile(file('big.pdf', UPLOAD_MAX_BYTES + 1, 'application/pdf'), 'documents'),
    (error) => error instanceof UploadValidationError && error.code === 'UPLOAD_TOO_LARGE',
  );
  assert.throws(
    () => assertUploadFile(file('evil.html', 10, 'text/html'), 'coursework'),
    (error) => error instanceof UploadValidationError && error.code === 'UPLOAD_TYPE_UNSUPPORTED',
  );
});

test('the API lanes validate before buffering the file (no full-file read on rejection)', () => {
  const careers = read('src/lib/careers-api.ts');
  const careersValidate = careers.indexOf("assertUploadFile(file, 'documents')");
  const careersRead = careers.indexOf('fileToBase64(file)');
  assert.ok(careersValidate >= 0, 'careers uploadAttachment must validate');
  assert.ok(careersRead > careersValidate, 'careers must refuse before base64 buffering');

  const learning = read('src/lib/learning-api.ts');
  const learningValidate = learning.indexOf("assertUploadFile(file, 'coursework')");
  const learningRead = learning.indexOf('file.arrayBuffer()');
  assert.ok(learningValidate >= 0, 'learning readFilePayload must validate');
  assert.ok(learningRead > learningValidate, 'learning must refuse before arrayBuffer()');

  const admissions = read('src/components/admissions/AdmissionsApplyPage.tsx');
  const admissionsValidate = admissions.indexOf("assertUploadFile(file, 'documents')");
  const admissionsRead = admissions.indexOf('file.arrayBuffer()');
  assert.ok(admissionsValidate >= 0, 'admissions pickFileBase64 must validate');
  assert.ok(admissionsRead > admissionsValidate, 'admissions must refuse before arrayBuffer()');
});

test('every upload input advertises the matching accept list', () => {
  assert.match(read('src/components/admissions/AdmissionsApplyPage.tsx'),
    /accept=\{UPLOAD_ACCEPT_DOCUMENTS\}/);
  assert.match(read('src/components/careers/CareersBoardPage.tsx'),
    /accept=\{UPLOAD_ACCEPT_DOCUMENTS\}/);
  const learning = read('src/components/learning/LearningConsolePage.tsx');
  assert.equal((learning.match(/accept=\{UPLOAD_ACCEPT_COURSEWORK\}/g) ?? []).length, 2,
    'student submission and staff material inputs both get the coursework accept list');
  assert.match(UPLOAD_ACCEPT_DOCUMENTS, /\.pdf/);
  assert.match(UPLOAD_ACCEPT_DOCUMENTS, /\.docx/);
  assert.match(UPLOAD_ACCEPT_COURSEWORK, /\.xlsx/);
});

test('WEB-02: careers keeps the picked file after a failed upload, clears only on success', () => {
  const source = read('src/components/careers/CareersBoardPage.tsx');
  const onChange = source.slice(
    source.indexOf('onChange={(event) => {'),
    source.indexOf('onChange={(event) => {') + 600,
  );
  assert.doesNotMatch(onChange, /target\.value\s*=\s*''/,
    'onChange must not clear the input before the request resolves');

  const uploadStart = source.indexOf('const upload = async');
  const uploadEnd = source.indexOf('if (authLoading)', uploadStart);
  const upload = source.slice(uploadStart, uploadEnd);
  const send = upload.indexOf('await careersApi.uploadAttachment');
  // The rejection path clears too (before `send`) — the assertion pins the
  // success-side clear that must come after the request resolves.
  const clear = upload.indexOf("if (input) input.value = '';", send);
  assert.ok(send >= 0 && clear > send,
    'the input is cleared only after the upload request succeeds');
});
