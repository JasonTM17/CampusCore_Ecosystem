#!/usr/bin/env node
// Ecosystem fixture generator/auditor (P01 step 2).
//
// Builds a synthetic fixture pack from an EMPTY disposable database: brings up
// the docker-compose.e2e.yml postgres + restful-api services (the application
// applies its own Flyway migrations), normalizes every literal outside the
// synthetic allowlist, audits all text surfaces, dumps a credential-free
// pack.sql + personas.json + manifest.json. Never clones production.
//
// Usage:
//   node scripts/ecosystem-fixture.mjs generate --project <name> [--compose-file docker-compose.e2e.yml] [--output artifacts/fixtures/ecosystem-demo] [--keep-stack]
//   node scripts/ecosystem-fixture.mjs audit --project <name> [--compose-file ...] [--pack artifacts/fixtures/ecosystem-demo] [--evidence dir]
//   node scripts/ecosystem-fixture.mjs preflight --project <name>
//
// Safety: --project must match campuscore-ecosystem-fixture-* so the script can
// only ever touch a disposable stack. Exit codes: 0 ok, 1 violations/failure,
// 2 usage, 4 capability missing.

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_RE = /^campuscore-ecosystem-fixture-[a-z0-9-]+$/;
const MIN_NODE = [22, 13, 0];
const MAX_BUFFER = 256 * 1024 * 1024;

const EMAIL_RE = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';
const EMAIL_RE_JS = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';
const EMAIL_ALLOW_RE = '@(campuscore\\.demo|campuscore\\.edu|campuscore\\.test|ute\\.demo\\.edu\\.vn)$';
// Two spellings of the same URL matcher: POSIX/Postgres (sent through sqlLit)
// and the JS RegExp used for local pack-file auditing.
const URL_RE_SQL = 'https?://[A-Za-z0-9.-]+[^[:space:]\'"<>()\\\\]*';
const URL_RE_JS = /https?:\/\/[A-Za-z0-9.-]+[^\s'"<>()\\]*/g;
const URL_HOST_ALLOW_RE = '^https?://(localhost|127\\.0\\.0\\.1|[a-z0-9.-]+\\.(campuscore\\.(demo|edu|test)|demo\\.campuscore\\.test)|campuscore\\.(demo|edu|test)|ute\\.demo\\.edu\\.vn)([/:#?].*)?$';
// m[2] carries the phone literal; boundaries exclude hex characters so digit
// runs inside sha256/uuid/hash values can never match (hex letters a–f would
// otherwise pass as non-digit boundaries and corrupt checksum columns).
const PHONE_RE = '(^|[^0-9a-fA-F+])(\\+84[0-9]{9}|0[0-9]{9})([^0-9a-fA-F]|$)';
const BCRYPT_RE = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const PHONE_RE_JS = /(^|[^0-9a-fA-F+])(\+84[0-9]{9}|0[0-9]{9})([^0-9a-fA-F]|$)/g;

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: ecosystem-fixture.mjs <generate|audit|preflight> --project <campuscore-ecosystem-fixture-*> [--compose-file f] [--output dir] [--pack dir] [--keep-stack] [--evidence dir]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { composeFile: 'docker-compose.e2e.yml', output: 'artifacts/fixtures/ecosystem-demo', keepStack: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--keep-stack') args.keepStack = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (val === undefined) usage(`missing value for ${a}`);
      if (key === 'project') args.project = val;
      else if (key === 'compose-file') args.composeFile = val;
      else if (key === 'output') args.output = val;
      else if (key === 'pack') args.pack = val;
      else if (key === 'evidence') args.evidence = val;
      else usage(`unknown flag ${a}`);
    } else positional.push(a);
  }
  args.command = positional[0];
  return args;
}

function run(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, {
    cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: MAX_BUFFER,
    stdio: opts.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    input: opts.input, env: { ...process.env, ...(opts.env || {}) },
  });
}

