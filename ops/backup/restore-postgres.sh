#!/usr/bin/env bash
set -euo pipefail
umask 077

archive="${1:?Usage: restore-postgres.sh <custom-archive.dump> <isolated-db-name>}"
target_db="${2:?Usage: restore-postgres.sh <custom-archive.dump> <isolated-db-name>}"
project="${COMPOSE_PROJECT_NAME:?Set COMPOSE_PROJECT_NAME to the running local Compose project.}"
db_user="${POSTGRES_USER:-campuscore}"
source_db="${POSTGRES_DB:-campuscore_restful}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/child-tools.sh"
repo_root="$(cd "$script_dir/../.." && pwd)"
compose_file="${COMPOSE_FILE:-$repo_root/docker-compose.yml}"
archive_dir="$(cd "$(dirname "$archive")" && pwd)"
archive="$archive_dir/$(basename "$archive")"

[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid Compose project name.' >&2; exit 2; }
[[ "$db_user" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo 'Invalid PostgreSQL user name.' >&2; exit 2; }
[[ "$source_db" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo 'Invalid source database name.' >&2; exit 2; }
[[ "$archive" == *.dump && -f "$archive" ]] || { echo 'Backup archive does not exist or is not a .dump file.' >&2; exit 2; }
[[ "$target_db" =~ ^campuscore_restore_[a-zA-Z0-9_]+$ ]] || {
  echo 'Restore target must use the campuscore_restore_ namespace.' >&2
  exit 2
}
[[ "$target_db" != "$source_db" ]] || { echo 'Restore target must differ from the source database.' >&2; exit 2; }

reports_archive="${archive%.dump}.reports.tar"
reports_restore_dir="${archive%.dump}.reports.restore"
"$script_dir/verify-backup.sh" "$archive"
[[ ! -e "$reports_restore_dir" ]] || {
  echo 'The isolated report restore directory already exists; refusing to overwrite it.' >&2
  exit 2
}

target_exists="$(docker compose -p "$project" -f "$compose_file" exec -T postgres \
  psql --username "$db_user" --dbname "$source_db" --tuples-only --no-align \
  --command "SELECT 1 FROM pg_database WHERE datname = '$target_db'")"
[[ -z "$target_exists" ]] || { echo 'Restore target database already exists.' >&2; exit 2; }

reports_created=0
database_created=0
completed=0
cleanup() {
  local status=$?
  if (( completed == 0 )); then
    if (( database_created == 1 )); then
      if ! docker compose -p "$project" -f "$compose_file" exec -T postgres \
        psql --username "$db_user" --dbname "$source_db" \
        --command "DROP DATABASE \"$target_db\"" >/dev/null 2>&1; then
        echo 'Failed to remove the restore database created by this attempt.' >&2
      fi
    fi
    if (( reports_created == 1 )); then rm -rf -- "$reports_restore_dir"; fi
  fi
  exit "$status"
}
trap cleanup EXIT

mkdir -m 700 "$reports_restore_dir"
reports_created=1
(
  cd "$archive_dir"
  run_child_phase 'Thesis report archive extraction' tar -xf "./$(basename "$reports_archive")" -C "$reports_restore_dir"
)

docker compose -p "$project" -f "$compose_file" exec -T postgres \
  psql --username "$db_user" --dbname "$source_db" --command "CREATE DATABASE \"$target_db\""
database_created=1

run_child_phase 'Database restore' \
  docker compose -p "$project" -f "$compose_file" exec -T postgres \
  pg_restore --single-transaction --exit-on-error --no-owner --no-privileges \
  --username "$db_user" --dbname "$target_db" < "$archive"

completed=1
printf 'Restored database %s and thesis report files to isolated targets:\n  database: %s\n  reports: %s\n' \
  "$archive" "$target_db" "$reports_restore_dir"
printf 'Run Flyway/readiness checks against the isolated database before considering recovery complete.\n'
