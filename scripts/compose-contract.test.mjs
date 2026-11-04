#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadWorkflow } from './ci-workflow-replay.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

function requiredVariables(composeFile) {
  const source = readFileSync(path.join(repoRoot, composeFile), 'utf8');
  return [...source.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((match) => match[1]);
}

function jobEnvironment(job) {
  const env = { ...(job?.env ?? {}) };
  for (const step of job?.steps ?? []) Object.assign(env, step.env ?? {});
  return env;
}

function composeServices() {
  const source = readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const services = new Set();
  let inServices = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^\S/.test(line)) break;
    const match = /^ {2}([A-Za-z0-9][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (match) services.add(match[1]);
  }
  return services;
}

test('the compose CI job supplies every variable the default compose file requires', () => {
  const doc = loadWorkflow(workflowPath, repoRoot);
  const job = doc.jobs?.compose;
  assert.ok(job, 'compose job exists');
  const env = jobEnvironment(job);
  const required = [...new Set(requiredVariables('docker-compose.yml'))];
  assert.ok(required.length > 0, 'docker-compose.yml keeps at least one required variable');

  for (const name of required) {
    const value = env[name];
    assert.ok(typeof value === 'string' && value.length > 0, `compose job must define ${name}`);
    if (/SECRET|TOKEN|PASSWORD/.test(name)) {
      assert.match(value, /^(?:dev|test|ci)[-_.]/i, `${name} must carry an obviously non-production CI value`);
    }
  }
});

const composeDocs = [
  'docs/DEMO_RUNBOOK.md',
  'docs/RELEASE.md',
  'mobile/README.md',
  'java-services/restful-api/README.md',
  'ops/backup/README.md',
];

test('documented compose entry points provision the required owner-assertion secret', () => {
  for (const doc of composeDocs) {
    const content = readFileSync(path.join(repoRoot, doc), 'utf8');
    assert.match(content, /ASSISTANT_RAG_OWNER_ASSERTION_SECRET/, `${doc} must name the required compose secret`);
    assert.match(
      content,
      /(?:Add-Content \.env|export ASSISTANT_RAG_OWNER_ASSERTION_SECRET|local-dev\.mjs up)/,
      `${doc} must tell the reader how to provision it`,
    );
  }
});

test('every docker compose logs command in docs/ecosystem names a real service', () => {
  const services = composeServices();
  assert.ok(services.has('restful-api'), 'compose service inventory is readable');
  const dir = path.join(repoRoot, 'docs', 'ecosystem');
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
    const content = readFileSync(path.join(dir, file), 'utf8');
    for (const match of content.matchAll(/docker compose logs\s+([a-z][a-z0-9-]*)/g)) {
      assert.ok(services.has(match[1]), `docs/ecosystem/${file} names unknown compose service "${match[1]}"`);
    }
  }
});
