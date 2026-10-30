# Backup, restore, and rollback

The production database backup is a PostgreSQL custom archive plus a SHA-256
sidecar. Run it from the repository checkout on the VPS:

```sh
BACKUP_RETENTION_DAYS=14 ./ops/backup/backup-postgres.sh
./ops/backup/verify-backup.sh ops/backups/campuscore-<timestamp>.dump
./ops/backup/restore-postgres.sh ops/backups/campuscore-<timestamp>.dump campuscore_restore_<timestamp>
```

Restore always requires a database name different from `POSTGRES_DB`; the
script refuses an in-place overwrite. After an isolated restore, verify the
latest successful Flyway version, readiness, authentication, representative
JSON/SSE assistant calls, and row counts before approving a recovery.

Rollback is an application/image operation: stop the edge, set
`CAMPUSCORE_IMAGE_TAG` to the previous verified full commit SHA, pull the four
matching digests, run `docker compose -f docker-compose.prod.yml up -d --wait`,
and repeat the smoke checks. Never use `latest`, and never run `down -v` on a
production volume. If a migration is irreversible, restore into an isolated
database first and obtain an explicit recovery decision before changing the
live volume.

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
