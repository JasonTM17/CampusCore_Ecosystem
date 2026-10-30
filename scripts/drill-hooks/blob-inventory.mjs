#!/usr/bin/env node
/**
 * MP38 blob-inventory hook (lead-owned trusted code).
 * Verifies that every external blob referenced by the restored database's
 * thesis report object metadata actually exists as bytes on the writer's
 * local storage root, and that the stored SHA-256 matches the DB digest.
 * The writer stays fenced during the drill, so bytes are read out of the
 * stopped container via `docker cp` — never by starting or exec-ing it.
 * Scope: storage_provider = 'local' rows only — any other provider has no
 * client inside the disposable rig and is reported as a failure, never PASS.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const fail = (reason) => { console.log(JSON.stringify({ status: 'FAIL', reason })); process.exit(0); };

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
    `SELECT jsonb_build_array(storage_provider,storage_key,file_sha256)::text
     FROM thesis.thesis_group_report WHERE storage_key IS NOT NULL ORDER BY storage_key`],
    { encoding: 'utf8', timeout: 30_000 });
  if (rows.status !== 0) { fail('inventory-query'); return; }
  const entries = rows.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const localRoot = (process.env.DRILL_LOCAL_ROOT || '/tmp/campuscore/thesis-reports').replace(/\/+$/, '');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-blob-'));
  const checked = [];
  for (const [provider, key, sha256] of entries) {
    if (provider !== 'local') { fail(`unverifiable-provider:${provider}`); return; }
    // storage_key is server-generated, but refuse anything suspicious anyway.
    if (!/^[a-zA-Z0-9._/-]+$/.test(key) || key.includes('..') || key.startsWith('/')) { fail('unsafe-key'); return; }
    const target = path.join(tmp, 'blob');
    const copy = spawnSync('docker', ['cp', `${writer}:${localRoot}/${key}`, target], { encoding: 'utf8', timeout: 30_000 });
    if (copy.status !== 0) { fail(`missing-bytes:${key}`); return; }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if (actual !== sha256) { fail(`digest-mismatch:${key}`); return; }
    checked.push(key);
  }
  console.log(JSON.stringify({ status: 'PASS', checked: checked.length }));
});
