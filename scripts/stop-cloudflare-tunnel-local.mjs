import { mkdir } from 'node:fs/promises';

import {
  resolveLogsDir,
  run,
  runCli,
  writeJsonSummary,
} from './k8s-local-lib.mjs';

const containerName =
  process.env.CLOUDFLARE_TUNNEL_CONTAINER_NAME ??
  'campuscore-cloudflared-local';
const logsDir = resolveLogsDir('cloudflare-tunnel-local');

async function main() {
  await mkdir(logsDir, { recursive: true });

  const existingContainer = await run(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      `name=^/${containerName}$`,
      '--format',
      '{{.Names}}',
    ],
    {
      allowFailure: true,
      captureOutput: true,
      timeoutMs: 30000,
    },
  );
  const exists = existingContainer
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .includes(containerName);

  if (exists) {
    await run('docker', ['rm', '-f', containerName], {
      allowFailure: true,
      captureOutput: true,
      timeoutMs: 30000,
    });
  }

  await writeJsonSummary(logsDir, 'cloudflare-tunnel-stop-summary.json', {
    stoppedAt: new Date().toISOString(),
    containerName,
    removed: Boolean(exists),
  });

  console.log(
    exists
      ? `[cloudflare-tunnel] Stopped Docker cloudflared container ${containerName}.`
      : `[cloudflare-tunnel] No Docker cloudflared container named ${containerName} was running.`,
  );
}

await runCli(main);
