import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const profile = getArgValue('--profile') || process.env.PRODUCTION_VALIDATION_PROFILE || 'balanced';
const withE2e = args.has('--with-e2e') || args.has('--full');
const withEdgeE2e = args.has('--with-edge-e2e') || args.has('--full');
const withServiceQuality = args.has('--with-service-quality') || args.has('--full');
const skipLoad = args.has('--skip-load');
const skipFinance = args.has('--skip-finance');
const skipObservability = args.has('--skip-observability');
const skipInventory = args.has('--skip-inventory');

const hostBaseUrl = process.env.BASE_URL || 'http://127.0.0.1';
const hostApiBaseUrl = process.env.API_BASE_URL || `${hostBaseUrl}/api/v1`;

const dockerBaseUrl = process.env.DOCKER_K6_BASE_URL || 'http://host.docker.internal';
const dockerApiBaseUrl = process.env.DOCKER_K6_API_BASE_URL || `${dockerBaseUrl}/api/v1`;

const loadReportsDir = path.join(repoRoot, 'load-tests', 'reports');

async function main() {
  console.log(`[production-validation] profile=${profile}`);
  await preflightHttp();

  if (!skipInventory) {
    await runNodeScript('scripts/run-container-inventory.mjs');
  }

  if (!skipObservability) {
    await runNodeScript('scripts/run-observability-smoke.mjs');
  }

  if (withServiceQuality) {
    await runServiceQuality('academic-service');
    await runServiceQuality('finance-service');
    await runServiceQuality('notification-service');
  }

  if (!skipFinance) {
    await runNodeScript('scripts/run-finance-e2e.mjs');
  }

  if (withE2e) {
    await runNpm('frontend', ['run', 'test:e2e']);
  }

  if (withEdgeE2e) {
    await runNpm('frontend', ['run', 'test:e2e:edge']);
  }

  if (!skipLoad) {
    await runK6(profile);
  }

  console.log('[production-validation] complete');
}

async function preflightHttp() {
  const probes = [
    { label: 'health', url: `${hostBaseUrl}/health`, statuses: [200] },
    { label: 'vi homepage', url: `${hostBaseUrl}/vi`, statuses: [200] },
    { label: 'vi login', url: `${hostBaseUrl}/vi/login`, statuses: [200] },
    { label: 'api docs', url: `${hostBaseUrl}/api/docs`, statuses: [200, 301, 302] },
  ];

  for (const probe of probes) {
    const response = await fetch(probe.url, { redirect: 'manual' });
    if (!probe.statuses.includes(response.status)) {
      throw new Error(
        `[production-validation] ${probe.label} returned ${response.status} for ${probe.url}`,
      );
    }
    console.log(`[production-validation] ${probe.label}: ${response.status}`);
  }
}

async function runK6(selectedProfile) {
  fs.mkdirSync(loadReportsDir, { recursive: true });

  const summaryPath = path.join(
    loadReportsDir,
    `production-${selectedProfile}-summary.json`,
  );

  const hostK6 = await commandWorks('k6', ['version']);
  if (hostK6) {
    await run('k6', [
      'run',
      '--summary-export',
      summaryPath,
      'load-tests/src/production-validation.js',
    ], {
      env: {
        ...process.env,
        PROFILE: selectedProfile,
        BASE_URL: hostBaseUrl,
        API_BASE_URL: hostApiBaseUrl,
      },
    });
    return;
  }

  const dockerAvailable = await commandWorks('docker', ['version']);
  if (!dockerAvailable) {
    throw new Error(
      'Neither k6 nor Docker is available. Install k6 or start Docker Desktop to run load validation.',
    );
  }

  const mountSource = repoRoot.replace(/\\/gu, '/');
  await run('docker', [
    'run',
    '--rm',
    '-v',
    `${mountSource}:/work`,
    '-w',
    '/work',
    '-e',
    `PROFILE=${selectedProfile}`,
    '-e',
    `BASE_URL=${dockerBaseUrl}`,
    '-e',
    `API_BASE_URL=${dockerApiBaseUrl}`,
    '-e',
    `K6_USERS_EMAIL=${process.env.K6_USERS_EMAIL || 'student1@campuscore.edu'}`,
    '-e',
    `K6_USERS_PASSWORD=${process.env.K6_USERS_PASSWORD || 'password123'}`,
    '-e',
    `K6_ADMIN_EMAIL=${process.env.K6_ADMIN_EMAIL || 'admin@campuscore.edu'}`,
    '-e',
    `K6_ADMIN_PASSWORD=${process.env.K6_ADMIN_PASSWORD || 'admin123'}`,
    '-e',
    `K6_PAYMENT_PROVIDERS=${process.env.K6_PAYMENT_PROVIDERS || 'MOMO,ZALOPAY,VNPAY,PAYPAL,CARD'}`,
    '-e',
    `K6_ENABLE_MUTATING_REGISTRATION=${process.env.K6_ENABLE_MUTATING_REGISTRATION || '0'}`,
    '-e',
    `K6_HOT_SECTION_ID=${process.env.K6_HOT_SECTION_ID || ''}`,
    'grafana/k6:0.52.0',
    'run',
    '--summary-export',
    `/work/load-tests/reports/production-${selectedProfile}-summary.json`,
    'load-tests/src/production-validation.js',
  ]);
}

async function runNodeScript(relativePath) {
  await run(process.execPath, [path.join(repoRoot, relativePath)], {
    cwd: repoRoot,
  });
}

async function runServiceQuality(serviceDir) {
  await runNpm(serviceDir, ['run', 'lint']);
  await runNpm(serviceDir, ['run', 'typecheck']);
  await runNpm(serviceDir, ['test', '--', '--runInBand']);
  await runNpm(serviceDir, ['run', 'build']);
}

async function runNpm(relativeCwd, npmArgs) {
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, {
    cwd: path.join(repoRoot, relativeCwd),
  });
}

async function commandWorks(command, commandArgs) {
  try {
    await run(command, commandArgs, { silent: true });
    return true;
  } catch {
    return false;
  }
}

function run(command, commandArgs, options = {}) {
  const { cwd = repoRoot, env = process.env, silent = false } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env,
      stdio: silent ? 'ignore' : 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`));
    });
  });
}

function getArgValue(name) {
  const prefix = `${name}=`;
  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
}

await main();
