const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/** Strips comments so explanatory prose can mention Date.now() freely. */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function loadTs(relativePath, fakeRequire) {
  const ts = require('typescript');
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, fakeRequire);
  return moduleRecord.exports;
}

// WEB-09: deadline-driven UI read Date.now() once at render and then froze —
// "registration open", "days remaining" and "submit before the deadline"
// stayed wrong until an unrelated re-render. A ticking useNow hook now feeds
// every render-time deadline check.

test('useNow stays SSR-stable at 0, then ticks on mount and cleans up', () => {
  const effects = [];
  const setCalls = [];
  const intervals = [];
  const cleared = [];
  const fakeReact = {
    useState: (initial) => [initial, (value) => setCalls.push(value)],
    useEffect: (cb) => effects.push(cb),
  };
  const window = {
    setInterval: (cb, ms) => { intervals.push({ cb, ms }); return intervals.length; },
    clearInterval: (id) => cleared.push(id),
  };
  const previous = globalThis.window;
  globalThis.window = window;
  try {
    const { useNow } = loadTs('src/lib/use-now.ts', (id) => {
      assert.equal(id, 'react', 'only react may be imported');
      return fakeReact;
    });

    assert.equal(useNow(5_000), 0, 'pre-mount value must be 0 (SSR/hydration parity)');
    assert.equal(effects.length, 1, 'one effect registers the ticking clock');

    const cleanup = effects[0]();
    assert.ok(setCalls.length >= 1 && setCalls.every((v) => v > 0),
      'the first effect tick supplies a real timestamp');
    assert.equal(intervals.length, 1, 'one interval keeps the clock live');
    assert.equal(intervals[0].ms, 5_000, 'the caller interval is honoured');

    intervals[0].cb();
    assert.ok(setCalls.length >= 2, 'the interval keeps refreshing the value');

    cleanup();
    assert.deepEqual(cleared, [1], 'unmount clears the interval');
  } finally {
    globalThis.window = previous;
  }
});

test('the GVPB review panel reads the live clock, not a render-time Date.now()', () => {
  const source = read('src/features/thesis/components/GvpbReviewPanel.tsx');
  assert.match(source, /const now = useNow\(\)/);
  assert.match(source, /Date\.parse\(deadline\) < now/);
  assert.doesNotMatch(codeOnly(source), /Date\.now\(/,
    'no render-time clock may remain in the review panel');
});

test('the dashboard thesis page drives every deadline check from useNow', () => {
  const source = read('src/app/dashboard/thesis/page.tsx');
  assert.match(source, /const nowMs = useNow\(\)/);
  assert.doesNotMatch(codeOnly(source), /Date\.now\(/,
    'registration window, days-remaining and deadline-passed all read nowMs');
  assert.match(source, /\}, \[selectedRound, nowMs\]\)/,
    'the registration-window memo re-evaluates as the clock ticks');
});
