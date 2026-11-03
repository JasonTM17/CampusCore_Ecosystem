import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertPortAvailable,
  isPortReachable,
  processGroupSpawnOptions,
  stopProcessTree,
  waitForPortClosed,
} from './e2e-process-control.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const posixOnly = process.platform === 'win32'
  ? { skip: 'POSIX process-group signalling does not exist on win32; covered by the Linux CI host' }
  : {};

let fixture = null;
test.after(() => {
  if (!fixture) return;
  // Only the known, newly created fixture directory may be removed recursively.
  assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(fixture).startsWith('e2e-process-control-'));
  fs.rmSync(fixture, { recursive: true, force: true });
});

function virtualClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
}

function realConnect(port, host, timeoutMs) {
  return isPortReachable(port, { host, timeoutMs });
}

function listen() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.unref();
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = [];
  child.kill = (signal) => {
    child.killed.push(signal);
    return true;
  };
  child.finish = (signalCode, exitCode = null) => {
    child.exitCode = exitCode;
    child.signalCode = signalCode;
    child.emit('close', exitCode, signalCode);
  };
  return child;
}

test('processGroupSpawnOptions detaches only off win32', () => {
  assert.deepEqual(processGroupSpawnOptions('linux'), { detached: true });
  assert.deepEqual(processGroupSpawnOptions('darwin'), { detached: true });
  assert.deepEqual(processGroupSpawnOptions('win32'), {});
});

test('assertPortAvailable rejects an invalid port before probing', async () => {
  let probes = 0;
  await assert.rejects(
    assertPortAvailable('not-a-port', 'Frontend', { connect: async () => {
      probes += 1;
      return true;
    } }),
    /Frontend port is invalid; refusing E2E startup/,
  );
  assert.equal(probes, 0);
});

test('assertPortAvailable returns on the first free probe', async () => {
  const server = await listen();
  const port = server.address().port;
  await closeServer(server);
  let probes = 0;
  await assertPortAvailable(String(port), 'Frontend', {
    connect: async (value, host, timeoutMs) => {
      probes += 1;
      return realConnect(value, host, timeoutMs);
    },
  });
  assert.equal(probes, 1);
});

test('assertPortAvailable retries through the grace then refuses a staying listener', async () => {
  const server = await listen();
  const port = server.address().port;
  try {
    const clock = virtualClock();
    let probes = 0;
    await assert.rejects(
      assertPortAvailable(String(port), 'Frontend', {
        graceMs: 10_000,
        pollMs: 250,
        now: clock.now,
        sleep: clock.sleep,
        connect: async (value, host, timeoutMs) => {
          probes += 1;
          return realConnect(value, host, timeoutMs);
        },
      }),
      (error) => {
        assert.equal(
          error.message,
          `Frontend port ${port} is already in use; refusing E2E collision`,
        );
        return true;
      },
    );
    assert.equal(probes, 41, 'the port must be re-probed for the whole grace before refusing');
  } finally {
    await closeServer(server);
  }
});

test('assertPortAvailable accepts a listener that releases during the grace', async () => {
  const server = await listen();
  const port = server.address().port;
  const clock = virtualClock();
  let probes = 0;
  await assertPortAvailable(String(port), 'Frontend', {
    graceMs: 10_000,
    pollMs: 250,
    now: clock.now,
    sleep: clock.sleep,
    connect: async (value, host, timeoutMs) => {
      probes += 1;
      if (probes === 3) await closeServer(server);
      return realConnect(value, host, timeoutMs);
    },
  });
  assert.equal(probes, 3);
});

test('waitForPortClosed reports a staying listener after the bounded wait', async () => {
  const server = await listen();
  try {
    const clock = virtualClock();
    const released = await waitForPortClosed(server.address().port, {
      timeoutMs: 1_000,
      pollMs: 250,
      now: clock.now,
      sleep: clock.sleep,
      connect: realConnect,
    });
    assert.equal(released, false);
  } finally {
    await closeServer(server);
  }
});

test('waitForPortClosed returns as soon as the listener goes away', async () => {
  const server = await listen();
  const port = server.address().port;
  const clock = virtualClock();
  let probes = 0;
  const released = await waitForPortClosed(port, {
    timeoutMs: 30_000,
    pollMs: 250,
    now: clock.now,
    sleep: clock.sleep,
    connect: async (value, host, timeoutMs) => {
      probes += 1;
      if (probes === 2) await closeServer(server);
      return realConnect(value, host, timeoutMs);
    },
  });
  assert.equal(released, true);
  assert.equal(probes, 2);
});

test('stopProcessTree is a no-op for an already exited child', async () => {
  const child = fakeChild(4321);
  child.exitCode = 0;
  let signalled = 0;
  await stopProcessTree(child, {
    platform: 'linux',
    kill: () => {
      signalled += 1;
    },
  });
  assert.equal(signalled, 0);
  assert.deepEqual(child.killed, []);
});

test('stopProcessTree signals the exact group and stops once SIGTERM lands', async () => {
  const child = fakeChild(7777);
  const signals = [];
  await stopProcessTree(child, {
    platform: 'linux',
    sleep: async () => {},
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      child.finish(signal);
    },
  });
  assert.deepEqual(signals, [[-7777, 'SIGTERM']]);
  assert.deepEqual(child.killed, []);
});

