import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

import {
  appendLine,
  assertNamespaceHasRuntimeStack,
  baseURL,
  classifyPortForwardLine,
  edgeStatePath,
  ensureClusterAvailable,
  getEdgeKubectlPid,
  namespace,
  probeLocalEdgeContractOnce,
  readEdgeState,
  removeEdgeState,
  repoRoot,
  runCli,
  writeEdgeState,
  writeJsonSummary,
} from './k8s-local-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const logsDir = args.logsDir;

if (!logsDir) {
  throw new Error('--logs-dir is required for the K8s edge supervisor.');
}

const rawLogPath = path.join(logsDir, 'port-forward.raw.log');
const classifiedLogPath = path.join(logsDir, 'port-forward.classified.log');
const statusSummaryPath = path.join(logsDir, 'edge-supervisor-summary.json');
const HEALTH_CHECK_INTERVAL_MS = 15000;
const RESTART_BACKOFF_MS = [1000, 3000, 5000];
const STARTUP_HEALTH_RETRY_MS = 1000;
const STARTUP_HEALTH_TIMEOUT_MS = 15000;

let stopping = false;
let kubectlChild = null;
let restartCount = 0;
let observedNoiseCount = 0;
let observedRuntimeErrorCount = 0;
let lastHealthyAt = null;

process.on('SIGTERM', () => {
  stopping = true;
  if (kubectlChild && !kubectlChild.killed) {
    kubectlChild.kill('SIGTERM');
  }
});

process.on('SIGINT', () => {
  stopping = true;
  if (kubectlChild && !kubectlChild.killed) {
    kubectlChild.kill('SIGTERM');
  }
});

await runCli(main);

async function main() {
  await mkdir(logsDir, { recursive: true });
  const existingState = await readEdgeState();
  restartCount = Number(existingState?.restartCount ?? 0);
  observedNoiseCount = Number(existingState?.observedNoiseCount ?? 0);
  observedRuntimeErrorCount = Number(
    existingState?.observedRuntimeErrorCount ?? 0,
  );
  lastHealthyAt = existingState?.lastHealthyAt ?? null;

  while (!stopping) {
    const runtimeStatus = await getRuntimeStatus();
    if (!runtimeStatus.ready) {
      await persistState({
        status: runtimeStatus.status,
        kubectlPid: null,
        lastError: runtimeStatus.message,
      });
      await delay(RESTART_BACKOFF_MS[Math.min(restartCount, RESTART_BACKOFF_MS.length - 1)]);
      continue;
    }

    kubectlChild = spawn(
      'kubectl',
      ['-n', namespace, 'port-forward', 'service/campuscore-nginx', '8080:80'],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      },
    );

    bindLogStream(kubectlChild.stdout, 'stdout');
    bindLogStream(kubectlChild.stderr, 'stderr');

    await persistState({
      status: 'starting',
      kubectlPid: kubectlChild.pid ?? null,
      lastError: null,
    });

    await warmUpHealthStatus();
    const healthTimer = setInterval(() => {
      void refreshHealthStatus();
    }, HEALTH_CHECK_INTERVAL_MS);

    const exitInfo = await waitForExit(kubectlChild);
    clearInterval(healthTimer);
    kubectlChild = null;

    if (stopping) {
      break;
    }

    restartCount += 1;
    await persistState({
      status: 'restarting',
      kubectlPid: null,
      restartCount,
      lastExitAt: new Date().toISOString(),
      lastExitCode: exitInfo.code,
      lastExitSignal: exitInfo.signal,
    });
    await delay(RESTART_BACKOFF_MS[Math.min(restartCount - 1, RESTART_BACKOFF_MS.length - 1)]);
  }

  await persistState({
    status: 'stopped',
    kubectlPid: null,
  });
}

