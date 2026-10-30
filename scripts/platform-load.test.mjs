import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { parseLoadArgs, runLoad, LIMITS } from './platform-load.mjs';
import { parseDrillConfig } from './ecosystem-backup-drill.mjs';

const baseArgs = ['--base-url', 'http://localhost:4010', '--scenario', 'mixed-academic', '--fixture', 'synthetic',
  '--concurrency', '10', '--duration-seconds', '60', '--out', 'artifacts/verification/master-plan/mp38-load'];
const replacing = (key, value) => baseArgs.map((arg, index) => baseArgs[index - 1] === key ? value : arg);

for (const url of [
  'https://example.com', 'http://localhost.example.com', 'http://127.0.0.1.example.com', 'http://192.168.1.1',
  'http://0.0.0.0', 'http://[::1]', 'http://127.1', 'http://2130706433', 'http://0x7f000001',
  'http://localhost@evil.invalid', 'http://user:password@localhost', 'file:///localhost', '//localhost',
  'http://localhost/path', 'http://localhost?token=sensitive', 'http://localhost#fragment',
  'http://localhost:0', 'http://localhost:65536', ' http://localhost', 'http://localhost\n',
]) {
  test(`reject wrong or ambiguous target: ${url.replaceAll('\n', '<newline>')}`, () => {
    assert.throws(() => parseLoadArgs(replacing('--base-url', url)));
  });
}

for (const [key, cap] of [['--concurrency', LIMITS.concurrency], ['--duration-seconds', LIMITS.durationSeconds]]) {
  for (const value of [String(cap + 1), '0', '-1', '1.5', '1e1', 'NaN', 'Infinity', '9007199254740992', ' 1', '01', '1\n']) {
    test(`reject invalid limit ${key}=${value}`, () => assert.throws(() => parseLoadArgs(replacing(key, value))));
  }
}

for (const args of [[], baseArgs.slice(0, -1), [...baseArgs, '--unknown', 'x'], [...baseArgs, '--out', 'duplicate'],
  ['--base-url=http://localhost', ...baseArgs.slice(2)], replacing('--scenario', 'unknown'), replacing('--scenario', '__proto__'),
  replacing('--fixture', 'production'), replacing('--out', ''), replacing('--out', 'bad\0path'),
  [...baseArgs, '--invariant-hook', 'hook.sh'], [...baseArgs, 'extra']]) {
  test(`reject malformed args case ${JSON.stringify(args)}`, () => assert.throws(() => parseLoadArgs(args)));
}

test('happy-path config parses without requests or filesystem writes', () => {
  const config = parseLoadArgs(baseArgs);
  assert.equal(config.baseUrl, 'http://127.0.0.1:4010');
  assert.equal(config.scenario, 'mixed-academic');
  assert.equal(config.fixture, 'synthetic');
  assert.equal(config.concurrency, 10);
  assert.equal(config.durationSeconds, 60);
  assert.equal(config.outDir, path.resolve('artifacts/verification/master-plan/mp38-load'));
  assert.equal(config.invariantHook, null);
});

test('exact cap boundaries and HTTPS loopback parse', () => {
  let args = replacing('--base-url', 'https://127.0.0.1:4443/');
  args[args.indexOf('--concurrency') + 1] = String(LIMITS.concurrency);
  args[args.indexOf('--duration-seconds') + 1] = String(LIMITS.durationSeconds);
  const config = parseLoadArgs([...args, '--invariant-hook', 'trusted-hook.mjs']);
  assert.equal(config.concurrency, 50);
  assert.equal(config.durationSeconds, 300);
  assert.equal(config.baseUrl, 'https://127.0.0.1:4443');
  assert.equal(config.invariantHook, path.resolve('trusted-hook.mjs'));
});

test('run entry rejects a tampered target before fetch (no load)', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('Unexpected fetch'); };
  try {
    await assert.rejects(runLoad({ ...parseLoadArgs(baseArgs), baseUrl: 'https://example.com' }));
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

const ownedEnv = { ECO_DRILL_CONTAINER: 'campusute-drill-mp38-postgres', ECO_DRILL_DB: 'campusute_drill_mp38', ECO_DRILL_DISPOSABLE: '1' };
for (const overrides of [
  { ECO_DRILL_CONTAINER: undefined }, { ECO_DRILL_DB: undefined }, { ECO_DRILL_DISPOSABLE: undefined },
  { ECO_DRILL_DISPOSABLE: 'true' }, { ECO_DRILL_CONTAINER: 'production-postgres' }, { ECO_DRILL_DB: 'campuscore' },
  { ECO_DRILL_CONTAINER: 'campusute-drill-owned;bad' }, { ECO_DRILL_DB: 'campusute_drill_owned";bad' },
  { ECO_DRILL_CONTAINER: 'campusute-drill-owned\n' }, { ECO_DRILL_DB: 'campusute_drill_owned\n' },
  { ECO_DRILL_DB: `campusute_drill_${'x'.repeat(64)}` }, { ECO_DRILL_USER: '-admin' },
  { ECO_DRILL_WRITER: 'production-api' }, { ECO_DRILL_WRITER: ownedEnv.ECO_DRILL_CONTAINER },
]) {
  test(`drill refuses missing/unsafe target: ${JSON.stringify(overrides)}`, () => assert.throws(() => parseDrillConfig([], { ...ownedEnv, ...overrides })));
}

test('drill requires explicit disposable names, without runtime calls', () => {
  const config = parseDrillConfig(['--keep'], ownedEnv);
  assert.equal(config.container, ownedEnv.ECO_DRILL_CONTAINER);
  assert.equal(config.db, ownedEnv.ECO_DRILL_DB);
  assert.equal(config.keep, true);
  assert.deepEqual(config.hooks, {});
});

test('drill rejects malformed flags and mutable previous image', () => {
  for (const args of [['--out'], ['--keep', '--keep'], ['--unknown'], ['--previous-image', 'latest'], ['--previous-image', `sha256:${'a'.repeat(64)}\n`], ['--previous-image-hook', 'hook.mjs']]) {
    assert.throws(() => parseDrillConfig(args, ownedEnv));
  }
  assert.equal(parseDrillConfig(['--previous-image', `sha256:${'a'.repeat(64)}`], ownedEnv).previousImage, `sha256:${'a'.repeat(64)}`);
});
