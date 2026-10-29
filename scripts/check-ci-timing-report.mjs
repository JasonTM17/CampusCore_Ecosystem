#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const conclusions = new Set(['success', 'failure', 'cancelled', 'skipped']);
const allowedFields = new Set([
  'schemaVersion',
  'workflow',
  'runId',
  'runAttempt',
  'job',
  'startedAt',
  'completedAt',
  'durationMs',
  'conclusion',
]);

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function validateTimingSummary(value) {
  const errors = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return ['summary must be a JSON object'];
  }

  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) errors.push(`unexpected field: ${field}`);
  }
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  for (const field of ['workflow', 'runId', 'job']) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (!Number.isSafeInteger(value.runAttempt) || value.runAttempt < 1) {
    errors.push('runAttempt must be a positive integer');
  }
  if (!isCanonicalUtcTimestamp(value.startedAt)) errors.push('startedAt must be a canonical UTC timestamp');
  if (!isCanonicalUtcTimestamp(value.completedAt)) errors.push('completedAt must be a canonical UTC timestamp');
  if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 0) {
    errors.push('durationMs must be a non-negative integer');
  }
  if (!conclusions.has(value.conclusion)) errors.push('conclusion is not a supported job conclusion');
  if (
    isCanonicalUtcTimestamp(value.startedAt) &&
    isCanonicalUtcTimestamp(value.completedAt) &&
    Number.isSafeInteger(value.durationMs) &&
    value.durationMs >= 0 &&
    Date.parse(value.completedAt) - Date.parse(value.startedAt) !== value.durationMs
  ) {
    errors.push('durationMs must equal the timestamp difference');
  }
  return errors;
}

function validateFile(filePath) {
  let value;
  try {
    value = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read valid JSON from ${filePath}: ${error.message}`);
  }
  const errors = validateTimingSummary(value);
  if (errors.length > 0) throw new Error(errors.join('; '));
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Usage: node scripts/check-ci-timing-report.mjs [summary.json]');
  const filePath = args[0] ?? path.join('artifacts', 'ci', 'ci-timing-summary.json');
  validateFile(filePath);
  process.stdout.write('CI timing summary is schema-valid.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`CI timing summary validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
