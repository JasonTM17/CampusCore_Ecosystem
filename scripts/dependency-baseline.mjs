#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencyBaseline } from './dependency-baseline-data.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASELINE_PATH = 'scripts/dependency-baseline-data.mjs';
const COMPATIBILITY_PATH = 'docs/ecosystem/runtime-compatibility.md';
const ROOT_POM_PATH = 'java-services/pom.xml';
const API_POM_PATH = 'java-services/restful-api/pom.xml';
const H2_SURFACE = 'api.h2';
const DOCKER_PRUNE = new Set([
  '.git', '.next', '.expo', '.gradle', 'node_modules', 'target', 'dist',
  'build', 'coverage', 'artifacts',
]);

class InputError extends Error {
  constructor(file, reason) {
    super(`${file}: ${reason}`);
    this.name = 'InputError';
  }
}

function repoPath(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

function readText(root, relativePath) {
  try {
    return fs.readFileSync(repoPath(root, relativePath), 'utf8');
  } catch {
    throw new InputError(relativePath, 'missing or unreadable source');
  }
}

function parseJson(root, relativePath) {
  const text = readText(root, relativePath);
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError(relativePath, 'invalid JSON');
  }
}

function relativePath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function walkFiles(root, directory, include) {
  const absoluteDirectory = repoPath(root, directory);
  let entries;
  try {
    entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
  } catch {
    throw new InputError(directory, 'missing or unreadable directory');
  }

  const results = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!DOCKER_PRUNE.has(entry.name)) {
        results.push(...walkFiles(root, relativePath(root, absolutePath), include));
      }
    } else if (entry.isFile() && include(entry.name, absolutePath)) {
      results.push(relativePath(root, absolutePath));
    }
  }
  return results;
}

function sourceFilePaths(root) {
  const dockerfiles = walkFiles(root, '.', (name) => name === 'Dockerfile' || name.endsWith('.Dockerfile'));
  const workflows = walkFiles(root, '.github/workflows', (name) => /\.ya?ml$/i.test(name));
  return [
    ROOT_POM_PATH,
    API_POM_PATH,
    'frontend/package.json',
    'mobile/package.json',
    COMPATIBILITY_PATH,
    BASELINE_PATH,
    ...dockerfiles,
    ...workflows,
  ];
}

function stripXmlComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function tagValue(source, tagName, file, label) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`<${escaped}\\b[^>]*>\\s*([^<\\s]+)\\s*<\\/${escaped}>`, 'i'));
  if (!match) throw new InputError(file, `${label} is missing`);
  return match[1];
}

function numericParts(value, file, label) {
  const match = String(value).trim().match(/^[^0-9]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) throw new InputError(file, `${label} version is invalid`);
  return match.slice(1, 4).map((part) => (part === undefined ? null : Number(part)));
}

function versionLane(value, file, label, policy = 'major') {
  const sourceVersion = String(value).trim();
  if (!/^[~^]?v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(sourceVersion)) {
    throw new InputError(file, `${label} version range is unsupported`);
  }
  const [major, minor] = numericParts(sourceVersion, file, label);
  if (policy === 'major') return String(major);
  if (policy === 'major-minor') {
    if (minor === null) throw new InputError(file, `${label} version is incomplete`);
    return `${major}.${minor}`;
  }
  if (policy === 'react-native') {
    if (major === 0) {
      if (minor === null) throw new InputError(file, `${label} version is incomplete`);
      return `${major}.${minor}`;
    }
    return String(major);
  }
  throw new Error(`Unknown version policy: ${policy}`);
}

function addSurface(surfaces, id, file, label, version, options = {}) {
  if (Object.hasOwn(surfaces, id)) throw new InputError(file, `${label} source is ambiguous`);
  surfaces[id] = {
    path: file,
    label,
    version,
    pinRequired: options.pinRequired === true,
    pinPresent: options.pinPresent === true,
    ...(options.image ? { image: options.image } : {}),
  };
}

function pomParentVersion(xml, file) {
  const parent = xml.match(/<parent\b[^>]*>([\s\S]*?)<\/parent>/i);
  if (!parent) throw new InputError(file, 'Spring Boot parent is missing');
  const groupId = tagValue(parent[1], 'groupId', file, 'Spring Boot parent group');
  const artifactId = tagValue(parent[1], 'artifactId', file, 'Spring Boot parent artifact');
  if (groupId !== 'org.springframework.boot' || artifactId !== 'spring-boot-starter-parent') {
    throw new InputError(file, 'Spring Boot parent is missing');
  }
  return tagValue(parent[1], 'version', file, 'Spring Boot parent version');
}

