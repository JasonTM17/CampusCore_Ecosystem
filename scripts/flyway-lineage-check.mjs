#!/usr/bin/env node

/**
 * Flyway Lineage & Migration Guard (AUD-13)
 *
 * Validates the Flyway migration chain under java-services/restful-api/src/main/resources/db/migration:
 *  - Enforces naming convention: V<digits>__<description>.sql
 *  - Enforces positive integer version numbers
 *  - Disallows duplicate versions
 *  - Enforces strict sequence without unexpected gaps (only explicit allowlisted gaps: V56, V91, V119)
 *  - Read-only execution, zero external dependencies
 */

import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_MIGRATIONS_DIR = 'java-services/restful-api/src/main/resources/db/migration';
export const DEFAULT_ALLOWED_GAPS = Object.freeze([56, 91, 119]);
export const MIGRATION_FILE_PATTERN = /^V(\d+)__([a-zA-Z0-9_]+)\.sql$/;

/**
 * Performs lineage verification on the specified directory.
 *
 * @param {Object} [options]
 * @param {string} [options.dir] - Directory containing migration files (relative or absolute).
 * @param {string} [options.rootDir] - Root directory for relative resolution (default: process.cwd()).
 * @param {number[]} [options.allowedGaps] - List of allowable gap versions.
 * @param {string[]} [options.ignoredFiles] - Files in directory to ignore (e.g. README.md).
 * @returns {Object} Verification result object.
 */
export function verifyMigrationLineage(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const targetDir = options.dir || DEFAULT_MIGRATIONS_DIR;
  const dirPath = resolve(rootDir, targetDir);
  const allowedGaps = new Set((options.allowedGaps || DEFAULT_ALLOWED_GAPS).map(Number));
  const ignoredFiles = new Set(options.ignoredFiles || ['README.md', '.gitkeep', '.DS_Store']);

  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return {
      success: false,
      dirPath,
      filesCount: 0,
      minVersion: null,
      maxVersion: null,
      versions: [],
      duplicates: [],
      unexpectedGaps: [],
      allowedGapsFound: [],
      namingErrors: [{ file: dirPath, reason: `Directory unreadable: ${err.message}` }]
    };
  }

  const namingErrors = [];
  const duplicates = [];
  const seenVersions = new Map();
  const parsedMigrations = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      continue;
    }

    const filename = entry.name;
    if (ignoredFiles.has(filename)) {
      continue;
    }

    if (!filename.endsWith('.sql')) {
      namingErrors.push({
        file: filename,
        reason: 'Non-SQL file found in migration directory (not in ignoredFiles allowlist)'
      });
      continue;
    }

    const match = MIGRATION_FILE_PATTERN.exec(filename);
    if (!match) {
      namingErrors.push({
        file: filename,
        reason: 'Filename does not match pattern V<digits>__<description>.sql'
      });
      continue;
    }

    const versionNum = parseInt(match[1], 10);
    const description = match[2];

    if (!Number.isInteger(versionNum) || versionNum <= 0) {
      namingErrors.push({
        file: filename,
        reason: `Version number must be a strictly positive integer, received "${match[1]}"`
      });
      continue;
    }

    if (seenVersions.has(versionNum)) {
      duplicates.push({
        version: versionNum,
        files: [seenVersions.get(versionNum), filename]
      });
    } else {
      seenVersions.set(versionNum, filename);
    }

    parsedMigrations.push({
      version: versionNum,
      description,
      filename
    });
  }

  parsedMigrations.sort((a, b) => a.version - b.version);

  const unexpectedGaps = [];
  const allowedGapsFound = [];
  let minVersion = null;
  let maxVersion = null;

  if (parsedMigrations.length > 0) {
    minVersion = parsedMigrations[0].version;
    maxVersion = parsedMigrations[parsedMigrations.length - 1].version;

    // Check sequence from 1 (or minVersion if starting higher) to maxVersion
    const startVersion = Math.min(1, minVersion);
    for (let v = startVersion; v <= maxVersion; v++) {
      if (!seenVersions.has(v)) {
        if (allowedGaps.has(v)) {
          allowedGapsFound.push(v);
        } else {
          unexpectedGaps.push(v);
        }
      }
    }
  } else {
    namingErrors.push({
      file: dirPath,
      reason: 'No migration SQL files found in directory'
    });
  }

  const success =
    namingErrors.length === 0 &&
    duplicates.length === 0 &&
    unexpectedGaps.length === 0 &&
    parsedMigrations.length > 0;

  return {
    success,
    dirPath,
    filesCount: parsedMigrations.length,
    minVersion,
    maxVersion,
    versions: parsedMigrations.map(m => m.version),
    duplicates,
    unexpectedGaps,
    allowedGapsFound,
    namingErrors
  };
}

/**
 * CLI Entry point
 */
function runCli() {
  const args = process.argv.slice(2);
  let dir = DEFAULT_MIGRATIONS_DIR;
  let allowedGaps = [...DEFAULT_ALLOWED_GAPS];
  let jsonOutput = false;
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/flyway-lineage-check.mjs [options] [dir]

Options:
  --dir <path>          Directory containing Flyway SQL migrations
  --allow-gaps <list>   Comma-separated list of allowed gap version numbers (default: 56,91,119)
  --json                Output results as JSON
  --quiet, -q           Suppress non-error logs
  --help, -h            Show this help message

Description:
  Verifies the migration lineage, checks for duplicate versions, invalid file naming,
  and unexpected gaps not present in the documented allowlist (V56, V91, V119).
`);
      process.exit(0);
    } else if (arg === '--dir' && i + 1 < args.length) {
      dir = args[++i];
    } else if (arg === '--allow-gaps' && i + 1 < args.length) {
      allowedGaps = args[++i].split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isInteger);
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
    } else if (!arg.startsWith('-')) {
      dir = arg;
    }
  }

  const result = verifyMigrationLineage({ dir, allowedGaps });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) {
      process.exitCode = 1;
    }
    return;
  }

  if (!quiet) {
    console.log(`Checked ${result.filesCount} migration files in ${dir}`);
    if (result.minVersion !== null && result.maxVersion !== null) {
      console.log(`Version range: V${result.minVersion} to V${result.maxVersion}`);
    }
    if (result.allowedGapsFound.length > 0) {
      console.log(`Allowed gaps verified: ${result.allowedGapsFound.map(v => `V${v}`).join(', ')}`);
    }
  }

  if (result.duplicates.length > 0) {
    for (const dup of result.duplicates) {
      console.error(`FAIL Duplicate migration version V${dup.version}: ${dup.files.join(' and ')}`);
    }
  }

  if (result.unexpectedGaps.length > 0) {
    for (const gap of result.unexpectedGaps) {
      console.error(`FAIL Unexpected migration gap at V${gap} (not in allowed-gaps list)`);
    }
  }

  if (result.namingErrors.length > 0) {
    for (const err of result.namingErrors) {
      console.error(`FAIL Naming error: ${err.file} - ${err.reason}`);
    }
  }

  if (result.success) {
    if (!quiet) {
      console.log('MIGRATION LINEAGE PASS');
    }
  } else {
    process.exitCode = 1;
  }
}

const currentFileUrl = import.meta.url;
const scriptFileUrl = pathToFileURL(process.argv[1] ? resolve(process.argv[1]) : '').href;

if (currentFileUrl === scriptFileUrl) {
  runCli();
}
