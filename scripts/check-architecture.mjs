import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const backendModulesDir = path.join(repoRoot, 'backend', 'src', 'modules');
const nginxConfigPath = path.join(repoRoot, 'nginx', 'nginx.conf');

const allowedBackendModules = new Set([
  'audit-logs',
  'auth',
  'cache',
  'common',
  'finance-context',
  'health',
  'people-context',
  'people-shadow',
  'permissions',
  'rabbitmq',
  'roles',
  'users',
]);

const excludedDirectoryNames = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const staleInternalContractPattern = /\/internal\/v1\//u;

function main() {
  const errors = [];

  assertBackendModules(errors);
  assertNoStaleInternalContract(errors);
  assertNginxBoundaries(errors);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Architecture guard passed.');
}

function assertBackendModules(errors) {
  const actualModules = fs
    .readdirSync(backendModulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const unexpectedModules = actualModules.filter(
    (moduleName) => !allowedBackendModules.has(moduleName),
  );
  const missingModules = [...allowedBackendModules].filter(
    (moduleName) => !actualModules.includes(moduleName),
  );

  if (unexpectedModules.length > 0) {
    errors.push(
      `backend/src/modules still contains legacy public domains: ${unexpectedModules.join(', ')}`,
    );
  }

  if (missingModules.length > 0) {
    errors.push(
      `backend/src/modules is missing required platform modules: ${missingModules.join(', ')}`,
    );
  }
}

function assertNoStaleInternalContract(errors) {
  for (const filePath of walkRepo(repoRoot)) {
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/gu, '/');
    if (relativePath === 'scripts/check-architecture.mjs') {
      continue;
    }

    const source = fs.readFileSync(filePath, 'utf8');

    if (staleInternalContractPattern.test(source)) {
      errors.push(
        `${relativePath} still references the retired internal contract /internal/v1/*`,
      );
    }
  }
}

function assertNginxBoundaries(errors) {
  const nginxConfig = fs.readFileSync(nginxConfigPath, 'utf8');

  const requiredPatterns = [
    {
      description: 'deny /internal/* on the public edge',
      pattern: /location \^~ \/internal\/ \{\s*return 403;\s*\}/su,
    },
    {
      description: 'deny /api/v1/internal/* on the public edge',
      pattern: /location \^~ \/api\/v1\/internal\/ \{\s*return 403;\s*\}/su,
    },
    {
      description: 'route notifications to notification-service',
      pattern:
        /location \^~ \/api\/v1\/notifications\/ \{[\s\S]*?proxy_pass http:\/\/notification_service_upstream;/u,
    },
    {
      description: 'route finance to finance-service',
      pattern:
        /location \^~ \/api\/v1\/finance\/ \{[\s\S]*?proxy_pass http:\/\/finance_service_upstream;/u,
    },
    {
      description: 'route engagement domains to engagement-service',
      pattern:
        /location ~ \^\/\(announcements\|support-tickets\)\(\/\|\$\) \{[\s\S]*?proxy_pass http:\/\/engagement_service_upstream;/u,
    },
    {
      description: 'route analytics to analytics-service',
      pattern:
        /location \^~ \/api\/v1\/analytics\/ \{[\s\S]*?proxy_pass http:\/\/analytics_service_upstream;/u,
    },
    {
      description: 'route students to people-service',
      pattern:
        /location \^~ \/api\/v1\/students\/ \{[\s\S]*?proxy_pass http:\/\/people_service_upstream;/u,
    },
    {
      description: 'route lecturers to people-service',
      pattern:
        /location \^~ \/api\/v1\/lecturers\/ \{[\s\S]*?proxy_pass http:\/\/people_service_upstream;/u,
    },
    {
      description: 'route academic domains to academic-service',
      pattern:
        /location ~ \^\/api\/v1\/\(academic-years\|attendance\|classrooms\|courses\|curricula\|departments\|enrollments\|faculties\|grades\|schedules\|sections\|semesters\|waitlist\)\(\/\|\$\) \{[\s\S]*?proxy_pass http:\/\/academic_service_upstream;/u,
    },
    {
      description: 'keep auth under core-api',
      pattern:
        /location \^~ \/api\/v1\/auth\/ \{[\s\S]*?proxy_pass http:\/\/core_api_upstream;/u,
    },
    {
      description: 'keep /api/docs under core-api',
      pattern:
        /location \^~ \/api\/docs \{[\s\S]*?proxy_pass http:\/\/core_api_upstream;/u,
    },
  ];

  for (const { description, pattern } of requiredPatterns) {
    if (!pattern.test(nginxConfig)) {
      errors.push(`nginx.conf is missing the expected boundary rule to ${description}`);
    }
  }
}

function walkRepo(currentDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (excludedDirectoryNames.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRepo(fullPath));
      continue;
    }

    if (!isTextLikeFile(fullPath)) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function isTextLikeFile(filePath) {
  return /\.(?:cjs|css|env|js|json|md|mjs|mts|sh|test\.js|toml|ts|tsx|txt|yml|yaml)$/iu.test(
    filePath,
  );
}

main();
