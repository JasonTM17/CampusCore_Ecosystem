import { mkdir } from 'node:fs/promises';

import {
  edgeStatePath,
  getEdgeControllerPid,
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

  const controllerPid = getEdgeControllerPid(state);
  const wasRunning = Boolean(
    controllerPid && (await isProcessRunning(controllerPid)),
  );
  if (wasRunning) {
    await stopDetachedProcess(controllerPid);
  }

  await removeEdgeState();
  await writeJsonSummary(logsDir, 'edge-stop-summary.json', {
    stoppedAt: new Date().toISOString(),
    stateFile: edgeStatePath,
    stopped: wasRunning,
    pid: controllerPid ?? null,
    supervisorPid: state.supervisorPid ?? controllerPid ?? null,
    kubectlPid: state.kubectlPid ?? null,
    baseURL: state.baseURL ?? null,
  });

  console.log(
    wasRunning
      ? '[k8s-edge] Local edge helper has been stopped.'
      : '[k8s-edge] Removed stale local edge state.',
  );
}

await runCli(main);