function dependencyVersion(xml, file, groupId, artifactId) {
  const dependencies = [...xml.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi)]
    .map((match) => match[1]);
  const matches = dependencies.filter((block) => {
    try {
      return tagValue(block, 'groupId', file, 'dependency group') === groupId
        && tagValue(block, 'artifactId', file, 'dependency artifact') === artifactId;
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) throw new InputError(file, `${artifactId} pin is missing or ambiguous`);
  const version = tagValue(matches[0], 'version', file, `${artifactId} pin`);
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
    throw new InputError(file, `${artifactId} pin is not an explicit version`);
  }
  return version;
}

function collectPomSurfaces(root, surfaces) {
  for (const [file, prefix] of [[ROOT_POM_PATH, 'java.root'], [API_POM_PATH, 'api']]) {
    const xml = stripXmlComments(readText(root, file));
    const bootVersion = pomParentVersion(xml, file);
    addSurface(surfaces, `${prefix}.boot`, file, 'Spring Boot BOM', versionLane(bootVersion, file, 'Spring Boot', 'major-minor'));

    const properties = xml.match(/<properties\b[^>]*>([\s\S]*?)<\/properties>/i);
    if (!properties) throw new InputError(file, 'Java version properties are missing');
    const javaVersion = tagValue(properties[1], 'java.version', file, 'Java version');
    const compilerRelease = tagValue(properties[1], 'maven.compiler.release', file, 'Java compiler release');
    addSurface(surfaces, `${prefix}.java`, file, 'Java', versionLane(javaVersion, file, 'Java'));
    addSurface(surfaces, `${prefix}.compiler`, file, 'Java compiler release', versionLane(compilerRelease, file, 'Java compiler release'));
  }

  const apiXml = stripXmlComments(readText(root, API_POM_PATH));
  const h2Version = dependencyVersion(apiXml, API_POM_PATH, 'com.h2database', 'h2');
  addSurface(surfaces, H2_SURFACE, API_POM_PATH, 'H2 pin', h2Version, { pinRequired: true, pinPresent: true });
}

function dependencyManifestVersion(manifest, file, dependencyName) {
  const matches = ['dependencies', 'devDependencies']
    .filter((section) => manifest[section] && Object.hasOwn(manifest[section], dependencyName))
    .map((section) => manifest[section][dependencyName]);
  if (matches.length !== 1 || typeof matches[0] !== 'string') {
    throw new InputError(file, `${dependencyName} version is missing or ambiguous`);
  }
  return matches[0];
}

function collectPackageSurfaces(root, surfaces, file, prefix, names) {
  const manifest = parseJson(root, file);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new InputError(file, 'manifest is not an object');
  }
  for (const { key, label, policy = 'major' } of names) {
    const sourceVersion = dependencyManifestVersion(manifest, file, key);
    addSurface(surfaces, `${prefix}.${key}`, file, label, versionLane(sourceVersion, file, label, policy));
  }

  const engine = manifest.engines?.node;
  if (engine === undefined) {
    addSurface(surfaces, `${prefix}.nodeEngine`, file, 'Node engine', null);
  } else {
    if (typeof engine !== 'string') throw new InputError(file, 'Node engine version is invalid');
    addSurface(surfaces, `${prefix}.nodeEngine`, file, 'Node engine', versionLane(engine, file, 'Node engine'));
  }
}

function parseDockerImage(reference, file, label) {
  if (reference === 'scratch') return { image: 'scratch', version: 'scratch', pinPresent: true };

  const digestParts = reference.split('@');
  if (digestParts.length > 2) throw new InputError(file, `${label} image reference is invalid`);
  const digestPinned = digestParts.length === 2;
  if (digestPinned && !/^sha256:[a-f0-9]{64}$/i.test(digestParts[1])) {
    throw new InputError(file, `${label} image pin is invalid`);
  }
  const imageAndTag = digestParts[0];
  const colon = imageAndTag.lastIndexOf(':');
  const slash = imageAndTag.lastIndexOf('/');
  if (colon <= slash) throw new InputError(file, `${label} image version is missing`);
  const image = imageAndTag.slice(0, colon);
  const tag = imageAndTag.slice(colon + 1);
  if (!image || !tag) throw new InputError(file, `${label} image version is missing`);
  const [major, minor] = numericParts(tag, file, label);
  const imageFamily = image.split('/').at(-1);
  const policy = imageFamily === 'maven' ? 'major-minor' : 'major';
  const version = policy === 'major-minor'
    ? `${major}.${minor ?? 0}`
    : String(major);
  return { image, version, pinPresent: digestPinned };
}

