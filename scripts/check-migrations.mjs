// Migration hygiene gate: catches numbering and naming drift before the
// heavier compose job spins the full stack. Cheap enough for every push.
//   - filenames must match  V<digits>__<description>.sql
//   - version numbers must be unique (a duplicate would make Flyway pick one
//     silently depending on scan order)
//   - versions must be strictly positive integers
//   - every new file's version must exceed the highest baseline version when
//     MIGRATION_BASELINE is provided (prevents "inserted in the middle"
//     migrations that Flyway would skip on out-of-order=false installs)
//   - CTID_WRITE: no physical-row-key DELETE/UPDATE
//   - BACKFILL_CONSTRAINT: no same-table backfill plus NOT NULL/validated FK
//   - AUTH_TABLE_LOCK: auth schema locks require -- PRE-DEPLOY: <reason>
//   - NON_TRANSACTIONAL: no CONCURRENTLY indexes, VACUUM, ALTER SYSTEM or CREATE DATABASE
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Applied migration bytes cannot change; exceptions are limited to the rule
// already present in each historical file, never to a version range.
const HAZARD_BASELINE = new Map([
  ['V14__registration_foundation.sql', ['BACKFILL_CONSTRAINT']],
  ['V30__thesis_governance_foundation.sql', ['BACKFILL_CONSTRAINT']],
  ['V53__optimize_indexes_and_grade_integrity.sql', ['CTID_WRITE']],
  ['V64__enterprise_article_ecosystem_and_strict_constraints.sql', ['BACKFILL_CONSTRAINT']],
  ['V116__align_four_member_demo_team.sql', ['AUTH_TABLE_LOCK']],
]);

function sqlTokens(sql) {
  const tokens = [];
  let preDeploy = false;
  const lex = /--[^\r\n]*|\/\*|\*\/|'(?:''|\\.|[^'])*'|"(?:""|[^"])*"|\$(?:[a-z_][a-z_0-9]*)?\$|[a-z_][a-z_0-9$]*|[^\s]/giy;
  let offset = 0;
  let commentDepth = 0;
  while (offset < sql.length) {
    if (commentDepth) {
      if (sql.startsWith('/*', offset)) { commentDepth += 1; offset += 2; }
      else if (sql.startsWith('*/', offset)) { commentDepth -= 1; offset += 2; }
      else offset += 1;
      continue;
    }
    if (/\s/.test(sql[offset])) { offset += 1; continue; }
    lex.lastIndex = offset;
    const match = lex.exec(sql);
    const token = match[0];
    offset = lex.lastIndex;
    if (token === '/*') { commentDepth += 1; continue; }
    if (token.startsWith('--')) {
      if (/^--\s*PRE-DEPLOY:\s*\S.*$/i.test(token)) preDeploy = true;
      continue;
    }
    if (token.startsWith("'") || token.startsWith('$')) continue;
    tokens.push(token.toLowerCase());
  }
  return { tokens, preDeploy };
}

function tableAt(tokens, start) {
  let end = start;
  if (tokens[end] === 'only') end += 1;
  const identifier = /^(?:[a-z_][a-z_0-9$]*|"(?:""|[^"])*")$/i;
  const parts = [];
  while (identifier.test(tokens[end] ?? '')) {
    parts.push(tokens[end].replace(/^"|"$/g, '').replaceAll('""', '"'));
    end += 1;
    if (tokens[end] !== '.') break;
    end += 1;
  }
  return { name: JSON.stringify(parts), schema: parts.length > 1 ? parts[0] : null, end };
}

function keywordText(tokens) {
  return tokens.map((token) => token.startsWith('"') ? '__identifier__' : token).join(' ');
}

