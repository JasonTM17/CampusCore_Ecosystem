const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/** Strips comments so explanatory prose can mention banned patterns freely. */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

async function loadCampusErrorModule() {
  const source = fs.readFileSync(path.join(root, 'src/lib/campus-error.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'campus-error.ts',
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

// A closed registration round is the only answer a sections/summary read may
// report as "empty". A 503, a 401, a network drop or an unknown code is an
// outage — it must surface as an error with retry, never as zero open
// sections or a silently missing credit cap.

test('only an exact WINDOW_CLOSED code may read as expected-empty', async () => {
  const { campusErrorCode } = await loadCampusErrorModule();
  const isExpectedEmpty = (error) => campusErrorCode(error) === 'WINDOW_CLOSED';

  assert.equal(
    isExpectedEmpty({ response: { status: 409, data: { code: 'WINDOW_CLOSED' } } }),
    true,
    'a closed round is the only expected-empty answer',
  );
  assert.equal(
    isExpectedEmpty({ response: { status: 503, data: { code: 'SERVICE_UNAVAILABLE' } } }),
    false,
    'a 503 is an outage, not an empty catalog',
  );
  assert.equal(
    isExpectedEmpty({ response: { status: 401, data: { code: 'UNAUTHORIZED' } } }),
    false,
    'a 401 is an auth failure, not an empty catalog',
  );
  assert.equal(isExpectedEmpty({ code: 'ERR_NETWORK' }), false);
  assert.equal(
    isExpectedEmpty({ response: { status: 409, data: { code: 'WINDOW_CLOSED_STALE' } } }),
    false,
    'look-alike codes still surface as errors',
  );
});

test('curriculum page keeps sections failures as errors and only maps WINDOW_CLOSED to empty', () => {
  const source = read('src/app/dashboard/curriculum/page.tsx');
  const code = codeOnly(source);

  assert.match(code, /campusErrorCode\(error\) === 'WINDOW_CLOSED'/);
  assert.doesNotMatch(code, /\.catch\(\(\)\s*=>\s*\[\]\)/,
    'swallowing every sections failure as [] masquerades outages as zero open sections');

  // The failure still reaches the user through an error state with retry.
  assert.match(code, /sectionsQuery\.isError/);
  assert.match(code, /sectionsQuery\.refetch\(\)/);
});

test('dashboard page keeps registration summary failures as errors', () => {
  const source = read('src/app/dashboard/page.tsx');
  const code = codeOnly(source);

  assert.match(code, /campusErrorCode\(error\) === 'WINDOW_CLOSED'/);
  assert.doesNotMatch(code, /\.catch\(\(\)\s*=>\s*null\)/,
    'swallowing every summary failure as null silently drops the credit cap');

  assert.match(code, /summaryQuery\.isError/, 'a failed summary read must surface as an error');
});
