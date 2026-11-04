#!/usr/bin/env node
// Runs every ecosystem HTTPS preview lane. Each lane boots its own disposable
// stack, sets SSO_PORTAL_BASE for its Playwright spec, and tears the stack down
// again, so the merge gate collects the specs the single-host suite excludes.
//
//   node scripts/ecosystem-e2e-verify.mjs --project-prefix <campuscore-*> [--evidence-root dir]
//
// The first failing lane stops the run; a lane that cannot start is a failure,
// never a skip.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_PREFIX_RE = /^campuscore-[a-z0-9-]+$/;

export const ECOSYSTEM_LANES = ['admissions', 'careers', 'content', 'events', 'learning', 'library', 'sso'];

function usage(message) {
  if (message) console.error(`USAGE_FAIL ${message}`);
  console.error('Usage: ecosystem-e2e-verify.mjs --project-prefix <campuscore-*> [--evidence-root dir]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { evidenceRoot: path.join('artifacts', 'verification') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-prefix') args.projectPrefix = argv[++i];
    else if (arg === '--evidence-root') args.evidenceRoot = argv[++i];
    else usage(`unknown arg ${arg}`);
  }
  return args;
}

function runLane(lane, args) {
  const runner = path.join(REPO, 'scripts', `ecosystem-${lane}-verify.mjs`);
  const evidence = path.join(args.evidenceRoot, `ecosystem-${lane}-ci`);
  const result = spawnSync(process.execPath, [
    runner,
    'preview',
    '--project',
    `${args.projectPrefix}-${lane}`,
    '--evidence',
    evidence,
  ], { cwd: REPO, stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ecosystem lane ${lane} exited ${result.status}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectPrefix || !PROJECT_PREFIX_RE.test(args.projectPrefix)) {
    usage('--project-prefix must match /^campuscore-[a-z0-9-]+$/');
  }

  for (const lane of ECOSYSTEM_LANES) {
    console.log(`RUN ecosystem lane ${lane}`);
    runLane(lane, args);
  }
  console.log(`PASS ecosystem lanes: ${ECOSYSTEM_LANES.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL ecosystem lanes: ${error.message || error}`);
    process.exit(1);
  }
}
