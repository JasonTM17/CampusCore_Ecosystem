import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const composeFile = 'docker-compose.production.yml';

const requiredEnv = [
  {
    name: 'IMAGE_TAG',
    reason: 'semver release tag used by production images',
  },
  {
    name: 'POSTGRES_PASSWORD',
    reason: 'database bootstrap and runtime connectivity',
  },
  {
    name: 'RABBITMQ_PASSWORD',
    reason: 'message broker bootstrap and runtime connectivity',
  },
  {
    name: 'MINIO_PASSWORD',
    reason: 'object storage bootstrap and runtime connectivity',
  },
  {
    name: 'JWT_SECRET',
    reason: 'access-token signing for backend services',
  },
  {
    name: 'JWT_REFRESH_SECRET',
    reason: 'refresh-token signing for backend services',
  },
  {
    name: 'HEALTH_READINESS_KEY',
    reason: 'internal readiness probe protection',
  },
  {
    name: 'INTERNAL_SERVICE_TOKEN',
    reason: 'service-to-service internal API protection',
  },
];

async function main() {
  const missing = requiredEnv.filter(
    (entry) => !String(process.env[entry.name] ?? '').trim(),
  );

  if (missing.length > 0) {
    const lines = [
      `[compose-preflight] ${composeFile} is missing required environment values:`,
      ...missing.map((entry) => `- ${entry.name}: ${entry.reason}`),
      '',
      '[compose-preflight] Export the missing variables and rerun this preflight.',
      '[compose-preflight] Optional vars such as DOCKERHUB_NAMESPACE, FRONTEND_URL, SMTP_* keep their existing defaults.',
    ];
    throw new Error(lines.join('\n'));
  }

  const imageTag = process.env.IMAGE_TAG?.trim() ?? '';
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(imageTag)) {
    throw new Error(
      `[compose-preflight] IMAGE_TAG must look like a semver release tag (for example v1.3.6). Received: ${imageTag}`,
    );
  }

  await runCommand('docker', ['compose', '-f', composeFile, 'config']);
  console.log(
    `[compose-preflight] ${composeFile} rendered clean with IMAGE_TAG=${imageTag}.`,
  );
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(
          [
            `[compose-preflight] ${command} ${args.join(' ')} exited with code ${code}.`,
            stderr.trim(),
          ]
            .filter(Boolean)
            .join('\n\n'),
        ),
      );
    });
  });
}

await main();
