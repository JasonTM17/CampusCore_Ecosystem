import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const isExternalStack = process.env.E2E_EXTERNAL_STACK === '1';
const skipWebServer = process.env.E2E_SKIP_WEBSERVER === '1';
const apiBaseURL =
  process.env.E2E_API_URL ??
  (isExternalStack ? 'http://127.0.0.1/api/v1' : 'http://127.0.0.1:4100/api/v1');
const frontendBaseURL =
  process.env.E2E_BASE_URL ??
  (isExternalStack ? 'http://127.0.0.1' : 'http://127.0.0.1:3100');
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://campuscore:campuscore_password@127.0.0.1:5433/campuscore_e2e?schema=public';
const redisUrl = process.env.E2E_REDIS_URL ?? 'disabled';
const rabbitmqUrl = process.env.E2E_RABBITMQ_URL ?? 'disabled';
const frontendNodeOptions = [process.env.NODE_OPTIONS, '--max-old-space-size=4096']
  .filter(Boolean)
  .join(' ');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/playwright',
  use: {
    baseURL: frontendBaseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: isExternalStack || skipWebServer
    ? undefined
    : [
        {
          command: 'npm run start',
          cwd: path.resolve(__dirname, '../backend'),
          url: `${apiBaseURL}/health/liveness`,
          timeout: 120_000,
          reuseExistingServer: true,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            PORT: '4100',
            FRONTEND_URL: frontendBaseURL,
            JWT_SECRET: process.env.E2E_JWT_SECRET ?? 'e2e-jwt-secret',
            JWT_REFRESH_SECRET:
              process.env.E2E_JWT_REFRESH_SECRET ?? 'e2e-jwt-refresh-secret',
            NODE_ENV: 'test',
            REDIS_URL: redisUrl,
            RABBITMQ_URL: rabbitmqUrl,
          },
        },
        {
          command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
          cwd: __dirname,
          url: frontendBaseURL,
          timeout: 120_000,
          reuseExistingServer: true,
          env: {
            ...process.env,
            NEXT_PUBLIC_API_URL: apiBaseURL,
            NODE_OPTIONS: frontendNodeOptions,
          },
        },
      ],
});
