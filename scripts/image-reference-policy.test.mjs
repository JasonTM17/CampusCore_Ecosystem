import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_MUTABLE,
  classifyReference,
  evaluateReferences,
  parseReferences,
} from './image-reference-policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skippedDirectories = new Set(['.git', '.next', '.expo', 'build', 'dist', 'node_modules', 'target']);
const mutableBaselineCeiling = new Set([
  'docker-compose.yml|mailpit|axllent/mailpit:v1.21',
  'docker-compose.yml|assistant-db-provisioner|node:20-alpine',
  'docker-compose.e2e.yml|postgres|postgres:15-alpine',
  'docker-compose.e2e.yml|assistant-db-provisioner|node:20-alpine',
  'scripts/caddy-validate.mjs|DEFAULT_CADDY_IMAGE|caddy:2.10.2-alpine',
]);

function isDockerfile(name) {
  return name === 'Dockerfile' || name.startsWith('Dockerfile.') || name.endsWith('.Dockerfile');
}

function listImageSourceFiles(root) {
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name) && !entry.name.startsWith('.test-')) {
          visit(path.join(directory, entry.name));
        }
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      const isCompose = entry.name.startsWith('docker-compose') && entry.name.endsWith('.yml');
      const isWorkflow = relativePath.startsWith('.github/workflows/')
        && !relativePath.slice('.github/workflows/'.length).includes('/')
        && entry.name.endsWith('.yml');
      const isCaddyDefault = relativePath === 'scripts/caddy-validate.mjs';

      if (isCompose || isDockerfile(entry.name) || isWorkflow || isCaddyDefault) {
        files.push(relativePath);
      }
    }
  }

  visit(root);
  return files.sort();
}

function scanRepository(root) {
  return listImageSourceFiles(root).flatMap((relativePath) => parseReferences(
    relativePath,
    readFileSync(path.join(root, relativePath), 'utf8'),
  ));
}

function copyImageSources(root, destination, injectMutableComposeImage = false) {
  for (const relativePath of listImageSourceFiles(root)) {
    let content = readFileSync(path.join(root, relativePath), 'utf8');
    if (injectMutableComposeImage && relativePath === 'docker-compose.yml') {
      content = content.replace(
        /^services:\s*$/m,
        'services:\n  unpinned-policy-probe:\n    image: nginx:latest',
      );
    }

    const destinationPath = path.join(destination, relativePath);
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, content, 'utf8');
  }
}

test('image parser inventories Compose images and ignores build-only services', () => {
  const references = parseReferences('docker-compose.fixture.yml', `services:
  built-from-source:
    build: .
  mailpit:
    image: axllent/mailpit:v1.21
`);

  assert.deepEqual(references.map(({ service, reference }) => ({ service, reference })), [
    { service: 'mailpit', reference: 'axllent/mailpit:v1.21' },
  ]);
});

test('image parser inventories Dockerfile stages and workflow container and service images', () => {
  const digest = `node:20-alpine@sha256:${'a'.repeat(64)}`;
  const dockerfile = parseReferences('frontend/Dockerfile', `FROM --platform=$BUILDPLATFORM ${digest} AS build\nFROM scratch`);
  assert.deepEqual(dockerfile.map(({ reference }) => reference), [digest, 'scratch']);

  const workflow = parseReferences('.github/workflows/fixture.yml', `jobs:\n  build:\n    container:\n      image: node:20-alpine\n    services:\n      postgres:\n        image: postgres:15-alpine\n  direct:\n    container: ${digest}\n`);
  assert.deepEqual(workflow.map(({ service, reference }) => ({ service, reference })), [
    { service: 'container', reference: 'node:20-alpine' },
    { service: 'postgres', reference: 'postgres:15-alpine' },
    { service: 'container', reference: digest },
  ]);
});

test('mutable external tags and malformed digests are rejected', () => {
  const references = [
    'node',
    'node:latest',
    'node:20',
    'node:20.1',
    'node:20.1.2',
    'node:20@sha256:abcd',
    `node:20@sha512:${'a'.repeat(64)}`,
  ];

  for (const reference of references) {
    assert.equal(
      classifyReference(reference, { file: 'fixture.yml', service: 'app' }).classification,
      'MUTABLE',
      `${reference} must not be accepted without a valid sha256 digest`,
    );
  }
});

