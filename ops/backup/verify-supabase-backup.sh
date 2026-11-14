#!/usr/bin/env bash
# Verify a campuscore-supabase-<timestamp> bundle offline: checksum sidecar
# shape, digest match, and TOC sanity. Runs entirely on local pg_restore —
# no Compose stack, no network.
set -euo pipefail

archive="${1:?Usage: verify-supabase-backup.sh <archive.dump>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/child-tools.sh"

command -v pg_restore >/dev/null 2>&1 || { echo 'pg_restore is required on PATH.' >&2; exit 2; }
[[ "$archive" == *.dump ]] || { echo 'Backup archive must end in .dump.' >&2; exit 2; }
[[ -f "$archive" ]] || { echo 'Backup archive does not exist.' >&2; exit 2; }
checksum="$archive.sha256"
[[ -f "$checksum" ]] || { echo 'Backup checksum sidecar is missing.' >&2; exit 2; }

archive_name="$(basename "$archive")"
checksum_lines=0
archive_records=0
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
    *) invalid_checksum_records=1;;
  esac
done < "$checksum"
if [[ "$checksum_lines" -ne 1 \
  || "$archive_records" -ne 1 \
  || "$invalid_checksum_records" -ne 0 ]]; then
  echo 'Backup checksum sidecar must cover exactly the database archive.' >&2
  exit 2
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$archive")" && sha256sum --check "$(basename "$checksum")")
else
  (cd "$(dirname "$archive")" && shasum -a 256 --check "$(basename "$checksum")")
fi

toc="$(run_child_phase 'Database archive inspection' pg_restore --list "$archive")"
if ! grep -Eq 'TABLE DATA[[:space:]]+thesis[[:space:]]+flyway_schema_history([[:space:]]|$)' <<< "$toc"; then
  echo 'Backup archive does not contain the application Flyway history table.' >&2
  exit 1
fi

printf 'Checksum and application contents verified: %s\n' "$archive"
