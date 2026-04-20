import {
  deleteNamespace,
  namespace,
  prepareLogs,
  removeLocalArtifacts,
  runCli,
  writeJsonSummary,
} from './k8s-local-lib.mjs';

const logsDir = await prepareLogs('k8s-local-destroy');

async function main() {
  await deleteNamespace();
  await removeLocalArtifacts(['k8s-local-deploy']);
  await writeJsonSummary(logsDir, 'destroy-summary.json', {
    namespace,
    destroyedAt: new Date().toISOString(),
    removedArtifacts: ['frontend/test-results/k8s-local-deploy'],
  });

  console.log(`[k8s-destroy] Namespace "${namespace}" has been removed.`);
}

await runCli(main);
