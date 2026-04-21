import {
  deleteNamespace,
  getEdgeControllerPid,
  isProcessRunning,
  namespace,
  prepareLogs,
  readEdgeState,
  removeEdgeState,
  removeLocalArtifacts,
  run,
  runCli,
  stopDetachedProcess,
  writeJsonSummary,
} from './k8s-local-lib.mjs';

const logsDir = await prepareLogs('k8s-local-destroy');

async function main() {
  const edgeState = await readEdgeState();
  const controllerPid = getEdgeControllerPid(edgeState);
  const edgeWasRunning = Boolean(
    controllerPid && (await isProcessRunning(controllerPid)),
  );

  if (edgeWasRunning) {
    await stopDetachedProcess(controllerPid);
  }

  const cloudflareTunnelContainer =
    process.env.CLOUDFLARE_TUNNEL_CONTAINER_NAME ??
    'campuscore-cloudflared-local';
  const tunnelContainerOutput = await run(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      `name=^/${cloudflareTunnelContainer}$`,
      '--format',
      '{{.Names}}',
    ],
    { allowFailure: true, captureOutput: true, timeoutMs: 30000 },
  );
  const cloudflareTunnelStopped = Boolean(tunnelContainerOutput
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .includes(cloudflareTunnelContainer));
  if (cloudflareTunnelStopped) {
    await run('docker', ['rm', '-f', cloudflareTunnelContainer], {
      allowFailure: true,
      captureOutput: true,
      timeoutMs: 30000,
    });
  }

  await removeEdgeState();
  await deleteNamespace();
  await removeLocalArtifacts([
    'k8s-local-deploy',
    'k8s-local-edge',
    'cloudflare-tunnel-local',
  ]);
  await writeJsonSummary(logsDir, 'destroy-summary.json', {
    namespace,
    destroyedAt: new Date().toISOString(),
    edgeStateStopped: edgeWasRunning,
    cloudflareTunnelStopped,
    removedArtifacts: [
      'frontend/test-results/k8s-local-deploy',
      'frontend/test-results/k8s-local-edge',
      'frontend/test-results/cloudflare-tunnel-local',
      'frontend/test-results/k8s-local-edge-state.json',
    ],
  });

  console.log(`[k8s-destroy] Namespace "${namespace}" has been removed.`);
}

await runCli(main);
