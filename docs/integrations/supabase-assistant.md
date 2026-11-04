# Assistant knowledge authority and Supabase

The assistant answers from the active published release in the Java application's PostgreSQL `assistant` schema. `knowledge_runtime_state.active_release_id` selects an immutable snapshot. The authoring table alone is not served. Public chatbot requests never query Supabase directly.

`assistant.knowledge.authority-mode` selects who may change that active release:

- `sql`: the Java two-admin review flow publishes or archives a document and promotes the matching local snapshot in the same database transaction.
- `supabase`: the two-admin authority flow publishes or archives a release in Supabase. Java then synchronizes that release to the local runtime. A failed projection is reported as pending or degraded; an authoring acknowledgement is not proof that the chatbot serves the change.

Do not edit `assistant.knowledge_document` directly with a service key. Direct upsert bypasses the two-admin review and release pointer. The import utility rejects that governed table. Use the admin workflow for changes to live knowledge.

## Schema and rollout

For a new Supabase project, apply the assistant authoring and release migrations in timestamp order. Existing projects should apply the new additive migrations:

- `supabase/migrations/20260923180000_specialized_knowledge_domain.sql` admits `SPECIALIZED` in authoring, revision, and release constraints and the public knowledge validator.
- `supabase/migrations/20260923181500_archive_knowledge_release.sql` creates a published tombstone release when an active document is archived. Java synchronization can then remove that document from retrieval.

Apply these before enabling the corresponding Java version in `supabase` authority mode. Verify the target project and migration state before any remote change. No remote Supabase migration or production cutover is performed by the local tests in this repository.

The `assistant` schema must be exposed to the Supabase Data API for the authority gateway. Keep service credentials on the server. RLS, service grants, and project settings require verification against the actual target project.

## Migration authorities

Flyway owns the schema of the Compose and application database. `supabase/migrations` is a separate remote path for the assistant authority. Never apply both families to one database, and never edit an applied Supabase migration except to keep the retired keepalive file as a documented no-op. CI enforces both families: `scripts/check-migration-immutability.mjs` rejects edits, renames, and deletions of applied files, and `scripts/check-supabase-migrations.mjs` checks Supabase timestamp names, ordering, and non-empty files. No Supabase environment exists here, so no Supabase migration was applied (`NOT_RUN`). The demo-password alignment (`20260922123000`) only writes accounts when the session opts in with `SET campuscore.demo_seed = 'on'` and is a no-op when `campuscore_auth."User"` is absent. The keepalive ping (`20260920210000`) schedules nothing; the forward migration `20261103000000` unschedules any leftover `render_keepalive_warm_ping` job. Both remain demo and operations behaviour and must not be enabled on a production project.

The two families diverge in ways that make a shared database unsafe:

1. `assistant.knowledge_release`: Flyway `V16` requires a non-null `source` without a default, while the Supabase release migrations insert without it and the later RLS policies expect `source` and status `STAGED`.
2. The allowlist in `20260926031709` rejects the earlier authoring policies and the `V110` catalog-sync policies, so replay aborts.
3. The same migration revokes `service_role` privileges that `SupabaseKnowledgeAuthorityService` uses, so its RPC calls return not found.
4. Its role-membership check rejects the incoming `postgres` membership that Flyway `V84` was relaxed to accept.
5. `20260918153000` re-adds an `announcement_status_ck` with a seven-value list, regressing the four states of Flyway `V136`.
6. Flyway `V11` gives `knowledge_document_audit.id` no default while the Supabase RPC omits it on insert.

Revisit only with an approved redesign that supports a shared database. The boundary is also recorded in [flyway-lineage.md](flyway-lineage.md#12-supabase-migrations-boundary).

## Specialized corpus

[`assistant-specialized-knowledge.json`](../../supabase/seed/assistant-specialized-knowledge.json) owns the Vietnamese and English software engineering corpus. The Java runtime and remote release projection use `domain = 'SPECIALIZED'`. Applied Flyway history is immutable; the initial generator refuses to overwrite V71. [The focus-correction generator](../../scripts/generate-specialized-focus-migration.mjs) checks the additive V115 migration against the canonical architecture and constructor-injection articles. Existing migration files are checked rather than rewritten.

V115 preserves human edits and foreign runtime authority. If its exact local base is unavailable, its audit records `AUTHORITY_REVIEW_REQUIRED`; local authoring changes do not imply that the chatbot serves them. Remote publication still uses the existing two-admin workflow and Java synchronization.

Validate the source offline:

```powershell
$specializedSeedCount = (Get-Content .\supabase\seed\assistant-specialized-knowledge.json -Raw | ConvertFrom-Json).Count
node scripts/supabase/assistant-knowledge.mjs validate `
  --file .\supabase\seed\assistant-specialized-knowledge.json --expected-count $specializedSeedCount
node scripts/generate-specialized-focus-migration.mjs
node --test scripts/supabase/assistant-knowledge.test.mjs
```

The validation checks count, identifiers, locales, and duplicate slugs. Java's `V71SpecializedKnowledgeMigrationTest` additionally checks all public seed content against the assistant input guard.

## Verification boundary

The SQL fixture in `supabase/tests/` exercises the two new migrations on a disposable PostgreSQL schema, including a safe specialized lesson, a rejected credential assignment, and an archived release snapshot. It is not an authenticated Supabase project test. Java's PostgreSQL test exercises local release promotion and rollback in a disposable database. A live remote project still needs an authorized migration, two-admin publish and archive walkthrough, successful Java synchronization, and a chatbot retrieval check before release acceptance.
