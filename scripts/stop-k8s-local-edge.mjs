import { mkdir } from 'node:fs/promises';

import {
  edgeStatePath,
  isProcessRunning,
  readEdgeState,
  removeEdgeState,
  resolveLogsDir,
  runCli,
  stopDetachedProcess,
  writeJsonSummary,
} from './k8s-local-lib.mjs';

const logsDir = resolveLogsDir('k8s-local-edge');

async function main() {
  await mkdir(logsDir, { recursive: true });

  const state = await readEdgeState();
  if (!state) {
    await writeJsonSummary(logsDir, 'edge-stop-summary.json', {
      stoppedAt: new Date().toISOString(),
      stateFile: edgeStatePath,
      stopped: false,
      reason: 'No local edge state file was present.',
    });
    console.log('[k8s-edge] No local edge helper is currently registered.');
    return;
  }

  const wasRunning = Boolean(state.pid && (await isProcessRunning(state.pid)));
  if (wasRunning) {
    await stopDetachedProcess(state.pid);
  }

  await removeEdgeState();
  await writeJsonSummary(logsDir, 'edge-stop-summary.json', {
    stoppedAt: new Date().toISOString(),
    stateFile: edgeStatePath,
    stopped: wasRunning,
    pid: state.pid ?? null,
    baseURL: state.baseURL ?? null,
  });

  console.log(
    wasRunning
      ? '[k8s-edge] Local edge helper has been stopped.'
      : '[k8s-edge] Removed stale local edge state.',
  );
}

await runCli(main);
