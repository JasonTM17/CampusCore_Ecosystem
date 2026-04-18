import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const composeFile = path.join(repoRoot, 'docker-compose.e2e.yml');
const logsDir = path.join(frontendDir, 'test-results', 'image-smoke-stack');
const projectName = process.env.IMAGE_SMOKE_COMPOSE_PROJECT ?? 'campuscore-image-smoke';
const edgePort = Number(process.env.IMAGE_SMOKE_EDGE_PORT ?? '8080');
const baseURL = `http://127.0.0.1:${edgePort}`;
const keepStack = process.env.IMAGE_SMOKE_KEEP_STACK === '1';
const usePrebuiltImages = process.env.E2E_USE_PREBUILT_IMAGES === '1';
const readinessKey =
  process.env.HEALTH_READINESS_KEY ?? 'image-smoke-readiness-key-12345';
const coreApiImage =
  process.env.E2E_CORE_API_IMAGE ?? 'campuscore-backend:e2e-local';
const notificationServiceImage =
  process.env.E2E_NOTIFICATION_SERVICE_IMAGE ??
  'campuscore-notification-service:e2e-local';
const frontendImage =
  process.env.E2E_FRONTEND_IMAGE ?? 'campuscore-frontend:e2e-local';
const servicesForLogs = [
  'core-api-init',
  'core-api',
  'notification-service-init',
  'notification-service',
  'frontend',
  'nginx',
  'postgres',
  'redis',
  'rabbitmq',
  'minio',
  'minio-init',
];

const composeBaseArgs = ['compose', '-p', projectName, '-f', composeFile];

async function main() {
  await rm(logsDir, { recursive: true, force: true });
  await mkdir(logsDir, { recursive: true });

  try {
    await compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
    if (usePrebuiltImages) {
      await compose(['pull', 'core-api', 'notification-service', 'frontend']);
      await compose(['up', '-d']);
    } else {
      await compose(['up', '-d', '--build']);
    }

    const liveness = await waitForJson(`${baseURL}/health`, (payload) => {
      return payload?.status === 'ok' && payload?.service === 'campuscore-api';
    });
    const coreReadiness = await getInternalReadiness('core-api', 4000);
    const notificationReadiness = await getInternalReadiness(
      'notification-service',
      4001,
    );

    await waitForResponse(`${baseURL}/`, (_, response) => response.ok, {
      parseJson: false,
    });
    await waitForResponse(`${baseURL}/login`, (_, response) => response.ok, {
      parseJson: false,
    });
    await waitForResponse(`${baseURL}/api/docs`, (_, response) => response.ok, {
      parseJson: false,
    });

    const coreApiCmd = await inspectServiceCommand('core-api');
    const notificationCmd = await inspectServiceCommand(
      'notification-service',
    );
    const frontendCmd = await inspectServiceCommand('frontend');

    if (!coreApiCmd.some((part) => part.includes('dist/src/main.js'))) {
      throw new Error(
        `Core API runtime is not using dist/src/main.js: ${coreApiCmd.join(' ')}`,
      );
    }

    if (!notificationCmd.some((part) => part.includes('dist/src/main.js'))) {
      throw new Error(
        `Notification service runtime is not using dist/src/main.js: ${notificationCmd.join(' ')}`,
      );
    }

    if (!frontendCmd.some((part) => part.includes('.next/standalone/server.js'))) {
      throw new Error(
        `Frontend runtime is not using standalone server.js: ${frontendCmd.join(' ')}`,
      );
    }

    await writeFile(
      path.join(logsDir, 'liveness.json'),
      JSON.stringify(liveness, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(logsDir, 'readiness.json'),
      JSON.stringify(
        {
          coreApi: coreReadiness,
          notificationService: notificationReadiness,
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(
      path.join(logsDir, 'runtime-commands.json'),
      JSON.stringify(
        {
          coreApi: coreApiCmd,
          notificationService: notificationCmd,
          frontend: frontendCmd,
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(
      path.join(logsDir, 'image-mode.json'),
      JSON.stringify(
        {
          usePrebuiltImages,
          coreApiImage,
          notificationServiceImage,
          frontendImage,
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (error) {
    await collectArtifacts();
    throw error;
  } finally {
    if (!keepStack) {
      await compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
    }
  }
}

async function waitForJson(url, predicate, options = {}) {
  return waitForResponse(url, predicate, {
    parseJson: true,
    timeoutMs: options.timeoutMs ?? 180_000,
    intervalMs: options.intervalMs ?? 2_000,
  });
}

async function waitForResponse(
  url,
  predicate,
  options = { parseJson: true, timeoutMs: 180_000, intervalMs: 2_000 },
) {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const payload = options.parseJson === false ? null : await response.json();

      if (predicate(payload, response)) {
        return payload;
      }

      lastError = new Error(
        `Received unexpected response from ${url}: ${response.status}`,
      );
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function collectArtifacts() {
  for (const service of servicesForLogs) {
    const logPath = path.join(logsDir, `${service}.log`);
    const output = await compose(['logs', '--no-color', service], {
      allowFailure: true,
      captureOutput: true,
    });
    await writeFile(logPath, output ?? '', 'utf8');
  }

  const psOutput = await compose(['ps', '--format', 'json'], {
    allowFailure: true,
    captureOutput: true,
  });
  await writeFile(path.join(logsDir, 'compose-ps.json'), psOutput ?? '', 'utf8');
}

async function inspectServiceCommand(service) {
  const containerId = (
    await compose(['ps', '-q', service], {
      captureOutput: true,
    })
  )
    ?.trim()
    .split(/\r?\n/u)[0];

  if (!containerId) {
    throw new Error(`Could not resolve container id for service ${service}`);
  }

  const commandJson = await run(
    'docker',
    ['inspect', '-f', '{{json .Config.Cmd}}', containerId],
    {
      cwd: repoRoot,
      captureOutput: true,
    },
  );

  return JSON.parse(commandJson.trim());
}

async function compose(args, options = {}) {
  return run('docker', [...composeBaseArgs, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      E2E_EDGE_PORT: String(edgePort),
      E2E_FRONTEND_URL: baseURL,
      HEALTH_READINESS_KEY: readinessKey,
      E2E_CORE_API_IMAGE: coreApiImage,
      E2E_NOTIFICATION_SERVICE_IMAGE: notificationServiceImage,
      E2E_FRONTEND_IMAGE: frontendImage,
    },
    ...options,
  });
}

async function getInternalReadiness(serviceName, port) {
  const output = await compose(
    [
      'exec',
      '-T',
      serviceName,
      'node',
      '-e',
      `
        fetch('http://127.0.0.1:${port}/api/v1/health/readiness', {
          headers: { 'X-Health-Key': ${JSON.stringify(readinessKey)} },
        })
          .then(async (response) => {
            const body = await response.text();
            if (!response.ok) {
              console.error(body);
              process.exit(1);
            }
            process.stdout.write(body);
          })
          .catch((error) => {
            console.error(error);
            process.exit(1);
          });
      `,
    ],
    { captureOutput: true },
  );

  return JSON.parse(output.trim());
}

function run(command, args, options = {}) {
  const {
    cwd = repoRoot,
    env = process.env,
    allowFailure = false,
    captureOutput = false,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    if (captureOutput) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0 || allowFailure) {
        resolve(captureOutput ? `${stdout}${stderr}` : undefined);
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
