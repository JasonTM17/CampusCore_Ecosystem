#!/usr/bin/env node
// V115 only: canonical seed content, pinned V93/V101 original hashes.
// Existing migration bytes can only be checked, never rewritten.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = resolve(root, 'java-services/restful-api/src/main/resources/db/migration/V115__specialized_spring_injection_question_fit.sql');
const rows = JSON.parse(readFileSync(resolve(root, 'supabase/seed/assistant-specialized-knowledge.json'), 'utf8'));
const history = readFileSync(resolve(root, 'java-services/restful-api/src/main/resources/db/migration/V93__specialized_domain_knowledge_markdown.sql'), 'utf8').replaceAll('\r\n', '\n');
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const architecture = rows.filter(r => r.slug.includes('microservices-monolith-spring-architecture'));
const injection = rows.filter(r => r.slug.startsWith('specialized-spring-dependency-constructor-injection-'));
if (architecture.length !== 2 || injection.length !== 2) throw new Error('Expected two locales for each target topic');
const expected = architecture.map(row => {
  const end = history.indexOf(`WHERE slug = '${row.slug}'`);
  const start = history.lastIndexOf("SET content = '", end) + "SET content = '".length;
  const content = history.slice(start, history.indexOf("',\n", start)).replaceAll("''", "'").replaceAll('CampusCore', 'CampusUTE');
  if (!content.includes('V1–V71')) throw new Error('Historical architecture fixture missing');
  const hash = createHash('md5').update(`${row.title}\n${content}`).digest('hex');
  return `(${q(row.slug)},${q(row.locale)},${q(hash)},${q(row.content)})`;
}).join(',\n');
const newRows = injection.map(r => `(${q(r.slug)},${q(r.locale)},${q(r.title)},${q(r.content)},${r.priority})`).join(',\n');
const sql = `-- Forward-only V115: correct unchanged architecture seeds and add DI examples.
-- Human revisions and foreign/newer authority remain untouched. Remote corpus
-- publication still requires its own governance workflow; no provider change.
CREATE TEMP TABLE v115_expected (slug text PRIMARY KEY, locale text, old_hash text, content text) ON COMMIT DROP;
INSERT INTO v115_expected VALUES
${expected};
CREATE TEMP TABLE v115_new_seed (slug text PRIMARY KEY, locale text, title text, content text, priority smallint) ON COMMIT DROP;
INSERT INTO v115_new_seed VALUES
${newRows};

-- Match the publisher's document/revision -> singleton lock order.
SELECT d.id FROM assistant.knowledge_document d JOIN v115_expected e ON e.slug=d.slug
JOIN assistant.knowledge_document_revision r ON r.document_id=d.id
ORDER BY d.id,r.version FOR UPDATE OF d,r;
SELECT active_release_id FROM assistant.knowledge_runtime_state WHERE singleton FOR UPDATE;

CREATE TEMP TABLE v115_changed ON COMMIT DROP AS
SELECT d.id,e.slug,e.locale,e.old_hash,e.content,r.id AS old_revision_id,r.version AS old_version,r.published_at AS old_published_at
FROM assistant.knowledge_document d JOIN v115_expected e ON e.slug=d.slug AND e.locale=d.locale
JOIN assistant.knowledge_document_revision r ON r.document_id=d.id AND r.version=3
WHERE d.id=md5(e.slug || '-document')::uuid AND d.domain='SPECIALIZED' AND d.priority=12
  AND d.source='campuscore-thesis-spec-correction-v101' AND d.active AND d.visibility='PUBLIC'
  AND d.archived_at IS NULL AND d.archived_by IS NULL
  AND r.id=md5(d.id::text || '-correction-v101')::uuid AND r.state='PUBLISHED'
  AND r.domain=d.domain AND r.slug=d.slug AND r.locale=d.locale AND r.priority=d.priority AND r.source=d.source
  AND r.created_by='system-migration' AND r.reviewed_by='system-migration'
  AND md5(d.title || E'\\n' || d.content)=e.old_hash AND md5(r.title || E'\\n' || r.content)=e.old_hash
  AND NOT EXISTS (SELECT 1 FROM assistant.knowledge_document_revision later WHERE later.document_id=d.id AND later.version>3);
UPDATE assistant.knowledge_document d SET content=c.content,source='campuscore-specialized-focus-v115',updated_at=CURRENT_TIMESTAMP
FROM v115_changed c WHERE c.id=d.id;
UPDATE assistant.knowledge_document_revision r SET state='ARCHIVED' FROM v115_changed c WHERE r.id=c.old_revision_id;
INSERT INTO assistant.knowledge_document_revision
 (id,document_id,version,state,domain,locale,slug,title,content,source,priority,created_by,reviewed_by,published_at)
SELECT md5(d.id::text || '-focus-v115')::uuid,d.id,4,'PUBLISHED',d.domain,d.locale,d.slug,d.title,d.content,d.source,d.priority,
 'system-migration','system-migration',CURRENT_TIMESTAMP FROM assistant.knowledge_document d JOIN v115_changed c ON c.id=d.id;

-- Never overwrite an existing slug/identity, including a human-authored draft.
CREATE TEMP TABLE v115_inserted (id uuid PRIMARY KEY) ON COMMIT DROP;
WITH inserted AS (
 INSERT INTO assistant.knowledge_document (id,slug,locale,title,content,source,priority,domain)
 SELECT md5(n.slug || '-document')::uuid,n.slug,n.locale,n.title,n.content,'campuscore-specialized-focus-v115',n.priority,'SPECIALIZED'
 FROM v115_new_seed n WHERE NOT EXISTS (SELECT 1 FROM assistant.knowledge_document d WHERE d.slug=n.slug OR d.id=md5(n.slug || '-document')::uuid)
 RETURNING id
) INSERT INTO v115_inserted SELECT id FROM inserted;
INSERT INTO assistant.knowledge_document_revision
 (id,document_id,version,state,domain,locale,slug,title,content,source,priority,created_by,reviewed_by,published_at)
SELECT md5(d.id::text || '-focus-v115')::uuid,d.id,1,'PUBLISHED',d.domain,d.locale,d.slug,d.title,d.content,d.source,d.priority,
 'system-migration','system-migration',CURRENT_TIMESTAMP FROM assistant.knowledge_document d JOIN v115_inserted n ON n.id=d.id;

CREATE TEMP TABLE v115_overlay ON COMMIT DROP AS
SELECT c.id FROM assistant.knowledge_runtime_state s
JOIN assistant.knowledge_runtime_document p ON p.release_id=s.active_release_id
JOIN v115_changed c ON c.id::text=p.source_id
WHERE s.singleton AND p.revision_id=c.old_revision_id AND p.version=c.old_version
 AND p.domain='SPECIALIZED' AND p.priority=12 AND p.slug=c.slug AND p.locale=c.locale
 AND p.source='campuscore-thesis-spec-correction-v101' AND p.active AND p.visibility='PUBLIC'
 AND p.published_at=c.old_published_at AND md5(p.title || E'\\n' || p.content)=c.old_hash;
CREATE TEMP TABLE v115_base ON COMMIT DROP AS
SELECT release.id FROM assistant.knowledge_runtime_state s JOIN assistant.knowledge_release release ON release.id=s.active_release_id
WHERE s.singleton AND release.status='PUBLISHED' AND release.source IN ('MANUAL','LEGACY') AND release.created_by='system-migration'
 AND (SELECT COUNT(*) FROM v115_overlay)=2 AND (SELECT COUNT(*) FROM v115_inserted)=2
 AND NOT EXISTS (SELECT 1 FROM assistant.knowledge_runtime_document p JOIN v115_new_seed n ON n.slug=p.slug OR md5(n.slug || '-document')::uuid::text=p.source_id WHERE p.release_id=release.id);

-- Clone only the active immutable projection; never publish unrelated authoring.
CREATE TEMP TABLE v115_projected ON COMMIT DROP AS
SELECT p.source_id,COALESCE(r.id,p.revision_id) AS revision_id,COALESCE(r.version,p.version) AS version,
 COALESCE(r.domain,p.domain) AS domain,COALESCE(r.slug,p.slug) AS slug,COALESCE(r.locale,p.locale) AS locale,
 COALESCE(r.title,p.title) AS title,COALESCE(r.content,p.content) AS content,COALESCE(r.source,p.source) AS source,
 COALESCE(r.priority,p.priority) AS priority,p.active,p.visibility,COALESCE(r.published_at,p.published_at) AS published_at
FROM v115_base b JOIN assistant.knowledge_runtime_document p ON p.release_id=b.id
LEFT JOIN v115_overlay c ON c.id::text=p.source_id
LEFT JOIN assistant.knowledge_document_revision r ON r.id=md5(c.id::text || '-focus-v115')::uuid
UNION ALL
SELECT d.id::text,r.id,r.version,r.domain,r.slug,r.locale,r.title,r.content,r.source,r.priority,d.active,d.visibility,r.published_at
FROM assistant.knowledge_document d JOIN v115_inserted n ON n.id=d.id
JOIN assistant.knowledge_document_revision r ON r.id=md5(d.id::text || '-focus-v115')::uuid WHERE EXISTS (SELECT 1 FROM v115_base);
CREATE TEMP TABLE v115_summary ON COMMIT DROP AS
SELECT COUNT(*)::integer AS row_count,
 encode(thesis.digest(COALESCE(string_agg(concat_ws('|',source_id,COALESCE(revision_id::text,''),version::text,domain,slug,locale,title,content,source,priority::text,active::text,visibility),E'\\n' ORDER BY source_id),''),'sha256'),'hex') AS corpus_hash,
 COALESCE(jsonb_agg(jsonb_build_object('sourceId',source_id,'domain',domain,'slug',slug,'locale',locale) ORDER BY source_id),'[]'::jsonb) AS documents FROM v115_projected;
INSERT INTO assistant.knowledge_release (id,corpus_version,corpus_hash,row_count,source,status,manifest,created_by,activated_at,previous_release_id)
SELECT '00000000-0000-0000-0000-000000000115'::uuid,'specialized-spring-focus-v115',summary.corpus_hash,summary.row_count,'MANUAL','PUBLISHED',
 jsonb_build_object('schemaVersion',1,'corpusVersion','specialized-spring-focus-v115','rowCount',summary.row_count,'sha256',summary.corpus_hash,'documents',summary.documents),
 'system-migration',CURRENT_TIMESTAMP,b.id FROM v115_summary summary CROSS JOIN v115_base b;
INSERT INTO assistant.knowledge_runtime_document
 (release_id,source_id,revision_id,version,domain,slug,locale,title,content,source,priority,active,visibility,published_at)
SELECT '00000000-0000-0000-0000-000000000115'::uuid,source_id,revision_id,version,domain,slug,locale,title,content,source,priority,active,visibility,published_at FROM v115_projected;
UPDATE assistant.knowledge_runtime_state s SET active_release_id=r.id,updated_at=CURRENT_TIMESTAMP
FROM assistant.knowledge_release r WHERE s.singleton AND r.id='00000000-0000-0000-0000-000000000115'::uuid AND s.active_release_id=r.previous_release_id;
INSERT INTO campuscore_audit."AdminAudit" ("id","actorId","actorLabel","action","entityType","entityId","summary","beforeState","afterState","createdAt")
SELECT 'audit-specialized-spring-focus-v115','system-migration','V115 specialized knowledge migration','CORRECT_SPECIALIZED_KNOWLEDGE','KnowledgeRelease',
 s.active_release_id::text,'Guarded architecture count correction and bilingual constructor injection examples; foreign/human runtime authority retained',
 '{"expectedBase":"unchanged V101 architecture seeds in a system-owned local projection"}',
 jsonb_build_object('changedDocuments',(SELECT COUNT(*) FROM v115_changed),'newDocuments',(SELECT COUNT(*) FROM v115_inserted),
 'activated',EXISTS (SELECT 1 FROM v115_base),'runtimeStatus',CASE WHEN EXISTS (SELECT 1 FROM v115_base) THEN 'LOCAL_CORRECTED' ELSE 'AUTHORITY_REVIEW_REQUIRED' END)::text,CURRENT_TIMESTAMP
FROM assistant.knowledge_runtime_state s WHERE s.singleton;
`;
if (existsSync(migration)) {
  if (readFileSync(migration, 'utf8') !== sql) throw new Error('V115 drift; inspect rather than overwrite migration history');
  console.log('PASS V115 canonical content parity');
} else if (process.argv.includes('--write')) {
  writeFileSync(migration, sql, 'utf8');
  console.log('Created additive V115 draft');
} else throw new Error('Missing V115; use --write only for first local draft');
