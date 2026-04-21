import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  baseURL,
  localPort,
  repoRoot,
  resolveLogsDir,
  run,
  runCli,
  waitForLocalEdgeHealthy,
} from './k8s-local-lib.mjs';

const containerName =
  process.env.CLOUDFLARE_TUNNEL_CONTAINER_NAME ??
  'campuscore-cloudflared-local';
const cloudflaredImage =
  process.env.CLOUDFLARE_TUNNEL_IMAGE ?? 'cloudflare/cloudflared:latest';
const tunnelToken = process.env.CLOUDFLARE_TUNNEL_TOKEN?.trim();
const requestedConnector = (
  process.env.CLOUDFLARE_TUNNEL_CONNECTOR ?? 'auto'
).toLowerCase();
const logsDir = resolveLogsDir('cloudflare-tunnel-local');
const logPath = path.join(logsDir, 'cloudflared.log');

async function main() {
  await mkdir(logsDir, { recursive: true });

  console.log('[cloudflare-tunnel] Ensuring CampusCore local K8s edge is ready...');
  await run(process.execPath, [
    path.join(repoRoot, 'scripts', 'run-k8s-local-edge.mjs'),
  ]);
  await waitForLocalEdgeHealthy();

  const connector = await resolveConnector();
  const mode = tunnelToken ? 'named' : 'quick';
  const serviceUrl = resolveServiceUrl(connector, mode);

  await writeFile(
    path.join(logsDir, 'cloudflare-tunnel-summary.json'),
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        connector,
        mode,
        localEdge: baseURL,
        serviceUrl,
        containerName: connector === 'docker' ? containerName : null,
        logPath,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log('');
  console.log(`[cloudflare-tunnel] Local edge is healthy at ${baseURL}.`);
  console.log(`[cloudflare-tunnel] Connector: ${connector}`);
  console.log(`[cloudflare-tunnel] Mode: ${mode}`);

  if (mode === 'quick') {
    console.log(
      '[cloudflare-tunnel] No CLOUDFLARE_TUNNEL_TOKEN found, so a temporary trycloudflare.com URL will be created.',
    );
    console.log(
      '[cloudflare-tunnel] This is good for demo/test. For tienson.io.vn, create a named tunnel in Cloudflare and rerun with CLOUDFLARE_TUNNEL_TOKEN.',
    );
  } else if (connector === 'docker') {
    console.log(
      `[cloudflare-tunnel] In Cloudflare Public Hostname, set Service to: http://host.docker.internal:${localPort}`,
    );
  } else {
    console.log(
      `[cloudflare-tunnel] In Cloudflare Public Hostname, set Service to: ${baseURL}`,
    );
  }

  console.log(`[cloudflare-tunnel] Raw logs: ${logPath}`);
  console.log('[cloudflare-tunnel] Keep this process running while you use the tunnel.');
  console.log('[cloudflare-tunnel] Press Ctrl+C to stop it.');
  console.log('');

  await startTunnel(connector, mode, serviceUrl);
}

async function resolveConnector() {
  if (!['auto', 'native', 'docker'].includes(requestedConnector)) {
    throw new Error(
      `Unsupported CLOUDFLARE_TUNNEL_CONNECTOR="${requestedConnector}". Use auto, native, or docker.`,
    );
  }

  if (requestedConnector === 'native') {
    await assertNativeCloudflared();
    return 'native';
  }

  if (requestedConnector === 'docker') {
    await assertDocker();
    return 'docker';
  }

  if (await hasNativeCloudflared()) {
    return 'native';
  }

  await assertDocker();
  return 'docker';
}

function resolveServiceUrl(connector, mode) {
  const explicit = process.env.CLOUDFLARE_TUNNEL_SERVICE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  if (connector === 'docker') {
    return `http://host.docker.internal:${localPort}`;
  }

  return baseURL;
}

async function startTunnel(connector, mode, serviceUrl) {
  const { command, args, options = {} } =
    connector === 'docker'
      ? await buildDockerCommand(mode, serviceUrl)
      : buildNativeCommand(mode, serviceUrl);

  await writeFile(logPath, '', 'utf8');

  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      ...options.env,
    },
  });

  const stop = async () => {
    if (child.killed) {
      return;
    }

    child.kill('SIGTERM');
    if (connector === 'docker') {
      await run('docker', ['rm', '-f', containerName], {
        allowFailure: true,
        captureOutput: true,
        timeoutMs: 30000,
      });
    }
  };

  process.on('SIGINT', () => {
    void stop().finally(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    void stop().finally(() => process.exit(143));
  });

  child.stdout.on('data', (chunk) => handleTunnelOutput(chunk));
  child.stderr.on('data', (chunk) => handleTunnelOutput(chunk));

  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`Cloudflare tunnel exited with code ${code}.`));
    });
  });
}

async function buildDockerCommand(mode, serviceUrl) {
  await run('docker', ['rm', '-f', containerName], {
    allowFailure: true,
    captureOutput: true,
    timeoutMs: 30000,
  });

  const args = [
    'run',
    '--rm',
    '--name',
    containerName,
  ];

  if (mode === 'named') {
    args.push('-e', 'TUNNEL_TOKEN');
  }

  args.push(cloudflaredImage);

  if (mode === 'named') {
    args.push('tunnel', '--no-autoupdate', 'run');
    return {
      command: 'docker',
      args,
      options: {
        env: {
          TUNNEL_TOKEN: tunnelToken,
        },
      },
    };
  }

  args.push('tunnel', '--no-autoupdate', '--url', serviceUrl);
  return {
    command: 'docker',
    args,
  };
}

function buildNativeCommand(mode, serviceUrl) {
  if (mode === 'named') {
    return {
      command: 'cloudflared',
      args: ['tunnel', '--no-autoupdate', 'run', '--token', tunnelToken],
    };
  }

  return {
    command: 'cloudflared',
    args: ['tunnel', '--no-autoupdate', '--url', serviceUrl],
  };
}

function handleTunnelOutput(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  void appendLog(text);

  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu);
  if (match) {
    console.log('');
    console.log(`[cloudflare-tunnel] Temporary public URL: ${match[0]}`);
    console.log(`[cloudflare-tunnel] Health: ${match[0]}/health`);
    console.log(`[cloudflare-tunnel] Login:  ${match[0]}/login`);
    console.log('');
  }
}

async function appendLog(text) {
  await writeFile(logPath, text, {
    encoding: 'utf8',
    flag: 'a',
  });
}

async function hasNativeCloudflared() {
  try {
    await assertNativeCloudflared();
    return true;
  } catch {
    return false;
  }
}

async function assertNativeCloudflared() {
  await run('cloudflared', ['--version'], {
    captureOutput: true,
    timeoutMs: 15000,
  });
}

async function assertDocker() {
  try {
    await run('docker', ['version'], {
      captureOutput: true,
      timeoutMs: 30000,
    });
  } catch {
    throw new Error(
      'Docker is not reachable and native cloudflared is not installed. Start Docker Desktop, or install cloudflared, then rerun this script.',
    );
  }
}

await runCli(main);
