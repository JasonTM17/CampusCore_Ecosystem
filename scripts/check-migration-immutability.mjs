#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

function migrationFamily(file) {
  if (!file.startsWith('java-services/') || !file.endsWith('.sql')) return null;
  const parts = file.split('/');
  const index = parts.findIndex((part, partIndex) => part === 'db'
    && ['migration', 'migration-h2'].includes(parts[partIndex + 1]));
  return index >= 2 ? parts[index + 1] : null;
}

function migrationVersion(file) {
  const filename = file.split('/').at(-1);
  return /^V(\d+(?:[._]\d+)*)__/.exec(filename)?.[1] ?? null;
}

function isMigrationFile(file) {
  return migrationFamily(file) !== null;
}

export function parseMigrationTree(output) {
  return output.split('\0').filter(Boolean).flatMap((entry) => {
    const tab = entry.indexOf('\t');
    if (tab < 0) throw new Error('git ls-tree returned an invalid entry');
    const [mode, type, blob] = entry.slice(0, tab).split(' ');
    const file = entry.slice(tab + 1);
    if (type !== 'blob' || !isMigrationFile(file)) return [];
    return [{ path: file, blob, mode, family: migrationFamily(file), version: migrationVersion(file) }];
  });
}

export async function readMigrationTree(ref, git = execFileAsync) {
  const { stdout } = await git('git', ['ls-tree', '-r', '-z', ref, '--', 'java-services'], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  return parseMigrationTree(stdout);
}

export async function checkMigrationImmutability({ baseRef, headRef = 'HEAD', readTree = readMigrationTree } = {}) {
  if (!baseRef) throw new TypeError('baseRef is required');
  const [baselineTree, headTree] = await Promise.all([
    readTree(baseRef),
    readTree(headRef),
  ]);
  const baseline = baselineTree.filter((migration) => isMigrationFile(migration.path));
  const head = headTree.filter((migration) => isMigrationFile(migration.path));
  const headByPath = new Map(head.map((migration) => [migration.path, migration]));
  const failures = baseline.filter((migration) => {
    const samePath = headByPath.get(migration.path);
    if (samePath?.blob === migration.blob) return false;
    const family = migration.family ?? migrationFamily(migration.path);
    const version = migration.version ?? migrationVersion(migration.path);
    if (!version) return true;
    return !head.some((current) => (current.family ?? migrationFamily(current.path)) === family
      && (current.version ?? migrationVersion(current.path)) === version
      && current.blob === migration.blob);
  });
  return { ok: failures.length === 0, checked: baseline.length, failures };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    console.error('Usage: node scripts/check-migration-immutability.mjs <base-ref>');
    process.exitCode = 2;
    return;
  }
  const result = await checkMigrationImmutability({ baseRef: argv[0] });
  if (!result.ok) {
    for (const migration of result.failures) {
      console.error(`IMMUTABLE migration content changed or removed: ${migration.path}`);
    }
    console.error('Corrective changes must use a new Flyway version; see the migration README.');
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: ${result.checked} baseline migrations retain their versioned content.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
