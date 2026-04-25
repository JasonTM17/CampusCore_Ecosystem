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
const includeImageScan = process.env.LOCAL_SECURITY_INCLUDE_IMAGE_SCAN !== '0';
const summary = [];
const npmAuditTargets = [
  { id: 'platform-auth', cwd: path.join(repoRoot, 'packages', 'platform-auth') },
  { id: 'backend', cwd: path.join(repoRoot, 'backend') },
  { id: 'auth-service', cwd: path.join(repoRoot, 'auth-service') },
  { id: 'notification-service', cwd: path.join(repoRoot, 'notification-service') },
  { id: 'finance-service', cwd: path.join(repoRoot, 'finance-service') },
  { id: 'academic-service', cwd: path.join(repoRoot, 'academic-service') },
  { id: 'engagement-service', cwd: path.join(repoRoot, 'engagement-service') },
  { id: 'people-service', cwd: path.join(repoRoot, 'people-service') },
  { id: 'analytics-service', cwd: path.join(repoRoot, 'analytics-service') },
  { id: 'frontend', cwd: path.join(repoRoot, 'frontend') },
];
const fsScanTargets = [
  {
    id: 'platform-auth',
    targetPath: '/repo/packages/platform-auth',
    skipDirs: ['/repo/packages/platform-auth/node_modules'],
  },
  {
    id: 'backend',
    targetPath: '/repo/backend',
    skipDirs: [
      '/repo/backend/node_modules',
      '/repo/backend/dist',
      '/repo/backend/coverage',
    ],
  },
  {
    id: 'auth-service',
    targetPath: '/repo/auth-service',
    skipDirs: [
      '/repo/auth-service/node_modules',
      '/repo/auth-service/dist',
      '/repo/auth-service/coverage',
    ],
  },
  {
    id: 'notification-service',
    targetPath: '/repo/notification-service',
    skipDirs: [
      '/repo/notification-service/node_modules',
      '/repo/notification-service/dist',
      '/repo/notification-service/coverage',
    ],
  },
  {
    id: 'finance-service',
    targetPath: '/repo/finance-service',
    skipDirs: [
      '/repo/finance-service/node_modules',
      '/repo/finance-service/dist',
      '/repo/finance-service/coverage',
    ],
  },
  {
    id: 'academic-service',
    targetPath: '/repo/academic-service',
    skipDirs: [
      '/repo/academic-service/node_modules',
      '/repo/academic-service/dist',
      '/repo/academic-service/coverage',
    ],
  },
  {
    id: 'engagement-service',
    targetPath: '/repo/engagement-service',
    skipDirs: [
      '/repo/engagement-service/node_modules',
      '/repo/engagement-service/dist',
      '/repo/engagement-service/coverage',
    ],
  },
  {
    id: 'people-service',
    targetPath: '/repo/people-service',
    skipDirs: [
      '/repo/people-service/node_modules',
      '/repo/people-service/dist',
      '/repo/people-service/coverage',
    ],
  },
  {
    id: 'analytics-service',
    targetPath: '/repo/analytics-service',
    skipDirs: [
      '/repo/analytics-service/node_modules',
      '/repo/analytics-service/dist',
      '/repo/analytics-service/coverage',
    ],
  },
  {
    id: 'frontend',
    targetPath: '/repo/frontend',
    skipDirs: [
      '/repo/frontend/node_modules',
      '/repo/frontend/.next',
      '/repo/frontend/dist',
      '/repo/frontend/test-results',
    ],
  },
];
const imageScanTargets = [
  {
    id: 'backend',
    dockerfile: 'backend/Dockerfile',
    imageTag: 'campuscore-backend:security-local',
    archiveName: 'campuscore-backend-security-local.tar',
  },
  {
    id: 'auth-service',
    dockerfile: 'auth-service/Dockerfile',
    imageTag: 'campuscore-auth-service:security-local',
    archiveName: 'campuscore-auth-service-security-local.tar',
  },
  {
    id: 'notification-service',
    dockerfile: 'notification-service/Dockerfile',
    imageTag: 'campuscore-notification-service:security-local',
    archiveName: 'campuscore-notification-service-security-local.tar',
  },
  {
    id: 'finance-service',
    dockerfile: 'finance-service/Dockerfile',
    imageTag: 'campuscore-finance-service:security-local',
    archiveName: 'campuscore-finance-service-security-local.tar',
  },
  {
    id: 'academic-service',
    dockerfile: 'academic-service/Dockerfile',
    imageTag: 'campuscore-academic-service:security-local',
    archiveName: 'campuscore-academic-service-security-local.tar',
  },
  {
    id: 'engagement-service',
    dockerfile: 'engagement-service/Dockerfile',
    imageTag: 'campuscore-engagement-service:security-local',
    archiveName: 'campuscore-engagement-service-security-local.tar',
  },
  {
    id: 'people-service',
    dockerfile: 'people-service/Dockerfile',
    imageTag: 'campuscore-people-service:security-local',
    archiveName: 'campuscore-people-service-security-local.tar',
  },
  {
    id: 'analytics-service',
    dockerfile: 'analytics-service/Dockerfile',
    imageTag: 'campuscore-analytics-service:security-local',
    archiveName: 'campuscore-analytics-service-security-local.tar',
  },
  {
    id: 'frontend',
    dockerfile: 'frontend/Dockerfile',
    imageTag: 'campuscore-frontend:security-local',
    archiveName: 'campuscore-frontend-security-local.tar',
  },
];

