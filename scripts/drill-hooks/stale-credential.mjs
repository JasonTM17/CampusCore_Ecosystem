#!/usr/bin/env node
/**
 * MP38 stale-credential hook (lead-owned trusted code).
 * Asserts that the restore preserved every account's credential fencing
 * state: credential_version and password_hash must be identical between the
 * source database and the restored copy. A restore that silently drifts
 * credential versions would wrongly validate stale tokens (or wrongly fence
 * live ones) — this catches that at the DB boundary. Only a digest of the
 * comparison result is printed; raw hashes never leave the container.
 */
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const fail = (reason) => { console.log(JSON.stringify({ status: 'FAIL', reason })); process.exit(0); };

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let context;
  try { context = JSON.parse(input); } catch { fail('context-parse'); return; }
  const { container, sourceDb, restoreDb, user } = context;
  const credentialDigest = (db) => {
    const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
      '-U', user, '-d', db, '-Atqc',
      `SELECT coalesce(md5(string_agg(t.id || ':' || t."credentialVersion" || ':' || t."password", '|' ORDER BY t.id)), '')
       FROM campuscore_auth."User" t`],
      { encoding: 'utf8', timeout: 30_000 });
    if (result.status !== 0) return null;
    return result.stdout.trim();
  };
  const source = credentialDigest(sourceDb);
  const restored = credentialDigest(restoreDb);
  if (source === null || restored === null) { fail('credential-query'); return; }
  if (source !== restored) { fail('credential-drift'); return; }
  console.log(JSON.stringify({ status: 'PASS', digest: crypto.createHash('sha256').update(source).digest('hex').slice(0, 16) }));
});
