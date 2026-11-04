import { execFileSync } from 'node:child_process';
import net from 'node:net';

const LOOPBACK_HOST = '127.0.0.1';
const CONNECT_TIMEOUT_MS = 250;
const PORT_POLL_MS = 250;
const STARTUP_PORT_GRACE_MS = 10_000;
const SHUTDOWN_PORT_TIMEOUT_MS = 30_000;
const SIGTERM_GRACE_MS = 10_000;

function defaultConnect(port, host, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, host);
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPortReachable(portValue, options = {}) {
  const {
    connect = defaultConnect,
    host = LOOPBACK_HOST,
    timeoutMs = CONNECT_TIMEOUT_MS,
  } = options;
  return connect(Number(portValue), host, timeoutMs);
}

export async function assertPortAvailable(portValue, label, options = {}) {
  const {
    graceMs = STARTUP_PORT_GRACE_MS,
    pollMs = PORT_POLL_MS,
    connect = defaultConnect,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = options;
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} port is invalid; refusing E2E startup`);
  }
  // An occupied host port is a hard collision, not a reason to stop or
  // reconfigure another developer's service. A port still draining from a
  // just-stopped sibling run gets a short bounded grace before it counts
  // as occupied.
  const deadline = now() + graceMs;
  for (;;) {
    if (!(await connect(port, LOOPBACK_HOST, CONNECT_TIMEOUT_MS))) return;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }
  throw new Error(`${label} port ${port} is already in use; refusing E2E collision`);
}

export async function waitForPortClosed(portValue, options = {}) {
  const {
    timeoutMs = SHUTDOWN_PORT_TIMEOUT_MS,
    pollMs = PORT_POLL_MS,
    connect = defaultConnect,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = options;
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`port ${portValue} is invalid; cannot wait for release`);
  }
  const deadline = now() + timeoutMs;
  for (;;) {
    if (!(await connect(port, LOOPBACK_HOST, CONNECT_TIMEOUT_MS))) return true;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(pollMs, remaining));
  }
}

export function processGroupSpawnOptions(platform = process.platform) {
  // POSIX: the child starts as a process-group leader so stopProcessTree can
  // signal the npm wrapper and the Next server together with kill(-pid).
  // Windows keeps the default group; taskkill /T handles its tree instead.
  return platform === 'win32' ? {} : { detached: true };
}

export async function stopProcessTree(child, options = {}) {
  const {
    platform = process.platform,
    port = null,
    kill = (pid, signal) => process.kill(pid, signal),
    taskkill = (pid) =>
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }),
    connect = defaultConnect,
    termGraceMs = SIGTERM_GRACE_MS,
    sleep = defaultSleep,
  } = options;

  const exited = () => !child || child.exitCode !== null || child.signalCode !== null;
  if (exited()) return;
  const closed = new Promise((resolve) => child.once('close', resolve));

  if (platform === 'win32') {
    // npm.cmd/cmd.exe can leave the Next child alive after SIGTERM. Kill only
    // this exact process tree so a failed run cannot leave port 3101 occupied;
    // the runner never broadens this to a name- or port-based kill.
    if (child.pid) {
      try {
        taskkill(child.pid);
      } catch {
        // The process may have exited between the status check and taskkill.
      }
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        // The spawn never produced a pid; there is nothing left to signal.
      }
    }
    await Promise.race([closed, sleep(termGraceMs)]);
    return;
  }

  signalProcessGroup(child, kill, 'SIGTERM');
  await Promise.race([closed, sleep(termGraceMs)]);
  // A group member can outlive the leader's close event; an exact group
  // SIGKILL covers both "leader still running" and "port still bound".
  if (exited() && !(port != null && (await connect(Number(port), LOOPBACK_HOST, CONNECT_TIMEOUT_MS)))) {
    return;
  }
  signalProcessGroup(child, kill, 'SIGKILL');
  await Promise.race([closed, sleep(termGraceMs)]);
}

function signalProcessGroup(child, kill, signal) {
  try {
    kill(-child.pid, signal);
  } catch {
    // The group is already gone or the child was not a group leader; fall
    // back to the single process so it is never left running.
    try {
      child.kill(signal);
    } catch {
      // The process exited between the status check and the signal.
    }
  }
}
