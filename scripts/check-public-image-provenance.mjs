#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_FIELDS = new Set([
  'path',
  'sha256',
  'bytes',
  'referencedBy',
  'alt',
  'source',
  'rights',
  'depiction',
  'verifiedBy',
  'verifiedOn',
]);

export function validateManifestEntry(entry, index) {
  const errors = [];
  const prefix = `entry[${index}] (${entry?.path ?? 'unknown'})`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${prefix}: must be a JSON object`];
  }

  for (const field of Object.keys(entry)) {
    if (!ALLOWED_FIELDS.has(field)) {
      errors.push(`${prefix}: unexpected field "${field}"`);
    }
  }

  if (typeof entry.path !== 'string' || entry.path.trim() === '') {
    errors.push(`${prefix}: path must be a non-empty string`);
  } else {
    const normalized = entry.path.replace(/\\/g, '/');
    const isUnderBannersOrEvents =
      normalized.includes('images/banners/') || normalized.includes('images/events/');
    if (!isUnderBannersOrEvents) {
      errors.push(`${prefix}: path must be under images/banners or images/events`);
    }
    if (normalized.includes('images/news/')) {
      errors.push(`${prefix}: news cover images must not be in this manifest`);
    }
  }

  if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
    errors.push(`${prefix}: sha256 must be a 64-character lowercase hex string`);
  }

  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
    errors.push(`${prefix}: bytes must be a non-negative integer`);
  }

  if (!Array.isArray(entry.referencedBy) || !entry.referencedBy.every((r) => typeof r === 'string')) {
    errors.push(`${prefix}: referencedBy must be an array of strings`);
  }

  if (entry.alt !== null && typeof entry.alt !== 'string') {
    errors.push(`${prefix}: alt must be a string or null`);
  }

  if (typeof entry.source !== 'string' || entry.source.trim() === '') {
    errors.push(`${prefix}: source must be a non-empty string`);
  }

  if (typeof entry.rights !== 'string' || entry.rights.trim() === '') {
    errors.push(`${prefix}: rights must be a non-empty string`);
  }

  if (typeof entry.depiction !== 'string' || entry.depiction.trim() === '') {
    errors.push(`${prefix}: depiction must be a non-empty string`);
  }

  if (entry.verifiedBy !== null && typeof entry.verifiedBy !== 'string') {
    errors.push(`${prefix}: verifiedBy must be a string or null`);
  }

  if (entry.verifiedOn !== null && typeof entry.verifiedOn !== 'string') {
    errors.push(`${prefix}: verifiedOn must be a string or null`);
  }

  return errors;
}

export function normalizeAssetRelPath(entryPath) {
  if (typeof entryPath !== 'string') return '';
  return entryPath
    .replace(/\\/g, '/')
    .replace(/^\/?frontend\/public\//, '')
    .replace(/^\//, '');
}

export function resolveDiskPath(repoRoot, entryPath) {
  if (typeof entryPath !== 'string') return null;
  const normalized = entryPath.replace(/\\/g, '/');
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  const rel = normalizeAssetRelPath(normalized);
  return path.join(repoRoot, 'frontend', 'public', rel);
}

export function validateImageProvenance(manifestData, repoRoot) {
  const errors = [];
  const entries = Array.isArray(manifestData)
    ? manifestData
    : (manifestData?.entries ?? null);

  if (!entries || !Array.isArray(entries)) {
    return {
      valid: false,
      errors: ['manifest must be a JSON array of entries'],
      unverifiedCount: 0,
      totalEntries: 0,
    };
  }

  const seenCanonicalPaths = new Set();
  let unverifiedCount = 0;

  entries.forEach((entry, idx) => {
    const entryErrors = validateManifestEntry(entry, idx);
    errors.push(...entryErrors);
    if (entryErrors.length > 0) return;

    const canonicalRel = normalizeAssetRelPath(entry.path);
    if (seenCanonicalPaths.has(canonicalRel)) {
      errors.push(`duplicate entry for ${entry.path} (${canonicalRel})`);
    }
    seenCanonicalPaths.add(canonicalRel);

    const diskPath = resolveDiskPath(repoRoot, entry.path);
    if (!existsSync(diskPath)) {
      errors.push(`entry points to a missing file: ${entry.path} (resolved: ${diskPath})`);
    } else {
      let fileBuf;
      try {
        fileBuf = readFileSync(diskPath);
      } catch (err) {
        errors.push(`cannot read file for ${entry.path}: ${err.message}`);
      }

      if (fileBuf) {
        const computedSha = createHash('sha256').update(fileBuf).digest('hex');
        if (computedSha !== entry.sha256) {
          errors.push(
            `sha256 mismatch for ${entry.path}: manifest=${entry.sha256}, disk=${computedSha}`
          );
        }

        const computedBytes = statSync(diskPath).size;
        if (computedBytes !== entry.bytes) {
          errors.push(
            `bytes mismatch for ${entry.path}: manifest=${entry.bytes}, disk=${computedBytes}`
          );
        }
      }
    }

    const isUnverified =
      entry.source === 'UNVERIFIED' ||
      entry.rights === 'UNVERIFIED' ||
      entry.depiction === 'UNVERIFIED' ||
      entry.verifiedBy === null ||
      entry.verifiedOn === null;

    if (isUnverified) {
      unverifiedCount++;
    }
  });

  const bannerDir = path.join(repoRoot, 'frontend', 'public', 'images', 'banners');
  const eventDir = path.join(repoRoot, 'frontend', 'public', 'images', 'events');
  const expectedCanonicalPaths = new Set();

  if (existsSync(bannerDir)) {
    for (const file of readdirSync(bannerDir)) {
      expectedCanonicalPaths.add(`images/banners/${file}`);
    }
  }

  if (existsSync(eventDir)) {
    for (const file of readdirSync(eventDir)) {
      expectedCanonicalPaths.add(`images/events/${file}`);
    }
  }

  for (const expected of expectedCanonicalPaths) {
    if (!seenCanonicalPaths.has(expected)) {
      errors.push(`file missing from manifest: ${expected}`);
    }
  }

  for (const seen of seenCanonicalPaths) {
    if (!expectedCanonicalPaths.has(seen)) {
      errors.push(`manifest contains entry outside banners/events directories: ${seen}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    unverifiedCount,
    totalEntries: entries.length,
  };
}