async function main() {
  await rm(resultsDir, { recursive: true, force: true });
  await mkdir(resultsDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  console.log('[security-local] Bắt đầu quét bảo mật cục bộ cho CampusCore');
  console.log(`[security-local] Thư mục kết quả: ${resultsDir}`);
  console.log(
    '[security-local] Trình tự: npm audit cho toàn bộ package/service -> gitleaks -> Trivy fs -> Trivy image',
  );

  for (const target of npmAuditTargets) {
    await runStep(`${target.id}-npm-audit`, async () => {
      await runNpmAudit(
        target.cwd,
        path.join(resultsDir, `${target.id}-npm-audit.json`),
      );
    });
  }

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

  for (const target of fsScanTargets) {
    await runStep(`trivy-${target.id}-fs`, async () => {
      await runTrivyFs({
        targetPath: target.targetPath,
        outputPath: `/repo/frontend/test-results/security-local/trivy-${target.id}-fs.sarif`,
        skipDirs: target.skipDirs,
      });
    });
  }

  if (includeImageScan) {
    console.log(
      '[security-local] Đã bật image scan cho toàn bộ image trong quality gate CI',
    );
    for (const target of imageScanTargets) {
      await buildAndScanImage(target);
    }
  }

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
          '/repo/auth-service/Dockerfile',
          '/repo/notification-service/Dockerfile',
          '/repo/finance-service/Dockerfile',
          '/repo/academic-service/Dockerfile',
          '/repo/engagement-service/Dockerfile',
          '/repo/people-service/Dockerfile',
          '/repo/analytics-service/Dockerfile',
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
    await run('cmd.exe', ['/d', '/s', '/c', 'npm audit --audit-level=high --json'], {
      cwd,
      captureOutput: true,
      outputPath,
    });
    return;
  }

  await run('npm', ['audit', '--audit-level=high', '--json'], {
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
      '--skip-version-check',
      '--ignore-unfixed',
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

async function buildAndScanImage({ id, dockerfile, imageTag, archiveName }) {
  const archivePath = path.join(resultsDir, archiveName);

  await runStep(`docker-build-${id}-image`, async () => {
    await run('docker', ['build', '-f', dockerfile, '-t', imageTag, '.']);
  });

  await runStep(`docker-save-${id}-image`, async () => {
    await run('docker', ['image', 'save', imageTag, '-o', archivePath]);
  });

  await runStep(`trivy-${id}-image`, async () => {
    await run(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${cacheDir}:/root/.cache/trivy`,
        '-v',
        `${resultsDir}:/results`,
        trivyImage,
        'image',
        '--scanners',
        'vuln',
        '--skip-version-check',
        '--ignore-unfixed',
        '--input',
        `/results/${archiveName}`,
        '--severity',
        'HIGH,CRITICAL',
        '--exit-code',
        '1',
        '--format',
        'sarif',
        '--output',
        `/results/trivy-${id}-image.sarif`,
      ],
      { timeoutMs: trivyTimeoutMs },
    );
  });
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
