#!/usr/bin/env node
/**
 * MP38 previous-image hook (lead-owned trusted code).
 * Verifies the rollback image named by --previous-image is present locally
 * and content-addressable: `docker image inspect sha256:<digest>` must
 * resolve to a real image entry (Docker stores RepoDigests for pulled
 * images; locally built images are inspected by ID). A restore is only
 * half-done if the previous runtime can't be redeployed — this proves the
 * rollback target still exists on the drill host.
 */
import { spawnSync } from 'node:child_process';

const fail = (reason) => { console.log(JSON.stringify({ status: 'FAIL', reason })); process.exit(0); };

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let context;
  try { context = JSON.parse(input); } catch { fail('context-parse'); return; }
  const digest = context.previousImage;
  if (!digest || !/^sha256:[a-f0-9]{64}$/.test(digest)) { fail('no-previous-image-digest'); return; }
  // Content-addressed lookup: an image whose ID matches the digest resolves
  // directly; a pulled image resolves through its RepoDigest.
  for (const ref of [digest, `*@${digest}`]) {
    const inspect = spawnSync('docker', ['image', 'inspect', ref, '--format', '{{.Id}} {{json .RepoTags}}'],
      { encoding: 'utf8', timeout: 15_000 });
    if (inspect.status === 0 && inspect.stdout.trim()) {
      console.log(JSON.stringify({ status: 'PASS', ref }));
      return;
    }
  }
  // RepoDigest lookup: find any image listing this digest.
  const list = spawnSync('docker', ['images', '--digests', '--format', '{{.Repository}}@{{.Digest}}'],
    { encoding: 'utf8', timeout: 15_000 });
  if (list.status === 0 && list.stdout.split('\n').some((line) => line.trim().endsWith(digest))) {
    console.log(JSON.stringify({ status: 'PASS', ref: digest }));
    return;
  }
  fail('rollback-image-absent');
});
