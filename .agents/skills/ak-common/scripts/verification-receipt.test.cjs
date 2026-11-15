'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { capture, check, validateSpec, redact } = require('./verification-receipt.cjs');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit receipt space-'));
  try {
    fs.mkdirSync(path.join(root, 'scope-đúng'));
    fs.writeFileSync(path.join(root, 'scope-đúng', 'source.txt'), 'v1');
    const spec = { version: 1, commandId: 'test:fixture', argv: [process.execPath, '-e', 'process.stdout.write("ok")'], cwd: '.', scope: ['scope-đúng/source.txt'], timeoutMs: 1000 };
    return fn(root, spec);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('real execution receipt passes only at matching scope', () => fixture((root, spec) => {
  const receipt = capture(root, spec);
  assert.equal(receipt.status, 'PASS');
  assert.equal(check(root, spec, receipt).status, 'PASS');
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'unrelated');
  assert.equal(check(root, spec, receipt).status, 'PASS');
  fs.writeFileSync(path.join(root, 'scope-đúng', 'source.txt'), 'v2');
  assert.match(check(root, spec, receipt).reason, /stale scope/);
}));

test('nonzero, timeout and missing command never become PASS', () => fixture((root, spec) => {
  spec.argv = [process.execPath, '-e', 'process.exit(7)'];
  let receipt = capture(root, spec);
  assert.equal(receipt.status, 'FAIL'); assert.equal(check(root, spec, receipt).status, 'FAIL');
  spec.argv = [process.execPath, '-e', 'setTimeout(() => {}, 1000)']; spec.timeoutMs = 100;
  receipt = capture(root, spec);
  assert.equal(receipt.status, 'FAIL'); assert.equal(receipt.timedOut, true);
  spec.argv = ['agentkit-command-that-does-not-exist'];
  receipt = capture(root, spec);
  assert.equal(receipt.status, 'BLOCKED_CAPABILITY');
}));

test('scope mutation during test invalidates its receipt', () => fixture((root, spec) => {
  spec.argv = [process.execPath, '-e', 'require("fs").writeFileSync("scope-đúng/source.txt", "v2")'];
  const receipt = capture(root, spec);
  assert.equal(receipt.status, 'FAIL'); assert.match(receipt.reason, /scope changed/);
}));

test('structured argv and path boundaries reject traversal', () => fixture((root, spec) => {
  for (const bad of ['../outside', 'C:/outside', 'scope-đúng/../outside']) {
    assert.throws(() => validateSpec({ ...spec, scope: [bad] }));
  }
  assert.throws(() => validateSpec({ ...spec, shell: true }));
  assert.throws(() => validateSpec({ ...spec, env: { SECRET: 'x' } }));
  const link = path.join(root, 'scope-đúng', 'link');
  try { fs.symlinkSync(os.tmpdir(), link, 'dir'); assert.throws(() => capture(root, { ...spec, scope: ['scope-đúng/link'] })); }
  catch (error) { if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error; }
}));

test('redacts secrets, home paths and credentials in output', () => fixture((root, spec) => {
  spec.argv = [process.execPath, '-e', 'console.log("Bearer abc123 api_key=verysecret sk-abcdefghijk")'];
  const receipt = capture(root, spec);
  assert.equal(receipt.status, 'PASS');
  assert.doesNotMatch(receipt.stdout, /abc123|verysecret|sk-abcdefghijk/);
  assert.equal(receipt.outputPolicy, 'suppressed');
  assert.equal(receipt.stdout, '');
  assert.equal(receipt.stderr, '');
  assert.equal(redact(os.homedir()), '[HOME]');
  assert.equal(redact(os.homedir().replace(/\\/g, '/')), '[HOME]');
  assert.equal(redact('ghp_' + 'A'.repeat(36)), '[REDACTED]');
}));

test('arbitrary sensitive output is suppressed even without recognizable patterns', () => fixture((root, spec) => {
  spec.argv = [process.execPath, '-e', 'process.stdout.write("private customer data"); process.stderr.write("unrecognized credential")'];
  const receipt = capture(root, spec);
  assert.equal(receipt.status, 'PASS');
  assert.doesNotMatch(JSON.stringify(receipt), /private customer data|unrecognized credential/);
}));

test('expired and mismatched command receipts fail', () => fixture((root, spec) => {
  spec.maxAgeMs = 10;
  const receipt = capture(root, spec);
  assert.equal(check(root, spec, receipt, Date.parse(receipt.startedAt) + 11).status, 'FAIL');
  assert.equal(check(root, { ...spec, commandId: 'test:other' }, receipt).status, 'FAIL');
  assert.equal(check(root, spec, { ...receipt, status: 'PASS', exitCode: 1 }).status, 'FAIL');
}));
