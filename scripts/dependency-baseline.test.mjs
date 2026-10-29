import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkRepository,
  listSurfaceInputFiles,
} from './dependency-baseline.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campusute-dependency-baseline-'));
  for (const relativePath of listSurfaceInputFiles(repositoryRoot)) {
    const source = path.join(repositoryRoot, ...relativePath.split('/'));
    const destination = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('rejects an H2 pin change without a matching compatibility entry', (t) => {
  const root = createFixture(t);
  const pomPath = path.join(root, 'java-services', 'restful-api', 'pom.xml');
  const pom = fs.readFileSync(pomPath, 'utf8');
  const changed = pom.replace(
    /(<artifactId>h2<\/artifactId>\s*<version>)2\.3\.232(<\/version>)/,
    (_match, prefix, suffix) => `${prefix}2.4.240${suffix}`,
  );
  assert.notEqual(changed, pom, 'the fixture must contain the explicit H2 pin');
  fs.writeFileSync(pomPath, changed);

  const result = checkRepository(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('H2 pin') && error.includes('2.4.240')));
});

test('accepts a patch bump within the recorded version lane', (t) => {
  const root = createFixture(t);
  const manifestPath = path.join(root, 'frontend', 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const current = manifest.dependencies.next;
  const match = current.match(/(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'the fixture must contain a concrete Next.js version');
  const patchBumped = current.replace(match[0], `${match[1]}.${match[2]}.${Number(match[3]) + 1}`);
  manifest.dependencies.next = patchBumped;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = checkRepository(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('rejects a dependency range that spans multiple major lanes', (t) => {
  const root = createFixture(t);
  const manifestPath = path.join(root, 'frontend', 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const current = manifest.dependencies.next;
  const match = current.match(/(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'the fixture must contain a concrete Next.js version');
  manifest.dependencies.next = `${current} || ^${Number(match[1]) + 1}.0.0`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.throws(
    () => checkRepository(root),
    (error) => error.message === 'frontend/package.json: Next.js version range is unsupported',
  );
});

test('keeps Docker image mismatch diagnostics to paths and versions', (t) => {
  const root = createFixture(t);
  const dockerPath = path.join(root, 'frontend', 'Dockerfile');
  const dockerfile = fs.readFileSync(dockerPath, 'utf8');
  const privateImage = dockerfile.replaceAll('node:20-alpine', 'registry.example/private-node:20-alpine');
  assert.notEqual(privateImage, dockerfile, 'the fixture must contain a versioned Node image');
  fs.writeFileSync(dockerPath, privateImage);

  const result = checkRepository(root);
  const diagnostics = result.errors.join('\n');
  assert.equal(result.ok, false);
  assert.match(diagnostics, /frontend\/Dockerfile: Docker base image identity changed at version 20/);
  assert.doesNotMatch(diagnostics, /registry\.example|private-node|sha256:/);
});

test('fails closed on malformed package manifests', (t) => {
  const root = createFixture(t);
  fs.writeFileSync(path.join(root, 'frontend', 'package.json'), '{ malformed');

  assert.throws(
    () => checkRepository(root),
    (error) => error.message === 'frontend/package.json: invalid JSON',
  );
});