async function warmUpHealthStatus() {
  const deadline = Date.now() + STARTUP_HEALTH_TIMEOUT_MS;
  let lastError = null;

  while (!stopping && kubectlChild && Date.now() < deadline) {
    try {
      await probeLocalEdgeContractOnce(5000);
      lastHealthyAt = new Date().toISOString();
      await persistState({
        status: 'healthy',
        kubectlPid: kubectlChild.pid ?? null,
        lastHealthyAt,
        lastError: null,
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await persistState({
        status: 'starting',
        kubectlPid: kubectlChild.pid ?? null,
        lastError,
      });
      await delay(STARTUP_HEALTH_RETRY_MS);
    }
  }

  await persistState({
    status: 'degraded',
    kubectlPid: kubectlChild?.pid ?? null,
    lastError: lastError ?? 'Timed out waiting for local edge health during startup.',
  });
}

async function refreshHealthStatus() {
  if (stopping || !kubectlChild) {
    return;
  }

  try {
    await probeLocalEdgeContractOnce(5000);
    lastHealthyAt = new Date().toISOString();
    await persistState({
      status: 'healthy',
      kubectlPid: kubectlChild.pid ?? null,
      lastHealthyAt,
      lastError: null,
    });
  } catch (error) {
    await persistState({
      status: 'degraded',
      kubectlPid: kubectlChild.pid ?? null,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getRuntimeStatus() {
  try {
    await ensureClusterAvailable();
  } catch (error) {
    return {
      ready: false,
      status: 'waiting-for-cluster',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    await assertNamespaceHasRuntimeStack();
  } catch (error) {
    return {
      ready: false,
      status: 'waiting-for-runtime',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ready: true,
    status: 'healthy',
    message: null,
  };
}

function bindLogStream(stream, streamName) {
  const streamSink = createWriteStream(rawLogPath, { flags: 'a' });
  const lineReader = readline.createInterface({ input: stream });

  stream.on('data', (chunk) => {
    streamSink.write(chunk);
  });
  stream.on('close', () => {
    streamSink.end();
  });

  lineReader.on('line', async (line) => {
    const classification = classifyPortForwardLine(line);
    const event = {
      at: new Date().toISOString(),
      stream: streamName,
      kind: classification.kind,
      severity: classification.severity,
      actionable: classification.actionable,
      message: line,
    };

    if (classification.kind === 'client-disconnect-noise') {
      observedNoiseCount += 1;
    }

    if (classification.kind === 'runtime-error') {
      observedRuntimeErrorCount += 1;
      await persistState({
        status: 'degraded',
        kubectlPid: getEdgeKubectlPid(await readEdgeState()),
        lastRuntimeErrorAt: event.at,
        lastRuntimeError: line,
      });
    }

    await appendLine(classifiedLogPath, JSON.stringify(event));
    await writeJsonSummary(logsDir, path.basename(statusSummaryPath), {
      supervisorPid: process.pid,
      kubectlPid: kubectlChild?.pid ?? null,
      namespace,
      baseURL,
      status: (await readEdgeState())?.status ?? 'unknown',
      restartCount,
      observedNoiseCount,
      observedRuntimeErrorCount,
      lastHealthyAt,
      stateFile: edgeStatePath,
      rawLogPath,
      classifiedLogPath,
    });
  });
}

async function persistState(patch) {
  const current = (await readEdgeState()) ?? {};
  const nextState = {
    ...current,
    pid: process.pid,
    supervisorPid: process.pid,
    kubectlPid: patch.kubectlPid ?? kubectlChild?.pid ?? null,
    namespace,
    baseURL,
    status: patch.status ?? current.status ?? 'starting',
    startedAt: current.startedAt ?? new Date().toISOString(),
    lastHealthyAt: patch.lastHealthyAt ?? lastHealthyAt ?? current.lastHealthyAt ?? null,
    restartCount: patch.restartCount ?? restartCount,
    observedNoiseCount,
    observedRuntimeErrorCount,
    logs: {
      supervisorStdoutPath: current.logs?.supervisorStdoutPath ?? path.join(logsDir, 'edge-supervisor.out.log'),
      supervisorStderrPath: current.logs?.supervisorStderrPath ?? path.join(logsDir, 'edge-supervisor.err.log'),
      rawPortForwardLogPath: rawLogPath,
      classifiedPortForwardLogPath: classifiedLogPath,
    },
    ...patch,
  };

  await writeEdgeState(nextState);
  await writeJsonSummary(logsDir, path.basename(statusSummaryPath), {
    supervisorPid: process.pid,
    kubectlPid: nextState.kubectlPid,
    namespace,
    baseURL,
    status: nextState.status,
    restartCount: nextState.restartCount,
    observedNoiseCount,
    observedRuntimeErrorCount,
    lastHealthyAt: nextState.lastHealthyAt,
    stateFile: edgeStatePath,
    rawLogPath,
    classifiedLogPath,
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--logs-dir') {
      parsed.logsDir = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}