export function runCheck(manifestPath, options = {}) {
  const repoRoot = options.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const targetPath = manifestPath ?? path.join(repoRoot, 'frontend', 'public', 'images', 'asset-manifest.json');

  let rawContent;
  try {
    rawContent = readFileSync(targetPath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read manifest from ${targetPath}: ${err.message}`);
  }

  let manifestData;
  try {
    manifestData = JSON.parse(rawContent);
  } catch (err) {
    throw new Error(`invalid JSON in manifest file ${targetPath}: ${err.message}`);
  }

  const result = validateImageProvenance(manifestData, repoRoot);

  if (!result.valid) {
    const details = result.errors.map((e) => `  - ${e}`).join('\n');
    throw new Error(`manifest structural validation failed (${result.errors.length} error(s)):\n${details}`);
  }

  console.log(
    `Static media provenance manifest is valid (${result.totalEntries} entries, ${result.unverifiedCount} UNVERIFIED).`
  );

  if (options.requireVerified && result.unverifiedCount > 0) {
    throw new Error(
      `publication gate failed: ${result.unverifiedCount} static media entries are UNVERIFIED (--require-verified is enabled)`
    );
  }

  return result;
}

function main() {
  const args = process.argv.slice(2);
  let requireVerified = false;
  let manifestPath = null;

  for (const arg of args) {
    if (arg === '--require-verified') {
      requireVerified = true;
    } else if (!arg.startsWith('-') && !manifestPath) {
      manifestPath = arg;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exitCode = 1;
      return;
    }
  }

  try {
    runCheck(manifestPath, { requireVerified });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
