import { mkdir, readFile } from 'node:fs/promises';

import {
  assertNamespaceHasRuntimeStack,
  baseURL,
  cleanupStaleEdgeState,
  edgeStatePath,
  ensureClusterAvailable,
  isProcessRunning,
  namespace,
  readEdgeState,
  removeEdgeState,
  resolveLogsDir,
  run,
  runCli,
  runPreflight,
  startDetachedPortForward,
  stopDetachedProcess,
  waitForLocalEdgeHealthy,
  writeEdgeState,
  writeJsonSummary,
} from './k8s-local-lib.mjs';

const logsDir = resolveLogsDir('k8s-local-edge');

async function main() {
  await markProgress('start');
  await runPreflight();
  await markProgress('after-preflight');
  await ensureClusterAvailable();
  await markProgress('after-cluster-check');
  await assertNamespaceHasRuntimeStack();
  await markProgress('after-namespace-check');

  const existingState = await cleanupStaleEdgeState();
  await markProgress('after-state-cleanup', {
    hasExistingState: Boolean(existingState?.pid),
  });
  if (existingState?.pid && (await isProcessRunning(existingState.pid))) {
    try {
      const summary = await verifyLocalHealth();
      await markProgress('after-existing-health-verify');
      await writeEdgeState({
        ...existingState,
        lastVerifiedAt: new Date().toISOString(),
      });
      await markProgress('after-existing-state-write');
      await mkdir(logsDir, { recursive: true });
      await writeJsonSummary(logsDir, 'edge-summary.json', {
        mode: 'reused-existing-port-forward',
        namespace,
        baseURL,
        pid: existingState.pid,
        stateFile: edgeStatePath,
        logs: existingState.logs ?? null,
        summary,
      });
      await markProgress('after-existing-summary');
      printAccessInstructions(existingState.pid);
      return;
    } catch {
      await stopDetachedProcess(existingState.pid);
      await removeEdgeState();
    }
  }

  await mkdir(logsDir, { recursive: true });
  const portForward = await startDetachedPortForward(logsDir);
  await markProgress('after-port-forward-start', {
    pid: portForward.pid,
  });

  try {
    const summary = await verifyLocalHealth();
    await markProgress('after-health-verify');
    const state = {
      pid: portForward.pid,
      namespace,
      baseURL,
      startedAt: new Date().toISOString(),
      logs: {
        stdoutPath: portForward.stdoutPath,
        stderrPath: portForward.stderrPath,
      },
    };

    await writeEdgeState(state);
    await markProgress('after-state-write');
    await writeJsonSummary(logsDir, 'edge-summary.json', {
      mode: 'started-new-port-forward',
      ...state,
      stateFile: edgeStatePath,
      summary,
    });
    await markProgress('after-summary-write');
    printAccessInstructions(portForward.pid);
  } catch (error) {
    await stopDetachedProcess(portForward.pid);
    await removeEdgeState();

    const stdout = await safeReadText(portForward.stdoutPath);
    const stderr = await safeReadText(portForward.stderrPath);
    const details = [error instanceof Error ? error.message : String(error)];

    if (stdout.trim()) {
      details.push(`stdout:\n${stdout.trim()}`);
    }

    if (stderr.trim()) {
      details.push(`stderr:\n${stderr.trim()}`);
    }

    throw new Error(details.join('\n\n'));
  }
}

function printAccessInstructions(pid) {
  console.log('');
  console.log(
    `[k8s-edge] Local edge listener is ready on ${baseURL} (pid ${pid}).`,
  );
  console.log(`[k8s-edge] Health: ${baseURL}/health`);
  console.log(`[k8s-edge] Login:  ${baseURL}/login`);
  console.log(`[k8s-edge] Docs:   ${baseURL}/api/docs`);
  console.log(
    `[k8s-edge] Stop it later with: node scripts/stop-k8s-local-edge.mjs`,
  );
  console.log('');
}

async function safeReadText(filePath) {
  if (!filePath) {
    return '';
  }

  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function markProgress(step, extra = {}) {
  await mkdir(logsDir, { recursive: true });
  await writeJsonSummary(logsDir, 'edge-progress.json', {
    step,
    at: new Date().toISOString(),
    ...extra,
  });
}

async function verifyLocalHealth() {
  if (process.platform !== 'win32') {
    const summary = await waitForLocalEdgeHealthy();
    return {
      namespace,
      baseURL,
      health: summary.health,
      urls: summary.urls,
    };
  }

  const deadline = Date.now() + 120000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const health = await invokeHealthJson(`${baseURL}/health`);
      if (health?.status !== 'ok' || health?.service !== 'campuscore-api') {
        throw new Error(
          `Unexpected health payload: ${JSON.stringify(health)}`,
        );
      }

      return {
        namespace,
        baseURL,
        health,
        urls: {
          health: `${baseURL}/health`,
          login: `${baseURL}/login`,
          docs: `${baseURL}/api/docs`,
        },
      };
    } catch (error) {
      lastError = error;
      await delay(2000);
    }
  }

  throw lastError ?? new Error('Timed out waiting for the local K8s edge.');
}

async function invokeHealthJson(url) {
  const output = await run(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      [
        `$response = Invoke-RestMethod -Uri '${url}' -TimeoutSec 20`,
        '$response | ConvertTo-Json -Compress',
      ].join('; '),
    ],
    { captureOutput: true, timeoutMs: 30000 },
  );

  return JSON.parse(output.trim());
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await runCli(main);
