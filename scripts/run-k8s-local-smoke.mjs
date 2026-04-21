import {
  assertNamespaceReadyForFreshDeploy,
  baseURL,
  bootstrapJobs,
  collectArtifacts,
  deleteNamespace,
  ensureClusterAvailable,
  namespace,
  prepareLogs,
  runCli,
  runEdgeSmokeChecks,
  runPreflight,
  runtimeDeployments,
  startPortForward,
  stopPortForward,
  waitForInfra,
  waitForRuntime,
  writeJsonSummary,
  applyOverlay,
  runBootstrapSequence,
} from './k8s-local-lib.mjs';

const keepResources = process.env.K8S_KEEP_RESOURCES === '1';
const logsDir = await prepareLogs('k8s-local-smoke');

async function main() {
  let portForwardHandle;

  try {
    await runPreflight();
    await ensureClusterAvailable();
    if (!keepResources) {
      await deleteNamespace();
    }
    await assertNamespaceReadyForFreshDeploy();
    await applyOverlay();
    await waitForInfra();
    await runBootstrapSequence();
    await waitForRuntime();

    portForwardHandle = startPortForward(logsDir);
    const health = await runEdgeSmokeChecks();
    await writeJsonSummary(logsDir, 'smoke-summary.json', {
      namespace,
      baseURL,
      health,
      bootstrapJobs: bootstrapJobs.map((job) => job.name),
      runtimeDeployments,
    });
  } catch (error) {
    await collectArtifacts(logsDir);
    throw error;
  } finally {
    if (portForwardHandle) {
      await stopPortForward(portForwardHandle);
    }

    if (!keepResources) {
      await deleteNamespace();
    }
  }
}

await runCli(main);
