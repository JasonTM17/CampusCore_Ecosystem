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

run_sensitive_child_phase() {
  local VERBOSE=0
  run_child_phase "$@"
}

reconcile_report_archive() {
  local archive="$1"
  local reports_archive="$2"
  local project="$3"
  local compose_file="$4"
  local toc="$5"
  local previous_umask
  local work_dir
  local missing_count
  local nonlocal_count

  REPORT_RECONCILE_MISSING_COUNT=0
  if ! grep -Eq 'TABLE[[:space:]]+thesis[[:space:]]+thesis_group_report([[:space:]]|$)' <<< "$toc"; then
    echo 'Database archive does not contain the thesis report table.' >&2
    return 2
  fi
  if ! grep -Eq 'TABLE DATA[[:space:]]+thesis[[:space:]]+thesis_group_report([[:space:]]|$)' <<< "$toc"; then
    echo 'Database archive does not contain thesis report table data.' >&2
    return 2
  fi

  previous_umask="$(umask)"
  umask 077
  if work_dir="$(mktemp -d "${TMPDIR:-/tmp}/campuscore-report-reconcile.XXXXXX")"; then
    :
  else
    umask "$previous_umask"
    echo 'Could not prepare report archive reconciliation.' >&2
    return 2
  fi
  umask "$previous_umask"

  local references="$work_dir/references"
  local nonlocal_references="$work_dir/nonlocal-references"
  local sorted_references="$work_dir/sorted-references"
  local sorted_members="$work_dir/sorted-members"
  local sorted_nonlocal="$work_dir/sorted-nonlocal"
  local missing="$work_dir/missing"
  : > "$references"
  : > "$nonlocal_references"

  if run_sensitive_child_phase 'Database report-reference extraction' \
    docker compose -p "$project" -f "$compose_file" exec -T postgres \
    pg_restore --data-only --strict-names --schema=thesis --table=thesis_group_report < "$archive" |
    awk -F '\t' -v references="$references" -v nonlocal_references="$nonlocal_references" '
      /^COPY thesis[.]thesis_group_report[[:space:]]+[(]/ {
        columns = $0
        sub(/^COPY thesis[.]thesis_group_report[[:space:]]+[(]/, "", columns)
        sub(/[)][[:space:]]+FROM stdin;$/, "", columns)
        count = split(columns, names, /,[[:space:]]*/)
        provider_column = 0
        key_column = 0
        for (i = 1; i <= count; i++) {
          gsub(/^"|"$/, "", names[i])
          if (names[i] == "storage_provider") provider_column = i
          if (names[i] == "storage_key") key_column = i
        }
        if (provider_column == 0 || key_column == 0) invalid = 1
        in_copy = 1
        found = 1
        next
      }
      in_copy {
        if ($0 == "\\.") {
          in_copy = 0
          next
        }
        field_count = split($0, fields, "\t")
        if (field_count < provider_column || field_count < key_column) {
          invalid = 1
          next
        }
        key = fields[key_column]
        provider = fields[provider_column]
        if (key == "\\N") next
        if (provider == "local") print key >> references
        else print key >> nonlocal_references
      }
      END {
        if (!found || invalid || in_copy) exit 2
      }
    '; then
    :
  else
    rm -rf -- "$work_dir"
    echo 'Could not inspect report references in the database archive.' >&2
    return 2
  fi

  if run_sensitive_child_phase 'Thesis report archive listing' \
    docker compose -p "$project" -f "$compose_file" exec -T restful-api tar -tf - \
    < "$reports_archive" > "$work_dir/archive-members"; then
    :
  else
    rm -rf -- "$work_dir"
    return 2
  fi

  if ! LC_ALL=C sort -u "$references" > "$sorted_references" \
    || ! awk '
      {
        member = $0
        sub(/^\.\//, "", member)
        if (member != "" && member != ".") print member
      }
    ' "$work_dir/archive-members" | LC_ALL=C sort -u > "$sorted_members" \
    || ! LC_ALL=C sort -u "$nonlocal_references" > "$sorted_nonlocal"; then
    rm -rf -- "$work_dir"
    echo 'Could not compare report archive members.' >&2
    return 2
  fi

  if ! comm -23 "$sorted_references" "$sorted_members" > "$missing"; then
    rm -rf -- "$work_dir"
    echo 'Could not compare report archive members.' >&2
    return 2
  fi

  missing_count="$(awk 'END { print NR + 0 }' "$missing")"
  nonlocal_count="$(awk 'END { print NR + 0 }' "$sorted_nonlocal")"
  REPORT_RECONCILE_MISSING_COUNT=$((missing_count + nonlocal_count))
  rm -rf -- "$work_dir"
  if (( REPORT_RECONCILE_MISSING_COUNT > 0 )); then
    return 1
  fi
  return 0
}