test('unapproved local-build tags and unchecked variable overrides are rejected', () => {
  assert.equal(classifyReference('student-management-ute-restful-api:dev', {
    file: 'docker-compose.yml',
    service: 'restful-api',
  }).classification, 'MUTABLE');

  assert.equal(classifyReference('${E2E_CORE_API_IMAGE:-nginx:latest}', {
    file: 'docker-compose.e2e.yml',
    service: 'restful-api',
  }).classification, 'MUTABLE');
});

test('digest pins, scratch, exact local builds and reviewed GHCR interpolation are accepted', () => {
  assert.equal(classifyReference(`node:20-alpine@sha256:${'a'.repeat(64)}`).classification, 'digest-pinned');
  assert.equal(classifyReference('scratch').classification, 'scratch');
  assert.equal(classifyReference('student-management-ute-database:local', {
    file: 'docker-compose.yml',
    service: 'postgres',
  }).classification, 'approved-local-build');
  assert.equal(classifyReference('${E2E_CORE_API_IMAGE:-student-management-ute-restful-api:e2e-local}', {
    file: 'docker-compose.e2e.yml',
    service: 'restful-api',
  }).classification, 'approved-local-build');
  assert.equal(classifyReference(
    'ghcr.io/jasontm17/student-management-ute-database:${CAMPUSCORE_IMAGE_TAG:?Set CAMPUSCORE_IMAGE_TAG to a reviewed full commit SHA}',
    { file: 'docker-compose.rag.override.yml', service: 'postgres' },
  ).classification, 'approved-variable');
});

test('evaluation rejects stale baseline entries and mutable references outside the baseline', () => {
  const baseline = [{
    file: 'docker-compose.yml',
    service: 'mailpit',
    reference: 'axllent/mailpit:v1.21',
    reason: 'owner digest pending',
  }];
  const stale = evaluateReferences([], { knownMutable: baseline });
  assert.equal(stale.ok, false);
  assert.ok(stale.issues.some(({ type }) => type === 'stale-known-mutable'));

  const added = evaluateReferences([
    ...parseReferences('docker-compose.yml', 'services:\n  probe:\n    image: nginx:latest\n'),
  ], { knownMutable: [] });
  assert.equal(added.ok, false);
  assert.ok(added.issues.some(({ type, reference }) => (
    type === 'unapproved-mutable-reference' && reference === 'nginx:latest'
  )));
});

test('known mutable baseline only shrinks from its reviewed ceiling', () => {
  for (const entry of KNOWN_MUTABLE) {
    const key = `${entry.file}|${entry.service}|${entry.reference}`;
    assert.ok(mutableBaselineCeiling.has(key), `${key} is outside the reviewed baseline ceiling`);
    assert.equal(entry.reason, 'owner digest pending');
  }
});

test('repo scan rejects a new mutable reference in a scratch Compose copy', (t) => {
  const scratchRoot = mkdtempSync(path.join(repoRoot, '.test-image-policy-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(scratchRoot)), path.resolve(repoRoot));
    assert.ok(path.basename(scratchRoot).startsWith('.test-image-policy-'));
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  copyImageSources(repoRoot, scratchRoot, true);
  const result = evaluateReferences(scanRepository(scratchRoot));

  assert.equal(result.ok, false);
  assert.ok(result.issues.some(({ file, reference, type }) => (
    file === 'docker-compose.yml'
    && reference === 'nginx:latest'
    && type === 'unapproved-mutable-reference'
  )));
});

test('real repository image inventory passes with the explicit mutable baseline', () => {
  const references = scanRepository(repoRoot);
  const result = evaluateReferences(references);
  const messages = result.issues.map((issue) => JSON.stringify(issue)).join('\n');

  assert.ok(references.some(({ file }) => file === 'docker-compose.yml'), 'Compose inventory is present');
  assert.ok(references.some(({ file }) => file.endsWith('Dockerfile')), 'Dockerfile inventory is present');
  assert.ok(references.some(({ file }) => file === 'scripts/caddy-validate.mjs'), 'Caddy default is inventoried');
  assert.equal(result.ok, true, messages);
});
