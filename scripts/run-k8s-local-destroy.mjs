import {
  deleteNamespace,
  isProcessRunning,
  namespace,
  prepareLogs,
  readEdgeState,
  removeEdgeState,
  removeLocalArtifacts,
  runCli,
  stopDetachedProcess,
  writeJsonSummary,
} from './k8s-local-lib.mjs';

const logsDir = await prepareLogs('k8s-local-destroy');

async function main() {
  const edgeState = await readEdgeState();
  const edgeWasRunning = Boolean(
    edgeState?.pid && (await isProcessRunning(edgeState.pid)),
  );

  if (edgeWasRunning) {
    await stopDetachedProcess(edgeState.pid);
  }

  await removeEdgeState();
  await deleteNamespace();
  await removeLocalArtifacts(['k8s-local-deploy', 'k8s-local-edge']);
  await writeJsonSummary(logsDir, 'destroy-summary.json', {
    namespace,
    destroyedAt: new Date().toISOString(),
    edgeStateStopped: edgeWasRunning,
    removedArtifacts: [
      'frontend/test-results/k8s-local-deploy',
      'frontend/test-results/k8s-local-edge',
      'frontend/test-results/k8s-local-edge-state.json',
    ],
  });

  console.log(`[k8s-destroy] Namespace "${namespace}" has been removed.`);
}

await runCli(main);
