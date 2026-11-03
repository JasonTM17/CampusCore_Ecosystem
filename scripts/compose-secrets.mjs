#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const COMPOSE_SECRET_NAMES = Object.freeze([
  'POSTGRES_PASSWORD',
  'ASSISTANT_DB_PASSWORD',
  'HEALTH_READINESS_KEY',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ASSISTANT_RAG_SERVICE_TOKEN',
  'ASSISTANT_RAG_OWNER_ASSERTION_SECRET',
  'INTERNAL_SERVICE_TOKEN',
]);

const PUBLISHED_DEFAULTS = new Map([
  ['POSTGRES_PASSWORD', new Set(['campuscore_password'])],
  ['ASSISTANT_DB_PASSWORD', new Set(['dev-only-not-a-secret-16+', 'dev-ci-password-16chars-min'])],
  ['HEALTH_READINESS_KEY', new Set(['local-course-health-key', 'edge-e2e-readiness-key-12345'])],
  ['JWT_SECRET', new Set(['local-course-jwt-secret-change-me', 'edge-e2e-jwt-secret-0123456789abcdef'])],
  ['JWT_REFRESH_SECRET', new Set(['local-course-refresh-secret-change-me', 'edge-e2e-refresh-secret-0123456789abcdef'])],
  ['ASSISTANT_RAG_SERVICE_TOKEN', new Set(['dev-rag-service-token-rotate-before-exposing'])],
  ['ASSISTANT_RAG_OWNER_ASSERTION_SECRET', new Set(['dev-ci-owner-assertion-not-a-secret'])],
  ['INTERNAL_SERVICE_TOKEN', new Set(['edge-e2e-internal-service-token-12345'])],
]);

function assignment(line) {
  return /^(\s*(?:export\s+)?)([A-Z][A-Z0-9_]*)(\s*=\s*)(.*)$/.exec(line);
}

function valueOf(raw) {
  const value = raw.trim();
  if (value.length > 0 && (value[0] === '"' || value[0] === "'")) {
    const closingQuote = value.indexOf(value[0], 1);
    if (closingQuote > 0 && /^\s*(?:#.*)?$/.test(value.slice(closingQuote + 1))) {
      return value.slice(1, closingQuote);
    }
  }
  return value.replace(/\s+#.*$/, '').trimEnd();
}

function isPublishedDefault(name, value) {
  return PUBLISHED_DEFAULTS.get(name)?.has(valueOf(value)) ?? false;
}

function serializeDotenvValue(value) {
  if (/^[A-Za-z0-9_./:+,@%-]+$/.test(value)) return value;
  if (/[\r\n]/.test(value)) throw new TypeError('Compose secret values cannot contain newlines');
  return `'${value.replace(/'/g, "\\'")}'`;
}

function generatedSecret(randomBytes) {
  return Buffer.from(randomBytes(48)).toString('base64url');
}

export function ensureComposeSecrets(options = {}) {
  const {
    root,
    fs: fsImpl = fs,
    randomBytes = crypto.randomBytes,
    env = process.env,
    names = COMPOSE_SECRET_NAMES,
  } = options;
  if (!root && !options.envPath) throw new TypeError('root or envPath is required');
  const envPath = options.envPath ?? path.join(root, '.env');
  const templatePath = options.templatePath ?? path.join(root, '.env.example');
  const hadEnvFile = fsImpl.existsSync(envPath);
  const original = hadEnvFile
    ? fsImpl.readFileSync(envPath, 'utf8')
    : fsImpl.readFileSync(templatePath, 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = /(?:\r?\n)$/.test(original);
  const lines = original ? original.split(/\r?\n/) : [];
  if (hadTrailingNewline) lines.pop();
  const generatedKeys = [];

  for (const name of names) {
    let lastIndex = -1;
    let match = null;
    for (let index = 0; index < lines.length; index += 1) {
      const candidate = assignment(lines[index]);
      if (candidate?.[2] === name) {
        lastIndex = index;
        match = candidate;
      }
    }

    const fileValue = match ? valueOf(match[4]) : '';
    const hasEnvironmentValue = Object.prototype.hasOwnProperty.call(env, name);
    const environmentValue = hasEnvironmentValue ? String(env[name] ?? '') : '';
    const hasCustomFileValue = fileValue && !isPublishedDefault(name, fileValue);
    const hasCustomEnvironmentValue = environmentValue.trim()
      && !isPublishedDefault(name, environmentValue);

    if (hasCustomFileValue) {
      if (hasEnvironmentValue && !hasCustomEnvironmentValue) env[name] = fileValue;
      continue;
    }

    if (hasCustomEnvironmentValue) {
      const storedValue = serializeDotenvValue(environmentValue);
      if (lastIndex >= 0) {
        lines[lastIndex] = `${match[1]}${name}${match[3]}${storedValue}`;
      } else {
        lines.push(`${name}=${storedValue}`);
      }
      continue;
    }

    const secret = generatedSecret(randomBytes);
    if (lastIndex >= 0) {
      lines[lastIndex] = `${match[1]}${name}${match[3]}${secret}`;
    } else {
      lines.push(`${name}=${secret}`);
    }
    env[name] = secret;
    generatedKeys.push(name);
  }

  const output = lines.join(newline) + (hadTrailingNewline || lines.length > 0 ? newline : '');
  if (output !== original || !hadEnvFile) {
    fsImpl.writeFileSync(envPath, output, { encoding: 'utf8', mode: 0o600 });
  }
  // chmod keeps an existing dotenv private too; mode is an owner-only intent
  // on Windows and an owner-only permission set on POSIX filesystems.
  fsImpl.chmodSync?.(envPath, 0o600);

  return { path: envPath, generatedKeys };
}

const invoked = process.argv[1];
const isMain = Boolean(invoked) && pathToFileURL(path.resolve(invoked)).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--ensure') {
    console.error('Usage: node scripts/compose-secrets.mjs --ensure');
    process.exitCode = 2;
  } else {
    try {
      ensureComposeSecrets({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') });
      console.log('Compose secrets are stored in the git-ignored .env file.');
    } catch (error) {
      console.error(`Compose secret preparation failed (${error instanceof Error ? error.name : 'unknown error'}).`);
      process.exitCode = 1;
    }
  }
}
