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
const stagingGenericOverlayDir = path.join(
  repoRoot,
  'k8s',
  'overlays',
  'staging-generic',
);
const prodGenericOverlayDir = path.join(
  repoRoot,
  'k8s',
  'overlays',
  'prod-generic',
);
const stagingOperatorOverlayDir = path.join(
  repoRoot,
  'k8s',
  'overlays',
  'staging-operator',
);
const prodOperatorOverlayDir = path.join(
  repoRoot,
  'k8s',
  'overlays',
  'prod-operator',
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

const genericOverlayExpectations = [
  {
    label: 'k8s/overlays/staging-generic',
    dir: stagingGenericOverlayDir,
    host: 'staging.campuscore.example.com',
    tlsSecret: 'campuscore-staging-tls',
    frontendUrl: 'https://staging.campuscore.example.com',
    placeholderPrefix: 'replace-me-with-staging-',
  },
  {
    label: 'k8s/overlays/prod-generic',
    dir: prodGenericOverlayDir,
    host: 'campuscore.example.com',
    tlsSecret: 'campuscore-prod-tls',
    frontendUrl: 'https://campuscore.example.com',
    placeholderPrefix: 'replace-me-with-prod-',
  },
];

const operatorOverlayExpectations = [
  {
    label: 'k8s/overlays/staging-operator',
    dir: stagingOperatorOverlayDir,
    host: 'staging.campuscore.example.com',
    tlsSecret: 'campuscore-staging-tls',
    frontendUrl: 'https://staging.campuscore.example.com',
    placeholderPrefix: 'replace-me-with-staging-',
    clusterIssuer: 'replace-with-staging-cluster-issuer',
    secretStoreName: 'replace-with-staging-cluster-secret-store',
    remoteSecretKey: 'replace-with-staging/campuscore/runtime',
  },
  {
    label: 'k8s/overlays/prod-operator',
    dir: prodOperatorOverlayDir,
    host: 'campuscore.example.com',
    tlsSecret: 'campuscore-prod-tls',
    frontendUrl: 'https://campuscore.example.com',
    placeholderPrefix: 'replace-me-with-prod-',
    clusterIssuer: 'replace-with-prod-cluster-issuer',
    secretStoreName: 'replace-with-prod-cluster-secret-store',
    remoteSecretKey: 'replace-with-prod/campuscore/runtime',
  },
];

async function main() {
  const baseRender = await kubectlKustomize(baseDir);
  const bootstrapRender = await kubectlKustomize(bootstrapDir);
  const dockerDesktopRender = await kubectlKustomize(dockerDesktopOverlayDir);
  const genericRenders = await Promise.all(
    genericOverlayExpectations.map(async (overlay) => ({
      ...overlay,
      renderedYaml: await kubectlKustomize(overlay.dir),
    })),
  );
  const operatorRenders = await Promise.all(
    operatorOverlayExpectations.map(async (overlay) => ({
      ...overlay,
      renderedYaml: await kubectlKustomize(overlay.dir),
    })),
  );

  const baseTag = getResolvedTag(baseRender, runtimeImages);
  const bootstrapTag = getResolvedTag(bootstrapRender, bootstrapImages);
  const overlayTag = getResolvedTag(dockerDesktopRender, runtimeImages);
  const genericTags = genericRenders.map((overlay) =>
    getResolvedTag(overlay.renderedYaml, runtimeImages),
  );
  const operatorTags = operatorRenders.map((overlay) =>
    getResolvedTag(overlay.renderedYaml, runtimeImages),
  );

  if (
    baseTag !== bootstrapTag ||
    baseTag !== overlayTag ||
    genericTags.some((tag) => tag !== baseTag) ||
    operatorTags.some((tag) => tag !== baseTag)
  ) {
    throw new Error(
      `Kustomize image tags drifted across base/bootstrap/overlays: base=${baseTag}, bootstrap=${bootstrapTag}, docker-desktop=${overlayTag}, generic=${genericTags.join(
        ', ',
      )}, operator=${operatorTags.join(', ')}`,
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
  for (const overlay of genericRenders) {
    assertGhcrImages(
      overlay.renderedYaml,
      runtimeImages,
      baseTag,
      overlay.label,
    );
    assertGenericOverlay(overlay);
  }
  for (const overlay of operatorRenders) {
    assertGhcrImages(
      overlay.renderedYaml,
      runtimeImages,
      baseTag,
      overlay.label,
    );
    assertOperatorOverlay(overlay);
  }

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
  for (const overlay of genericRenders) {
    console.log(
      `[k8s-preflight] ${overlay.label} renders clean with release tag ${baseTag}.`,
    );
  }
  for (const overlay of operatorRenders) {
    console.log(
      `[k8s-preflight] ${overlay.label} renders clean with release tag ${baseTag}.`,
    );
  }
  console.log(
    '[k8s-preflight] Local overlay sets Swagger on, secure cookies off, and localhost frontend URL for browser-safe local validation.',
  );
  console.log(
    '[k8s-preflight] Generic overlays stay cloud-agnostic: ingress host/TLS placeholders are present, nginx stays behind ClusterIP, and ingressClassName is intentionally unset.',
  );
  console.log(
    '[k8s-preflight] Operator overlays replace static placeholder secrets with ExternalSecret and Certificate resources for cert-manager/external-secrets handoff.',
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

function assertGenericOverlay(overlay) {
  const { label, placeholderPrefix, renderedYaml } = overlay;

  assertSharedClusterIngressContract(overlay);

  if (!renderedYaml.includes(`${placeholderPrefix}postgres-password`)) {
    throw new Error(`${label} is missing environment-specific secret placeholders.`);
  }
}

function assertOperatorOverlay(overlay) {
  const {
    clusterIssuer,
    label,
    placeholderPrefix,
    remoteSecretKey,
    renderedYaml,
    secretStoreName,
    tlsSecret,
    host,
  } = overlay;

  assertSharedClusterIngressContract(overlay);

  if (renderedYaml.includes(`${placeholderPrefix}postgres-password`)) {
    throw new Error(
      `${label} must delete the static placeholder Secret before layering operator-managed secrets.`,
    );
  }

  if (hasDocument(renderedYaml, 'Secret', 'campuscore-secrets')) {
    throw new Error(
      `${label} still renders a plain Secret named campuscore-secrets. Operator overlays must hand secret ownership to ExternalSecret.`,
    );
  }

  const certificateDoc = extractDocument(renderedYaml, 'Certificate', 'campuscore-tls');
  for (const expected of [
    `secretName: ${tlsSecret}`,
    `name: ${clusterIssuer}`,
    `- ${host}`,
  ]) {
    if (!certificateDoc.includes(expected)) {
      throw new Error(
        `${label} is missing the expected cert-manager setting: ${expected}`,
      );
    }
  }

  const externalSecretDoc = extractDocument(
    renderedYaml,
    'ExternalSecret',
    'campuscore-secrets',
  );
  for (const expected of [
    'kind: ClusterSecretStore',
    `name: ${secretStoreName}`,
    'name: campuscore-secrets',
    'creationPolicy: Owner',
    `key: ${remoteSecretKey}`,
    'secretKey: POSTGRES_PASSWORD',
    'secretKey: JWT_SECRET',
    'secretKey: JWT_REFRESH_SECRET',
    'secretKey: HEALTH_READINESS_KEY',
    'secretKey: INTERNAL_SERVICE_TOKEN',
    'secretKey: RABBITMQ_PASSWORD',
    'secretKey: MINIO_USER',
    'secretKey: MINIO_PASSWORD',
    'secretKey: SMTP_USER',
    'secretKey: SMTP_PASSWORD',
  ]) {
    if (!externalSecretDoc.includes(expected)) {
      throw new Error(
        `${label} is missing the expected external-secrets setting: ${expected}`,
      );
    }
  }
}

function assertSharedClusterIngressContract(overlay) {
  const { frontendUrl, host, label, renderedYaml, tlsSecret } = overlay;

  if (renderedYaml.includes('campuscore-local-readiness-key-12345')) {
    throw new Error(`${label} must not leak Docker Desktop local secrets.`);
  }

  if (renderedYaml.includes('replace-me-before-apply')) {
    throw new Error(`${label} still renders base placeholder secrets.`);
  }

  for (const expected of [
    'COOKIE_SECURE: "true"',
    'SWAGGER_ENABLED: "false"',
    `FRONTEND_URL: ${frontendUrl}`,
  ]) {
    if (!renderedYaml.includes(expected)) {
      throw new Error(`${label} is missing the expected override: ${expected}`);
    }
  }

  if (/ingressClassName:/u.test(renderedYaml)) {
    throw new Error(
      `${label} must stay cloud-agnostic and therefore must not hard-code ingressClassName.`,
    );
  }

  const nginxServiceDoc = extractDocument(renderedYaml, 'Service', 'campuscore-nginx');
  if (!/type:\s*ClusterIP/u.test(nginxServiceDoc)) {
    throw new Error(`${label} must keep campuscore-nginx behind a ClusterIP service.`);
  }

  const ingressDoc = extractDocument(renderedYaml, 'Ingress', 'campuscore');
  for (const expected of [
    `- ${host}`,
    `host: ${host}`,
    `secretName: ${tlsSecret}`,
  ]) {
    if (!ingressDoc.includes(expected)) {
      throw new Error(`${label} is missing the expected ingress setting: ${expected}`);
    }
  }
}

function hasDocument(renderedYaml, kind, name) {
  try {
    extractDocument(renderedYaml, kind, name);
    return true;
  } catch {
    return false;
  }
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
