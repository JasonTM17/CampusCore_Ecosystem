# Backup, restore, and rollback

This workspace runs local-first and has no production database. The backup
scripts require an explicit `COMPOSE_PROJECT_NAME`; there is no production
project fallback. They write a PostgreSQL custom archive, the local
thesis-report volume archive, and one SHA-256 sidecar covering both files.
Backups are staged and checked before publication. The database archive must
include `thesis.flyway_schema_history`, and the report archive must be a
readable tar file containing only regular files and directories. Child-tool
errors are summarized without raw diagnostics by default; `VERBOSE=1` prints and
retains non-report diagnostics in mode-600 temporary files. Report-key and
report-tar diagnostics stay suppressed. A non-local
thesis storage provider makes the manual backup fail so external objects cannot
be silently omitted. `BACKUP_RETENTION_DAYS` accepts positive base-10 digits,
including zero-padded values such as `08`. Bundle names embed the Compose
project as `campuscore-<project>-<timestamp>`; a retention pass deletes only
that project's expired bundles and never prunes earlier archives that lack
the project segment.

After each dump and report tar are staged, backup and verification compare `thesis.thesis_group_report.storage_key` values from the dump with tar members.
A missing key triggers one full backup recapture; a second mismatch fails with only the missing-key count.
An archive that contains the report table definition without its table data is
rejected. Verification and restore run the same reconciliation before either
restore target is created.
This closes the report replacement gap without fencing report writes.

