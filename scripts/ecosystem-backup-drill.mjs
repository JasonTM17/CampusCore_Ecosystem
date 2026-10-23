#!/usr/bin/env node
/**
 * P14 backup→restore parity drill: dump the demo postgres, restore into
 * an isolated database on the same container, then compare every table's
 * row count plus FK-declared parity and targeted orphan checks. Emits an
 * evidence JSON; drops the restore DB unless --keep.
 *
 * Env: ECO_DRILL_CONTAINER (default the local audit fixture),
 *      ECO_DRILL_USER, ECO_DRILL_DB.
 * Exit 4 when the drill container is absent — a missing demo stack is a
 * BLOCKED capability, never a skip.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const keep = args.includes('--keep');
const outDir = flag('--out') ?? path.join(root, 'artifacts/verification/demo-rehearsal');

const container = process.env.ECO_DRILL_CONTAINER ?? 'campuscore-course-e2e-audit-261019-postgres-1';
const user = process.env.ECO_DRILL_USER ?? 'campuscore';
const db = process.env.ECO_DRILL_DB ?? 'campuscore_audit_261019';

const docker = (argv, opts = {}) =>
  spawnSync('docker', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const psql = (targetDb, sql) => {
  const r = docker(['exec', '-i', container, 'psql', '-U', user, '-d', targetDb, '-Atqc', sql]);
  if (r.status !== 0) throw new Error(`psql(${targetDb}) failed: ${r.stderr.slice(-400)}`);
  return r.stdout.trim();
};

// capability probe — missing container ⇒ BLOCKED (exit 4)
const inspect = docker(['inspect', container]);
if (inspect.status !== 0) {
  console.error(`BLOCKED_CAPABILITY drill container ${container} not running (ECO_DRILL_CONTAINER to override)`);
  process.exit(4);
}

fs.mkdirSync(outDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const restoreDb = `demo_restore_${process.pid}`;
const dumpPath = path.join(outDir, `demo-${ts}.dump`);

// ── 0. fence the writer ───────────────────────────────────────────────
// pg_dump's snapshot is self-consistent, but comparing restore-content
// to a still-writing source races (e.g. ScheduledAnnouncementNotifyJob
// inserting rows between dump and count — observed on the first drill).
// Fence the writer like the recovery procedure does; restart it in
// finally even on failure.
const writer = process.env.ECO_DRILL_WRITER ?? null;
let writerStopped = false;
if (writer) {
  const stop = docker(['stop', writer]);
  if (stop.status !== 0) throw new Error(`cannot fence writer ${writer}: ${stop.stderr.slice(-300)}`);
  writerStopped = true;
}

try {
// ── 1. dump ────────────────────────────────────────────────────────────
const dump = spawnSync('docker',
  ['exec', '-i', container, 'pg_dump', '--format=custom', '--no-owner', '--no-privileges', '-U', user, '-d', db],
  { maxBuffer: 512 * 1024 * 1024 });
if (dump.status !== 0) throw new Error(`pg_dump failed: ${String(dump.stderr).slice(-400)}`);
fs.writeFileSync(dumpPath, dump.stdout);
const dumpDigest = crypto.createHash('sha256').update(dump.stdout).digest('hex');
fs.writeFileSync(`${dumpPath}.sha256`, `${dumpDigest}  ${path.basename(dumpPath)}\n`);

// ── 2. restore into isolated DB ───────────────────────────────────────
psql('postgres', `DROP DATABASE IF EXISTS "${restoreDb}"`);
psql('postgres', `CREATE DATABASE "${restoreDb}"`);
const restore = spawnSync('docker',
  ['exec', '-i', container, 'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges', '-U', user, '-d', restoreDb],
  { input: dump.stdout, maxBuffer: 512 * 1024 * 1024 });
if (restore.status !== 0) throw new Error(`pg_restore failed: ${String(restore.stderr).slice(-600)}`);

// ── 3. parity: every base-table row count, both directions ─────────────
const tableSql = `SELECT table_schema||'.'||table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1`;
const tables = psql(db, tableSql).split('\n');
const count = (target, table) => {
  const [schema, name] = table.split('.');
  return Number(psql(target, `SELECT count(*) FROM "${schema}"."${name}"`));
};
const counts = tables.map((t) => ({ table: t, source: count(db, t), restored: count(restoreDb, t) }));
const mismatched = counts.filter((c) => c.source !== c.restored);
assert.deepEqual(mismatched, [], `row-count parity broke on ${mismatched.map((m) => m.table).join(', ')}`);

// FK declaration parity — every constraint lands in the restore.
const fkCount = (target) => Number(psql(target, `SELECT count(*) FROM pg_constraint WHERE contype='f'`));
const fks = { source: fkCount(db), restored: fkCount(restoreDb) };
assert.equal(fks.source, fks.restored, 'FK constraint parity broke');

// Targeted orphan checks on the domain lanes the plan names
// (publication/loan/submission + attachment parity).
const orphans = {};
orphans['library.LoanRequest→Copy'] = psql(restoreDb,
  `SELECT count(*) FROM library."LoanRequest" l LEFT JOIN library."Copy" c ON c.id=l."copyId" WHERE c.id IS NULL`);
orphans['careers.Attachment→Application'] = psql(restoreDb,
  `SELECT count(*) FROM careers."Attachment" a LEFT JOIN careers."Application" p ON p.id=a."applicationId" WHERE p.id IS NULL`);
orphans['events.Registration→Event'] = psql(restoreDb,
  `SELECT count(*) FROM events."Registration" r LEFT JOIN events."Event" e ON e.id=r."eventId" WHERE e.id IS NULL`);
orphans['admissions.Attachment→Application'] = psql(restoreDb,
  `SELECT count(*) FROM admissions."Attachment" a LEFT JOIN admissions."Application" p ON p.id=a."applicationId" WHERE p.id IS NULL`);
for (const [name, n] of Object.entries(orphans)) {
  assert.equal(Number(n), 0, `orphans in restored ${name}`);
}

// Flyway head at drill time + storage-object rows whose bytes live
// OUTSIDE this dump (object store, not pg_dump) — counted so the gap is
// disclosed in evidence rather than implied covered.
const flywayHead = psql(db,
  `SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1`);
const storageObjects = Number(psql(db,
  `SELECT count(*) FROM thesis.thesis_group_report WHERE storage_key IS NOT NULL`));

let restoreDropped = false;
if (!keep) {
  psql('postgres', `DROP DATABASE IF EXISTS "${restoreDb}"`);
  restoreDropped = true;
}

const evidence = {
  verdict: 'PASS',
  scope: 'db-only; thesis_report storage objects live on the object-store volume/provider and are not covered by pg_dump parity',
  container, sourceDb: db, restoreDb, dump: path.basename(dumpPath),
  dumpDigest, dumpBytes: dump.stdout.length, tables: counts.length,
  rowsTotal: counts.reduce((s, c) => s + c.source, 0),
  fkConstraints: fks, orphans, mismatched,
  flywayHead, storageObjects,
  writerFenced: writerStopped,
  restoreDropped,
  checkedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'backup-drill.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ verdict: 'PASS', tables: counts.length, rows: evidence.rowsTotal, dumpDigest, restoreDb: keep ? restoreDb : `${restoreDb} (dropped)`, writerFenced: writerStopped }, null, 2));
} finally {
  if (writerStopped) {
    docker(['start', writer]);
  }
}