export function migrationHazards(sql) {
  const { tokens, preDeploy } = sqlTokens(sql);
  const failures = new Set();
  const updates = new Set();
  const alters = [];
  const statements = [];
  let start = 0;
  for (let end = 0; end <= tokens.length; end += 1) {
    if (end === tokens.length || tokens[end] === ';') {
      statements.push(tokens.slice(start, end));
      start = end + 1;
    }
  }
  for (const statement of statements) {
    const text = keywordText(statement);
    let writes = false;
    for (let i = 0; i < statement.length; i += 1) {
      const word = statement[i];
      if (word === 'update' && statement[i - 1] !== 'for') {
        const table = tableAt(statement, i + 1);
        let end = table.end;
        if (statement[end] === '*') end += 1;
        if (statement[end] === 'as') end += 1;
        if (statement[end] !== 'set') end += 1;
        if (statement[end] === 'set') { updates.add(table.name); writes = true; }
      }
      if (word === 'delete' && statement[i + 1] === 'from') writes = true;
      if (word === 'alter' && statement[i + 1] === 'table') {
        let pos = i + 2;
        if (statement[pos] === 'if' && statement[pos + 1] === 'exists') pos += 2;
        const table = tableAt(statement, pos);
        alters.push({ name: table.name, actions: statement.slice(table.end) });
      }
      if (!preDeploy && word === 'lock' && statement[i + 1] === 'table') {
        let pos = i + 2;
        while (pos < statement.length) {
          const table = tableAt(statement, pos);
          if (table.schema === 'campuscore_auth') failures.add('AUTH_TABLE_LOCK');
          pos = table.end;
          if (statement[pos] === '*') pos += 1;
          if (statement[pos] !== ',') break;
          pos += 1;
        }
      }
    }
    if (writes && statement.some((token) => token === 'ctid' || token === '"ctid"')) failures.add('CTID_WRITE');
    if (/\bcreate (?:unique )?index concurrently\b|\bvacuum\b|\balter system\b|\bcreate database\b/.test(text)) {
      failures.add('NON_TRANSACTIONAL');
    }
  }
  for (const { name, actions } of alters) {
    if (!updates.has(name)) continue;
    // A NOT VALID on a different comma-separated constraint is not an exemption.
    let depth = 0;
    let action = [];
    for (const token of [...actions, ',']) {
      if (token === '(') depth += 1;
      if (token === ')') depth -= 1;
      if (token === ',' && depth === 0) {
        const text = keywordText(action);
        if (/\balter column\b.*\bset not null\b/.test(text)
          || (/\badd constraint\b.*\bforeign key\b/.test(text) && !/\bnot valid\b/.test(text))) {
          failures.add('BACKFILL_CONSTRAINT');
        }
        action = [];
      } else action.push(token);
    }
  }
  return [...failures];
}

function main() {
  const DIR = process.argv[2]
    || 'java-services/restful-api/src/main/resources/db/migration';
  const BASELINE = Number(process.env.MIGRATION_BASELINE || 0);

  const NAME = /^V(\d+)__[^_].+\.sql$/;
  const files = readdirSync(join(process.cwd(), DIR)).filter(f => f.endsWith('.sql'));

  let failures = 0;
  const fail = msg => { failures += 1; console.error(`FAIL  ${msg}`); };

  const seen = new Map();
  for (const file of files) {
    const match = NAME.exec(file);
    if (!match) {
      fail(`bad migration filename: ${file}`);
      continue;
    }
    const version = Number(match[1]);
    if (!Number.isInteger(version) || version <= 0) {
      fail(`non-positive version in ${file}`);
      continue;
    }
    if (seen.has(version)) {
      fail(`duplicate migration version V${version}: ${seen.get(version)} and ${file}`);
    }
    seen.set(version, file);
    if (version <= BASELINE) {
      fail(`V${version} (${file}) is not newer than baseline V${BASELINE}`);
    }
    for (const rule of migrationHazards(readFileSync(join(process.cwd(), DIR, file), 'utf8'))) {
      if (!HAZARD_BASELINE.get(file)?.includes(rule)) fail(`${file}: ${rule}`);
    }
  }

  console.log(`checked ${files.length} migration files in ${DIR}`);
  if (failures === 0) {
    console.log('MIGRATION NAMES PASS');
  } else {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
