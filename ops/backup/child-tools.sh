#!/usr/bin/env bash

run_child_phase() {
  local phase="$1"
  shift

  local previous_umask
  previous_umask="$(umask)"
  umask 077
  local stderr_file
  local temp_status=0
  if stderr_file="$(mktemp "${TMPDIR:-/tmp}/campuscore-backup-stderr.XXXXXX")"; then
    :
  else
    temp_status=$?
  fi
  umask "$previous_umask"
  if (( temp_status != 0 )); then
    return "$temp_status"
  fi
  chmod 600 "$stderr_file"

  local status=0
  if "$@" 2>"$stderr_file"; then
    status=0
  else
    status=$?
    printf '%s failed (exit code %s).\n' "$phase" "$status" >&2
  fi

  if [[ "${VERBOSE:-}" == 1 && -s "$stderr_file" ]]; then
    cat "$stderr_file" >&2
    printf 'Verbose diagnostics retained in temporary file %s\n' "${stderr_file##*/}" >&2
  else
    rm -f -- "$stderr_file"
  fi
  return "$status"
}
