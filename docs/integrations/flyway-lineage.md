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
│  Schemas: public, thesis, academic, engagement, assistant, site, auth, │
│           notification, events, learning, admissions, library, careers │
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
- `auth`: Accounts, user credentials, two-factor authentication challenges, password reset tokens, session revocations.
- `notification`: In-app notifications, delivery markers, device push notification registrations.
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

### 1.3 Manual and Scratch SQL Boundary
The `.sql` files located directly in the root `database/` directory (e.g., `seed_big_data_campus_ecosystem_v43.sql`, `role_targeted_announcements.sql`, `update_all_old_university_names.sql`):
- Were temporary scratch scripts and development seeds used during early iterations.
- Have **zero runtime authority**.
- Must **NEVER** be applied manually to any database running the CampusUTE ecosystem.
- All valid DDL and data adjustments from these scripts have already been codified into permanent Flyway migrations (e.g., V43, V45, V122, V123). Manually running them risks primary key violations, overwriting normalized records, or corrupting Flyway schema history checksums.

---

## 2. Migration Lineage & Version Census

As of version V144, the canonical Flyway migration sequence contains **141 migration files**, spanning from `V1` to `V144`.

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

A parallel test migration chain exists under `java-services/restful-api/src/test/resources/db/migration-h2/` (62 files).

- **Purpose**: A lightweight, trimmed-down schema definition designed solely for rapid in-memory execution during Maven unit test passes (`mvn test`).
- **Structure**: Skips non-essential historical data seeds (jumps directly from V24 to V85, and V93 to V109).
- **Semantics Limitation**: H2 uses nullable generated columns and standard unique constraints. It does not evaluate PostgreSQL-native partial unique indexes (such as `(round_id, student_id) WHERE active_participation = TRUE`), table-level lock sequencing (`FOR UPDATE`), or Row-Level Security (RLS) policies.
- **Rule**: Success in H2 tests does not guarantee PostgreSQL concurrent invariant correctness. Critical concurrency and migration tests must be verified against real PostgreSQL instances (`*PostgresIT.java`).

---

## 4. Fresh Install vs. Supported Upgrade Guidance

### 4.1 Fresh Installation
On a newly provisioned PostgreSQL instance:
1. Ensure the target database exists and the application user has DDL permissions on the relevant schemas (`thesis`, `academic`, `engagement`, `assistant`, `site`, `auth`, `notification`, `events`, `learning`, `admissions`, `library`, `careers`, `public`).
2. Boot the Java RESTful API service or run `mvn flyway:migrate`.
3. Flyway replays all 141 migrations in numerical order (`V1` to `V144`), recording installed versions in `thesis.flyway_schema_history`.
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
   Run Flyway validate to determine the exact mismatched versions:
   ```bash
   mvn -f java-services/pom.xml flyway:validate -Dflyway.url="$DB_URL"
   ```

3. **Realign Checksums with Repair**:
   If—and **ONLY** if—the validation failures belong strictly to the known 12 early migrations listed above, execute:
   ```bash
   mvn -f java-services/pom.xml flyway:repair -Dflyway.url="$DB_URL"
   ```
   > [!IMPORTANT]
   > `flyway:repair` only realigns the `checksum` column in `flyway_schema_history` to match the current local files. It performs **no DDL changes** and **modifies no business data**.

4. **Confirm Clean Validation**:
   Re-run validation to verify that stored checksums now match the local files:
   ```bash
   mvn -f java-services/pom.xml flyway:validate -Dflyway.url="$DB_URL"
   ```

5. **Apply Forward Migrations**:
   Boot the Java service. Flyway will seamlessly apply all remaining pending migrations up to `V144`.

### 4.3 Operational Invariants & Anti-Patterns
- **No Blind Repair**: Never run `flyway:repair` if checksum drift occurs on migrations outside the 12 known legacy versions. Unrecognized drift indicates unauthorized manual SQL edits or file corruption that must be investigated before proceeding.
- **Never Edit Merged Migrations**: Once a migration file has been merged into `main` or deployed to any environment, it is strictly immutable. All bug fixes, data corrections, and index adjustments must be authored as new forward migrations (`V<n+1>__fix_description.sql`).
- **Never Disable `validateOnMigrate`**: Setting `validate-on-migrate=false` masks underlying schema divergence, resulting in unrepeatable deployments and hard-to-diagnose production defects.
- **Never Run `flyway:clean` on Shared or Production Databases**: `clean` completely drops all database objects and schemas.

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
- Production migration directory passes with 141 files, V1..V144, and gaps `[56, 91, 119]`.
- Duplicate version detection catches conflicts.
- Gap detection identifies unapproved gaps outside the allow-list.
- Filename and non-positive version syntax errors are reported.
- Known documentation files (e.g. `README.md`) are gracefully ignored.
- CLI exit codes and `--json` serialization adhere to automation contracts.
