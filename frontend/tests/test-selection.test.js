const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// A suite may stay out of `npm test` only when another gate owns it; list it
// here with that gate and the reason. Empty means every file runs here.
const excluded = new Map();

function registeredTests() {
  return packageJson.scripts.test
    .split(/\s+/)
    .filter((token) => token.startsWith('tests/'));
}

test('every test file in tests/ is registered in npm test exactly once', () => {
  const onDisk = fs
    .readdirSync(__dirname)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => `tests/${name}`)
    .sort();
  const registered = registeredTests();

  const duplicates = registered.filter((file, index) => registered.indexOf(file) !== index);
  assert.deepEqual(duplicates, [], 'npm test must not list a test file twice');

  const unaccounted = onDisk.filter((file) => !registered.includes(file) && !excluded.has(file));
  assert.deepEqual(unaccounted, [], 'test files exist but are never executed by npm test');

  const missing = registered.filter((file) => !onDisk.includes(file));
  assert.deepEqual(missing, [], 'npm test lists test files that do not exist');

  for (const [file, reason] of excluded) {
    assert.match(reason, /\S{10,}/, `${file} needs a documented exclusion reason`);
    assert.ok(onDisk.includes(file), `excluded file must exist: ${file}`);
  }
});
