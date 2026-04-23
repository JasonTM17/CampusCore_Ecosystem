import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const backendDir = path.join(repoRoot, 'backend');

const profileArg = process.argv.find((arg) => arg.startsWith('--profile='));
const profile = profileArg?.split('=')[1] || process.env.CAMPUSCORE_SEED_PROFILE || 'ui-rich';

if (!['ui-rich', 'observability', 'load'].includes(profile)) {
  console.error(`Unsupported seed profile "${profile}". Use ui-rich, observability, or load.`);
  process.exit(1);
}

async function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(750);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

async function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const candidates = [
    Number(process.env.POSTGRES_HOST_PORT || 0),
    55432,
    5432,
  ].filter(Boolean);

  for (const port of [...new Set(candidates)]) {
    if (await canConnect(port)) {
      return `postgresql://campuscore:${process.env.POSTGRES_PASSWORD || 'campuscore_password'}@127.0.0.1:${port}/campuscore?schema=public`;
    }
  }

  throw new Error(
    'Could not find a local Postgres listener on 5432 or 55432. Start the CampusCore compose stack first.',
  );
}

const databaseUrl = await resolveDatabaseUrl();

console.log(`Seeding CampusCore observability data with profile "${profile}"...`);
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', 'prisma/seed-observability.ts', `--profile=${profile}`],
  {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      CAMPUSCORE_SEED_PROFILE: profile,
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
