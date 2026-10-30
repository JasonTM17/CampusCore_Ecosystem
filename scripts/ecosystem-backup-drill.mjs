#!/usr/bin/env node
/** Disposable recovery drill. No env-file reads; runtime belongs to the lead. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const containerPattern = /^campusute-drill-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const databasePattern = /^campusute_drill_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const label = 'io.campusute.drill.disposable';
const hookNames = ['blob-inventory', 'stale-credential', 'previous-image'];
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const lines = (value) => value ? value.split('\n') : [];
class DrillConfigError extends Error {}

export function parseDrillConfig(args, env) {
  const values = {};
  const allowed = ['--out', '--previous-image', ...hookNames.map((name) => `--${name}-hook`)];
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (Object.hasOwn(values, key)) throw new DrillConfigError('Duplicate drill option');
    if (key === '--keep') values[key] = true;
    else if (allowed.includes(key) && args[i + 1]?.trim() && !args[i + 1].startsWith('--')) values[key] = args[++i];
    else throw new DrillConfigError('Unknown drill option or missing value');
  }
  if (env.ECO_DRILL_DISPOSABLE !== '1') throw new DrillConfigError('ECO_DRILL_DISPOSABLE=1 is required');
  if (!containerPattern.test(env.ECO_DRILL_CONTAINER ?? '') || /\s/.test(env.ECO_DRILL_CONTAINER)) throw new DrillConfigError('ECO_DRILL_CONTAINER is required and must match campusute-drill-<owned-name>');
  if (!databasePattern.test(env.ECO_DRILL_DB ?? '') || /\s/.test(env.ECO_DRILL_DB) || env.ECO_DRILL_DB.length > 63) throw new DrillConfigError('ECO_DRILL_DB is required and must match campusute_drill_<owned_name> (max 63 characters)');
  const user = env.ECO_DRILL_USER ?? 'campuscore';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(user) || /\s/.test(user)) throw new DrillConfigError('Invalid ECO_DRILL_USER');
  const writer = env.ECO_DRILL_WRITER || null;
  if (writer && (!containerPattern.test(writer) || /\s/.test(writer) || writer === env.ECO_DRILL_CONTAINER)) throw new DrillConfigError('ECO_DRILL_WRITER must be a distinct campusute-drill-<owned-name>');
  if (values['--previous-image'] && (!/^sha256:[a-f0-9]{64}$/.test(values['--previous-image']) || /\s/.test(values['--previous-image']))) throw new DrillConfigError('--previous-image requires an immutable sha256 digest');
  if (values['--previous-image-hook'] && !values['--previous-image']) throw new DrillConfigError('--previous-image-hook requires --previous-image');
  const hooks = {};
  for (const name of hookNames) {
    const file = values[`--${name}-hook`];
    if (file) {
      if (path.extname(file) !== '.mjs' || !fs.statSync(file).isFile()) throw new DrillConfigError('Drill hooks must be existing .mjs files');
      hooks[name] = path.resolve(file);
    }
  }
  return { container: env.ECO_DRILL_CONTAINER, db: env.ECO_DRILL_DB, user, writer,
    keep: values['--keep'] === true, outDir: path.resolve(values['--out'] ?? path.join(root, 'artifacts/verification/demo-rehearsal')),
    hooks, previousImage: values['--previous-image'] ?? null };
}

function runHook(file, context) {
  if (!file) return { status: 'NOT_RUN' };
  // Lead-owned trusted code. Capture output, never forward it or raw errors.
  const result = spawnSync(process.execPath, [file], { input: JSON.stringify(context), encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 });
  try { return { status: result.status === 0 && JSON.parse(result.stdout).status === 'PASS' ? 'PASS' : 'FAIL' }; }
  catch { return { status: 'FAIL' }; }
}

function runDrill(config) {
  const { container, db, user, writer, outDir, keep } = config;
  const docker = (argv, opts = {}) => spawnSync('docker', argv, { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024, ...opts });
  const psql = (target, sql) => {
    const result = docker(['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', target, '-Atqc', sql]);
    if (result.status !== 0) throw new Error('Database command failed; raw output withheld');
    return result.stdout.trim();
  };
  // Validate ALL targets before stopping any writer, creating files, or dumping.
  for (const target of [container, writer].filter(Boolean)) {
    const result = docker(['inspect', '--format', '{{json .Config.Labels}}', target]);
    if (result.status !== 0) throw new Error('BLOCKED_CAPABILITY: owned drill container unavailable');
    let labels;
    try { labels = JSON.parse(result.stdout); } catch { /* fail closed below */ }
    if (labels?.[label] !== 'true') throw new Error('Disposable ownership label missing; refusing drill');
    const running = docker(['inspect', '--format', '{{.State.Running}}', target]);
    if (running.status !== 0 || running.stdout.trim() !== 'true') throw new Error('BLOCKED_CAPABILITY: drill target must already be running');
  }
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const restoreDb = `campusute_drill_restore_${crypto.randomBytes(12).toString('hex')}`;
  assert.notEqual(db, restoreDb);
  const dumpPath = path.join(outDir, `demo-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  let writerStopped = false;
  let restoreCreated = false;
  const evidence = { verdict: 'FAIL', container, sourceDb: db, restoreDb, checkedAt: new Date().toISOString(),
    checks: Object.fromEntries(['database-parity', ...hookNames].map((name) => [name, { status: 'NOT_RUN' }])), restoreDropped: false };
  try {
    if (writer) {
      if (docker(['stop', writer]).status !== 0) throw new Error('Cannot fence owned writer');
      writerStopped = true;
    }
    const dump = docker(['exec', '-i', container, 'pg_dump', '--format=custom', '--no-owner', '--no-privileges', '-U', user, '-d', db],
      { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
    if (dump.status !== 0) throw new Error('Database dump failed; raw output withheld');
    fs.writeFileSync(dumpPath, dump.stdout, { flag: 'wx', mode: 0o600 });
    evidence.dump = path.basename(dumpPath);
    evidence.dumpDigest = digest(dump.stdout);
    fs.writeFileSync(`${dumpPath}.sha256`, `${evidence.dumpDigest}  ${path.basename(dumpPath)}\n`, { flag: 'wx', mode: 0o600 });
    // Never pre-drop: a name collision must fail without touching another DB.
    psql('postgres', `CREATE DATABASE ${quote(restoreDb)}`);
    restoreCreated = true;
    const restore = docker(['exec', '-i', container, 'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges', '-U', user, '-d', restoreDb],
      { input: dump.stdout, maxBuffer: 512 * 1024 * 1024 });
    if (restore.status !== 0) throw new Error('Database restore failed; raw output withheld');

    const tableSql = `SELECT format('%I.%I',table_schema,table_name) FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1`;
    const tables = lines(psql(db, tableSql));
    assert.ok(tables.length > 0, 'No source tables found');
    assert.deepEqual(lines(psql(restoreDb, tableSql)), tables, 'Table-set parity failed');
    const counts = tables.map((table) => ({ table, source: psql(db, `SELECT count(*) FROM ${table}`), restored: psql(restoreDb, `SELECT count(*) FROM ${table}`) }));
    assert.ok(counts.every((row) => row.source === row.restored), 'Row-count parity failed');
    const fkSql = `SELECT n.nspname,c.conname,pg_get_constraintdef(c.oid),c.convalidated FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' ORDER BY 1,2,3`;
    const fks = psql(db, fkSql);
    assert.equal(psql(restoreDb, fkSql), fks, 'FK declaration parity failed');
    const orphans = {};
    for (const [name, sql] of Object.entries({
      'library.LoanRequest→Copy': `SELECT count(*) FROM library."LoanRequest" l LEFT JOIN library."Copy" c ON c.id=l."copyId" WHERE c.id IS NULL`,
      'careers.Attachment→Application': `SELECT count(*) FROM careers."Attachment" a LEFT JOIN careers."Application" p ON p.id=a."applicationId" WHERE p.id IS NULL`,
      'events.Registration→Event': `SELECT count(*) FROM events."Registration" r LEFT JOIN events."Event" e ON e.id=r."eventId" WHERE e.id IS NULL`,
      'admissions.Attachment→Application': `SELECT count(*) FROM admissions."Attachment" a LEFT JOIN admissions."Application" p ON p.id=a."applicationId" WHERE p.id IS NULL`,
    })) {
      orphans[name] = psql(restoreDb, sql);
      assert.equal(orphans[name], '0', 'Restored orphan check failed');
    }
    const flywaySql = `SELECT version FROM thesis.flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1`;
    evidence.flywayHead = psql(db, flywaySql);
    assert.equal(psql(restoreDb, flywaySql), evidence.flywayHead, 'Flyway head parity failed');
    // Raw provider/bucket/key metadata stays in memory; only its digest is saved.
    const blobSql = `SELECT coalesce(jsonb_agg(jsonb_build_array(storage_provider,storage_bucket,storage_key,file_sha256) ORDER BY storage_provider,storage_bucket,storage_key)::text,'[]') FROM thesis.thesis_group_report WHERE storage_key IS NOT NULL`;
    const inventory = psql(db, blobSql);
    assert.equal(psql(restoreDb, blobSql), inventory, 'External blob metadata parity failed');
    evidence.externalBlobInventory = { references: JSON.parse(inventory).length, digest: digest(inventory), scope: 'thesis report object metadata; bytes require blob-inventory hook' };
    evidence.checks['database-parity'] = { status: 'PASS' };
    evidence.tables = counts.length;
    evidence.counts = counts;
    evidence.fkConstraints = lines(fks).length;
    evidence.orphans = orphans;
    const context = { container, sourceDb: db, restoreDb, user, writer, fixture: 'synthetic', previousImage: config.previousImage,
      externalBlobInventory: evidence.externalBlobInventory };
    for (const name of hookNames) evidence.checks[name] = runHook(config.hooks[name], { ...context, check: name });
    evidence.verdict = Object.values(evidence.checks).some((check) => check.status === 'FAIL') ? 'FAIL'
      : Object.values(evidence.checks).every((check) => check.status === 'PASS') ? 'PASS' : 'INCOMPLETE';
  } catch {
    // Assertion messages, SQL errors and child output may contain private data.
    evidence.verdict = 'FAIL';
  } finally {
    if (restoreCreated && !keep) {
      try { psql('postgres', `DROP DATABASE ${quote(restoreDb)}`); evidence.restoreDropped = true; }
      catch { evidence.verdict = 'FAIL'; }
    }
    evidence.writerFenced = writerStopped;
    evidence.writerRestarted = writerStopped ? docker(['start', writer]).status === 0 : null;
    if (evidence.writerRestarted === false) evidence.verdict = 'FAIL';
    fs.writeFileSync(path.join(outDir, 'backup-drill.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(JSON.stringify({ verdict: evidence.verdict, checks: evidence.checks, restoreDropped: evidence.restoreDropped }));
  return evidence.verdict === 'PASS' ? 0 : evidence.verdict === 'INCOMPLETE' ? 4 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runDrill(parseDrillConfig(process.argv.slice(2), process.env)); }
  catch (error) {
    // Only fixed capability errors are safe to print; never raw fs/child errors.
    const blocked = error.message.startsWith('BLOCKED_CAPABILITY:');
    console.error(blocked ? error.message : error instanceof DrillConfigError ? `REFUSED: ${error.message}` : 'REFUSED: invalid drill ownership or unavailable local capability; see ops/backup/README.md');
    process.exitCode = blocked ? 4 : 2;
  }
}
