#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedScriptPath =
  process.env.SEED_SCRIPT_PATH ||
  path.join(repoRoot, 'database', 'seed_active_students_bigdata.sql');

// Split a .sql file into top-level statements, honouring `--` line comments,
// /* */ block comments, 'single-quoted' literals (with '' escapes) and $tag$
// dollar-quoted bodies so a DO $$ ... $$ block is returned as one statement.
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let start = -1;
  let i = 0;
  const push = (end) => {
    const text = current.trim();
    if (text) {
      statements.push({ start, text });
    }
    current = '';
    start = -1;
  };
  while (i < sql.length) {
    if (start < 0 && !/\s/.test(sql[i])) {
      start = i;
    }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? sql.length : nl;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    const ch = sql[i];
    if (ch === "'") {
      current += ch;
      i += 1;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += sql[i + 1];
          i += 2;
          continue;
        }
        i += 1;
        if (sql[i - 1] === "'") break;
      }
      continue;
    }
    const dollar = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      current += end < 0 ? sql.slice(i) : sql.slice(i, end + tag.length);
      i = end < 0 ? sql.length : end + tag.length;
      continue;
    }
    if (ch === ';') {
      push(i);
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  push(sql.length);
  return statements;
}

// Statement text with 'single-quoted' literals blanked out, for keyword checks.
function codeOnly(text) {
  return text.replace(/'(?:''|[^'])*'/g, "''");
}

const isDataModifying = (stmt) =>
  /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i.test(codeOnly(stmt.text));

const isDestructive = (stmt) =>
  /\b(DELETE|TRUNCATE|DROP)\b/i.test(codeOnly(stmt.text));

const isGuardBlock = (stmt) =>
  /current_setting\s*\(\s*'campuscore\.demo_seed'/i.test(stmt.text) &&
  /\bRAISE\s+EXCEPTION\b/i.test(codeOnly(stmt.text));

// A DELETE is demo-scoped only when its WHERE references the seeded id prefixes
// or demo identities the script names, never the whole table.
const hasDelete = (stmt) => /\bDELETE\b/i.test(codeOnly(stmt.text));
const hasWhere = (stmt) => /\bWHERE\b/i.test(codeOnly(stmt.text));
const hasDemoScope = (stmt) =>
  /'(student-profile%?|enr-[a-z0-9-]*|enrollment-[a-z0-9-]*)/i.test(stmt.text);

const sql = fs.readFileSync(seedScriptPath, 'utf8');
const statements = splitStatements(sql);
const guard = statements.find(isGuardBlock);
const firstDml = statements.find(isDataModifying);

test('demo-seed guard aborts the script before the first data-modifying statement', () => {
  assert.ok(
    guard,
    'expected a DO block checking current_setting(\'campuscore.demo_seed\') with RAISE EXCEPTION',
  );
  assert.ok(firstDml, 'expected at least one data-modifying statement');
  assert.ok(
    guard.start < firstDml.start,
    'guard must precede the first INSERT/UPDATE/DELETE/TRUNCATE/DROP statement',
  );
});

test('every DELETE is restricted to seeded ids or named demo identities', () => {
  const deletes = statements.filter(hasDelete);
  assert.ok(deletes.length > 0, 'expected at least one DELETE statement');
  for (const stmt of deletes) {
    assert.ok(hasWhere(stmt), `DELETE lacks a WHERE clause:\n${stmt.text.slice(0, 200)}`);
    assert.ok(
      hasDemoScope(stmt),
      `DELETE is not scoped to seeded ids/demo identities:\n${stmt.text.slice(0, 200)}`,
    );
  }
});

test('every destructive statement sits after the guard', () => {
  assert.ok(guard, 'expected a campuscore.demo_seed guard block');
  for (const stmt of statements.filter(isDestructive)) {
    assert.ok(
      stmt.start > guard.start,
      `destructive statement precedes the guard:\n${stmt.text.slice(0, 200)}`,
    );
  }
});

test('every data-modifying script under database/ is gated by the demo-seed guard', () => {
  const dir = path.join(repoRoot, 'database');
  const checked = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.sql')) continue;
    const stmts = splitStatements(fs.readFileSync(path.join(dir, name), 'utf8'));
    const firstMod = stmts.find(isDataModifying);
    if (!firstMod) continue;
    const fileGuard = stmts.find(isGuardBlock);
    assert.ok(fileGuard, `${name} modifies data without a campuscore.demo_seed guard`);
    assert.ok(
      fileGuard.start < firstMod.start,
      `${name}: guard must precede the first data-modifying statement`,
    );
    checked.push(name);
  }
  assert.ok(checked.length > 0, 'expected at least one data-modifying script');
});
