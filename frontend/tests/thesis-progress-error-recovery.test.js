const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('thesis progress error keeps round controls and retries the read', () => {
  const source = read('src/components/dashboard/thesis/ThesisProgressPage.tsx');

  const start = source.indexOf('if (progressError || !progress)');
  const end = source.indexOf('const progressIndex');
  assert.ok(start > -1 && end > start, 'the progress error branch exists');
  const branch = source.slice(start, end);

  assert.match(branch, /onRetry=\{\(\) => setProgressReloadToken\(\(token\) => token \+ 1\)\}/,
    'the error state offers a retry that re-runs the progress read');
  assert.match(branch, /href="\/dashboard\/thesis"/,
    'the error state keeps the way back to the thesis workspace');
  assert.match(branch, /<Select/, 'the round selector stays mounted on failure');

  assert.match(source, /const \[progressReloadToken, setProgressReloadToken\] = useState\(0\)/);
  assert.match(source, /progressReloadToken, selectedRound\?\.id\]/,
    'the retry token participates in the progress effect');
  assert.match(source, /progress\.attentionState === 'NOT_QUALIFIED'/,
    'the published not-qualified outcome still renders on the progress page');
});
