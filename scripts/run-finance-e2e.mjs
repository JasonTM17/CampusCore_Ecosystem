import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function main() {
  await run(process.execPath, [path.join(repoRoot, 'scripts', 'run-fast-e2e.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      E2E_PROFILE: 'finance',
      E2E_PLAYWRIGHT_FILTER: 'e2e/finance-checkout.spec.ts',
      E2E_SESSION_CACHE_NAMESPACE:
        process.env.E2E_SESSION_CACHE_NAMESPACE ??
        `finance-e2e-${Date.now()}`,
    },
  });
}

function run(command, args, options = {}) {
  const { cwd = repoRoot, env = process.env } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

await main();