function tryRun(cmd, argv, opts = {}) {
  // spawnSync so stderr is captured on success too — ON_ERROR_STOP=0 sessions
  // report ERROR lines on stderr with a zero exit status.
  const res = spawnSync(cmd, argv, {
    cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: MAX_BUFFER,
    stdio: opts.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    input: opts.input, env: { ...process.env, ...(opts.env || {}) },
  });
  if (res.error) return { ok: false, out: `${res.stdout || ''}${res.stderr || ''}`, code: -1 };
  return { ok: res.status === 0, out: `${res.stdout || ''}${res.stderr || ''}`, code: res.status };
}

function composeArgs(args, argv) {
  return ['compose', '-p', args.project, '-f', path.join(REPO, args.composeFile), ...argv];
}

function compose(args, argv, opts = {}) {
  return run('docker', composeArgs(args, argv), { ...opts, env: { ...(args.env || {}), ...(opts.env || {}) } });
}

function psqlExec(args, sql, onErrorStop = 1) {
  return compose(args, [
    'exec', '-T', 'postgres', 'sh', '-c',
    `exec psql --no-psqlrc --set ON_ERROR_STOP=${onErrorStop} --tuples-only --no-align --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"`,
  ], { input: sql });
}

function psql(args, sql) {
  return psqlExec(args, sql, 1);
}