The recovery path actually executed here is the disposable drill in
[Disposable recovery drill (MP38)](#disposable-recovery-drill-mp38). The manual
archive/verify/restore flow is for a local or otherwise reachable stack:

```sh
# COMPOSE_PROJECT_NAME must name the running project:
#   campusute            -> node scripts/local-dev.mjs up
#   <checkout-directory> -> node scripts/local-dev.mjs up --project <checkout-directory>
export COMPOSE_PROJECT_NAME=campusute
BACKUP_RETENTION_DAYS=14 ./ops/backup/backup-postgres.sh
./ops/backup/verify-backup.sh ops/backups/campuscore-<project>-<timestamp>.dump
./ops/backup/restore-postgres.sh ops/backups/campuscore-<project>-<timestamp>.dump campuscore_restore_<timestamp>
```

The restore target must use the `campuscore_restore_` prefix and must not
already exist. Restore runs `pg_restore --single-transaction`; a failed restore
drops only the database created by that invocation. Report files are extracted
to a new sibling directory named
`campuscore-<project>-<timestamp>.reports.restore`. The original
`campuscore_thesis_report_storage` volume is never modified. Point an isolated
restore application at that directory when checking report downloads; do not
mount it over the live volume.

`node scripts/local-dev.mjs up` generates the required Compose secrets,
including `ASSISTANT_RAG_OWNER_ASSERTION_SECRET`, in the git-ignored `.env`.
Direct Compose starts must first run `node scripts/compose-secrets.mjs --ensure`
and supply all required base values. Existing custom database passwords in
`.env` are kept so their volumes remain usable.

`verify-backup.sh` and `restore-postgres.sh` also require the explicit project
name and a running local Compose stack so they can inspect the PostgreSQL TOC
and validate the report archive. Restore refuses an in-place overwrite and any
existing target. After an isolated restore, verify the latest successful
Flyway version, readiness, authentication, representative JSON/SSE assistant
calls, report downloads, and row counts before approving a recovery.

## Supabase backup lane

`backup-supabase.sh` covers the hosted Supabase database the Compose stack
cannot reach. It runs local `pg_dump`/`pg_restore` against
`SUPABASE_DB_URL` (use the pooled `postgres.<ref>` endpoint on port 6543),
dumps only the application schemas, and never echoes the URI. Bundles use a
separate `campuscore-supabase-<timestamp>` namespace so retention and naming
can never collide with the local lane. The thesis report archive step is out
of scope here: report objects live in provider storage, not the database.
Restore from this lane is manual `pg_restore` against an isolated database —
the same `campuscore_restore_` discipline applies.

```sh
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres'
./ops/backup/backup-supabase.sh
./ops/backup/verify-supabase-backup.sh ops/backups/campuscore-supabase-<timestamp>.dump
```

`SUPABASE_BACKUP_SCHEMAS` overrides the schema list (defaults to every schema
Flyway creates plus `public`); `BACKUP_RETENTION_DAYS` applies to the
`campuscore-supabase-*` namespace only.

Rollback is an application/image operation. Locally that means returning the
working tree to the previous reviewed commit and rebuilding the stack
(`git switch --detach <full-commit-sha>`, then `node scripts/local-dev.mjs up`).
If an external publisher produced images for that commit, the no-build overlay
pins the same immutable tag across services. Never use `latest`, and never run
`down -v` on a volume that still holds data you need. If a migration is
irreversible, restore into an isolated database first and obtain an explicit
recovery decision before touching the original volume. Publishing images and
rolling back a hosted deployment are **deferred — future deployment work**.

## Disposable recovery drill (MP38)

`scripts/ecosystem-backup-drill.mjs` never reads env files. The lead must
provision an owned synthetic fixture and supply these process environment
variables explicitly before invoking the drill:

| Variable | Contract |
| --- | --- |
| `ECO_DRILL_CONTAINER` | Required; `^campusute-drill-[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `ECO_DRILL_DB` | Required; `^campusute_drill_[a-z0-9]+(?:_[a-z0-9]+)*$`, at most 63 characters |
| `ECO_DRILL_DISPOSABLE` | Required; exactly `1`, the operator's disposable-target attestation |
| `ECO_DRILL_USER` | Optional; defaults to `campuscore`; simple PostgreSQL role identifier |
| `ECO_DRILL_WRITER` | Optional; distinct container with the same disposable name prefix |

The database container and optional writer must already be running and carry
the Docker label `io.campusute.drill.disposable=true`. All names and labels are
validated before stopping the writer or dumping. Missing/unsafe names fail
closed, without historical fallbacks. Names, labels and opt-in attest ownership;
the lead still verifies the Docker context, actual fixture and absence of real
records. A local container can proxy a remote service: labels alone cannot prove
data provenance. Do not relabel a real stack to bypass the guard.

```sh
# Supply the required process environment non-echoingly beforehand.
node scripts/ecosystem-backup-drill.mjs --out artifacts/verification/master-plan/mp38-recovery
```

The script creates a random separate restore database; it never pre-drops a
database on a name collision. Unless `--keep` is supplied, it drops only that
created database in `finally`, including failed-check paths. It attempts to
restart a writer it stopped and records restart failure. Quiesce all other
writers separately; `ECO_DRILL_WRITER` fences only the named container.

Built-in checks compare both table sets, all row counts, FK declarations,
targeted library/careers/events/admissions orphan checks, the qualified
`thesis.flyway_schema_history` head and thesis report blob-reference metadata.
Only aggregate blob-reference count and digest are recorded; DB metadata parity
does not prove that external bytes can be restored.

Runtime-only checks are explicit flags accepting **trusted lead-owned `.mjs`
hooks** (no shell). Supply the following on the same command when available:

- `--blob-inventory-hook <file.mjs>`: reconcile all external object references
  against the separately restored synthetic object store, check readable bytes
  and stored checksums, including missing objects and any additional providers.
- `--stale-credential-hook <file.mjs>`: use the restored fixture's application to
  prove that credentials/tokens invalidated before the backup remain rejected
  after recovery. A connectivity error is not proof of rejection.
- `--previous-image-hook <file.mjs> --previous-image sha256:<immutable-digest>`:
  run the identified prior application image against the restored DB and prove
  schema/read compatibility and representative smoke behavior. Do not run
  migrations or change a real deployment. Record exact image/fixture evidence
  separately; the drill does not pull or start an application image itself.

Each hook receives one JSON object on stdin: `check`, `container`, `sourceDb`,
`restoreDb`, `user`, `fixture: "synthetic"`, `previousImage` and the aggregate
`externalBlobInventory`. It runs before restore cleanup while the writer is
fenced. Resolve object keys/credentials privately against the owned fixture;
the stdin context contains neither keys nor credentials. Return exactly a JSON
object with `status: "PASS"` on stdout and exit successfully only after the
named check has actually passed. Hook stdout/stderr are captured and discarded;
never print secrets or backup bytes. Hooks have a bounded minute timeout and
bounded output. Missing hook = `NOT_RUN`; malformed output, timeout or nonzero
exit = `FAIL`. Arbitrary hook code is trusted and outside the script's target
guard; review it and arrange its own child-process cleanup before use.

`backup-drill.json` records individual checks. Exit codes: `0` all checks PASS;
`1` observed drill/check/cleanup failure; `2` invalid configuration or unsafe
ownership; `4` missing container capability or incomplete runtime checks. No
hook means DB checks may PASS but overall recovery remains `INCOMPLETE`.
Archives and SHA sidecars are retained privately; output never includes backup
bytes, raw child errors or secrets. POSIX permissions are restricted where
supported; the lead supplies equivalent directory ACLs on Windows.

This local drill does not establish encryption, offsite recovery, RPO/RTO,
provider storage durability or public hosting capacity. Those gates retain
their owner/destination/credential authority. See the
[capacity worksheet](../../docs/ecosystem/capacity-baseline.md).
