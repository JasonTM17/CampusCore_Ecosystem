import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/check-migrations.mjs');
const migrations = join(root, 'java-services/restful-api/src/main/resources/db/migration');
const filename = 'V153__guard_fixture.sql';

function fixture(t, sql) {
  const dir = mkdtempSync(join(root, '.test-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (sql !== undefined) writeFileSync(join(dir, filename), sql);
  return dir;
}

function run(dir) {
  return spawnSync(process.execPath, [script, ...(dir ? [relative(root, dir)] : [])], {
    cwd: root, encoding: 'utf8', env: { ...process.env, MIGRATION_BASELINE: '' },
  });
}

const hazards = [
  ['CTID_WRITE', 'DELETE FROM academic."StudentGrade" a WHERE a.ctid <> (SELECT min(b.ctid) FROM academic."StudentGrade" b);'],
  ['CTID_WRITE', 'uPdAtE academic."StudentGrade" SET score = 0 WHERE "ctid" IS NOT NULL;'],
  ['BACKFILL_CONSTRAINT', 'UPDATE "Academic"."Enrollment" e SET credits = 1; ALTER TABLE "academic"."enrollment" ALTER COLUMN credits SET NOT NULL;'],
  ['BACKFILL_CONSTRAINT', 'ALTER TABLE academic."Enrollment" ADD CONSTRAINT course_fk FOREIGN KEY (course) REFERENCES academic."Course"(id); update academic."Enrollment" set course = 1;'],
  ['BACKFILL_CONSTRAINT', 'UPDATE academic.items SET parent = 1; ALTER TABLE academic.items ADD CONSTRAINT safe_fk FOREIGN KEY (other) REFERENCES academic.items(id) NOT VALID, ADD CONSTRAINT unsafe_fk FOREIGN KEY (parent) REFERENCES academic.items(id);'],
  ['AUTH_TABLE_LOCK', 'LOCK TABLE academic.items, "campuscore_auth"."User" IN SHARE ROW EXCLUSIVE MODE;'],
  ['AUTH_TABLE_LOCK', 'LOCK TABLE ONLY campuscore_auth."User", academic.items IN ACCESS EXCLUSIVE MODE;'],
  ['NON_TRANSACTIONAL', 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx ON academic.items(id);'],
  ['NON_TRANSACTIONAL', 'VACUUM (ANALYZE) academic.items;'],
  ['NON_TRANSACTIONAL', "ALTER SYSTEM SET work_mem = '64MB';"],
  ['NON_TRANSACTIONAL', 'CREATE DATABASE campuscore_copy;'],
];

for (const [rule, sql] of hazards) {
  test(`${rule} rejects ${sql.split(';')[0]}`, (t) => {
    const result = run(fixture(t, sql));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes(filename), result.stderr);
    assert.ok(result.stderr.includes(rule), result.stderr);
  });
}

test('a reasoned pre-deploy line comment exempts an auth table lock', (t) => {
  const result = run(fixture(t, '-- PRE-DEPLOY: reviewed maintenance window\nLOCK TABLE campuscore_auth."User" IN EXCLUSIVE MODE;'));
  assert.equal(result.status, 0, result.stderr);
});

for (const annotation of ['-- PRE-DEPLOY:   ', "SELECT '-- PRE-DEPLOY: fake';", '/* -- PRE-DEPLOY: fake */']) {
  test(`an invalid pre-deploy annotation does not exempt locks: ${annotation}`, (t) => {
    const result = run(fixture(t, `${annotation}\nLOCK TABLE campuscore_auth."User" IN EXCLUSIVE MODE;`));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /AUTH_TABLE_LOCK/);
  });
}

test('a pre-deploy annotation cannot exempt other rules', (t) => {
  const result = run(fixture(t, '-- PRE-DEPLOY: reviewed\nDELETE FROM items WHERE ctid IS NOT NULL;'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /CTID_WRITE/);
});

test('comments, literals, safe constraints, and different tables pass', (t) => {
  const result = run(fixture(t, `
-- CREATE INDEX CONCURRENTLY idx ON items(id); VACUUM;
/* LOCK TABLE campuscore_auth."User"; /* nested comment */ ALTER SYSTEM RESET ALL; */
SELECT 'DELETE FROM items WHERE ctid IS NOT NULL; -- PRE-DEPLOY: text';
UPDATE academic.items SET parent = 1;
ALTER TABLE academic.items ADD CONSTRAINT parent_fk FOREIGN KEY (parent) REFERENCES academic.items(id) NOT VALID;
ALTER TABLE academic.other ALTER COLUMN id SET NOT NULL;
LOCK TABLE academic.items IN SHARE MODE;
CREATE INDEX idx ON academic.items(id);
SELECT ctid FROM academic.items;
`));
  assert.equal(result.status, 0, result.stderr);
});

test('hazards inside procedural SQL are checked', (t) => {
  const result = run(fixture(t, 'DO $$ BEGIN DELETE FROM items WHERE ctid IS NOT NULL; END $$;'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /CTID_WRITE/);
});

test('historical baseline files pass in an isolated directory', (t) => {
  const dir = fixture(t);
  for (const file of readdirSync(migrations).filter((name) => /^V(?:14|30|53|64|116)__/.test(name))) {
    copyFileSync(join(migrations, file), join(dir, file));
  }
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
});

test('the real migration tree passes', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /checked \d+ migration files/);
});

test('quoted identifiers are not executable non-transactional commands', (t) => {
  const result = run(fixture(t, 'SELECT "vacuum", "create database" FROM academic.items;'));
  assert.equal(result.status, 0, result.stderr);
});

test('a constraint name containing NOT VALID cannot exempt a validated FK', (t) => {
  const result = run(fixture(t, 'UPDATE items SET parent = 1; ALTER TABLE items ADD CONSTRAINT "not valid" FOREIGN KEY (parent) REFERENCES items(id);'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /BACKFILL_CONSTRAINT/);
});

test('baseline exceptions do not exempt a different rule in the same filename', (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'V14__registration_foundation.sql'), 'VACUUM items;');
  const result = run(dir);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /V14__registration_foundation.sql: NON_TRANSACTIONAL/);
});
