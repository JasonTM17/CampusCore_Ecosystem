import {
  applyOverlay,
  baseURL,
  bootstrapJobs,
  collectArtifacts,
  ensureClusterAvailable,
  namespace,
  prepareLogs,
  printDeployInstructions,
  runCli,
  runEdgeSmokeChecks,
  runPreflight,
  runtimeDeployments,
  startPortForward,
  stopPortForward,
  summarizeRuntimeState,
  waitForInfra,
  waitForRuntime,
  writeJsonSummary,
  runBootstrapSequence,
  assertNamespaceReadyForFreshDeploy,
} from './k8s-local-lib.mjs';

const logsDir = await prepareLogs('k8s-local-deploy');

async function main() {
  let portForwardHandle;

  try {
    await runPreflight();
    await ensureClusterAvailable();
    await assertNamespaceReadyForFreshDeploy();
    await applyOverlay();
    await waitForInfra();
    await runBootstrapSequence();
    await waitForRuntime();

    portForwardHandle = startPortForward(logsDir);
    const health = await runEdgeSmokeChecks();
    const runtimeState = await summarizeRuntimeState();

    await writeJsonSummary(logsDir, 'deploy-summary.json', {
      namespace,
      baseURL,
      health,
      bootstrapJobs: bootstrapJobs.map((job) => job.name),
      runtimeDeployments,
      runtimeState,
      nextSteps: {
        dockerDesktopNamespace: namespace,
        portForward: `kubectl -n ${namespace} port-forward service/campuscore-nginx 8080:80`,
      },
    });

    printDeployInstructions();
  } catch (error) {
    await collectArtifacts(logsDir);
    throw error;
  } finally {
    if (portForwardHandle) {
      await stopPortForward(portForwardHandle);
    }
  }
}

await runCli(main);