function psqlTolerant(args, sql) {
  const res = tryRun('docker', composeArgs(args, [
    'exec', '-T', 'postgres', 'sh', '-c',
    'exec psql --no-psqlrc --set ON_ERROR_STOP=0 --tuples-only --no-align --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"',
  ]), { input: sql, env: args.env });
  return res;
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function md5short(s) { return crypto.createHash('md5').update(s).digest('hex').slice(0, 8); }
function sqlLit(s) { return `'${String(s).replace(/'/g, "''")}'`; }

// Pick an ephemeral localhost port so the disposable stack never collides with
// the developer's permanent containers (supabase/uptime/student_management and
// other e2e projects all bind fixed host ports on this machine).
async function allocPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen({ host: '127.0.0.1', port: 0 }, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function preflight(args) {
  const problems = [];
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < MIN_NODE[0] || (maj === MIN_NODE[0] && min < MIN_NODE[1])) {
    problems.push(`node ${process.versions.node} < required ${MIN_NODE.join('.')}`);
  }
  if (!args.project || !PROJECT_RE.test(args.project)) {
    problems.push(`--project must match ${PROJECT_RE}; got '${args.project || '(none)'}' — refusing non-disposable target`);
  }
  if (!fs.existsSync(path.join(REPO, args.composeFile))) problems.push(`compose file ${args.composeFile} not found`);
  if (!tryRun('docker', ['compose', 'version']).ok) problems.push('docker compose unavailable (BLOCKED_CAPABILITY)');
  if (problems.length) {
    for (const p of problems) console.error(`PREFLIGHT_FAIL ${p}`);
    process.exit(problems.some((p) => p.includes('BLOCKED_CAPABILITY')) ? 4 : 2);
  }
  return { node: process.versions.node };
}

async function waitHealthy(args, timeoutMs = 900000) {
  const start = Date.now();
  for (;;) {
    const res = tryRun('docker', [...composeArgs(args, ['ps', '--format', 'json'])]);
    const raw = (res.out || '').trim();
    let states = [];
    try {
      const parsed = JSON.parse(raw);
      states = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      states = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
    const api = states.find((s) => /restful-api/.test(s.Service || s.Name || ''));
    const pg = states.find((s) => /postgres/.test(s.Service || s.Name || ''));
    const apiHealthy = api && /healthy/i.test(api.Health || api.State || api.Status || '');
    const pgHealthy = pg && /healthy/i.test(pg.Health || pg.State || pg.Status || '');
    if (apiHealthy && pgHealthy) return;
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for postgres+restful-api healthy');
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function locateFlywayHistory(args) {
  const schema = psql(args, `SELECT table_schema FROM information_schema.tables WHERE table_name='flyway_schema_history' ORDER BY 1 LIMIT 1;`).trim();
  if (!schema) return { schema: null, applied: 0, lastVersion: null, checksums: [] };
  const rows = psql(args, `SELECT "version", "description", "checksum" FROM "${schema}"."flyway_schema_history" WHERE success ORDER BY installed_rank;`).trim();
  const entries = rows ? rows.split('\n').filter(Boolean).map((r) => {
    const [version, description, checksum] = r.split('|');
    return { version, description, checksum };
  }) : [];
  return { schema, applied: entries.length, lastVersion: entries.length ? entries[entries.length - 1].version : null, checksums: entries };
}

// Server-side scan: one DO block iterates every candidate text surface and
// records violating literals. Allowlist checks run inside SQL so only real
// violations are returned — a single psql round trip instead of ~3 per column.
function scanDb(args, { collect = false } = {}) {
  const script = `
CREATE TEMP TABLE _fx_scan(kind text, s text, t text, c text, u text, lit text);
DO $FX$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_schema AS s, table_name AS t, column_name AS c, udt_name AS u
    FROM information_schema.columns
    WHERE data_type IN ('text','character varying','character','json','jsonb','ARRAY','USER-DEFINED')
      AND table_schema NOT IN ('pg_catalog','information_schema')
      AND table_schema NOT LIKE 'pg\_temp\_%'
      AND table_name NOT IN ('flyway_schema_history', '_fx_scan')
  LOOP
    EXECUTE format(
      'INSERT INTO _fx_scan SELECT ''email'', %L, %L, %L, %L, m[1] FROM %I.%I t, regexp_matches(t.%I::text, %L, ''g'') m WHERE m[1] !~* %L GROUP BY m[1]',
      r.s, r.t, r.c, r.u, r.s, r.t, r.c, ${sqlLit(EMAIL_RE)}, ${sqlLit(EMAIL_ALLOW_RE)});
    EXECUTE format(
      'INSERT INTO _fx_scan SELECT ''url'', %L, %L, %L, %L, m[1] FROM %I.%I t, regexp_matches(t.%I::text, %L, ''g'') m WHERE m[1] !~* %L',
      r.s, r.t, r.c, r.u, r.s, r.t, r.c, ${sqlLit(URL_RE_SQL)}, ${sqlLit(URL_HOST_ALLOW_RE)});
    EXECUTE format(
      'INSERT INTO _fx_scan SELECT ''phone'', %L, %L, %L, %L, m[2] FROM %I.%I t, regexp_matches(t.%I::text, %L, ''g'') m WHERE m[2] !~ %L GROUP BY m[2]',
      r.s, r.t, r.c, r.u, r.s, r.t, r.c, ${sqlLit(PHONE_RE)}, ${sqlLit('^\\+8490')});
  END LOOP;
END $FX$;
SELECT kind, s, t, c, u, lit FROM _fx_scan ORDER BY 1,2,3,6;
SELECT count(*) FROM information_schema.columns
  WHERE data_type IN ('text','character varying','character','json','jsonb','ARRAY','USER-DEFINED')
    AND table_schema NOT IN ('pg_catalog','information_schema')
    AND table_schema NOT LIKE 'pg\_temp\_%'
    AND table_name NOT IN ('flyway_schema_history', '_fx_scan');
`;
  const out = psql(args, script);
  const violations = [];
  const forbidden = { emails: new Map(), urls: new Map(), phones: new Map() };
  const perSurface = new Map();
  let scannedColumns = 0;
  for (const line of out.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    const f = l.split('|');
    if (f.length >= 6) {
      const [kind, s, t, c, u, lit] = f;
      const surface = `${s}.${t}.${c}`;
      const key = `${kind}|${surface}`;
      perSurface.set(key, (perSurface.get(key) || 0) + 1);
      if (collect) {
        const map = kind === 'email' ? forbidden.emails : kind === 'url' ? forbidden.urls : forbidden.phones;
        if (!map.has(lit)) map.set(lit, new Set());
        map.get(lit).add({ schema: s, table: t, column: c, udt: u });
      }
    } else if (f.length === 1 && /^[0-9]+$/.test(f[0])) {
      scannedColumns = Number(f[0]);
    }
  }
  for (const [key, count] of perSurface) {
    const [kind, surface] = key.split('|');
    violations.push({ surface, kind, count });
  }
  return { scannedColumns, violations, forbidden };
}

function updateSql(col, oldLit, newLit) {
  const cast = col.udt && col.udt !== 'text' ? `::"${col.udt}"` : '';
  return `UPDATE "${col.schema}"."${col.table}" SET "${col.column}" = replace("${col.column}"::text, ${sqlLit(oldLit)}, ${sqlLit(newLit)})${cast} WHERE position(${sqlLit(oldLit)} in "${col.column}"::text) > 0;`;
}

// Local part and URL path can carry real names (e.g. nguyen.van.a@,
// theses.example/NGUYEN-VAN-A.pdf): replace with opaque fx-hash identities.
function syntheticEmail(email) {
  return `fx-${md5short(email)}@campuscore.demo`;
}
function syntheticUrl(url) {
  const ext = (url.match(/\.[A-Za-z0-9]{1,8}$/) || [])[0] || '';
  return `https://demo.campuscore.test/fx/${md5short(url)}${ext}`;
}
function syntheticPhone(seq) {
  return `+8490${String(100000 + (seq % 899999)).slice(0, 6)}`;
}

function auditPackFile(content) {
  const violations = [];
  const bc = content.match(BCRYPT_RE); if (bc) violations.push({ kind: 'bcrypt', count: bc.length });
  const jw = content.match(JWT_RE); if (jw) violations.push({ kind: 'jwt', count: jw.length });
  const emails = content.match(new RegExp(EMAIL_RE_JS, 'g')) || [];
  const badEmails = emails.filter((e) => !new RegExp(EMAIL_ALLOW_RE, 'i').test(e));
  if (badEmails.length) violations.push({ kind: 'email', count: badEmails.length, sample: badEmails.slice(0, 5) });
  const urls = content.match(URL_RE_JS) || [];
  const badUrls = urls.filter((u) => !new RegExp(URL_HOST_ALLOW_RE, 'i').test(u));
  if (badUrls.length) violations.push({ kind: 'url', count: badUrls.length, sample: badUrls.slice(0, 5) });
  const phones = content.match(PHONE_RE_JS) || [];
  if (phones.length) violations.push({ kind: 'phone', count: phones.length, sample: phones.slice(0, 5) });
  return violations;
}

// One psql session (ON_ERROR_STOP=0) applies every UPDATE; ERROR lines are the
// honest per-statement failure count — e.g. a raw phone number inside a jsonb
// document that cannot be cast back.
function normalizeAll(args, forbidden) {
  const mapping = { emails: [], urls: [], phones: [] };
  const stmts = [];
  for (const [lit, cols] of forbidden.emails) {
    const to = syntheticEmail(lit);
    for (const col of cols) stmts.push(updateSql(col, lit, to));
    mapping.emails.push({ fromHash: md5short(lit), to });
  }
  for (const [lit, cols] of forbidden.urls) {
    const to = syntheticUrl(lit);
    for (const col of cols) stmts.push(updateSql(col, lit, to));
    mapping.urls.push({ host: (lit.match(/^https?:\/\/([^/]+)/) || [])[1] || lit, fromHash: md5short(lit), to });
  }
  let seq = 0;
  for (const [lit, cols] of forbidden.phones) {
    seq += 1;
    const to = syntheticPhone(seq);
    for (const col of cols) stmts.push(updateSql(col, lit, to));
    mapping.phones.push({ fromHash: md5short(lit), to });
  }
  if (!stmts.length) return { mapping, failures: 0 };
  const res = psqlTolerant(args, stmts.join('\n'));
  const failures = ((res.out || '').match(/^ERROR:/gm) || []).length;
  return { mapping, failures };
}

async function cmdGenerate(args) {
  const meta = preflight(args);
  const outDir = path.resolve(REPO, args.output);
  if (!outDir.startsWith(REPO)) usage('--output must be repo-relative');
  fs.mkdirSync(outDir, { recursive: true });

  let exitCode = 0;
  try {
    // Ephemeral host ports; one rebind retry if the port is taken between
    // allocation and compose-up (TOCTOU race is rare but real on busy dev boxes).
    args.env = {
      POSTGRES_HOST_PORT: String(await allocPort()),
      E2E_API_HOST_PORT: String(await allocPort()),
    };
    console.log(`[fixture] stack up: ${args.project} (${args.composeFile}) pg=${args.env.POSTGRES_HOST_PORT} api=${args.env.E2E_API_HOST_PORT}`);
    try {
      compose(args, ['up', '-d', '--build', 'postgres', 'restful-api']);
    } catch (e) {
      if (!/port is already allocated/i.test(`${e.stdout || ''}${e.stderr || ''}`)) throw e;
      args.env.POSTGRES_HOST_PORT = String(await allocPort());
      args.env.E2E_API_HOST_PORT = String(await allocPort());
      console.log(`[fixture] host port collision; retry pg=${args.env.POSTGRES_HOST_PORT} api=${args.env.E2E_API_HOST_PORT}`);
      compose(args, ['up', '-d', '--build', 'postgres', 'restful-api']);
    }
    await waitHealthy(args);
    console.log('[fixture] stack healthy; scanning text surfaces');
    const first = scanDb(args, { collect: true });
    const combinedMapping = { emails: [], urls: [], phones: [] };
    let failures = 0;
    let scanResult = first;
    let detailed = first;
    for (let round = 1; round <= 3 && scanResult.violations.length; round += 1) {
      if (round > 1) detailed = scanDb(args, { collect: true });
      const { mapping, failures: f } = normalizeAll(args, detailed.forbidden);
      failures += f;
      combinedMapping.emails.push(...mapping.emails);
      combinedMapping.urls.push(...mapping.urls);
      combinedMapping.phones.push(...mapping.phones);
      console.log(`[fixture] normalize round ${round}: +${mapping.emails.length} emails, +${mapping.urls.length} urls, +${mapping.phones.length} phones`);
      scanResult = scanDb(args);
    }
    const second = scanResult;
    if (second.violations.length) {
      console.error('[fixture] AUDIT_FAIL residual violations after 3 rounds:', JSON.stringify(second.violations.slice(0, 20)));
      exitCode = 1;
    }
    if (failures) console.error(`[fixture] WARN ${failures} replacement statements failed`);

    if (exitCode === 0) {
    const flyway = locateFlywayHistory(args);
    let pack = compose(args, ['exec', '-T', 'postgres', 'sh', '-c',
      'exec pg_dump --data-only --inserts --no-owner --no-privileges --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"']);
    let replacedBcrypt = 0; let replacedJwt = 0;
    pack = pack.replace(BCRYPT_RE, () => { replacedBcrypt += 1; return '__RUNTIME_BCRYPT__'; });
    pack = pack.replace(JWT_RE, () => { replacedJwt += 1; return '__RUNTIME_TOKEN__'; });

    const packPath = path.join(outDir, 'pack.sql');
    fs.writeFileSync(packPath, pack, 'utf8');

    const userRows = psql(args, `SELECT "id","email","firstName","lastName","status" FROM campuscore_auth."User" ORDER BY "email";`).trim();
    const personas = userRows ? userRows.split('\n').filter(Boolean).map((r) => {
      const [id, email, firstName, lastName, status] = r.split('|');
      return { synthetic: true, id, email, firstName, lastName, status };
    }) : [];
    const personasPath = path.join(outDir, 'personas.json');
    const personasJson = JSON.stringify({ count: personas.length, personas }, null, 2) + '\n';
    fs.writeFileSync(personasPath, personasJson, 'utf8');

    const packCheck = auditPackFile(pack);
    const files = [
      { path: 'pack.sql', sha256: sha256(pack), bytes: Buffer.byteLength(pack) },
      { path: 'personas.json', sha256: sha256(personasJson), bytes: Buffer.byteLength(personasJson) },
    ];
    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceHead: tryRun('git', ['rev-parse', 'HEAD']).out.trim(),
      node: meta.node,
      project: args.project,
      composeFile: args.composeFile,
      flyway: { schema: flyway.schema, appliedMigrations: flyway.applied, lastVersion: flyway.lastVersion, checksums: flyway.checksums },
      normalization: {
        scannedColumns: first.scannedColumns,
        dbViolationsBefore: first.violations,
        dbViolationsAfter: second.violations,
        mapping: combinedMapping,
        replacementFailures: failures,
      },
      personas: { path: 'personas.json', sha256: files[1].sha256, count: personas.length },
      files,
      forbiddenFields: ['realEmail', 'realName-outside-persona', 'realPhone', 'realStudentId', 'nationalId', 'realAddress', 'passwordHash', 'token', 'liveUrl', 'realAttachment', 'realAcademicRecord'],
      credentialPolicy: {
        bcryptPlaceholder: '__RUNTIME_BCRYPT__', tokenPlaceholder: '__RUNTIME_TOKEN__',
        replacedBcrypt, replacedJwt,
        runtimeEnv: ['FIXTURE_ACCOUNT_BCRYPT', 'FIXTURE_ACCOUNT_SECRET'],
        note: 'Credentials are generated at provisioning time and never stored in this pack.',
      },
      audit: { dbViolationsAfterNormalize: second.violations.length, packViolations: packCheck.length, packCheck },
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    if (packCheck.length) {
      console.error('[fixture] PACK_AUDIT_FAIL', JSON.stringify(packCheck));
      exitCode = 1;
    } else {
      console.log(`[fixture] PASS pack=${path.relative(REPO, packPath)} sha256=${files[0].sha256.slice(0, 16)}… personas=${personas.length} bcryptStripped=${replacedBcrypt} jwtStripped=${replacedJwt}`);
    }
    }
  } finally {
    if (!args.keepStack) {
      try { compose(args, ['down', '-v', '--remove-orphans']); } catch { /* cleanup best-effort */ }
    }
  }
  if (exitCode) process.exit(exitCode);
}

async function cmdAudit(args) {
  preflight(args);
  const report = { checkedAt: new Date().toISOString(), db: null, pack: null, verdict: 'PASS' };
  if (args.pack) {
    const packPath = path.resolve(REPO, args.pack, 'pack.sql');
    if (!fs.existsSync(packPath)) { console.error(`[audit] pack not found: ${packPath}`); process.exit(1); }
    const violations = auditPackFile(fs.readFileSync(packPath, 'utf8'));
    report.pack = { path: path.relative(REPO, packPath), violations };
    if (violations.length) report.verdict = 'FAIL';
    const manifestPath = path.join(path.dirname(packPath), 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const f of manifest.files || []) {
        const fp = path.join(path.dirname(packPath), f.path);
        const ok = fs.existsSync(fp) && sha256(fs.readFileSync(fp)) === f.sha256;
        if (!ok) { report.verdict = 'FAIL'; (report.pack.mismatches ||= []).push(f.path); }
      }
    } else {
      report.verdict = 'FAIL';
      (report.pack.mismatches ||= []).push('manifest.json missing');
    }
  }
  const stackUp = tryRun('docker', [...composeArgs(args, ['ps', '-q', 'postgres'])]).out.trim();
  if (stackUp) {
    const scan = scanDb(args);
    report.db = { scannedColumns: scan.scannedColumns, violations: scan.violations };
    if (scan.violations.length) report.verdict = 'FAIL';
  } else {
    report.db = { skipped: 'stack not running; db surface NOT_RUN' };
  }
  const out = JSON.stringify(report, null, 2);
  if (args.evidence) {
    const dir = path.resolve(REPO, args.evidence); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fixture-audit.json'), out + '\n', 'utf8');
  }
  console.log(out);
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

const args = parseArgs(process.argv.slice(2));
if (args.command === 'generate') await cmdGenerate(args);
else if (args.command === 'audit') await cmdAudit(args);
else if (args.command === 'preflight') { preflight(args); console.log('PREFLIGHT_PASS'); }
else usage();
