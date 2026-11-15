#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'publish-ghcr.yml');
const workflow = readFileSync(workflowPath, 'utf8');
const lines = workflow.split(/\r?\n/);

// Steps in this workflow sit at six-space indentation under each job's `steps:`
// key; a step ends at the next sibling step or at the next job key.
function findStepRange(name) {
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(start, -1, `workflow step not found: ${name}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s{6}- (?:name|uses):/.test(line) || /^ {2}\S/.test(line)) {
      end = index;
      break;
    }
  }
  return { start, end, text: lines.slice(start, end).join('\n') };
}

function extractRunBlocks() {
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s+)run: \|\s*$/.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    const block = [];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim() && line.search(/\S/) <= indent) break;
      block.push(line);
    }
    blocks.push(block.join('\n'));
    index = cursor - 1;
  }
  return blocks;
}

test('build stages a quarantined candidate tag instead of the immutable release tag', () => {
  const meta = findStepRange('Generate metadata').text;
  assert.match(
    meta,
    /value=candidate-\$\{\{ needs\.release-gate\.outputs\.sha \}\}/,
    'metadata must emit a candidate-<sha> staging tag',
  );
  assert.doesNotMatch(
    meta,
    /value=\$\{\{ needs\.release-gate\.outputs\.sha \}\}/,
    'metadata must not emit the bare immutable release tag',
  );

  const pushes = lines.filter((line) => /push:\s*true/.test(line));
  assert.equal(pushes.length, 1, 'exactly one step may push image bytes');

  const stage = findStepRange('Build and stage candidate image').text;
  assert.match(stage, /push:\s*true/, 'the staging step is the single push');
  assert.match(
    stage,
    /release_state == 'promote'/,
    'staging must only run while promotion is pending',
  );
  assert.match(stage, /sbom:\s*true/, 'staged image must carry an SBOM attestation');
  assert.match(stage, /provenance:\s*mode=max/, 'staged image must carry max provenance');
});

test('release tags are created only by the promotion step via manifest copy', () => {
  const promote = findStepRange('Promote scanned image to immutable release tags');
  assert.match(
    promote.text,
    /imagetools create/,
    'release tags must be created by copying the verified manifest, not by rebuilding',
  );
  const copies = lines.filter((line) => /imagetools create/.test(line));
  for (const line of copies) {
    assert.ok(
      promote.text.includes(line.trim()),
      `manifest copy found outside the promotion step: ${line.trim()}`,
    );
  }
});

test('vulnerability scan inspects the staged digest before any promotion step', () => {
  const scanStep = findStepRange('Scan staged image for high and critical vulnerabilities');
  const promoteIndex = findStepRange('Promote scanned image to immutable release tags').start;
  const stageIndex = findStepRange('Build and stage candidate image').start;
  assert.ok(stageIndex < scanStep.start, 'staging must precede the scan');
  assert.ok(scanStep.start < promoteIndex, 'the scan must run before release-tag promotion');
  assert.ok(
    promoteIndex < findStepRange('Verify immutable registry parity and source revision').start,
    'post-promotion parity must run after the promotion step',
  );

  assert.match(
    scanStep.text,
    /image-ref:\s*\$\{\{ steps\.scanref\.outputs\.ref \}\}/,
    'scan must address the artifact through the digest-bound scan reference',
  );
  assert.match(scanStep.text, /exit-code:\s*'1'/, 'scan findings must fail the job');

  const scanref = findStepRange('Resolve scan source and verify attestations').text;
  assert.match(
    scanref,
    /@\$digest|@\$\{?digest/,
    'scan source must be expressed as repo@digest, not a movable tag',
  );
  assert.ok(
    findStepRange('Resolve scan source and verify attestations').start < scanStep.start,
    'the digest must be resolved before the scan runs',
  );
});

test('SBOM/provenance attestation is verified on the exact scanned digest', () => {
  const scanref = findStepRange('Resolve scan source and verify attestations').text;
  assert.match(
    scanref,
    /vnd\.docker\.reference\.type/,
    'attestation manifests must be enumerated on the scan source',
  );
  assert.match(scanref, /revision/, 'scan source must be bound to the requested revision');
});

test('promotion is unreachable unless the scan and evidence checks succeed', () => {
  const promote = findStepRange('Promote scanned image to immutable release tags').text;
  const ifLine = promote.split('\n').find((line) => /^\s+if:/.test(line));
  assert.ok(ifLine, 'promotion step must declare an if guard');
  assert.match(ifLine, /success\(\)/, 'promotion must require all prior steps to succeed');
  assert.match(
    ifLine,
    /release_state == 'promote'/,
    'promotion must only run while a release tag is missing',
  );
});

test('promotion never repoints an existing release tag to different bytes', () => {
  const promote = findStepRange('Promote scanned image to immutable release tags').text;
  assert.match(
    promote,
    /already points at the scanned digest/,
    'a tag already bound to the scanned digest must be left untouched',
  );
  assert.match(
    promote,
    /refusing to overwrite/,
    'a tag bound to a different digest must refuse promotion',
  );
});

test('a partially published release is recoverable without rebuilding or overwriting', () => {
  const gate = findStepRange('Check immutable tag state').text;
  assert.doesNotMatch(
    gate,
    /refusing to create a cross-registry manifest/,
    'a tag surviving in one registry must be completable instead of fatal',
  );
  assert.match(
    gate,
    /source_repo=/,
    'the surviving registry must become the promotion source',
  );

  const promote = findStepRange('Promote scanned image to immutable release tags').text;
  assert.match(promote, /GHCR_IMAGE:\$full_sha/, 'promotion must cover the GHCR tag');
  assert.match(promote, /HUB_IMAGE:\$full_sha/, 'promotion must cover the Docker Hub tag');
});

test('release tags must resolve to the exact digest that was scanned', () => {
  const parity = findStepRange('Verify immutable registry parity and source revision').text;
  assert.match(
    parity,
    /SCAN_DIGEST/,
    'post-promotion digests must be compared with the scanned digest',
  );
  assert.match(
    parity,
    /vnd\.docker\.reference\.type/,
    'attestation evidence must be re-checked after promotion',
  );
});

test('workflow never writes secret values to logs, outputs or summaries', () => {
  const offenders = lines.filter(
    (line) => /\$\{\{\s*secrets\./.test(line) && /(echo|printf|GITHUB_OUTPUT|GITHUB_STEP_SUMMARY|>>|cat )/.test(line),
  );
  assert.deepEqual(
    offenders,
    [],
    `secret-bearing expressions must not be logged: ${offenders.join('; ')}`,
  );

  for (const block of extractRunBlocks()) {
    assert.doesNotMatch(
      block,
      /\$\{\{\s*secrets\./,
      'secrets must reach actions through with:/env: inputs, never inline in run: bodies',
    );
  }
});

test('action references are pinned to a version tag or commit SHA, never a floating ref', () => {
  const uses = lines.filter((line) => /^\s+-?\s*uses:/.test(line));
  assert.notEqual(uses.length, 0, 'workflow must use actions');
  for (const line of uses) {
    const ref = line.split('@')[1]?.trim();
    assert.ok(ref, `action without a ref: ${line.trim()}`);
    const bare = ref.replace(/\s+#.*$/, '');
    assert.match(
      bare,
      /^(v\d+(\.\d+)*)$|^([0-9a-f]{40})$/,
      `unpinned or floating action ref: ${bare}`,
    );
  }
});