test('stopProcessTree escalates to a group SIGKILL when the leader ignores SIGTERM', async () => {
  const child = fakeChild(8888);
  const signals = [];
  await stopProcessTree(child, {
    platform: 'linux',
    sleep: async () => {},
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGKILL') child.finish(signal);
    },
  });
  assert.deepEqual(signals, [[-8888, 'SIGTERM'], [-8888, 'SIGKILL']]);
});

test('stopProcessTree escalates when the port stays held after the leader exits', async () => {
  const child = fakeChild(8888);
  const signals = [];
  let probes = 0;
  await stopProcessTree(child, {
    platform: 'linux',
    port: 3101,
    sleep: async () => {},
    connect: async () => {
      probes += 1;
      return true;
    },
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGTERM') child.finish(signal);
    },
  });
  assert.deepEqual(signals, [[-8888, 'SIGTERM'], [-8888, 'SIGKILL']]);
  assert.equal(probes, 1);
});

test('stopProcessTree does not escalate once the leader is gone and the port is free', async () => {
  const child = fakeChild(8888);
  const signals = [];
  await stopProcessTree(child, {
    platform: 'linux',
    port: 3101,
    sleep: async () => {},
    connect: async () => false,
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      child.finish(signal);
    },
  });
  assert.deepEqual(signals, [[-8888, 'SIGTERM']]);
});

test('stopProcessTree falls back to the single pid when no group exists', async () => {
  const child = fakeChild(9999);
  child.kill = (signal) => {
    child.killed.push(signal);
    child.finish(signal);
    return true;
  };
  await stopProcessTree(child, {
    platform: 'linux',
    sleep: async () => {},
    kill: () => {
      throw new Error('ESRCH');
    },
  });
  assert.deepEqual(child.killed, ['SIGTERM']);
});

test('stopProcessTree uses taskkill /T /F on the exact pid on win32', async () => {
  const child = fakeChild(5555);
  const pids = [];
  let groupSignals = 0;
  await stopProcessTree(child, {
    platform: 'win32',
    sleep: async () => {},
    kill: () => {
      groupSignals += 1;
    },
    taskkill: (pid) => {
      pids.push(pid);
      child.finish(null, 1);
    },
  });
  assert.deepEqual(pids, [5555]);
  assert.equal(groupSignals, 0);
  assert.deepEqual(child.killed, []);
});

test('stopProcessTree on win32 without a pid signals only the child handle', async () => {
  const child = fakeChild(undefined);
  child.kill = (signal) => {
    child.killed.push(signal);
    child.finish(signal);
    return true;
  };
  let taskkills = 0;
  await stopProcessTree(child, {
    platform: 'win32',
    sleep: async () => {},
    taskkill: () => {
      taskkills += 1;
    },
  });
  assert.equal(taskkills, 0);
  assert.deepEqual(child.killed, ['SIGTERM']);
});

function startDetachedParent() {
  fixture ??= fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-process-control-'));
  const parentPath = path.join(fixture, 'parent.mjs');
  const grandchildSource = `const net = require('node:net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  process.stdout.write('READY ' + server.address().port + ' ' + process.pid + '\\n');
});`;
  fs.writeFileSync(
    parentPath,
    `import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
setInterval(() => {}, 1 << 30);
`,
  );
  const child = spawn(process.execPath, [parentPath], {
    detached: true,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('fixture grandchild did not report its port')), 10_000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const match = /READY (\d+) (\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve({ child, port: Number(match[1]), grandchildPid: Number(match[2]) });
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      if (!/READY \d+ \d+/.test(buffer)) {
        clearTimeout(timer);
        reject(new Error(`fixture parent exited before the grandchild bound (${code})`));
      }
    });
  });
}

function waitExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error('child did not exit in time')), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test('a single-pid SIGTERM leaves the spawned grandchild listener alive', posixOnly, async () => {
  const { child, port, grandchildPid } = await startDetachedParent();
  try {
    child.kill('SIGTERM');
    await waitExit(child);
    assert.equal(
      await isPortReachable(port),
      true,
      'signalling only the wrapper pid must reproduce the leaked-listener failure',
    );
  } finally {
    try {
      process.kill(grandchildPid, 'SIGKILL');
    } catch {
      // The grandchild may already be gone when an earlier assertion failed.
    }
    await waitForPortClosed(port, { timeoutMs: 10_000 });
  }
});

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // A dead grandchild reparented to a non-reaping PID 1 stays in the process
  // table as a zombie; a zombie still answers signal 0 but is not alive.
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch {
    return false;
  }
}

test('stopProcessTree releases the port held by the spawned process group', posixOnly, async () => {
  const { child, port, grandchildPid } = await startDetachedParent();
  await stopProcessTree(child, { port });
  assert.equal(
    await waitForPortClosed(port, { timeoutMs: 10_000 }),
    true,
    'the whole spawned group must die so the port is free for the next run',
  );
  assert.equal(await isPortReachable(port), false);
  assert.equal(
    isProcessAlive(grandchildPid),
    false,
    'the grandchild listener must be gone, not just unbound',
  );
});

test('run-course-e2e.mjs wires the group spawn and the bounded port drain', () => {
  const runner = fs.readFileSync(path.join(repo, 'scripts/run-course-e2e.mjs'), 'utf8');
  assert.match(runner, /from '\.\/e2e-process-control\.mjs'/);
  assert.match(runner, /\.\.\.processGroupSpawnOptions\(\)/);
  assert.match(runner, /await stopProcessTree\(frontend, \{ port: frontendPort \}\)/);
  assert.match(runner, /await waitForPortClosed\(frontendPort\)/);
});
