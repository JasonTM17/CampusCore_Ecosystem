import test from 'node:test';
import assert from 'node:assert/strict';
import { stopChildrenTree, installKillGuard } from './ecosystem-verify-shared.mjs';

function fakeExec() {
  const calls = [];
  return {
    calls,
    fn: (cmd, argv, opts) => { calls.push([cmd, argv, opts]); },
  };
}

test('win32: every tracked child gets taskkill /t /f, even an exited wrapper', () => {
  const { calls, fn } = fakeExec();
  const children = [
    { pid: 1111, exitCode: null, kill: () => {} },          // still running
    { pid: 2222, exitCode: 0, kill: () => {} },             // cmd.exe wrapper exited
    { pid: 3333, exitCode: null, signalCode: 'SIGTERM', kill: () => {} },
  ];
  stopChildrenTree(children, { exec: fn, platform: 'win32' });
  assert.equal(calls.length, 3, 'every pid must be tree-killed, alive or dead');
  for (const [i, pid] of [1111, 2222, 3333].entries()) {
    assert.equal(calls[i][0], 'taskkill');
    assert.deepEqual(calls[i][1], ['/pid', String(pid), '/t', '/f']);
  }
});

test('win32: a child without a pid is skipped, taskkill failures do not throw', () => {
  const { fn } = fakeExec();
  const throwing = () => { throw new Error('taskkill missing'); };
  assert.doesNotThrow(() =>
    stopChildrenTree([{ pid: null, kill: () => {} }, { pid: 9, kill: () => {} }],
      { exec: throwing, platform: 'win32' }));
});

test('non-win32: only live children get SIGTERM', () => {
  const killed = [];
  const live = { pid: 1, exitCode: null, signalCode: null, kill: (s) => killed.push(s) };
  const dead = { pid: 2, exitCode: 0, signalCode: null, kill: () => killed.push('dead') };
  stopChildrenTree([live, dead], { platform: 'linux' });
  assert.deepEqual(killed, ['SIGTERM']);
});

test('installKillGuard: signal handlers tear the tree down then exit', () => {
  const events = [];
  const onceCalls = [];
  // Capture the registered handlers without touching the real emitter.
  const fakeProcess = process;
  const registered = {};
  const spy = (event, handler) => { registered[event] = handler; return onceCalls.push(event), fakeProcess; };
  const prevOnce = process.once;
  process.once = spy;
  try {
    installKillGuard([], {
      exit: (code) => events.push(`exit:${code}`),
      teardown: () => events.push('down'),
    });
  } finally {
    process.once = prevOnce;
  }
  for (const event of ['SIGINT', 'SIGTERM', 'uncaughtException']) {
    assert.ok(registered[event], `${event} handler registered`);
  }
  registered.SIGINT();
  assert.deepEqual(events, ['down', 'exit:130']);
  events.length = 0;
  registered.SIGTERM();
  assert.deepEqual(events, ['down', 'exit:143']);
});
