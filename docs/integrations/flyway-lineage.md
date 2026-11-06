# Flyway Migration Lineage, Schema Authority, and Upgrade Guidance

This document is the definitive authority and operational reference for the database migration lineage across the CampusUTE ecosystem. It defines the boundary between PostgreSQL Flyway migrations, Supabase migrations, and legacy manual SQL scripts, details all version numbers and documented gaps, and provides step-by-step upgrade procedures for fresh installations and long-lived environments.

---

## 1. Schema Authority Model

The CampusUTE ecosystem employs multiple database technologies and scripts for different operational domains. To prevent schema split-brain, data loss, or checksum drift, clear authority boundaries are enforced:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CORE SCHEMA AUTHORITY                           │
│     java-services/restful-api/src/main/resources/db/migration          │
│               Managed by Flyway at Application Startup                 │
│                                                                        │
│  Schemas: public, thesis, academic, engagement, assistant, site,       │
│           events, learning, admissions, library, careers,              │
│           campuscore_auth, campuscore_identity, notifications,         │
│           campuscore_audit                                             │
└───────────────────▲────────────────────────────────────────────────────┘
                    │
                    │ Mirrors relational DDL up to V83
                    │ (20260924120000_schema_parity_v80_v81_v83.sql)
                    │
┌───────────────────┴────────────────────────────────────────────────────┐
│                    SUPABASE CONTENT & SERVICE LAYER                    │
│                          supabase/migrations                           │
│                                                                        │
│  - Authoring workflow (drafts, revisions, two-admin review)            │
│  - Storage buckets & media attachments (thesis reports, articles)      │
│  - Vector embeddings & semantic search                                 │
│  - Synchronized to PostgreSQL runtime via SupabaseKnowledgeSyncService │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                    MANUAL & SCRATCH SQL (NO AUTHORITY)                 │
│                               database/*.sql                           │
│                                                                        │
│  - Historical prototypes & scratch scripts (seed_v43, etc.)            │
│  - ZERO runtime authority: NEVER run against production or live DBs    │
│  - All valid structures incorporated into canonical Flyway migrations  │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Flyway as the Single Relational Authority
The Flyway migration chain under `java-services/restful-api/src/main/resources/db/migration/` is the **exclusive runtime schema authority** for all transactional tables and schemas:
- `thesis`: Council members, defense rounds, thesis topics, student teams, reviews, report submissions.
- `academic`: Courses, departments, faculties, student grades, GPA calculation, prerequisites, section enrollments.
- `engagement`: Articles, categories, rich media galleries, reading metrics, campus announcements.
- `assistant`: Local active release runtime projection (`knowledge_runtime_state`), conversation scopes, RLS policies.
- `campuscore_auth`: Accounts, user credentials, two-factor authentication challenges, password reset tokens, session revocations.
- `campuscore_identity`: OIDC authorization/consent grants, refresh lineage, BFF sessions and transactions, logout audit.
- `campuscore_audit`: Admin audit trail.
- `notifications`: In-app notifications, delivery markers, device push notification registrations.
- `events`: Campus events, venue management, ticketing, attendance check-ins.
- `learning`: LMS courses, assignment submissions, lesson modules.
- `admissions`: Applications, admission quotas, applicant documents.
- `library`: Book catalog, loans, reservations, fines.
- `careers`: Job listings, internship opportunities, student applications.
- `site`: Appearance key-value pairs, system parameters.

Spring Boot executes Flyway migrations automatically upon application startup. Immutability is strictly enforced: `validate-on-migrate` is enabled by default.

### 1.2 Supabase Migrations Boundary
The files under `supabase/migrations/` serve a distinct role:
- They govern Supabase-hosted authoring environments, edge storage buckets (such as `thesis-reports`), and two-admin approval workflows for knowledge releases.
- They are **content and authoring authority**, but NOT the relational schema authority for the Java RESTful API.
- Live public chatbot queries never query Supabase directly; instead, published knowledge releases are synchronized to the local PostgreSQL `assistant` schema via `SupabaseKnowledgeSyncService`.
- A dedicated parity migration (`supabase/migrations/20260924120000_schema_parity_v80_v81_v83.sql`) mirrors relational schema constraints up to V83 so local Supabase test environments match Flyway DDL. All schema modifications must originate in Flyway first.
- The two families must not be applied to the same database; the known divergences are listed in [supabase-assistant.md](supabase-assistant.md#migration-authorities).

### 1.3 Manual and Scratch SQL Boundary
The `.sql` files located directly in the root `database/` directory (e.g., `seed_big_data_campus_ecosystem_v43.sql`, `role_targeted_announcements.sql`, `update_all_old_university_names.sql`):
- Were temporary scratch scripts and development seeds used during early iterations.
- Have **zero runtime authority**.
- Must **NEVER** be applied manually to any database running the CampusUTE ecosystem.
- All valid DDL and data adjustments from these scripts have already been codified into permanent Flyway migrations (e.g., V43, V45, V122, V123). Manually running them risks primary key violations, overwriting normalized records, or corrupting Flyway schema history checksums.

---

## 2. Migration Lineage & Version Census

As of version V154, the canonical Flyway migration sequence contains **151 migration files**, spanning from `V1` to `V154`.

### 2.1 Duplicates
- **0 duplicate version numbers**. Every migration version number is strictly unique. Duplicate versions cause non-deterministic execution in Flyway and are prevented by CI validation.

### 2.2 Documented Numbering Gaps
There are exactly **three numbering gaps** in the canonical PostgreSQL Flyway sequence. These gaps are explicitly allow-listed in the automated lineage checker (`scripts/flyway-lineage-check.mjs`):

| Gap Version | Preceding Version | Succeeding Version | Historical Context & Rationale |
| :--- | :--- | :--- | :--- |
| **V56** | `V55__grade_score_range_checks.sql` | `V57__reconcile_academic_regulations_knowledge.sql` | **Intentional numbering gap**. The file `V56` never existed in git history. As recorded in `db/migration/README.md` and `docs/RECOMMENDATIONS.md`, this gap occurred during early feature merge and was intentionally left unallocated. No schema changes or data modifications were omitted. |
| **V91** | `V90__credit_hour_knowledge_fill.sql` | `V92__two_factor_disable_challenge.sql` | **Resequenced to V94 in PostgreSQL**. In the H2 unit-test fixture chain, thesis cancellation was drafted as `V91__release_canceled_thesis_memberships.sql`. During merge into canonical PostgreSQL, V92 (2FA challenge) and V93 (specialized knowledge markdown) were registered first, so the thesis cancellation logic became `V94__release_canceled_thesis_memberships.sql`. Early test comments citing V91 (e.g. `ThesisCancellationMembershipMigrationPostgresIT.java`) refer to the draft numbering; runtime authority is `V94`. Version 91 is intentionally absent in PostgreSQL Flyway. |
| **V119** | `V118__thesis_round_report_deadline.sql` | `V120__seed_truong_bo_mon_role.sql` | **Resequenced between H2 fixture and PostgreSQL**. In H2 fixtures, `V118` is group delete guard and `V119` is round report deadline. In PostgreSQL, `V117` is group delete guard and `V118` is round report deadline. The next migration assigned was `V120__seed_truong_bo_mon_role.sql`, leaving V119 unallocated in PostgreSQL Flyway. |

### 2.3 Explicit Allow-List Contract
The automated lineage validator enforces the gap allow-list:
```javascript
export const DEFAULT_ALLOWED_GAPS = Object.freeze([56, 91, 119]);
```
Any gap outside this explicit set is treated as an unexpected missing migration and causes immediate validation failure.

---

## 3. H2 Test Fixture Chain Boundary

A parallel test migration chain exists under `java-services/restful-api/src/test/resources/db/migration-h2/` (66 files).

- **Purpose**: A lightweight, trimmed-down schema definition designed solely for rapid in-memory execution during Maven unit test passes (`mvn test`).
- **Structure**: Skips non-essential historical data seeds (jumps directly from V24 to V85, and V93 to V109).
- **Semantics Limitation**: H2 uses nullable generated columns and standard unique constraints. It does not evaluate PostgreSQL-native partial unique indexes (such as `(round_id, student_id) WHERE active_participation = TRUE`), table-level lock sequencing (`FOR UPDATE`), or Row-Level Security (RLS) policies.
- **Rule**: Success in H2 tests does not guarantee PostgreSQL concurrent invariant correctness. Critical concurrency and migration tests must be verified against real PostgreSQL instances (`*PostgresIT.java`).

---

## 4. Fresh Install vs. Supported Upgrade Guidance

### 4.1 Fresh Installation
On a newly provisioned PostgreSQL instance:
1. Ensure the target database exists and the application user has DDL permissions on the relevant schemas (`thesis`, `academic`, `engagement`, `assistant`, `site`, `events`, `learning`, `admissions`, `library`, `careers`, `campuscore_auth`, `campuscore_identity`, `notifications`, `campuscore_audit`, `public`).
2. Boot the Java RESTful API service with `FLYWAY_ENABLED=true` (the default); Flyway migrates on startup. This repository declares no Flyway Maven plugin and has no root POM, so `mvn flyway:*` goals do not resolve.
3. Flyway replays all 151 migrations in numerical order (`V1` to `V154`), recording installed versions in `thesis.flyway_schema_history`.
4. All checksums match the committed repository files by construction.

### 4.2 Supported Upgrade from Long-Lived Databases (Stale Checksums)
During initial project development (prior to automated immutability enforcement), **12 early migrations** were edited in git after having been applied to long-lived development and staging databases:
```
V1, V2, V3, V8, V25, V34, V52, V54, V64, V65, V68, V73
```
If an existing database was initialized with the pre-edit versions, booting the updated application service will fail with a `FlywayValidateException`:
```
Migration checksum mismatch for migration version X:
-> Applied to database : <old_checksum>
-> Resolved locally    : <new_checksum>
```

#### Step-by-Step Upgrade Procedure:
1. **Inventory Applied History**:
   Connect to the database and inspect the recorded schema history:
   ```sql
   SELECT installed_rank, version, description, checksum, success
   FROM thesis.flyway_schema_history
   ORDER BY installed_rank;
   ```

2. **Validate Detected Drift**:
   Booting with Flyway enabled (the default outside Compose; in Compose,
   `rag-service` runs Flyway) is the supported validation path:
   `validate-on-migrate` is on by default, so startup fails with a
   `FlywayValidateException` naming the mismatched version. This repository
   declares no Flyway Maven plugin and has no root POM, so `mvn flyway:*` goals
   cannot be resolved.

3. **Realign Checksums with Repair**:
   No repair command ships in this repository. If—and **ONLY** if—the validation
   failures belong strictly to the known 12 early migrations listed above,
   realign the stored checksums with a Flyway CLI installed outside this
   repository (`flyway repair` with `-url`, `-user`, `-password` for the same
   database), then boot the service again. On a disposable local database,
   recreating the database is the supported alternative.
   > [!IMPORTANT]
   > Repair only realigns the `checksum` column in `flyway_schema_history` to match the current local files. It performs **no DDL changes** and **modifies no business data**.

4. **Confirm Clean Validation**:
   Boot the service again; a clean start proves the stored checksums now match
   the local files.

5. **Apply Forward Migrations**:
   Boot the Java service. Flyway will seamlessly apply all remaining pending migrations up to `V154`.

### 4.3 Operational Invariants & Anti-Patterns
- **No Blind Repair**: Never run a Flyway repair if checksum drift occurs on migrations outside the 12 known legacy versions. Unrecognized drift indicates unauthorized manual SQL edits or file corruption that must be investigated before proceeding.
- **Never Edit Merged Migrations**: Once a migration file has been merged into `main` or deployed to any environment, it is strictly immutable. All bug fixes, data corrections, and index adjustments must be authored as new forward migrations (`V<n+1>__fix_description.sql`).
- **Never Disable `validateOnMigrate`**: Setting `validate-on-migrate=false` masks underlying schema divergence, resulting in unrepeatable deployments and hard-to-diagnose production defects.
- **Never Run `flyway clean` on Shared or Production Databases**: `clean` completely drops all database objects and schemas.

### 4.4 Pre-Deployment Procedure for Populated Databases (Lock-Heavy Migrations: V146–V150)

For populated databases replaying from earlier migration versions (below V14, V53, or V116), consult the preflight queries and out-of-band mitigation procedures in [Populated environments below V14 / V53 / V116](../ecosystem/release-runbook.md#populated-environments-below-v14--v53--v116).

When deploying to a populated database, five migrations in the forward sequence introduce heavy table locks if executed inside the default startup Flyway transaction:

- **`V146__w14_hot_read_indexes.sql`**: Contains 6 `CREATE INDEX IF NOT EXISTS` statements without `CONCURRENTLY`. Standard `CREATE INDEX` takes a `SHARE` lock on each target table (`academic."Enrollment"`, `academic."Attendance"`, `academic."AttendanceCheckin"`, `thesis.thesis_topic_supervisor`, `thesis.thesis_group_member`, `notifications.notification`). This blocks concurrent write operations (`INSERT`, `UPDATE`, `DELETE`) for the duration of the migration.
- **`V147__engagement_folded_search_columns.sql`**: Contains 13 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... GENERATED ALWAYS AS (...) STORED` statements across `engagement."Announcement"` (7 columns) and `engagement."PublicDocumentRevision"` (6 columns). PostgreSQL 11+ supports metadata-only column additions for constant defaults, but `GENERATED ALWAYS AS (...) STORED` columns evaluate an expression per row (`TRANSLATE(LOWER(...), ...)`) and rewrite the table heap to store computed values. This takes an `ACCESS EXCLUSIVE` lock on each table, blocking both reads (`SELECT`) and writes (`INSERT`, `UPDATE`, `DELETE`). PostgreSQL does not support a `CONCURRENTLY` modifier for `ALTER TABLE ADD COLUMN`.
- **`V148__thesis_hot_read_indexes.sql`**, **`V149__enrollment_semester_index.sql`** and **`V150__admin_audit_created_index.sql`**: Contain 3, 1 and 1 `CREATE INDEX IF NOT EXISTS` statements without `CONCURRENTLY`. Each standard `CREATE INDEX` takes a `SHARE` lock on its target table (`thesis.thesis_group`, `thesis.thesis_group_report`, `thesis.thesis_council_topic`, `academic."Enrollment"`, `campuscore_audit."AdminAudit"`), blocking concurrent writes for the duration of the build.

All five migrations specify `IF NOT EXISTS` for every index and column. Because applied migrations are immutable and must not be edited in place, the operational procedure is to pre-create the schema objects prior to application deployment so Flyway's startup statements encounter existing objects and execute as sub-millisecond no-ops.

#### Execution Order

1. **Step 1 (Online): Pre-create V146 and V148–V150 indexes concurrently**. Run outside any transaction block as the database owner role while the application remains online.
2. **Step 2 (Maintenance Window): Pre-create V147 generated columns**. Because stored generated columns rewrite tables under `ACCESS EXCLUSIVE` locks without a concurrent alternative, run these statements during a planned maintenance window before booting the updated application image.
3. **Step 3: Verify pre-created objects**. Execute verification queries against `pg_indexes`, `pg_index`, and `information_schema.columns`.
4. **Step 4: Boot application service**. Flyway detects all indexes and columns via `IF NOT EXISTS` and skips creation without lock contention.

#### Pre-Creation DDL Statements

##### 1. V146 Concurrent Indexes
Execute as the database owner role, strictly **outside a transaction block** (`psql` autocommit enabled):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS academic_enrollment_enrolled_at_idx
    ON academic."Enrollment" ("enrolledAt" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS academic_attendance_date_id_idx
    ON academic."Attendance" ("date" DESC, "id" ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS attendance_checkin_session_created_idx
    ON academic."AttendanceCheckin" ("sessionId", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS thesis_topic_supervisor_lecturer_idx
    ON thesis.thesis_topic_supervisor (lecturer_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS thesis_group_member_student_idx
    ON thesis.thesis_group_member (student_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS notification_user_created_id_idx
    ON notifications.notification (user_id, created_at DESC, id DESC);
```

##### 2. V148–V150 Concurrent Indexes
Execute as the database owner role, strictly **outside a transaction block** (`psql` autocommit enabled), while the application remains online:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS thesis_group_topic_idx
    ON thesis.thesis_group (topic_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS thesis_group_report_round_submitted_idx
    ON thesis.thesis_group_report (round_id, submitted_at DESC, group_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS thesis_council_topic_council_idx
    ON thesis.thesis_council_topic (council_id, topic_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS academic_enrollment_semester_enrolled_idx
    ON academic."Enrollment" ("semesterId", "enrolledAt" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS admin_audit_created_id_idx
    ON campuscore_audit."AdminAudit" ("createdAt" DESC, "id" DESC);
```

##### 3. V147 Stored Generated Columns
Execute during a scheduled maintenance window (the statements take an `ACCESS EXCLUSIVE` lock while the heap is rewritten). Run the migration file itself as the database owner instead of retyping its statements; every statement uses `ADD COLUMN IF NOT EXISTS`, so a later Flyway run finds the columns and skips them:

```text
psql -v ON_ERROR_STOP=1 -f java-services/restful-api/src/main/resources/db/migration/V147__engagement_folded_search_columns.sql
```

#### Verification

##### Verify V146 and V148–V150 Indexes
Confirm existence in `pg_indexes`:
```sql
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE indexname IN (
    'academic_enrollment_enrolled_at_idx',
    'academic_attendance_date_id_idx',
    'attendance_checkin_session_created_idx',
    'thesis_topic_supervisor_lecturer_idx',
    'thesis_group_member_student_idx',
    'notification_user_created_id_idx',
    'thesis_group_topic_idx',
    'thesis_group_report_round_submitted_idx',
    'thesis_council_topic_council_idx',
    'academic_enrollment_semester_enrolled_idx',
    'admin_audit_created_id_idx'
)
ORDER BY schemaname, tablename;
```
*Expected output:* Exactly 11 rows corresponding to the target indexes.

Confirm index validity (`indisvalid = true` confirms concurrent builds succeeded without errors):
```sql
SELECT c.relname AS indexname, i.indisvalid
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname IN (
    'academic_enrollment_enrolled_at_idx',
    'academic_attendance_date_id_idx',
    'attendance_checkin_session_created_idx',
    'thesis_topic_supervisor_lecturer_idx',
    'thesis_group_member_student_idx',
    'notification_user_created_id_idx',
    'thesis_group_topic_idx',
    'thesis_group_report_round_submitted_idx',
    'thesis_council_topic_council_idx',
    'academic_enrollment_semester_enrolled_idx',
    'admin_audit_created_id_idx'
)
ORDER BY c.relname;
```
*Expected output:* 11 rows, all with `indisvalid = true`.

If any row reports `indisvalid = false`, the concurrent build failed and left an invalid remnant. Drop that remnant concurrently and re-run the same `CREATE INDEX CONCURRENTLY` statement:
```sql
DROP INDEX CONCURRENTLY IF EXISTS <schema>.<indexname>;
```

Verify via `psql` schema inspection:
```text
\d academic."Enrollment"
\d academic."Attendance"
\d academic."AttendanceCheckin"
\d thesis.thesis_topic_supervisor
\d thesis.thesis_group_member
\d notifications.notification
\d thesis.thesis_group
\d thesis.thesis_group_report
\d thesis.thesis_council_topic
\d campuscore_audit."AdminAudit"
```
*Expected output:* Each table's `Indexes:` block lists the pre-created index.

##### Verify V147 Columns
Confirm generated column registration:
```sql
SELECT table_schema, table_name, column_name, is_generated
FROM information_schema.columns
WHERE table_schema = 'engagement'
  AND table_name IN ('Announcement', 'PublicDocumentRevision')
  AND column_name LIKE 'folded%'
ORDER BY table_name, ordinal_position;
```
*Expected output:* 7 rows for `Announcement` and 6 rows for `PublicDocumentRevision`, with `is_generated = 'ALWAYS'`.

Verify via `psql` schema inspection:
```text
\d engagement."Announcement"
\d engagement."PublicDocumentRevision"
```
*Expected output:* Columns display with type `text` and modifier `generated always as (translate(...)) stored`.

#### Rollback Procedure

##### Rollback V146 and V148–V150 Indexes
If pre-created indexes need to be removed prior to application rollout, drop them concurrently without taking table write locks:
```sql
DROP INDEX CONCURRENTLY IF EXISTS academic.academic_enrollment_enrolled_at_idx;
DROP INDEX CONCURRENTLY IF EXISTS academic.academic_attendance_date_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS academic.attendance_checkin_session_created_idx;
DROP INDEX CONCURRENTLY IF EXISTS thesis.thesis_topic_supervisor_lecturer_idx;
DROP INDEX CONCURRENTLY IF EXISTS thesis.thesis_group_member_student_idx;
DROP INDEX CONCURRENTLY IF EXISTS notifications.notification_user_created_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS thesis.thesis_group_topic_idx;
DROP INDEX CONCURRENTLY IF EXISTS thesis.thesis_group_report_round_submitted_idx;
DROP INDEX CONCURRENTLY IF EXISTS thesis.thesis_council_topic_council_idx;
DROP INDEX CONCURRENTLY IF EXISTS academic.academic_enrollment_semester_enrolled_idx;
DROP INDEX CONCURRENTLY IF EXISTS campuscore_audit.admin_audit_created_id_idx;
```

##### Rollback V147 Columns
If the release is rolled back, drop the derived generated columns. Note that if the application was already deployed, the application service must be rolled back first because the application queries select these folded column names:
```sql
ALTER TABLE engagement."Announcement"
    DROP COLUMN IF EXISTS "foldedTitle",
    DROP COLUMN IF EXISTS "foldedContent",
    DROP COLUMN IF EXISTS "foldedSlug",
    DROP COLUMN IF EXISTS "foldedCourseCode",
    DROP COLUMN IF EXISTS "foldedCourseName",
    DROP COLUMN IF EXISTS "foldedSemesterName",
    DROP COLUMN IF EXISTS "foldedLecturerDisplayName";

ALTER TABLE engagement."PublicDocumentRevision"
    DROP COLUMN IF EXISTS "foldedTitleVi",
    DROP COLUMN IF EXISTS "foldedTitleEn",
    DROP COLUMN IF EXISTS "foldedSummaryVi",
    DROP COLUMN IF EXISTS "foldedSummaryEn",
    DROP COLUMN IF EXISTS "foldedBodyVi",
    DROP COLUMN IF EXISTS "foldedBodyEn";
```

---

## 5. Automated Verification Tooling

To guarantee continuous compliance with Flyway lineage rules without spinning up heavy database infrastructure, a lightweight Node.js verification script is provided in the repository:

### 5.1 Verification Script (`scripts/flyway-lineage-check.mjs`)
- Requires Node.js (no external npm dependencies).
- Scans `java-services/restful-api/src/main/resources/db/migration`.
- Validates filename format (`V<digits>__<description>.sql`).
- Confirms version positivity (`version > 0`).
- Asserts zero duplicate versions.
- Asserts that all gaps match the approved allow-list `[56, 91, 119]`.

```bash
# Run lineage check with default settings
node scripts/flyway-lineage-check.mjs

# Output results in machine-readable JSON format
node scripts/flyway-lineage-check.mjs --json

# Run with custom allowed gaps or directory
node scripts/flyway-lineage-check.mjs --dir path/to/migrations --allow-gaps 56,91,119
```

### 5.2 Test Suite (`scripts/flyway-lineage-check.test.mjs`)
Uses the Node.js built-in test runner (`node:test`):
```bash
node --test scripts/flyway-lineage-check.test.mjs
```
The test suite verifies:
- Production migration directory passes with 151 files, V1..V154, and gaps `[56, 91, 119]`.
- Duplicate version detection catches conflicts.
- Gap detection identifies unapproved gaps outside the allow-list.
- Filename and non-positive version syntax errors are reported.
- Known documentation files (e.g. `README.md`) are gracefully ignored.
- CLI exit codes and `--json` serialization adhere to automation contracts.
