#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Usage: verify-backup.sh <custom-archive.dump>}"
project="${COMPOSE_PROJECT_NAME:?Set COMPOSE_PROJECT_NAME to the running local Compose project.}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
compose_file="${COMPOSE_FILE:-$repo_root/docker-compose.yml}"

[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid Compose project name.' >&2; exit 2; }
[[ "$archive" == *.dump ]] || { echo 'Backup archive must end in .dump.' >&2; exit 2; }
[[ -f "$archive" ]] || { echo 'Backup archive does not exist.' >&2; exit 2; }
reports_archive="${archive%.dump}.reports.tar"
[[ -f "$reports_archive" ]] || { echo 'Thesis report volume archive is missing.' >&2; exit 2; }
checksum="$archive.sha256"
[[ -f "$checksum" ]] || { echo 'Backup checksum sidecar is missing.' >&2; exit 2; }

archive_name="$(basename "$archive")"
reports_name="$(basename "$reports_archive")"
if ! grep -Eq "^[[:xdigit:]]{64}  ${archive_name}$" "$checksum" \
  || ! grep -Eq "^[[:xdigit:]]{64}  ${reports_name}$" "$checksum" \
  || [[ "$(wc -l < "$checksum")" -ne 2 ]]; then
  echo 'Backup checksum sidecar must cover exactly the database and report archives.' >&2
  exit 2
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$archive")" && sha256sum --check "$(basename "$checksum")")
else
  (cd "$(dirname "$archive")" && shasum -a 256 --check "$(basename "$checksum")")
fi

toc="$(docker compose -p "$project" -f "$compose_file" exec -T postgres pg_restore --list < "$archive")"
if ! grep -Eq 'TABLE DATA[[:space:]]+thesis[[:space:]]+flyway_schema_history([[:space:]]|$)' <<< "$toc"; then
  echo 'Backup archive does not contain the application Flyway history table.' >&2
  exit 1
fi

report_entries="$(docker compose -p "$project" -f "$compose_file" exec -T restful-api tar -tf - < "$reports_archive")"
if grep -Eq '(^/|^[A-Za-z]:|(^|/)\.\.(/|$))' <<< "$report_entries"; then
  echo 'Thesis report archive contains an unsafe path.' >&2
  exit 1
fi
printf 'Checksum and application contents verified: %s\n' "$archive"
