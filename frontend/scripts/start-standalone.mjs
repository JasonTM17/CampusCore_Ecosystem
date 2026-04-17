import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const standaloneDir = path.join(projectRoot, '.next', 'standalone');
const standaloneServer = path.join(standaloneDir, 'server.js');
const standaloneStaticDir = path.join(standaloneDir, '.next', 'static');
const sourceStaticDir = path.join(projectRoot, '.next', 'static');
const sourcePublicDir = path.join(projectRoot, 'public');
const standalonePublicDir = path.join(standaloneDir, 'public');

await ensureDirectory(standaloneDir, 'Run `npm run build` before `npm run start:standalone`.');
await ensureDirectory(sourceStaticDir, 'Run `npm run build` before `npm run start:standalone`.');

await mirrorDirectory(sourceStaticDir, standaloneStaticDir);

try {
  await stat(sourcePublicDir);
  await mirrorDirectory(sourcePublicDir, standalonePublicDir);
} catch {
  await mkdir(standalonePublicDir, { recursive: true });
}

const child = spawn(process.execPath, [standaloneServer], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function ensureDirectory(dirPath, message) {
  return stat(dirPath).catch(() => {
    throw new Error(message);
  });
}

async function mirrorDirectory(source, target) {
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}
