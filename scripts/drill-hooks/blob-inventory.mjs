#!/usr/bin/env node
/**
 * MP38 blob-inventory hook (lead-owned trusted code).
 * Verifies that every external blob referenced by the restored database's
 * thesis report object metadata actually exists as bytes on the writer's
 * local storage root, and that the stored SHA-256 matches the DB digest.
 * The writer stays fenced during the drill, so bytes are read out of the
 * stopped container via `docker cp` — never by starting or exec-ing it.
 * Providers: 'local' rows are read from the fenced writer FS; 's3' rows are
 * fetched over HTTP from DRILL_S3_BASE (anonymous-read disposable bucket).
 * Any other provider has no client inside the rig and fails, never PASSes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const fail = (reason) => { console.log(JSON.stringify({ status: 'FAIL', reason })); process.exit(0); };

const fetchS3 = (base, bucket, key) => {
  const result = spawnSync('curl', ['-fsS', '--max-time', '15', `${base}/${bucket}/${key}`],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
};

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let context;
  try { context = JSON.parse(input); } catch { fail('context-parse'); return; }
  const { container, restoreDb, user, writer } = context;
  if (!writer) { fail('no-writer-in-context'); return; }
  // The drill context carries only a digest; re-query the restored DB for the
  // concrete references inside the owned PG container.
  const rows = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', user, '-d', restoreDb, '-Atqc',
    `SELECT jsonb_build_array(storage_provider,storage_bucket,storage_key,file_sha256)::text
     FROM thesis.thesis_group_report WHERE storage_key IS NOT NULL ORDER BY storage_key`],
    { encoding: 'utf8', timeout: 30_000 });
  if (rows.status !== 0) { fail('inventory-query'); return; }
  const entries = rows.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const localRoot = (process.env.DRILL_LOCAL_ROOT || '/tmp/campuscore/thesis-reports').replace(/\/+$/, '');
  const s3Base = (process.env.DRILL_S3_BASE || '').replace(/\/+$/, '');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-blob-'));
  const checked = [];
  for (const [provider, bucket, key, sha256] of entries) {
    // storage_key is server-generated, but refuse anything suspicious anyway.
    if (!/^[a-zA-Z0-9._/-]+$/.test(key) || key.includes('..') || key.startsWith('/')) { fail('unsafe-key'); return; }
    let bytes;
    if (provider === 'local') {
      const target = path.join(tmp, `blob-${checked.length}`);
      const copy = spawnSync('docker', ['cp', `${writer}:${localRoot}/${key}`, target], { encoding: 'utf8', timeout: 30_000 });
      if (copy.status !== 0) { fail(`missing-bytes:${key}`); return; }
      bytes = fs.readFileSync(target);
    } else if (provider === 's3') {
      if (!s3Base) { fail('no-drill-s3-base'); return; }
      if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) { fail('unsafe-bucket'); return; }
      bytes = fetchS3(s3Base, bucket, key);
      if (bytes === null) { fail(`missing-object:${bucket}/${key}`); return; }
    } else {
      fail(`unverifiable-provider:${provider}`); return;
    }
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actual !== sha256) { fail(`digest-mismatch:${key}`); return; }
    checked.push(key);
  }
  console.log(JSON.stringify({ status: 'PASS', checked: checked.length }));
});