function collectDockerSurfaces(root, surfaces) {
  const files = walkFiles(root, '.', (name) => name === 'Dockerfile' || name.endsWith('.Dockerfile'));
  if (files.length === 0) throw new InputError('Dockerfile', 'no Dockerfiles found');
  for (const file of files) {
    const text = readText(root, file);
    const fromLines = text.split(/\r?\n/).filter((line) => /^\s*FROM\s+/i.test(line));
    if (fromLines.length === 0) throw new InputError(file, 'base image is missing');
    fromLines.forEach((line, index) => {
      const match = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+[\w.-]+)?\s*$/i);
      const label = `Docker base image ${index + 1}`;
      if (!match) throw new InputError(file, `${label} is invalid`);
      const parsed = parseDockerImage(match[1], file, label);
      const id = `docker.${file}.${index + 1}`;
      addSurface(surfaces, id, file, label, parsed.version, {
        image: parsed.image,
        pinRequired: parsed.image !== 'scratch',
        pinPresent: parsed.pinPresent,
      });
    });
  }
}

function parseNodeYamlValue(value, file) {
  const commentless = value.replace(/\s+#.*$/, '').trim();
  const values = commentless.startsWith('[') && commentless.endsWith(']')
    ? commentless.slice(1, -1).split(',').map((item) => item.trim())
    : [commentless];
  if (values.length === 0 || values.some((item) => item.length === 0)) {
    throw new InputError(file, 'Node version is invalid');
  }
  return values.map((item) => item.replace(/^['"]|['"]$/g, ''));
}

function collectCiNodeSurfaces(root, surfaces) {
  const workflows = walkFiles(root, '.github/workflows', (name) => /\.ya?ml$/i.test(name));
  if (workflows.length === 0) throw new InputError('.github/workflows', 'CI workflow versions are missing');
  for (const file of workflows) {
    const text = readText(root, file);
    const lines = text.split(/\r?\n/);
    const setupNodeCount = lines.filter((line) => /\buses:\s*actions\/setup-node@/i.test(line)).length;
    const versionLines = lines.filter((line) => /^\s*node-version\s*:/i.test(line));
    if (setupNodeCount > 0 && versionLines.length === 0) {
      throw new InputError(file, 'Node version is missing');
    }
    let index = 0;
    for (const line of versionLines) {
      const value = line.replace(/^\s*node-version\s*:\s*/i, '').trim();
      for (const sourceVersion of parseNodeYamlValue(value, file)) {
        index += 1;
        const label = `CI Node ${index}`;
        addSurface(surfaces, `ci.${file}.${index}`, file, label, versionLane(sourceVersion, file, label));
      }
    }
  }
}

export function inspectRepository(root = REPOSITORY_ROOT) {
  const surfaces = {};
  collectPomSurfaces(root, surfaces);
  collectPackageSurfaces(root, surfaces, 'frontend/package.json', 'frontend', [
    { key: 'next', label: 'Next.js' },
    { key: 'react', label: 'React' },
    { key: 'typescript', label: 'TypeScript' },
  ]);
  collectPackageSurfaces(root, surfaces, 'mobile/package.json', 'mobile', [
    { key: 'expo', label: 'Expo' },
    { key: 'react', label: 'React' },
    { key: 'react-native', label: 'React Native', policy: 'react-native' },
    { key: 'typescript', label: 'TypeScript' },
  ]);
  collectDockerSurfaces(root, surfaces);
  collectCiNodeSurfaces(root, surfaces);
  return surfaces;
}

function validateBaseline(root, baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) || baseline.schemaVersion !== 1) {
    throw new InputError(BASELINE_PATH, 'unsupported baseline format');
  }
  if (!baseline.surfaces || typeof baseline.surfaces !== 'object' || Array.isArray(baseline.surfaces)) {
    throw new InputError(BASELINE_PATH, 'surfaces are missing');
  }
  for (const [id, surface] of Object.entries(baseline.surfaces)) {
    if (!surface || typeof surface !== 'object' || typeof surface.path !== 'string'
      || typeof surface.label !== 'string' || !Object.hasOwn(surface, 'version')) {
      throw new InputError(BASELINE_PATH, `${id} baseline entry is invalid`);
    }
  }
  const gates = baseline.reviewGates;
  const requiredGates = ['bootBomSasJackson', 'expoReactNative', 'next', 'h2Exception'];
  if (!gates || typeof gates !== 'object' || requiredGates.some((id) => !gates[id])) {
    throw new InputError(BASELINE_PATH, 'review gates are incomplete');
  }
  const compatibility = readText(root, COMPATIBILITY_PATH);
  const h2 = gates.h2Exception;
  if (typeof h2.version !== 'string' || !h2.reproductionReference
    || !String(h2.reproductionReference).startsWith(COMPATIBILITY_PATH)
    || !hasH2PinEntry(compatibility, h2.version)) {
    throw new InputError(COMPATIBILITY_PATH, `H2 ${h2.version ?? 'pin'} entry is missing`);
  }
}

function hasH2PinEntry(document, version) {
  const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matrix = new RegExp(`^\\|\\s*h2 \\(test\\)\\s*\\|[^|]*\\|\\s*\\*\\*${escaped} explicit test pin\\*\\*`, 'mi');
  const decision = new RegExp('pin `com\\.h2database:h2` to ' + escaped, 'i');
  return matrix.test(document) && decision.test(document);
}

function formatVersion(surface) {
  if (!surface) return 'missing';
  if (surface.version === null) return 'absent';
  return String(surface.version);
}

function compareSurfaces(root, baseline, actual) {
  const errors = [];
  const expectedSurfaces = baseline.surfaces;
  for (const [id, expected] of Object.entries(expectedSurfaces)) {
    const found = actual[id];
    if (!found) {
      errors.push(`${expected.path}: ${expected.label} expected ${formatVersion(expected)}, found missing`);
      continue;
    }
    if (expected.path !== found.path) {
      errors.push(`${found.path}: ${found.label} expected ${expected.version}, found ${found.version}`);
    }
    if (expected.version !== found.version) {
      errors.push(`${found.path}: ${found.label} expected ${formatVersion(expected)}, found ${formatVersion(found)}`);
    }
    if (expected.image !== found.image && (expected.image || found.image)) {
      errors.push(`${found.path}: Docker base image identity changed at version ${formatVersion(found)}`);
    }
    if (expected.pinRequired && !found.pinPresent) {
      errors.push(`${found.path}: ${found.label} expected pinned ${formatVersion(expected)}, found unpinned ${formatVersion(found)}`);
    }
  }
  for (const [id, found] of Object.entries(actual)) {
    if (!Object.hasOwn(expectedSurfaces, id)) {
      errors.push(`${found.path}: ${found.label} expected missing, found ${formatVersion(found)}`);
    }
  }

  const h2Surface = actual[H2_SURFACE];
  const h2Gate = baseline.reviewGates.h2Exception;
  const compatibility = readText(root, COMPATIBILITY_PATH);
  if (!h2Surface || h2Gate.version !== h2Surface.version || !hasH2PinEntry(compatibility, h2Surface.version)) {
    errors.push(`${API_POM_PATH}: H2 pin expected ${h2Gate.version}, found ${h2Surface?.version ?? 'missing'}`);
  }
  return errors;
}

export function checkRepository(root = REPOSITORY_ROOT, baseline = dependencyBaseline) {
  validateBaseline(root, baseline);
  const actual = inspectRepository(root);
  const errors = compareSurfaces(root, baseline, actual);
  return { ok: errors.length === 0, errors };
}

export function listSurfaceInputFiles(root = REPOSITORY_ROOT) {
  return sourceFilePaths(root);
}

function main(argv) {
  if (argv.length !== 1 || argv[0] !== '--check') {
    console.error('Usage: node scripts/dependency-baseline.mjs --check');
    return 2;
  }
  try {
    const result = checkRepository();
    if (!result.ok) {
      for (const error of result.errors) console.error(`FAIL ${error}`);
      return 1;
    }
    console.log('Dependency baseline: PASS');
    return 0;
  } catch (error) {
    console.error(`FAIL ${error instanceof InputError ? error.message : 'dependency baseline could not be read'}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
