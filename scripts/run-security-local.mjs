import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const resultsDir = path.join(
  repoRoot,
  'frontend',
  'test-results',
  'security-local',
);
const cacheDir = path.join(os.homedir(), '.campuscore', 'trivy-cache');
const trivyImage = process.env.TRIVY_IMAGE ?? 'aquasec/trivy:0.65.0';
const gitleaksImage =
  process.env.GITLEAKS_IMAGE ?? 'zricethezav/gitleaks:latest';
const trivyTimeoutMs = Number(
  process.env.LOCAL_SECURITY_TRIVY_TIMEOUT_MS ?? '600000',
);
const includeConfigScan = process.env.LOCAL_SECURITY_INCLUDE_CONFIG === '1';
const summary = [];

async function main() {
  await rm(resultsDir, { recursive: true, force: true });
  await mkdir(resultsDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  console.log('[security-local] Bắt đầu quét bảo mật cục bộ cho CampusCore');
  console.log(`[security-local] Thư mục kết quả: ${resultsDir}`);
  console.log(
    '[security-local] Trình tự: backend npm audit -> notification-service npm audit -> finance-service npm audit -> academic-service npm audit -> frontend npm audit -> gitleaks -> trivy fs',
  );

  await runStep('backend-npm-audit', async () => {
    await runNpmAudit(
      path.join(repoRoot, 'backend'),
      path.join(resultsDir, 'backend-npm-audit.json'),
    );
  });

  await runStep('notification-service-npm-audit', async () => {
    await runNpmAudit(
      path.join(repoRoot, 'notification-service'),
      path.join(resultsDir, 'notification-service-npm-audit.json'),
    );
  });

  await runStep('finance-service-npm-audit', async () => {
    await runNpmAudit(
      path.join(repoRoot, 'finance-service'),
      path.join(resultsDir, 'finance-service-npm-audit.json'),
    );
  });

  await runStep('academic-service-npm-audit', async () => {
    await runNpmAudit(
      path.join(repoRoot, 'academic-service'),
      path.join(resultsDir, 'academic-service-npm-audit.json'),
    );
  });

  await runStep('frontend-npm-audit', async () => {
    await runNpmAudit(
      path.join(repoRoot, 'frontend'),
      path.join(resultsDir, 'frontend-npm-audit.json'),
    );
  });

  await runStep('gitleaks', async () => {
    await run('docker', [
      'run',
      '--rm',
      '-v',
      `${repoRoot}:/repo`,
      gitleaksImage,
      'detect',
      '--source=/repo',
      '--no-banner',
      '--redact',
      '--report-format',
      'sarif',
      '--report-path',
      '/repo/frontend/test-results/security-local/gitleaks.sarif',
    ]);
  });

  await runStep('trivy-backend-fs', async () => {
    await runTrivyFs({
      targetPath: '/repo/backend',
      outputPath:
        '/repo/frontend/test-results/security-local/trivy-backend-fs.sarif',
      skipDirs: [
        '/repo/backend/node_modules',
        '/repo/backend/dist',
        '/repo/backend/coverage',
      ],
    });
  });

  await runStep('trivy-notification-service-fs', async () => {
    await runTrivyFs({
      targetPath: '/repo/notification-service',
      outputPath:
        '/repo/frontend/test-results/security-local/trivy-notification-service-fs.sarif',
      skipDirs: [
        '/repo/notification-service/node_modules',
        '/repo/notification-service/dist',
        '/repo/notification-service/coverage',
      ],
    });
  });

  await runStep('trivy-frontend-fs', async () => {
    await runTrivyFs({
      targetPath: '/repo/frontend',
      outputPath:
        '/repo/frontend/test-results/security-local/trivy-frontend-fs.sarif',
      skipDirs: [
        '/repo/frontend/node_modules',
        '/repo/frontend/.next',
        '/repo/frontend/dist',
        '/repo/frontend/test-results',
      ],
    });
  });

  await runStep('trivy-finance-service-fs', async () => {
    await runTrivyFs({
      targetPath: '/repo/finance-service',
      outputPath:
        '/repo/frontend/test-results/security-local/trivy-finance-service-fs.sarif',
      skipDirs: [
        '/repo/finance-service/node_modules',
        '/repo/finance-service/dist',
        '/repo/finance-service/coverage',
      ],
    });
  });

  await runStep('trivy-academic-service-fs', async () => {
    await runTrivyFs({
      targetPath: '/repo/academic-service',
      outputPath:
        '/repo/frontend/test-results/security-local/trivy-academic-service-fs.sarif',
      skipDirs: [
        '/repo/academic-service/node_modules',
        '/repo/academic-service/dist',
        '/repo/academic-service/coverage',
      ],
    });
  });

  if (includeConfigScan) {
    console.log(
      '[security-local] Đã bật thêm Trivy config cho phạm vi hạ tầng',
    );
    await runStep('trivy-config', async () => {
      await run(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${repoRoot}:/repo`,
          '-v',
          `${cacheDir}:/root/.cache/trivy`,
          trivyImage,
          'config',
          '--severity',
          'HIGH,CRITICAL',
          '--exit-code',
          '1',
          '--format',
          'sarif',
          '--output',
          '/repo/frontend/test-results/security-local/trivy-config.sarif',
          '/repo/nginx',
          '/repo/docker-compose.yml',
          '/repo/docker-compose.production.yml',
          '/repo/docker-compose.e2e.yml',
          '/repo/backend/Dockerfile',
          '/repo/notification-service/Dockerfile',
          '/repo/finance-service/Dockerfile',
          '/repo/academic-service/Dockerfile',
          '/repo/frontend/Dockerfile',
        ],
        { timeoutMs: trivyTimeoutMs },
      );
    });
  }

  await writeFile(
    path.join(resultsDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );

  const failedSteps = summary.filter((entry) => entry.status !== 'passed');
  if (failedSteps.length > 0) {
    console.error(
      `[security-local] Có ${failedSteps.length} bước lỗi. Xem chi tiết trong ${resultsDir}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    '[security-local] Hoàn tất. Không thấy lỗi bảo mật mức blocker trong sweep cục bộ.',
  );
}

async function runStep(name, action) {
  const startedAt = Date.now();
  console.log(`[security-local] -> ${name}`);

  try {
    await action();
    const durationMs = Date.now() - startedAt;
    summary.push({ name, status: 'passed', durationMs });
    console.log(
      `[security-local] <- ${name} xong trong ${(durationMs / 1000).toFixed(1)}s`,
    );
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    summary.push({
      name,
      status: 'failed',
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(
      `[security-local] <- ${name} lỗi sau ${(durationMs / 1000).toFixed(1)}s: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function runNpmAudit(cwd, outputPath) {
  if (process.platform === 'win32') {
    await run('cmd.exe', ['/d', '/s', '/c', 'npm audit --json'], {
      cwd,
      captureOutput: true,
      outputPath,
    });
    return;
  }

  await run('npm', ['audit', '--json'], {
    cwd,
    captureOutput: true,
    outputPath,
  });
}

async function runTrivyFs({ targetPath, outputPath, skipDirs }) {
  await run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${repoRoot}:/repo`,
      '-v',
      `${cacheDir}:/root/.cache/trivy`,
      trivyImage,
      'fs',
      '--scanners',
      'vuln,misconfig',
      '--severity',
      'HIGH,CRITICAL',
      '--timeout',
      `${Math.max(1, Math.floor(trivyTimeoutMs / 60000))}m`,
      '--exit-code',
      '1',
      '--format',
      'sarif',
      '--output',
      outputPath,
      ...skipDirs.flatMap((dir) => ['--skip-dirs', dir]),
      targetPath,
    ],
    { timeoutMs: trivyTimeoutMs },
  );
}

async function run(command, args, options = {}) {
  const {
    cwd = repoRoot,
    env = process.env,
    captureOutput = false,
    outputPath,
    timeoutMs,
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
    let timedOut = false;
    let timeoutHandle;

    if (captureOutput) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    if (timeoutMs) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
    }

    child.on('error', (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on('close', async (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const combinedOutput = captureOutput ? `${stdout}${stderr}` : '';
      if (outputPath) {
        await writeFile(outputPath, combinedOutput, 'utf8');
      }

      if (timedOut) {
        reject(
          new Error(
            `${command} ${args.join(' ')} vượt quá thời gian ${timeoutMs}ms`,
          ),
        );
        return;
      }

      if (code === 0) {
        resolve(combinedOutput);
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} thoát với mã ${code}${
            captureOutput && combinedOutput ? `\n${combinedOutput}` : ''
          }`,
        ),
      );
    });
  });
}

await main();
