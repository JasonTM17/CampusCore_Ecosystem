#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Usage: verify-backup.sh <custom-archive.dump>}"
[[ -f "$archive" ]] || { echo 'Backup archive does not exist.' >&2; exit 2; }
checksum="$archive.sha256"
[[ -f "$checksum" ]] || { echo 'Backup checksum sidecar is missing.' >&2; exit 2; }
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$archive")" && sha256sum --check "$(basename "$checksum")")
else
  (cd "$(dirname "$archive")" && shasum -a 256 --check "$(basename "$checksum")")
fi
printf 'Checksum verified: %s\n' "$archive"
