import { mkdir, readFile } from 'node:fs/promises';

import {
  assertNamespaceHasRuntimeStack,
  baseURL,
  cleanupStaleEdgeState,
  edgeStatePath,
  ensureClusterAvailable,
  getEdgeControllerPid,
  isProcessRunning,
  namespace,
  removeEdgeState,
  resolveLogsDir,
  runPreflight,
  startDetachedEdgeSupervisor,
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
    hasExistingState: Boolean(getEdgeControllerPid(existingState)),
  });
  const existingControllerPid = getEdgeControllerPid(existingState);
  if (existingControllerPid && (await isProcessRunning(existingControllerPid))) {
    try {
      const summary = await verifyLocalHealth();
      await markProgress('after-existing-health-verify');
      const latestState = (await cleanupStaleEdgeState()) ?? existingState;
      await writeEdgeState({
        ...latestState,
        status: 'healthy',
        lastHealthyAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString(),
      });
      await markProgress('after-existing-state-write');
      await mkdir(logsDir, { recursive: true });
      await writeJsonSummary(logsDir, 'edge-summary.json', {
        mode: 'reused-existing-edge-helper',
        namespace,
        baseURL,
        supervisorPid: existingControllerPid,
        kubectlPid: existingState.kubectlPid ?? null,
        stateFile: edgeStatePath,
        logs: existingState.logs ?? null,
        summary,
      });
      await markProgress('after-existing-summary');
      printAccessInstructions(existingControllerPid);
      return;
    } catch {
      await stopDetachedProcess(existingControllerPid);
      await removeEdgeState();
    }
  }

  await mkdir(logsDir, { recursive: true });
  const supervisor = await startDetachedEdgeSupervisor(logsDir);
  await markProgress('after-supervisor-start', {
    pid: supervisor.pid,
  });

  try {
    const summary = await verifyLocalHealth();
    await markProgress('after-health-verify');
    const latestState = await cleanupStaleEdgeState();
    const state = {
      ...(latestState ?? {}),
      pid: supervisor.pid,
      supervisorPid: supervisor.pid,
      namespace,
      baseURL,
      status: 'healthy',
      startedAt: new Date().toISOString(),
      lastHealthyAt: latestState?.lastHealthyAt ?? new Date().toISOString(),
      logs: latestState?.logs ?? {
        supervisorStdoutPath: supervisor.stdoutPath,
        supervisorStderrPath: supervisor.stderrPath,
      },
    };

    await writeEdgeState(state);
    await markProgress('after-state-write');
    await writeJsonSummary(logsDir, 'edge-summary.json', {
      mode: 'started-new-edge-helper',
      ...state,
      stateFile: edgeStatePath,
      summary,
    });
    await markProgress('after-summary-write');
    printAccessInstructions(supervisor.pid);
  } catch (error) {
    await stopDetachedProcess(supervisor.pid);
    await removeEdgeState();

    const stdout = await safeReadText(supervisor.stdoutPath);
    const stderr = await safeReadText(supervisor.stderrPath);
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
    `[k8s-edge] Local edge helper is ready on ${baseURL} (supervisor pid ${pid}).`,
  );
  console.log(`[k8s-edge] Health: ${baseURL}/health`);
  console.log(`[k8s-edge] Login:  ${baseURL}/login`);
  console.log(`[k8s-edge] Docs:   ${baseURL}/api/docs`);
  console.log(
    `[k8s-edge] State:  ${edgeStatePath}`,
  );
  console.log(
    `[k8s-edge] Stop it later with: node scripts/stop-k8s-local-edge.mjs`,
  );
  console.log(
    `[k8s-edge] Client-disconnect noise from raw kubectl port-forward is treated as benign; use the helper logs only for troubleshooting.`,
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
  return waitForLocalEdgeHealthy();
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
}
