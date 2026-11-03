#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Usage: verify-backup.sh <custom-archive.dump>}"
project="${COMPOSE_PROJECT_NAME:?Set COMPOSE_PROJECT_NAME to the running local Compose project.}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/child-tools.sh"
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
checksum_lines=0
archive_records=0
reports_records=0
invalid_checksum_records=0
while IFS= read -r checksum_line || [[ -n "$checksum_line" ]]; do
  checksum_lines=$((checksum_lines + 1))
  digest="${checksum_line%%  *}"
  if [[ "$checksum_line" != "$digest  "* || ! "$digest" =~ ^[[:xdigit:]]{64}$ ]]; then
    invalid_checksum_records=1
    continue
  fi
  filename="${checksum_line#"$digest  "}"
  case "$filename" in
    "$archive_name") archive_records=$((archive_records + 1));;
    "$reports_name") reports_records=$((reports_records + 1));;
    *) invalid_checksum_records=1;;
  esac
done < "$checksum"
if [[ "$checksum_lines" -ne 2 \
  || "$archive_records" -ne 1 \
  || "$reports_records" -ne 1 \
  || "$invalid_checksum_records" -ne 0 ]]; then
  echo 'Backup checksum sidecar must cover exactly the database and report archives.' >&2
  exit 2
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$archive")" && sha256sum --check "$(basename "$checksum")")
else
  (cd "$(dirname "$archive")" && shasum -a 256 --check "$(basename "$checksum")")
fi

toc="$(run_child_phase 'Database archive inspection' \
  docker compose -p "$project" -f "$compose_file" exec -T postgres pg_restore --list < "$archive")"
if ! grep -Eq 'TABLE DATA[[:space:]]+thesis[[:space:]]+flyway_schema_history([[:space:]]|$)' <<< "$toc"; then
  echo 'Backup archive does not contain the application Flyway history table.' >&2
  exit 1
fi

report_entries="$(run_sensitive_child_phase 'Thesis report archive listing' \
  docker compose -p "$project" -f "$compose_file" exec -T restful-api tar -tf - < "$reports_archive")"
if grep -Eq '(^/|^[A-Za-z]:|(^|/)\.\.(/|$))' <<< "$report_entries"; then
  echo 'Thesis report archive contains an unsafe path.' >&2
  exit 1
fi
report_types="$(run_sensitive_child_phase 'Thesis report archive type inspection' \
  docker compose -p "$project" -f "$compose_file" exec -T restful-api tar -tvf - < "$reports_archive")"
unsafe_member_type=0
while IFS= read -r member_listing || [[ -n "$member_listing" ]]; do
  case "${member_listing:0:1}" in
    -|d) ;;
    *) unsafe_member_type=1; break;;
  esac
done <<< "$report_types"
if [[ "$unsafe_member_type" -ne 0 ]]; then
  echo 'Thesis report archive contains an unsafe member type.' >&2
  exit 1
fi

if reconcile_report_archive "$archive" "$reports_archive" "$project" "$compose_file" "$toc"; then
  :
else
  reconcile_status=$?
  if (( reconcile_status == 1 )); then
    printf 'Report archive is missing %s referenced storage key(s).\n' \
      "$REPORT_RECONCILE_MISSING_COUNT" >&2
    exit 1
  fi
  exit "$reconcile_status"
fi

printf 'Checksum and application contents verified: %s\n' "$archive"
