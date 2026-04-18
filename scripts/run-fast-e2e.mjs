import { createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const backendDir = path.join(repoRoot, 'backend');
const frontendDir = path.join(repoRoot, 'frontend');
const logsDir = path.join(frontendDir, 'test-results', 'fast-e2e-stack');
const playwrightCli = path.join(frontendDir, 'node_modules', 'playwright', 'cli.js');
const prismaCli = path.join(
  backendDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

const postgresContainer =
  process.env.E2E_POSTGRES_CONTAINER ?? 'campuscore-fast-e2e-postgres';
const postgresPort = Number(process.env.E2E_DB_PORT ?? '5433');
const postgresUser = process.env.E2E_POSTGRES_USER ?? 'campuscore';
const postgresPassword =
  process.env.E2E_POSTGRES_PASSWORD ?? 'campuscore_password';
const postgresDatabase = process.env.E2E_POSTGRES_DB ?? 'campuscore_e2e';
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDatabase}?schema=public`;
const frontendBaseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';
const apiBaseURL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4100/api/v1';
const keepPostgres = process.env.E2E_KEEP_POSTGRES === '1';
const managedProcesses = [];
const frontendNodeOptions = [process.env.NODE_OPTIONS, '--max-old-space-size=4096']
  .filter(Boolean)
  .join(' ');

async function main() {
  await rm(logsDir, { recursive: true, force: true });
  await mkdir(logsDir, { recursive: true });

  try {
    await cleanupPostgres();
    await startPostgres();
    await waitForPostgres();
    await prepareDatabase();
    await startApplicationServers();
    await waitForResponse(
      `${apiBaseURL}/health/liveness`,
      (_, response) => response.ok,
    );
    await waitForResponse(frontendBaseURL, (_, response) => response.ok);

    await run(process.execPath, [playwrightCli, 'test'], {
      cwd: frontendDir,
      env: {
        ...process.env,
        E2E_SKIP_WEBSERVER: '1',
        E2E_BASE_URL: frontendBaseURL,
        E2E_API_URL: apiBaseURL,
        E2E_DATABASE_URL: databaseUrl,
        E2E_REDIS_URL: 'disabled',
        E2E_RABBITMQ_URL: 'disabled',
      },
    });
  } catch (error) {
    await collectArtifacts();
    throw error;
  } finally {
    await stopApplicationServers();

    if (!keepPostgres) {
      await cleanupPostgres();
    }
  }
}

async function startApplicationServers() {
  await startManagedProcess('backend', 'npm', ['run', 'start'], {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: '4100',
      FRONTEND_URL: frontendBaseURL,
      JWT_SECRET: process.env.E2E_JWT_SECRET ?? 'e2e-jwt-secret',
      JWT_REFRESH_SECRET:
        process.env.E2E_JWT_REFRESH_SECRET ?? 'e2e-jwt-refresh-secret',
      NODE_ENV: 'test',
      REDIS_URL: 'disabled',
      RABBITMQ_URL: 'disabled',
    },
  });

  await startManagedProcess(
    'frontend',
    'npm',
    ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '3100'],
    {
      cwd: frontendDir,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: apiBaseURL,
        NODE_OPTIONS: frontendNodeOptions,
      },
    },
  );
}

async function startManagedProcess(name, command, args, options) {
  const logStream = createWriteStream(path.join(logsDir, `${name}.log`), {
    flags: 'a',
  });
  const resolvedCommand = resolveCommand(command);
  const spawnCommand =
    process.platform === 'win32' && shouldUseCmdWrapper(resolvedCommand)
      ? 'cmd.exe'
      : resolvedCommand;
  const spawnArgs =
    spawnCommand === 'cmd.exe'
      ? ['/d', '/s', '/c', buildWindowsCommand(resolvedCommand, args)]
      : args;

  const child = spawn(spawnCommand, spawnArgs, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  child.once('exit', (code, signal) => {
    logStream.write(
      `\n[${name}] exited with code ${code ?? 'null'} signal ${signal ?? 'null'}\n`,
    );
  });

  managedProcesses.push({ name, child, logStream });

  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

async function stopApplicationServers() {
  for (const processInfo of managedProcesses.reverse()) {
    const { child, logStream } = processInfo;

    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        await run('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          allowFailure: true,
          captureOutput: true,
        });
      } else {
        child.kill('SIGTERM');
        await waitForExit(child, 5_000);

        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }
    }

    await new Promise((resolve) => logStream.end(resolve));
  }

  managedProcesses.length = 0;
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const timeoutId = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

async function startPostgres() {
  await run('docker', [
    'run',
    '-d',
    '--name',
    postgresContainer,
    '--health-cmd',
    `pg_isready -U ${postgresUser} -d ${postgresDatabase}`,
    '--health-interval',
    '5s',
    '--health-timeout',
    '5s',
    '--health-retries',
    '20',
    '-e',
    `POSTGRES_USER=${postgresUser}`,
    '-e',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    '-e',
    `POSTGRES_DB=${postgresDatabase}`,
    '-p',
    `${postgresPort}:5432`,
    'postgres:15-alpine',
  ]);
}

async function waitForPostgres(timeoutMs = 180_000, intervalMs = 2_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await inspectPostgresHealth();
    if (status === 'healthy') {
      return;
    }

    await delay(intervalMs);
  }

  throw new Error(
    `Timed out waiting for postgres container ${postgresContainer} to become healthy`,
  );
}

async function inspectPostgresHealth() {
  const output = await run(
    'docker',
    [
      'inspect',
      '-f',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}',
      postgresContainer,
    ],
    {
      allowFailure: true,
      captureOutput: true,
    },
  );

  return output?.trim() ?? 'unknown';
}

async function prepareDatabase() {
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
  };

  await run(prismaCli, ['db', 'push', '--skip-generate'], {
    cwd: backendDir,
    env,
  });

  await run('npm', ['run', 'prisma:seed'], {
    cwd: backendDir,
    env,
  });
}

async function cleanupPostgres() {
  await run('docker', ['rm', '-f', postgresContainer], {
    allowFailure: true,
    captureOutput: true,
  });
}

async function waitForResponse(
  url,
  predicate,
  options = { timeoutMs: 120_000, intervalMs: 1_000 },
) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (predicate(null, response)) {
        return;
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
  const postgresLog = await run('docker', ['logs', postgresContainer], {
    allowFailure: true,
    captureOutput: true,
  });

  await writeFile(path.join(logsDir, 'postgres.log'), postgresLog ?? '', 'utf8');
}

function run(command, args, options = {}) {
  const {
    cwd = repoRoot,
    env = process.env,
    allowFailure = false,
    captureOutput = false,
  } = options;

  return new Promise((resolve, reject) => {
    const resolvedCommand = resolveCommand(command);
    const spawnCommand =
      process.platform === 'win32' && shouldUseCmdWrapper(resolvedCommand)
        ? 'cmd.exe'
        : resolvedCommand;
    const spawnArgs =
      spawnCommand === 'cmd.exe'
        ? ['/d', '/s', '/c', buildWindowsCommand(resolvedCommand, args)]
        : args;

    const child = spawn(spawnCommand, spawnArgs, {
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

function resolveCommand(command) {
  if (process.platform !== 'win32') {
    return command;
  }

  if (command === 'npm') {
    return 'npm.cmd';
  }

  if (command === 'npx') {
    return 'npx.cmd';
  }

  return command;
}

function shouldUseCmdWrapper(command) {
  return command.toLowerCase().endsWith('.cmd');
}

function buildWindowsCommand(command, args) {
  return [command, ...args].map(quoteWindowsArg).join(' ');
}

function quoteWindowsArg(value) {
  if (value.length === 0) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

await main();
