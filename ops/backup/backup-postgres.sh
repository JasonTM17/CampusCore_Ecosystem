#!/usr/bin/env bash
set -euo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
project="${COMPOSE_PROJECT_NAME:?Set COMPOSE_PROJECT_NAME to the running local Compose project.}"
compose_file="${COMPOSE_FILE:-$repo_root/docker-compose.yml}"
backup_dir="${BACKUP_DIR:-$repo_root/ops/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
db_user="${POSTGRES_USER:-campuscore}"
db_name="${POSTGRES_DB:-campuscore_restful}"

[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid Compose project name.' >&2; exit 2; }
[[ "$backup_dir" != "/" && "$backup_dir" != "." && -n "$backup_dir" ]] || {
  echo 'Refusing an unsafe backup directory.' >&2
  exit 2
}
[[ "$retention_days" =~ ^[0-9]+$ ]] && (( retention_days > 0 )) || {
  echo 'BACKUP_RETENTION_DAYS must be a positive integer.' >&2
  exit 2
}
mkdir -p "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$backup_dir/campuscore-${timestamp}.dump"
reports_archive="$backup_dir/campuscore-${timestamp}.reports.tar"
checksum="$archive.sha256"
claim="$backup_dir/.campuscore-${timestamp}.claim"
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
    rm -f -- "$archive" "$reports_archive" "$checksum"
  fi
  if [[ -n "$staging" ]]; then rm -rf -- "$staging"; fi
  rmdir -- "$claim" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

if [[ -e "$archive" || -e "$reports_archive" || -e "$checksum" ]]; then
  echo 'Backup output already exists; refusing to overwrite it.' >&2
  exit 1
fi
owns_outputs=1
staging="$(mktemp -d "$backup_dir/.campuscore-${timestamp}.XXXXXX")"
staged_archive="$staging/$(basename "$archive")"
staged_reports="$staging/$(basename "$reports_archive")"
staged_checksum="$staging/$(basename "$checksum")"

docker compose -p "$project" -f "$compose_file" exec -T postgres \
  pg_dump --format=custom --no-owner --no-privileges --username "$db_user" --dbname "$db_name" > "$staged_archive"

docker compose -p "$project" -f "$compose_file" exec -T restful-api sh -ceu \
  'test "${THESIS_REPORT_STORAGE_PROVIDER:-local}" = local && test -n "${THESIS_REPORT_STORAGE_LOCAL_ROOT:-}" && exec tar -C "$THESIS_REPORT_STORAGE_LOCAL_ROOT" -cf - .' > "$staged_reports"

toc="$(docker compose -p "$project" -f "$compose_file" exec -T postgres pg_restore --list < "$staged_archive")"
if ! grep -Eq 'TABLE DATA[[:space:]]+thesis[[:space:]]+flyway_schema_history([[:space:]]|$)' <<< "$toc"; then
  echo 'Backup archive does not contain the application Flyway history table.' >&2
  exit 1
fi

docker compose -p "$project" -f "$compose_file" exec -T restful-api tar -tf - < "$staged_reports" >/dev/null

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$staging" && sha256sum "$(basename "$staged_archive")" "$(basename "$staged_reports")") > "$staged_checksum"
else
  (cd "$staging" && shasum -a 256 "$(basename "$staged_archive")" "$(basename "$staged_reports")") > "$staged_checksum"
fi

mv -- "$staged_reports" "$reports_archive"
mv -- "$staged_checksum" "$checksum"
mv -- "$staged_archive" "$archive"
completed=1

find "$backup_dir" -maxdepth 1 -type f \
  \( -name 'campuscore-*.dump' -o -name 'campuscore-*.dump.sha256' -o -name 'campuscore-*.reports.tar' \) \
  -mtime "+$retention_days" -print -delete
printf 'Backup written: %s\nReport volume archive: %s\nChecksum: %s\n' "$archive" "$reports_archive" "$checksum"
