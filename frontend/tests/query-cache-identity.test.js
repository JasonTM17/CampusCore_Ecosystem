const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function readSource(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

// Loads src/lib/query.ts with @tanstack/react-query stubbed so the module
// code really executes: the fake client records clear() calls and every
// `new QueryClient()` is observable through the instances array.
function loadQueryModule() {
  const instances = [];
  class FakeQueryClient {
    constructor(options) {
      this.options = options;
      this.clearCount = 0;
      instances.push(this);
    }
    clear() {
      this.clearCount += 1;
    }
  }
  const requireStub = (spec) => {
    if (spec === '@tanstack/react-query') {
      return { QueryClient: FakeQueryClient, useQuery: () => ({}) };
    }
    throw new Error(`unexpected import in query.ts: ${spec}`);
  };
  const source = readSource('src/lib/query.ts');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'query.ts',
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(requireStub, mod, mod.exports);
  return { exports: mod.exports, instances };
}

test('server-side calls always receive a fresh QueryClient', () => {
  const hadWindow = 'window' in globalThis;
  delete globalThis.window;
  try {
    const { exports: query, instances } = loadQueryModule();
    const first = query.getBrowserQueryClient();
    const second = query.getBrowserQueryClient();
    assert.notEqual(first, second, 'SSR must never share a QueryClient between calls');
    assert.equal(instances.length, 2);
  } finally {
    if (hadWindow === false) delete globalThis.window;
  }
});

test('browser calls share one lazily created QueryClient', () => {
  const { exports: query, instances } = loadQueryModule();
  globalThis.window = {};
  try {
    const first = query.getBrowserQueryClient();
    const second = query.getBrowserQueryClient();
    assert.equal(first, second);
    assert.equal(instances.length, 1);
    assert.equal(typeof first.clear, 'function');
    first.clear();
    assert.equal(first.clearCount, 1);
  } finally {
    delete globalThis.window;
  }
});

test('the provider mounts the shared browser client', () => {
  const provider = readSource('src/components/providers/query-provider.tsx');
  assert.match(provider, /useState\(getBrowserQueryClient\)/);
  assert.doesNotMatch(provider, /useState\(createQueryClient\)/);
});

test('AuthContext drops the query cache on every identity transition', () => {
  const source = readSource('src/context/AuthContext.tsx');
  const clears = (source.match(/getBrowserQueryClient\(\)\.clear\(\)/g) ?? []).length;
  // logout (always), login success, two-factor success, identity change,
  // and the dead-session path must each clear the shared cache.
  assert.ok(clears >= 4, `expected at least 4 clear() call sites, found ${clears}`);
  assert.match(source, /lastKnownUserIdRef/);
  // Every user write must go through the identity-aware setter so a changed
  // user id can drop the cache.
  assert.equal(
    (source.match(/\bsetUser\(/g) ?? []).length,
    1,
    'setUser should only appear inside the setUserIdentity helper',
  );
});

test('the dashboard layout re-arms the notification fetch for a new identity', () => {
  const source = readSource('src/app/dashboard/layout.tsx');
  assert.match(source, /notificationsUserIdRef/);
  assert.match(source, /notificationsRequested\.current = false/);
});
