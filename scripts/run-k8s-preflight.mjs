import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const baseDir = path.join(repoRoot, 'k8s', 'base');
const bootstrapDir = path.join(repoRoot, 'k8s', 'bootstrap');
const dockerDesktopOverlayDir = path.join(
  repoRoot,
  'k8s',
  'overlays',
  'docker-desktop',
);

const runtimeImages = [
  'campuscore-backend',
  'campuscore-auth-service',
  'campuscore-notification-service',
  'campuscore-finance-service',
  'campuscore-academic-service',
  'campuscore-engagement-service',
  'campuscore-people-service',
  'campuscore-analytics-service',
  'campuscore-frontend',
];

const bootstrapImages = runtimeImages.filter(
  (imageName) => imageName !== 'campuscore-frontend',
);

const localOverlayExpectations = [
  'COOKIE_SECURE: "false"',
  'SWAGGER_ENABLED: "true"',
  'FRONTEND_URL: http://127.0.0.1:8080',
  'campuscore-local-readiness-key-12345',
  'campuscore-local-internal-service-token-12345',
];

async function main() {
  const baseRender = await kubectlKustomize(baseDir);
  const bootstrapRender = await kubectlKustomize(bootstrapDir);
  const dockerDesktopRender = await kubectlKustomize(dockerDesktopOverlayDir);

  const baseTag = getResolvedTag(baseRender, runtimeImages);
  const bootstrapTag = getResolvedTag(bootstrapRender, bootstrapImages);
  const overlayTag = getResolvedTag(dockerDesktopRender, runtimeImages);

  if (baseTag !== bootstrapTag || baseTag !== overlayTag) {
    throw new Error(
      `Kustomize image tags drifted across base/bootstrap/overlay: base=${baseTag}, bootstrap=${bootstrapTag}, overlay=${overlayTag}`,
    );
  }

  assertGhcrImages(baseRender, runtimeImages, baseTag, 'k8s/base');
  assertGhcrImages(bootstrapRender, bootstrapImages, baseTag, 'k8s/bootstrap');
  assertGhcrImages(
    dockerDesktopRender,
    runtimeImages,
    baseTag,
    'k8s/overlays/docker-desktop',
  );

  if (dockerDesktopRender.includes('replace-me-before-apply')) {
    throw new Error(
      'Docker Desktop overlay still renders placeholder secrets from k8s/base/secrets.example.yaml.',
    );
  }

  for (const expected of localOverlayExpectations) {
    if (!dockerDesktopRender.includes(expected)) {
      throw new Error(
        `Docker Desktop overlay is missing the expected local override: ${expected}`,
      );
    }
  }

  const nginxServiceDoc = extractDocument(
    dockerDesktopRender,
    'Service',
    'campuscore-nginx',
  );
  if (!/type:\s*ClusterIP/u.test(nginxServiceDoc)) {
    throw new Error(
      'Docker Desktop overlay must patch campuscore-nginx to ClusterIP for port-forward based local access.',
    );
  }

  console.log('[k8s-preflight] Runtime base renders clean.');
  console.log('[k8s-preflight] Bootstrap renders clean.');
  console.log(
    `[k8s-preflight] Docker Desktop overlay renders clean with release tag ${baseTag}.`,
  );
  console.log(
    '[k8s-preflight] Local overlay sets Swagger on, secure cookies off, and localhost frontend URL for browser-safe local validation.',
  );
}

function assertGhcrImages(renderedYaml, imageNames, tag, label) {
  const namespaceMatch = renderedYaml.match(
    /ghcr\.io\/([^/\s]+)\/campuscore-backend:/u,
  );
  if (!namespaceMatch) {
    throw new Error(`${label} does not resolve published GHCR image names.`);
  }

  const ghcrNamespace = namespaceMatch[1];

  for (const imageName of imageNames) {
    const expectedImage = `ghcr.io/${ghcrNamespace}/${imageName}:${tag}`;
    if (!renderedYaml.includes(expectedImage)) {
      throw new Error(`${label} is missing resolved image ${expectedImage}`);
    }
  }
}

function getResolvedTag(renderedYaml, imageNames) {
  const tags = new Set();

  for (const imageName of imageNames) {
    const pattern = new RegExp(
      `ghcr\\.io\\/[^/\\s]+\\/${escapeForRegExp(imageName)}:([^\\s"']+)`,
      'gu',
    );

    for (const match of renderedYaml.matchAll(pattern)) {
      tags.add(match[1]);
    }
  }

  if (tags.size !== 1) {
    throw new Error(
      `Expected exactly one release tag in rendered manifests, found: ${[
        ...tags,
      ].join(', ') || '(none)'}`,
    );
  }

  return [...tags][0];
}

function extractDocument(renderedYaml, kind, name) {
  const documents = renderedYaml
    .split(/^---\s*$/gmu)
    .map((document) => document.trim())
    .filter(Boolean);

  const matched = documents.find((document) => {
    return (
      new RegExp(`^kind:\\s*${escapeForRegExp(kind)}\\s*$`, 'mu').test(document) &&
      new RegExp(
        `^metadata:\\s*[\\s\\S]*?^\\s*name:\\s*${escapeForRegExp(name)}\\s*$`,
        'mu',
      ).test(document)
    );
  });

  if (!matched) {
    throw new Error(`Could not find ${kind}/${name} in rendered manifests.`);
  }

  return matched;
}

async function kubectlKustomize(targetDir) {
  return run('kubectl', ['kustomize', targetDir], { captureOutput: true });
}

function run(command, args, options = {}) {
  const { cwd = repoRoot, captureOutput = false } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(captureOutput ? stdout : undefined);
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} exited with code ${code}${
            stderr ? `\n${stderr}` : ''
          }`,
        ),
      );
    });
  });
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

await main();
