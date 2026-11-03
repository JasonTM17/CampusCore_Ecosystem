import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const migrationName = '20261104000000_knowledge_admin_expected_version.sql';
const latestDefinitionName = '20260923181500_archive_knowledge_release.sql';

function functionDefinition(sql, name) {
  const escapedName = name.replaceAll('.', '\\.');
  const match = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+${escapedName}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ).exec(sql);
  assert.ok(match, `expected a definition for ${name}`);
  return match[0];
}

const normalizeSql = (sql) =>
  sql.replace(/^create\s+or\s+replace\s+function/i, 'create function').replace(/\s+/g, ' ').trim().toLowerCase();

test('the latest knowledge admin migration preserves its lock wrapper and guards the document version', () => {
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  assert.equal(files.at(-1), migrationName, 'expected the version guard to be the last migration');

  const migration = fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8');
  const previous = fs.readFileSync(path.join(migrationsDir, latestDefinitionName), 'utf8');
  const wrapper = functionDefinition(migration, 'assistant.knowledge_admin');
  const previousWrapper = functionDefinition(previous, 'assistant.knowledge_admin');
  const implementation = functionDefinition(migration, 'assistant.knowledge_admin_unlocked');
  const updateBranch = /if v_action = 'UPDATE' then([\s\S]*?)\n\s*end if;\s*\n\s*if v_action = 'SUBMIT' then/i.exec(implementation)?.[1];

  assert.ok(updateBranch, 'expected an UPDATE action in the unlocked implementation');
  assert.equal(normalizeSql(wrapper), normalizeSql(previousWrapper), 'the RPC lock wrapper must remain unchanged');
  assert.match(implementation, /set search_path = assistant, public/i);
  assert.doesNotMatch(implementation.slice(0, implementation.indexOf('as $$')), /security definer/i);
  assert.match(implementation, /v_expected_version integer/i);
  assert.match(updateBranch, /nullif\(v_payload\s*->>\s*'expectedVersion',\s*''\)::integer/i);
  assert.match(
    updateBranch,
    /select coalesce\(max\(r\.version\),\s*0\)\s*into v_document_version\s*from assistant\.knowledge_document_revision r\s*where r\.document_id\s*=\s*p_document_id;/i,
  );
  assert.match(
    updateBranch,
    /if v_expected_version is not null and v_expected_version <> v_document_version then\s+raise exception 'stale_version' using errcode = 'P0001';/i,
  );
  assert.doesNotMatch(updateBranch, /v_expected_version is not null and v_expected_version <> v_version/i);
  assert.ok(
    updateBranch.indexOf('v_expected_version <> v_document_version') < updateBranch.indexOf('if v_revision is null then'),
    'expectedVersion must be checked before either the owned-draft or fork branch',
  );
  assert.match(updateBranch, /select coalesce\(max\(r\.version\),\s*0\)\s*\+\s*1 into v_next_version/i);
  assert.match(updateBranch, /set version = v_next_version,/i);
  assert.match(updateBranch, /v_version\s*:=\s*v_next_version/i);
  assert.match(updateBranch, /return jsonb_build_object\([\s\S]*?'version',\s*v_version/i);
  assert.match(migration, /revoke all on function assistant\.knowledge_admin\(text, uuid, jsonb, text\)\s+from public, anon, authenticated;/i);
  assert.match(migration, /grant execute on function assistant\.knowledge_admin\(text, uuid, jsonb, text\)\s+to service_role;/i);
  assert.match(migration, /revoke all on function assistant\.knowledge_admin_unlocked\(text, uuid, jsonb, text\)\s+from public, anon, authenticated, service_role;/i);
});
