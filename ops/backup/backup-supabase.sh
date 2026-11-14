#!/usr/bin/env bash
# Backup the hosted Supabase database into the same bundle discipline as the
# local Compose lane, without touching it: bundles live in their own
# <BACKUP_DIR>/supabase/ subdirectory, so retention never prunes a local
# bundle (even if a Compose project is literally named 'supabase') and a
# Supabase bundle can never be mistaken for one.
#
# Required environment:
#   SUPABASE_DB_URL        PostgreSQL URI for the project — user, host,
#                          port, and database are taken from it; preferably
#                          the pooled endpoint (port 6543). Any password
#                          embedded in the URI is ignored on purpose.
#   SUPABASE_DB_PASSWORD   the database password, always via environment
#                          (PGPASSWORD is accepted as a fallback).
#   or component vars instead of the URI: PGHOST PGPORT PGUSER PGDATABASE
#
# Keeping the password out of the URI matters: pg_dump argv is visible to
# every local user via `ps`, while another user's process environment is
# not readable — credentials therefore travel in PG* env vars only.
# Optional:
#   BACKUP_DIR               default ops/backups (lane adds /supabase)
#   BACKUP_RETENTION_DAYS    default 14
#   SUPABASE_BACKUP_SCHEMAS  space-separated schema list; defaults to every
#                            application schema Flyway owns (no auth/storage/
#                            supabase_* internals, which the provider manages)
set -euo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/child-tools.sh"
repo_root="$(cd "$script_dir/../.." && pwd)"
backup_dir="${BACKUP_DIR:-$repo_root/ops/backups}/supabase"
retention_days="${BACKUP_RETENTION_DAYS:-14}"

if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  if [[ "$SUPABASE_DB_URL" =~ ^postgres(ql)?://([^:/@]+)(:[^@]*)?@([^:/]+):([0-9]+)/([^?]+) ]]; then
    PGUSER="${BASH_REMATCH[2]}"
    PGHOST="${BASH_REMATCH[4]}"
    PGPORT="${BASH_REMATCH[5]}"
    PGDATABASE="${BASH_REMATCH[6]}"
    export PGUSER PGHOST PGPORT PGDATABASE
  else
    echo 'SUPABASE_DB_URL must look like postgresql://user[:password]@host:port/db.' >&2
    exit 2
  fi
else
  : "${PGHOST:?Set PGHOST (or SUPABASE_DB_URL).}"
  : "${PGUSER:?Set PGUSER (or SUPABASE_DB_URL).}"
  : "${PGDATABASE:?Set PGDATABASE (or SUPABASE_DB_URL).}"
fi
PGPASSWORD="${SUPABASE_DB_PASSWORD:-${PGPASSWORD:-}}"
export PGPASSWORD
[[ -n "$PGPASSWORD" ]] || {
  echo 'Set SUPABASE_DB_PASSWORD (or PGPASSWORD) for the Supabase database.' >&2
  exit 2
}
schemas="${SUPABASE_BACKUP_SCHEMAS:-thesis assistant campuscore_auth campuscore_identity academic engagement notifications site campuscore_audit admissions learning events library careers public}"

command -v pg_dump >/dev/null 2>&1 || { echo 'pg_dump is required on PATH (match the server major version).' >&2; exit 2; }
command -v pg_restore >/dev/null 2>&1 || { echo 'pg_restore is required on PATH (match the server major version).' >&2; exit 2; }
[[ "$backup_dir" != "/" && "$backup_dir" != "." && -n "$backup_dir" ]] || {
  echo 'Refusing an unsafe backup directory.' >&2
  exit 2
}
[[ "$retention_days" =~ ^[0-9]+$ ]] || {
  echo 'BACKUP_RETENTION_DAYS must be a positive integer.' >&2
  exit 2
}
retention_days=$((10#$retention_days))
(( retention_days > 0 )) || {
  echo 'BACKUP_RETENTION_DAYS must be a positive integer.' >&2
  exit 2
}
for schema in $schemas; do
  [[ "$schema" =~ ^[a-z][a-z0-9_]*$ ]] || {
    echo "Unsafe schema name in SUPABASE_BACKUP_SCHEMAS: $schema" >&2
    exit 2
  }
done
mkdir -p "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle="campuscore-supabase-${timestamp}"
archive="$backup_dir/${bundle}.dump"
checksum="$archive.sha256"
claim="$backup_dir/.${bundle}.claim"
if ! mkdir "$claim" 2>/dev/null; then
  echo 'A backup with this timestamp is already in progress.' >&2
  exit 1
fi

staging=''
owns_outputs=0
completed=0
cleanup() {
  local status=$?
  if (( owns_outputs == 1 && completed == 0 )); then
    rm -f -- "$archive" "$checksum"
  fi
  if [[ -n "$staging" ]]; then rm -rf -- "$staging"; fi
  rmdir -- "$claim" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

if [[ -e "$archive" || -e "$checksum" ]]; then
  echo 'Backup output already exists; refusing to overwrite it.' >&2
  exit 1
fi
owns_outputs=1
staging="$(mktemp -d "$backup_dir/.${bundle}.XXXXXX")"
staged_archive="$staging/$(basename "$archive")"
staged_checksum="$staging/$(basename "$checksum")"

schema_args=()
for schema in $schemas; do
  schema_args+=(--schema="$schema")
done

# Credentials ride PG* env vars, never argv. run_sensitive_child_phase
# suppresses child stderr unless VERBOSE=1.
run_sensitive_child_phase 'Supabase database dump' \
  pg_dump --format=custom --no-owner --no-privileges "${schema_args[@]}" --dbname "$PGDATABASE" > "$staged_archive"

toc="$(run_child_phase 'Database archive inspection' pg_restore --list "$staged_archive")"
if ! grep -Eq 'TABLE DATA[[:space:]]+thesis[[:space:]]+flyway_schema_history([[:space:]]|$)' <<< "$toc"; then
  echo 'Backup archive does not contain the application Flyway history table.' >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$staging" && sha256sum "$(basename "$staged_archive")") > "$staged_checksum"
else
  (cd "$staging" && shasum -a 256 "$(basename "$staged_archive")") > "$staged_checksum"
fi

mv -- "$staged_checksum" "$checksum"
mv -- "$staged_archive" "$archive"
completed=1

find "$backup_dir" -maxdepth 1 -type f \
  \( -name "campuscore-supabase-????????T??????Z.dump" \
     -o -name "campuscore-supabase-????????T??????Z.dump.sha256" \) \
  -mtime "+$retention_days" -print -delete
printf 'Backup written: %s\nChecksum: %s\n' "$archive" "$checksum"
