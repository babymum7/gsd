#!/usr/bin/env bash
# Install GSD: deploy the automatic OMP context extension.
# Registers no command and no skills; removes supported legacy registrations
# only after the extension has been published successfully.
set -euo pipefail

# Keep pwd's terminator behind a sentinel so path-ending CR/LF survives validation.
REPO_WITH_SENTINEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P && printf "x")"
REPO="${REPO_WITH_SENTINEL%??}"

OMP_DIR="${HOME}/.omp"
OMP_AGENT_DIR="${OMP_DIR}/agent"
OMP_COMMANDS_DIR="${OMP_AGENT_DIR}/commands"
OMP_TARGET="${OMP_COMMANDS_DIR}/gsd.md"
OMP_EXTENSIONS_DIR="${OMP_AGENT_DIR}/extensions"
EXT_TARGET="${OMP_EXTENSIONS_DIR}/gsd-context.js"
EXT_SOURCE="${REPO}/extensions/gsd-context.js"

OMP_AGENTS_DIR="${OMP_AGENT_DIR}/agents"
LEGACY_EXEC_TARGET="${OMP_AGENTS_DIR}/gsd-executor.md"
LEGACY_EXEC_SOURCE="${REPO}/agents/gsd-executor.md"
LEGACY_REVIEW_TARGET="${OMP_AGENTS_DIR}/gsd-reviewer.md"
LEGACY_REVIEW_SOURCE="${REPO}/agents/gsd-reviewer.md"
# Global variables for cleanup and restoration
CLEANUP_TMP_SYMLINK=""
CLEANUP_BACKUP_TARGET=""
CLEANUP_QUARANTINE_TARGET=""
RESTORE_TARGET=""
RESTORE_EXPECTED_SOURCE=""
RESTORE_BACKUP_TARGET=""
APPROVED_BACKUP_LINK_TARGET=""
APPROVED_BACKUP_INODE=""
LEGACY_EXEC_ACTION="none"
LEGACY_EXEC_LINK_TARGET=""
LEGACY_REVIEW_ACTION="none"
LEGACY_REVIEW_LINK_TARGET=""
read_link_exact() {
  local link_path="$1"
  local var_name="$2"
  if [[ "$link_path" == -* ]]; then
    link_path="./$link_path"
  fi
  local target_sentinel
  if target_sentinel="$(readlink -n "$link_path" && printf "x")"; then
    printf -v "$var_name" "%s" "${target_sentinel%x}"
    return 0
  else
    return 1
  fi
}

is_owned_path() {
  local check_path="$1"
  if [ -z "$check_path" ]; then
    return 1
  fi
  if [ ! -L "$check_path" ]; then
    return 1
  fi
  local link_tgt="" inode=""
  if ! read_link_exact "$check_path" link_tgt; then
    return 1
  fi
  read -r inode _ < <(ls -di -- "$check_path" 2>/dev/null) || true
  if [ -n "${APPROVED_BACKUP_INODE:-}" ] && [ "$inode" = "$APPROVED_BACKUP_INODE" ] && \
     [ -n "${APPROVED_BACKUP_LINK_TARGET:-}" ] && [ "$link_tgt" = "$APPROVED_BACKUP_LINK_TARGET" ]; then
    return 0
  else
    return 1
  fi
}

process_owned_backup() {
  local path="$1"
  local action="$2"
  local restore_target="${3:-}"

  # Make EXIT/signal cleanup publication-aware:
  if [ "$action" = "restore" ] && [ -n "$restore_target" ]; then
    local is_committed=0
    local current_tgt=""
    local expected_source="${4:-${RESTORE_EXPECTED_SOURCE:-}}"
    if read_link_exact "$restore_target" current_tgt; then
      if [ -n "$expected_source" ] && [ "$current_tgt" = "$expected_source" ]; then
        is_committed=1
      fi
    fi

    if [ "$is_committed" -eq 1 ]; then
      # Treat publication as committed and guarded-delete the proven approved old backup/quarantine
      action="delete"
      restore_target=""
    else
      # Restore only when target is absent. Any differing target remains untouched.
      if [ -e "$restore_target" ] || [ -L "$restore_target" ]; then
        # Target is present but differs. Touched nothing.
        # If the backup/quarantine is proven owned, switch it to delete action:
        local has_owned_backup=0
        if is_owned_path "$path"; then
          has_owned_backup=1
        elif [ -n "${CLEANUP_QUARANTINE_TARGET:-}" ] && is_owned_path "${CLEANUP_QUARANTINE_TARGET:-}"; then
          has_owned_backup=1
        fi

        if [ "$has_owned_backup" -eq 1 ]; then
          action="delete"
          restore_target=""
        else
          # Target is present but differs. Touched nothing.
          # Fail and preserve backup/quarantine.
          printf "error: differing target remains untouched, backup/quarantine preserved\n" >&2
          return 1
        fi
      fi
    fi
  fi
  if [ -z "${path}" ]; then
    return 0
  fi

  local active_path=""
  local quarantine_path="${CLEANUP_QUARANTINE_TARGET:-}"

  if is_owned_path "$path"; then
    active_path="$path"
  elif [ -n "$quarantine_path" ] && is_owned_path "$quarantine_path"; then
    active_path="$quarantine_path"
  fi

  if [ -z "$active_path" ]; then
    if [ "$action" = "restore" ] && [ -n "$restore_target" ]; then
      if is_owned_path "$restore_target"; then
        CLEANUP_QUARANTINE_TARGET=""
        return 0
      else
        return 1
      fi
    elif [ "$action" = "delete" ]; then
      if [ ! -e "$path" ] && [ ! -L "$path" ] && \
         { [ -z "$quarantine_path" ] || { [ ! -e "$quarantine_path" ] && [ ! -L "$quarantine_path" ]; }; }; then
        CLEANUP_QUARANTINE_TARGET=""
        return 0
      else
        printf "error: backup mismatch preserved\n" >&2
        return 1
      fi
    else
      return 1
    fi
  fi

  if [ "$active_path" = "$path" ]; then
    if [ -n "$quarantine_path" ] && { [ -e "$quarantine_path" ] || [ -L "$quarantine_path" ]; }; then
      if ! is_owned_path "$quarantine_path"; then
        # If it contains an unowned object, preserve it and choose a new unique unused same-directory quarantine.
        quarantine_path=$(mktemp "${path}.quarantine.XXXXXX")
      fi
    elif [ -z "$quarantine_path" ]; then
      quarantine_path=$(mktemp "${path}.quarantine.XXXXXX")
    fi

    local q_path_arg="$quarantine_path"
    if [[ "$q_path_arg" == -* ]]; then
      q_path_arg="./$q_path_arg"
    fi
    local path_arg="$path"
    if [[ "$path_arg" == -* ]]; then
      path_arg="./$path_arg"
    fi

    rm -f "$q_path_arg" 2>/dev/null || true
    CLEANUP_QUARANTINE_TARGET="$quarantine_path"

    # Deterministic test seam between initial backup validation and quarantine
    if [ -n "${GSD_TEST_SEAM_PRE_QUARANTINE:-}" ]; then
      if [ "$GSD_TEST_SEAM_PRE_QUARANTINE" = "regular" ]; then
        rm -f "$path" 2>/dev/null || true
        echo "raced content pre-quarantine" > "$path"
      elif [ "$GSD_TEST_SEAM_PRE_QUARANTINE" = "symlink" ]; then
        rm -f "$path" 2>/dev/null || true
        ln -s "/some/other/quarantine/path" "$path"
      elif [ "$GSD_TEST_SEAM_PRE_QUARANTINE" = "quarantine_collision" ]; then
        # Place an unowned object at the quarantine path
        echo "unowned quarantine collision" > "$quarantine_path"
      fi
    fi

    if is_owned_path "$path"; then
      mv -n -T "$path_arg" "$q_path_arg" 2>/dev/null || true
    fi

    # Deterministic test seam after quarantine move
    if [ -n "${GSD_TEST_SEAM_POST_QUARANTINE_MOVE:-}" ]; then
      if [ "$GSD_TEST_SEAM_POST_QUARANTINE_MOVE" = "recreate_source" ]; then
        rm -f "$path" 2>/dev/null || true
        echo "recreated source content" > "$path"
      elif [ "$GSD_TEST_SEAM_POST_QUARANTINE_MOVE" = "sigterm" ]; then
        kill -TERM $$
      fi
    fi
  fi

  local q_path_arg="$quarantine_path"
  if [[ "$q_path_arg" == -* ]]; then
    q_path_arg="./$q_path_arg"
  fi

  # Deterministic test seam between quarantine revalidation and delete/restore
  if [ -n "${GSD_TEST_SEAM_POST_QUARANTINE_REVALIDATE:-}" ]; then
    if [ "$GSD_TEST_SEAM_POST_QUARANTINE_REVALIDATE" = "replace_quarantine" ]; then
      rm -f "$q_path_arg" 2>/dev/null || true
      echo "unowned quarantine replacement" > "$quarantine_path"
    fi
  fi

  local is_q_owned=0
  if is_owned_path "$quarantine_path"; then
    is_q_owned=1
  fi

  if [ "$is_q_owned" -eq 1 ]; then
    if [ "$action" = "restore" ] && [ -n "$restore_target" ]; then
      local restore_target_arg="$restore_target"
      if [[ "$restore_target_arg" == -* ]]; then
        restore_target_arg="./$restore_target_arg"
      fi

      if [ ! -e "$restore_target" ] && [ ! -L "$restore_target" ]; then
        mv -n -T "$q_path_arg" "$restore_target_arg" 2>/dev/null || true
      fi

      if [ -e "$quarantine_path" ] || [ -L "$quarantine_path" ]; then
        if [ ! -e "$path" ] && [ ! -L "$path" ]; then
          mv -n -T "$q_path_arg" "$path_arg" 2>/dev/null || true
        fi
        printf "error: restoration skipped, backup preserved\n" >&2
        return 1
      fi

      if is_owned_path "$restore_target"; then
        CLEANUP_QUARANTINE_TARGET=""
        return 0
      else
        printf "error: restored target identity mismatch\n" >&2
        return 1
      fi
    else
      rm -f "$q_path_arg" 2>/dev/null || true
      if [ ! -e "$quarantine_path" ] && [ ! -L "$quarantine_path" ]; then
        CLEANUP_QUARANTINE_TARGET=""
        return 0
      else
        return 1
      fi
    fi
  else
    printf "error: backup mismatch preserved\n" >&2
    return 1
  fi
}
rm_owned_backup() {
  process_owned_backup "$1" "delete"
}

cleanup_trap() {
  # Disable test seams during cleanup
  GSD_TEST_SEAM_PRE_RELOCATE=""
  GSD_TEST_SEAM_PRE_QUARANTINE=""
  GSD_TEST_SEAM_POST_QUARANTINE_MOVE=""
  GSD_TEST_SEAM_POST_QUARANTINE_REVALIDATE=""
  GSD_TEST_SEAM_POST_CLASSIFY=""
  GSD_TEST_SEAM_BACKUP_PUBLISH=""
  GSD_TEST_SEAM_POST_BACKUP_MOVE=""
  GSD_TEST_SEAM_MAKE_REFERENT_LIVE=""
  GSD_TEST_SEAM_RACE=""
  GSD_TEST_SEAM_POST_RM_TMP_SYMLINK=""
  GSD_TEST_SEAM_POST_PUBLISH=""

  # If publication failed, restore the backup target if one exists
  if [ -n "${RESTORE_TARGET:-}" ] && [ -n "${RESTORE_BACKUP_TARGET:-}" ]; then
    if [ -n "${APPROVED_BACKUP_LINK_TARGET:-}" ] && [ -n "${APPROVED_BACKUP_INODE:-}" ]; then
      if process_owned_backup "${RESTORE_BACKUP_TARGET}" "restore" "${RESTORE_TARGET}"; then
        RESTORE_TARGET=""
        RESTORE_EXPECTED_SOURCE=""
        RESTORE_BACKUP_TARGET=""
        APPROVED_BACKUP_LINK_TARGET=""
        APPROVED_BACKUP_INODE=""
        CLEANUP_BACKUP_TARGET=""
        CLEANUP_QUARANTINE_TARGET=""
      fi
    fi
  fi
  # Clean up temporary files/symlinks
  if [ -n "${CLEANUP_TMP_SYMLINK:-}" ]; then
    rm -f "${CLEANUP_TMP_SYMLINK}" 2>/dev/null || true
  fi
  if [ -n "${CLEANUP_BACKUP_TARGET:-}" ] && [ -z "${RESTORE_TARGET:-}" ]; then
    if process_owned_backup "${CLEANUP_BACKUP_TARGET}" "delete"; then
      CLEANUP_BACKUP_TARGET=""
      CLEANUP_QUARANTINE_TARGET=""
    fi
  fi
  if [ -n "${RESTORE_BACKUP_TARGET:-}" ] && [ -z "${RESTORE_TARGET:-}" ]; then
    if process_owned_backup "${RESTORE_BACKUP_TARGET}" "delete"; then
      RESTORE_BACKUP_TARGET=""
      CLEANUP_QUARANTINE_TARGET=""
    fi
  fi
}

trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 131' QUIT
trap 'exit 143' TERM
trap cleanup_trap EXIT
remove_legacy_managed_command() {
  local target="$1"
  local repo="$2"

  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    return 0
  fi
  if [ -L "$target" ]; then
    printf "  warn: preserving legacy command %s: target is a symlink.\n" "$target" >&2
    return 1
  fi
  if [ ! -f "$target" ]; then
    printf "  warn: preserving legacy command %s: target is not a regular file.\n" "$target" >&2
    return 1
  fi

  local orig_size clean_size
  orig_size=$(wc -c < "$target")
  clean_size=$(tr -d '\000' < "$target" | wc -c)
  if [ "$orig_size" -ne "$clean_size" ]; then
    printf "  warn: preserving legacy command %s: file contains NUL bytes.\n" "$target" >&2
    return 1
  fi

  local marker_in_header=0
  local total_markers=0
  local root_count=0
  local root_line=""
  local line_no=0
  local has_cr=0
  local malformed_canonical=0
  local has_unsupported_version=0
  local line clean_line marker_ver

  while IFS= read -r line || [ -n "$line" ]; do
    line_no=$((line_no + 1))
    if [[ "$line" == *$'\r'* ]]; then
      has_cr=1
    fi
    clean_line="${line%$'\r'}"

    if [[ "$clean_line" =~ ^"<!-- gsd-managed-command:"(.*)" -->"$ ]]; then
      marker_ver="${BASH_REMATCH[1]}"
      total_markers=$((total_markers + 1))
      if [ "$line_no" -le 10 ]; then
        marker_in_header=$((marker_in_header + 1))
      fi
      if [ "$marker_ver" != "v1" ]; then
        has_unsupported_version=1
      fi
    fi
    if [[ "$clean_line" =~ ^GSD_ROOT= ]]; then
      if [[ "$clean_line" =~ ^GSD_ROOT=\"(.*)\"$ ]]; then
        root_count=$((root_count + 1))
        root_line="${BASH_REMATCH[1]}"
      else
        malformed_canonical=1
      fi
    fi
  done < "$target"

  if [ "$total_markers" -eq 0 ]; then
    printf "  warn: preserving legacy command %s: file is not managed by GSD.\n" "$target" >&2
    return 1
  fi
  if [ "$marker_in_header" -ne 1 ] || [ "$total_markers" -ne 1 ]; then
    printf "  warn: preserving legacy command %s: managed marker is malformed or duplicated.\n" "$target" >&2
    return 1
  fi
  if [ "$has_unsupported_version" -ne 0 ]; then
    printf "  warn: preserving legacy command %s: managed version is unsupported.\n" "$target" >&2
    return 1
  fi
  if [ "$root_count" -ne 1 ] || [ "$malformed_canonical" -ne 0 ]; then
    printf "  warn: preserving legacy command %s: GSD_ROOT is missing, duplicated, or malformed.\n" "$target" >&2
    return 1
  fi
  if [ "$has_cr" -ne 0 ]; then
    printf "  warn: preserving legacy command %s: file contains carriage returns.\n" "$target" >&2
    return 1
  fi

  local decoded=""
  local i=0
  local len=${#root_line}
  local char next_char
  while [ "$i" -lt "$len" ]; do
    char="${root_line:$i:1}"
    if [ "$char" = "\\" ]; then
      i=$((i + 1))
      if [ "$i" -ge "$len" ]; then
        printf "  warn: preserving legacy command %s: GSD_ROOT has a trailing escape.\n" "$target" >&2
        return 1
      fi
      next_char="${root_line:$i:1}"
      if [ "$next_char" = "\\" ]; then
        decoded="${decoded}\\"
      elif [ "$next_char" = "\"" ]; then
        decoded="${decoded}\""
      else
        printf "  warn: preserving legacy command %s: GSD_ROOT has an unsupported escape.\n" "$target" >&2
        return 1
      fi
    elif [ "$char" = "\"" ]; then
      printf "  warn: preserving legacy command %s: GSD_ROOT has an unescaped quote.\n" "$target" >&2
      return 1
    else
      decoded="${decoded}${char}"
    fi
    i=$((i + 1))
  done

  if [[ "$decoded" != /* ]]; then
    printf "  warn: preserving legacy command %s: GSD_ROOT is not absolute.\n" "$target" >&2
    return 1
  fi
  if [ "$decoded" != "$repo" ] && [ -d "$decoded" ]; then
    printf "  warn: preserving legacy command %s: it belongs to live checkout %s.\n" "$target" "$decoded" >&2
    return 1
  fi

  local target_arg="$target"
  if [[ "$target_arg" == -* ]]; then
    target_arg="./$target_arg"
  fi
  if rm -f -- "$target_arg"; then
    printf "  removed legacy OMP command: %s\n" "$target"
    return 0
  fi
  printf "  warn: could not remove legacy command %s; preserving it.\n" "$target" >&2
  return 1
}

preflight_legacy_agent_target() {
  local target="$1"
  local source="$2"
  local file_name="$3"
  local label="$4"
  local action_var="$5"
  local link_var="$6"
  printf -v "$action_var" "%s" "none"
  printf -v "$link_var" "%s" ""

  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    return 0
  fi
  if [ ! -L "$target" ]; then
    printf "error: unmanaged collision: legacy %s target %s is not a symlink; move or remove it.\n" "$label" "$target" >&2
    return 1
  fi

  local link_target=""
  if ! read_link_exact "$target" link_target; then
    printf "error: unmanaged collision: legacy %s target %s cannot be read; move or remove it.\n" "$label" "$target" >&2
    return 1
  fi
  if [[ "$link_target" == *$'\n'* || "$link_target" == *$'\r'* ]]; then
    printf "error: unmanaged collision: legacy %s target %s has an invalid link value; move or remove it.\n" "$label" "$target" >&2
    return 1
  fi

  if [ "$link_target" = "$source" ] \
    || { [[ "$link_target" == /* ]] \
      && [[ "${link_target%/*}" == */agents ]] \
      && [ "${link_target##*/}" = "$file_name" ] \
      && [ ! -e "$target" ]; }; then
    printf -v "$action_var" "%s" "remove"
    printf -v "$link_var" "%s" "$link_target"
    return 0
  fi

  printf "error: unmanaged collision: legacy %s target %s points to foreign or live source %s; move or remove it.\n" "$label" "$target" "$link_target" >&2
  return 1
}

remove_preflighted_legacy_agent() {
  local target="$1"
  local label="$2"
  local action_var="$3"
  local link_var="$4"
  [ "${!action_var}" = "remove" ] || return 0

  local link_target=""
  if [ ! -L "$target" ] \
    || ! read_link_exact "$target" link_target \
    || [ "$link_target" != "${!link_var}" ]; then
    printf "error: legacy %s target %s changed after preflight; preserving it.\n" "$label" "$target" >&2
    return 1
  fi

  local target_arg="$target"
  if [[ "$target_arg" == -* ]]; then
    target_arg="./$target_arg"
  fi
  if ! rm -f -- "$target_arg"; then
    printf "error: could not remove managed legacy %s target %s.\n" "$label" "$target" >&2
    return 1
  fi
  printf "  removed legacy OMP %s agent: %s\n" "$label" "$target"
}

preflight_managed_target() {
  local target="$1"
  local ext_source="$2"
  local suffix="$3"
  local shape_pattern="$4"

  if [[ "$ext_source" == *$'\n'* || "$ext_source" == *$'\r'* ]]; then
    echo "error: repository root cannot contain carriage return or newline characters." >&2
    return 1
  fi
  if [ -L "$ext_source" ] || [ ! -f "$ext_source" ]; then
    printf "error: extension source %s is missing or is not a regular file.\n" "$ext_source" >&2
    return 1
  fi

  if [ -e "$target" ] || [ -L "$target" ]; then
    eval "PREFLIGHT_${suffix}_EXISTS=1"
    if [ -L "$target" ]; then
      local link_target=""
      if read_link_exact "$target" link_target; then
        eval "PREFLIGHT_${suffix}_LINK_TARGET=\"\$link_target\""
        if [ "$link_target" = "$ext_source" ]; then
          # Same exact source is okay
          return 0
        fi

        # Determine if it's relocatable:
        # - Must be absolute: [[ "$link_target" == /* ]]
        # - Must match shape: [[ "$link_target" == $shape_pattern ]]
        # - Must be dangling: [ ! -e "$target" ]
        if [[ "$link_target" == /* ]] && [[ "$link_target" == $shape_pattern ]] && [ ! -e "$target" ]; then
          return 0
        else
          printf "error: unmanaged collision: %s already exists and points to another source %s; move or remove it.\n" "$target" "$link_target" >&2
          return 1
        fi
      else
        printf "error: unmanaged collision: %s already exists and target cannot be read; move or remove it.\n" "$target" >&2
        return 1
      fi
    else
      # Regular file, directory, or special file (not a symlink)
      printf "error: unmanaged collision: %s already exists and is not a symlink; move or remove it.\n" "$target" >&2
      return 1
    fi
  else
    eval "PREFLIGHT_${suffix}_EXISTS=0"
    eval "PREFLIGHT_${suffix}_LINK_TARGET=\"\""
  fi
  return 0
}


sync_managed_target() {
  local target="$1"
  local ext_source="$2"
  local suffix="$3"
  local shape_pattern="$4"
  local is_stale=0
  local backup_target=""

  local preflight_exists=0
  eval "preflight_exists=\${PREFLIGHT_${suffix}_EXISTS:-0}"
  local preflight_link_target=""
  eval "preflight_link_target=\${PREFLIGHT_${suffix}_LINK_TARGET:-}"

  # Test seam to simulate a race condition where the destination is created
  # concurrently after preflight but before relocation.
  if [ -n "${GSD_TEST_SEAM_PRE_RELOCATE:-}" ]; then
    mkdir -p "$(dirname "$target")"
    if [ "$GSD_TEST_SEAM_PRE_RELOCATE" = "symlink" ]; then
      ln -sf "/some/other/path" "$target"
    elif [ "$GSD_TEST_SEAM_PRE_RELOCATE" = "regular" ]; then
      echo "raced pre-relocate content" > "$target"
    fi
  fi

  if [ -L "$target" ]; then
    local link_target=""
    if read_link_exact "$target" link_target; then
      if [ "$link_target" = "$ext_source" ]; then
        # Idempotent same-source link: do nothing
        return 0
      fi
    fi
  fi

  # Atomic creation/update of symlink
  local extensions_dir
  extensions_dir="$(dirname "$target")"

  local dir_to_create="$extensions_dir"
  if [[ "$dir_to_create" == -* ]]; then
    dir_to_create="./$dir_to_create"
  fi
  mkdir -p "$dir_to_create"
  local template="${extensions_dir}/${target##*/}.XXXXXX"
  if [[ "$template" == -* ]]; then
    template="./$template"
  fi
  local tmp_symlink
  tmp_symlink=$(mktemp "$template")

  local rm_tmp="$tmp_symlink"
  if [[ "$rm_tmp" == -* ]]; then
    rm_tmp="./$rm_tmp"
  fi
  rm -f "$rm_tmp"
  CLEANUP_TMP_SYMLINK="$tmp_symlink"

  local src_arg="$ext_source"
  if [[ "$src_arg" == -* ]]; then
    src_arg="./$src_arg"
  fi
  local dest_arg="$tmp_symlink"
  if [[ "$dest_arg" == -* ]]; then
    dest_arg="./$dest_arg"
  fi
  ln -s "$src_arg" "$dest_arg"

  # Relocation state machine
  if [ -e "$target" ] || [ -L "$target" ]; then
    # Something exists at the target. Re-read and reclassify.
    if [ "$preflight_exists" -ne 1 ]; then
      # A new object appeared since preflight!
      printf "error: unmanaged collision: %s already exists; move or remove it.\n" "$target" >&2
      rm -f "$tmp_symlink"
      CLEANUP_TMP_SYMLINK=""
      return 1
    fi

    # It existed at preflight. It must still be the exact same dangling absolute recognizable prior managed link.
    if [ ! -L "$target" ]; then
      printf "error: unmanaged collision: %s already exists and is not a symlink; move or remove it.\n" "$target" >&2
      rm -f "$tmp_symlink"
      CLEANUP_TMP_SYMLINK=""
      return 1
    fi

    local curr_link_target=""
    if ! read_link_exact "$target" curr_link_target; then
      printf "error: unmanaged collision: %s already exists; move or remove it.\n" "$target" >&2
      rm -f "$tmp_symlink"
      CLEANUP_TMP_SYMLINK=""
      return 1
    fi

    if [ "$curr_link_target" != "$preflight_link_target" ]; then
      printf "error: unmanaged collision: %s already exists and points to another source %s; move or remove it.\n" "$target" "$curr_link_target" >&2
      rm -f "$tmp_symlink"
      CLEANUP_TMP_SYMLINK=""
      return 1
    fi

    # Must still be dangling, absolute, recognizable
    if [ -e "$target" ]; then
      printf "error: unmanaged collision: %s already exists and is not dangling; move or remove it.\n" "$target" >&2
      rm -f "$tmp_symlink"
      CLEANUP_TMP_SYMLINK=""
      return 1
    fi

    if [[ "$curr_link_target" != /* ]] || [[ "$curr_link_target" != $shape_pattern ]]; then
      printf "error: unmanaged collision: %s already exists and is not recognizable; move or remove it.\n" "$target" >&2
      rm -f "$tmp_symlink"
      CLEANUP_TMP_SYMLINK=""
      return 1
    fi

    # Move verified old dangling link to a unique same-directory backup
    is_stale=1
    backup_target=$(mktemp "${target}.backup.XXXXXX")
    rm -f "$backup_target"
    CLEANUP_BACKUP_TARGET="$backup_target"
    RESTORE_TARGET="$target"
    RESTORE_BACKUP_TARGET="$backup_target"
    RESTORE_EXPECTED_SOURCE="$ext_source"

    local approved_target="$curr_link_target"
    local approved_inode=""
    read -r approved_inode _ < <(ls -di -- "$target" 2>/dev/null)
    APPROVED_BACKUP_LINK_TARGET="$approved_target"
    APPROVED_BACKUP_INODE="$approved_inode"
    # Deterministic test seam exactly after final classification (first window)
    if [ -n "${GSD_TEST_SEAM_POST_CLASSIFY:-}" ]; then
      if [ "$GSD_TEST_SEAM_POST_CLASSIFY" = "regular" ]; then
        rm -f "$target"
        echo "raced content post-classify" > "$target"
      elif [ "$GSD_TEST_SEAM_POST_CLASSIFY" = "symlink" ]; then
        rm -f "$target"
        ln -s "/some/other/path" "$target"
      elif [ "$GSD_TEST_SEAM_POST_CLASSIFY" = "regular_and_backup_regular" ]; then
        rm -f "$target"
        echo "raced content post-classify" > "$target"
        echo "unowned backup content post-classify" > "$backup_target"
      elif [ "$GSD_TEST_SEAM_POST_CLASSIFY" = "regular_and_backup_symlink" ]; then
        rm -f "$target"
        echo "raced content post-classify" > "$target"
        ln -s "/some/other/backup/path" "$backup_target"
      fi
      if [ -n "${GSD_TEST_SEAM_BACKUP_PUBLISH:-}" ]; then
        if [ "$GSD_TEST_SEAM_BACKUP_PUBLISH" = "regular" ]; then
          echo "unowned backup content post-classify" > "$backup_target"
        elif [ "$GSD_TEST_SEAM_BACKUP_PUBLISH" = "symlink" ]; then
          ln -s "/some/other/backup/path" "$backup_target"
        elif [ "$GSD_TEST_SEAM_BACKUP_PUBLISH" = "hardlink" ]; then
          ln -P "$target" "$backup_target"
        fi
      fi
    fi

    # Re-verify identity immediately before move to catch post-classification race
    local post_classify_link_target=""
    if [ -L "$target" ]; then
      read_link_exact "$target" post_classify_link_target || true
    fi
    local post_classify_inode=""
    read -r post_classify_inode _ < <(ls -di -- "$target" 2>/dev/null) || true

    local post_classify_ok=0
    if [ -L "$target" ] && \
       [ -n "$APPROVED_BACKUP_INODE" ] && [ "$post_classify_inode" = "$APPROVED_BACKUP_INODE" ] && \
       [ -n "$APPROVED_BACKUP_LINK_TARGET" ] && [ "$post_classify_link_target" = "$APPROVED_BACKUP_LINK_TARGET" ]; then
      post_classify_ok=1
    fi

    if [ "$post_classify_ok" -ne 1 ]; then
      printf "error: unmanaged collision: %s already exists; move or remove it.\n" "$target" >&2
      if is_owned_path "$backup_target"; then
        rm_owned_backup "$backup_target" || true
      fi
      CLEANUP_BACKUP_TARGET=""
      CLEANUP_QUARANTINE_TARGET=""
      RESTORE_TARGET=""
      RESTORE_EXPECTED_SOURCE=""
      RESTORE_BACKUP_TARGET=""
      APPROVED_BACKUP_LINK_TARGET=""
      APPROVED_BACKUP_INODE=""
      rm -f "$tmp_symlink"
      CLEANUP_TMP_SYMLINK=""
      return 1
    fi
    local backup_mv_target="$backup_target"
    if [[ "$backup_mv_target" == -* ]]; then
      backup_mv_target="./$backup_mv_target"
    fi
    local source_mv_target="$target"
    if [[ "$source_mv_target" == -* ]]; then
      source_mv_target="./$source_mv_target"
    fi

    # Deterministic test seam at backup publication (second window: right before backup move)
    if [ -n "${GSD_TEST_SEAM_BACKUP_PUBLISH:-}" ]; then
      if [ "$GSD_TEST_SEAM_BACKUP_PUBLISH" = "regular" ]; then
        echo "unowned backup content" > "$backup_target"
      elif [ "$GSD_TEST_SEAM_BACKUP_PUBLISH" = "symlink" ]; then
        ln -s "/some/other/backup/path" "$backup_target"
      elif [ "$GSD_TEST_SEAM_BACKUP_PUBLISH" = "hardlink" ]; then
        ln -P "$target" "$backup_target"
      fi
    fi

    # Capture the exact lstat identity and literal link target immediately before moving
    local target_inode_before=""
    local target_link_target_before=""
    local target_type_before=""
    if [ -L "$target" ]; then
      target_type_before="symlink"
      read_link_exact "$target" target_link_target_before || true
    elif [ -d "$target" ]; then
      target_type_before="directory"
    elif [ -e "$target" ]; then
      target_type_before="regular"
    fi
    read -r target_inode_before _ < <(ls -di -- "$target" 2>/dev/null) || true

    # Deterministic test seam immediately after capture and before backup move
    if [ -n "${GSD_TEST_SEAM_POST_CAPTURE_REPLACE:-}" ]; then
      if [ "$GSD_TEST_SEAM_POST_CAPTURE_REPLACE" = "regular" ]; then
        rm -f "$target" 2>/dev/null || true
        rm -rf "$target" 2>/dev/null || true
        echo "post-capture regular" > "$target"
      elif [ "$GSD_TEST_SEAM_POST_CAPTURE_REPLACE" = "symlink" ]; then
        rm -f "$target" 2>/dev/null || true
        rm -rf "$target" 2>/dev/null || true
        ln -s "/some/other/replacement/path" "$target"
      fi
    fi

    mv -n -T "$source_mv_target" "$backup_mv_target" 2>/dev/null || true

    # Deterministic test seam immediately after backup move and before target existence check
    if [ -n "${GSD_TEST_SEAM_POST_BACKUP_MOVE:-}" ]; then
      if [ "$GSD_TEST_SEAM_POST_BACKUP_MOVE" = "regular" ]; then
        rm -f "$target"
        echo "raced content post-backup-move" > "$target"
      elif [ "$GSD_TEST_SEAM_POST_BACKUP_MOVE" = "symlink" ]; then
        rm -f "$target"
        ln -s "/some/other/path" "$target"
      elif [ "$GSD_TEST_SEAM_POST_BACKUP_MOVE" = "replace_backup_target_absent" ]; then
        rm -f "$backup_target" 2>/dev/null || true
        echo "unowned backup replacement" > "$backup_target"
      fi
    fi

    # Prove move success by source disappearance
    if [ -e "$target" ] || [ -L "$target" ]; then
      # Source remains or a raced target appeared!
      printf "error: unmanaged collision: %s already exists; move or remove it.\n" "$target" >&2

      # Check if canonical target still exists with exact pre-move inode/type and literal link target.
      local cur_target_inode=""
      read -r cur_target_inode _ < <(ls -di -- "$target" 2>/dev/null) || true

      local cur_target_type=""
      if [ -L "$target" ]; then
        cur_target_type="symlink"
      elif [ -d "$target" ]; then
        cur_target_type="directory"
      elif [ -e "$target" ]; then
        cur_target_type="regular"
      fi

      local cur_target_link_target=""
      if [ -L "$target" ]; then
        read_link_exact "$target" cur_target_link_target || true
      fi

      local target_still_pre_move=0
      if [ -n "$target_inode_before" ] && [ "$cur_target_inode" = "$target_inode_before" ] && \
         [ "$cur_target_type" = "$target_type_before" ] && \
         [ "$cur_target_link_target" = "$target_link_target_before" ]; then
        target_still_pre_move=1
      fi

      if [ "$target_still_pre_move" -eq 1 ]; then
        # The no-clobber move was skipped; backup publication is unproven regardless of backup identity.
        # Preserve both canonical target and backup pathname, remove only installer temp,
        # clear only safe invocation state, and fail. Never call rm_owned_backup or restoration/deletion helpers.
        CLEANUP_BACKUP_TARGET=""
        RESTORE_TARGET=""
        RESTORE_EXPECTED_SOURCE=""
        RESTORE_BACKUP_TARGET=""
        APPROVED_BACKUP_LINK_TARGET=""
        APPROVED_BACKUP_INODE=""
        rm -f "$tmp_symlink"
        CLEANUP_TMP_SYMLINK=""
        return 1
      fi
      
      local backup_link_target=""
      if [ -L "$backup_target" ]; then
        read_link_exact "$backup_target" backup_link_target || true
      fi
      local backup_inode=""
      read -r backup_inode _ < <(ls -di -- "$backup_target" 2>/dev/null) || true

      local is_backup_owned=0
      if [ -L "$backup_target" ] && \
         [ -n "${APPROVED_BACKUP_INODE:-}" ] && [ "$backup_inode" = "$APPROVED_BACKUP_INODE" ] && \
         [ -n "$target_inode_before" ] && [ "$backup_inode" = "$target_inode_before" ] && \
         [ "$backup_link_target" = "${APPROVED_BACKUP_LINK_TARGET:-}" ] && \
         [ "$backup_link_target" = "$target_link_target_before" ]; then
        is_backup_owned=1
      fi

      if [ "$is_backup_owned" -eq 1 ]; then
        # Deterministic test seam: make the old referent live after ownership proof
        if [ -n "${GSD_TEST_SEAM_MAKE_REFERENT_LIVE:-}" ]; then
          mkdir -p "$(dirname "$APPROVED_BACKUP_LINK_TARGET")"
          echo "live referent content" > "$APPROVED_BACKUP_LINK_TARGET"
        fi

        # remove it through the guarded owned-backup path while leaving the raced target untouched,
        # then clear fields and fail. Keep cleanup armed until success, or fail keeping them armed if identity changes.
        if rm_owned_backup "$backup_target"; then
          CLEANUP_BACKUP_TARGET=""
          RESTORE_TARGET=""
          RESTORE_EXPECTED_SOURCE=""
          RESTORE_BACKUP_TARGET=""
          APPROVED_BACKUP_LINK_TARGET=""
          APPROVED_BACKUP_INODE=""
          rm -f "$tmp_symlink"
          CLEANUP_TMP_SYMLINK=""
          return 1
        else
          # Identity changed or deletion failed. Preserve and fail, keeping cleanup armed.
          rm -f "$tmp_symlink"
          CLEANUP_TMP_SYMLINK=""
          return 1
        fi
      else
        # If backup ownership does not match, preserve it in place and fail without restoring or deleting it.
        # Clear fields so trap doesn't touch it.
        CLEANUP_BACKUP_TARGET=""
        RESTORE_TARGET=""
        RESTORE_EXPECTED_SOURCE=""
        RESTORE_BACKUP_TARGET=""
        APPROVED_BACKUP_LINK_TARGET=""
        APPROVED_BACKUP_INODE=""
        rm -f "$tmp_symlink"
        CLEANUP_TMP_SYMLINK=""
        return 1
      fi
    fi

    # Immediately classify the moved backup and require it to be exactly the same dangling symlink target approved immediately before the move (and, where practical, the same lstat identity)
    local backup_link_target=""
    if [ -L "$backup_target" ]; then
      read_link_exact "$backup_target" backup_link_target || true
    fi
    local backup_inode=""
    read -r backup_inode _ < <(ls -di -- "$backup_target" 2>/dev/null) || true

    local backup_ok=0
    if [ -L "$backup_target" ] && \
       [ -n "${APPROVED_BACKUP_INODE:-}" ] && [ "$backup_inode" = "$APPROVED_BACKUP_INODE" ] && \
       [ -n "$target_inode_before" ] && [ "$backup_inode" = "$target_inode_before" ] && \
       [ "$backup_link_target" = "${APPROVED_BACKUP_LINK_TARGET:-}" ] && \
       [ "$backup_link_target" = "$target_link_target_before" ]; then
      backup_ok=1
    fi

    if [ "$backup_ok" -ne 1 ]; then
      # If backup identity does not match—whether replaced after move or pre-existing from a skipped move—
      # do not move it to extension target, do not delete it, and do not publish; preserve it in place and fail.
      if ! [ -e "$target" ] && ! [ -L "$target" ]; then
        local cur_type=""
        if [ -L "$backup_target" ]; then
          cur_type="symlink"
        elif [ -f "$backup_target" ]; then
          cur_type="regular"
        fi
        local cur_inode=""
        read -r cur_inode _ < <(ls -di -- "$backup_target" 2>/dev/null) || true
        local cur_link_target=""
        if [ "$cur_type" = "symlink" ]; then
          read_link_exact "$backup_target" cur_link_target || true
        fi
        local cur_content=""
        if [ "$cur_type" = "regular" ]; then
          cur_content=$(cat -- "$backup_target" 2>/dev/null || true)
        fi

        local restore_src="$backup_target"
        if [[ "$restore_src" == -* ]]; then
          restore_src="./$restore_src"
        fi
        local restore_dest="$target"
        if [[ "$restore_dest" == -* ]]; then
          restore_dest="./$restore_dest"
        fi

        mv -n -T "$restore_src" "$restore_dest" 2>/dev/null || true

        local skipped_move=0
        if [ -e "$backup_target" ] || [ -L "$backup_target" ]; then
          skipped_move=1
        fi

        local check_type=""
        if [ -L "$target" ]; then
          check_type="symlink"
        elif [ -f "$target" ]; then
          check_type="regular"
        fi
        local check_inode=""
        read -r check_inode _ < <(ls -di -- "$target" 2>/dev/null) || true
        local check_link_target=""
        if [ "$check_type" = "symlink" ]; then
          read_link_exact "$target" check_link_target || true
        fi
        local check_content=""
        if [ "$check_type" = "regular" ]; then
          check_content=$(cat -- "$target" 2>/dev/null || true)
        fi

        local verified=0
        if [ "$skipped_move" -eq 0 ] && [ "$check_type" = "$cur_type" ] && [ -n "$cur_inode" ] && [ "$check_inode" = "$cur_inode" ]; then
          if [ "$cur_type" = "symlink" ]; then
            if [ "$check_link_target" = "$cur_link_target" ]; then
              verified=1
            fi
          elif [ "$cur_type" = "regular" ]; then
            if [ "$check_content" = "$cur_content" ]; then
              verified=1
            fi
          fi
        fi

        if [ "$verified" -eq 1 ]; then
          CLEANUP_BACKUP_TARGET=""
          CLEANUP_QUARANTINE_TARGET=""
          RESTORE_TARGET=""
          RESTORE_EXPECTED_SOURCE=""
          RESTORE_BACKUP_TARGET=""
          APPROVED_BACKUP_LINK_TARGET=""
          APPROVED_BACKUP_INODE=""
          rm -f "$tmp_symlink"
          CLEANUP_TMP_SYMLINK=""
          return 1
        fi
      fi

      CLEANUP_BACKUP_TARGET=""
      CLEANUP_QUARANTINE_TARGET=""
      RESTORE_TARGET=""
      RESTORE_EXPECTED_SOURCE=""
      RESTORE_BACKUP_TARGET=""
      APPROVED_BACKUP_LINK_TARGET=""
      APPROVED_BACKUP_INODE=""
      rm -f "$tmp_symlink"
      CLEANUP_TMP_SYMLINK=""
      return 1
    fi
  fi

  local src_mv="$tmp_symlink"
  if [[ "$src_mv" == -* ]]; then
    src_mv="./$src_mv"
  fi
  local dest_mv="$target"
  if [[ "$dest_mv" == -* ]]; then
    dest_mv="./$dest_mv"
  fi

  # Test seam to simulate a race condition where the destination is created
  # concurrently after classification/preflight but before publication.
  if [ -n "${GSD_TEST_SEAM_RACE:-}" ]; then
    if [ "$GSD_TEST_SEAM_RACE" = "regular" ]; then
      echo "raced content" > "$target"
    elif [ "$GSD_TEST_SEAM_RACE" = "symlink" ]; then
      ln -s "/some/other/path" "$target"
    elif [ "$GSD_TEST_SEAM_RACE" = "directory" ]; then
      mkdir -p "$target"
    elif [ "$GSD_TEST_SEAM_RACE" = "same_source" ]; then
      ln -s "$ext_source" "$target"
    elif [ "$GSD_TEST_SEAM_RACE" = "sigterm" ]; then
      kill -TERM $$
    fi
  fi

  # Publish using a no-clobber and no-target-directory operation (never use mv -f)
  mv -n -T "$src_mv" "$dest_mv"

  # Check if the move was skipped because of a raced-in file/directory
  if [ -e "$tmp_symlink" ] || [ -L "$tmp_symlink" ]; then
    # Overwrite skipped! The destination was raced-in.
    # Re-read target:
    if [ -L "$target" ]; then
      local raced_link_target=""
      if read_link_exact "$target" raced_link_target; then
        if [ "$raced_link_target" = "$ext_source" ]; then
          # Accept the exact same-source link
          rm -f "$tmp_symlink"
          if [ -n "${GSD_TEST_SEAM_POST_RM_TMP_SYMLINK:-}" ]; then
            if [ "$GSD_TEST_SEAM_POST_RM_TMP_SYMLINK" = "sigterm" ]; then
              kill -TERM $$
            fi
          fi
          CLEANUP_TMP_SYMLINK=""
          if [ -n "$backup_target" ]; then
            if rm_owned_backup "$backup_target"; then
              RESTORE_EXPECTED_SOURCE=""
              RESTORE_TARGET=""
              RESTORE_BACKUP_TARGET=""
              APPROVED_BACKUP_LINK_TARGET=""
              APPROVED_BACKUP_INODE=""
              CLEANUP_BACKUP_TARGET=""
              CLEANUP_QUARANTINE_TARGET=""
              return 0
            else
              return 1
            fi
          fi
          RESTORE_TARGET=""
          RESTORE_EXPECTED_SOURCE=""
          RESTORE_BACKUP_TARGET=""
          APPROVED_BACKUP_LINK_TARGET=""
          APPROVED_BACKUP_INODE=""
          CLEANUP_BACKUP_TARGET=""
          CLEANUP_QUARANTINE_TARGET=""
          return 0
        fi
      fi
    fi

    # Failure: raced-in destination differs.
    printf "error: unmanaged collision: %s already exists; move or remove it.\n" "$target" >&2
    # If any destination raced in, preserve it, remove temp and backup, and fail - never restore over it
    if [ "$is_stale" -eq 1 ]; then
      if rm_owned_backup "$backup_target"; then
        RESTORE_TARGET=""
        RESTORE_EXPECTED_SOURCE=""
        RESTORE_BACKUP_TARGET=""
        APPROVED_BACKUP_LINK_TARGET=""
        APPROVED_BACKUP_INODE=""
        CLEANUP_BACKUP_TARGET=""
        CLEANUP_QUARANTINE_TARGET=""
      else
        rm -f "$tmp_symlink"
        if [ -n "${GSD_TEST_SEAM_POST_RM_TMP_SYMLINK:-}" ]; then
          if [ "$GSD_TEST_SEAM_POST_RM_TMP_SYMLINK" = "sigterm" ]; then
            kill -TERM $$
          fi
        fi
        CLEANUP_TMP_SYMLINK=""
        return 1
      fi
    fi
    rm -f "$tmp_symlink"
    if [ -n "${GSD_TEST_SEAM_POST_RM_TMP_SYMLINK:-}" ]; then
      if [ "$GSD_TEST_SEAM_POST_RM_TMP_SYMLINK" = "sigterm" ]; then
        kill -TERM $$
      fi
    fi
    CLEANUP_TMP_SYMLINK=""
    return 1
  else
    # Success!
    # Deterministic signal seam immediately after successful extension publication
    if [ -n "${GSD_TEST_SEAM_POST_PUBLISH:-}" ]; then
      if [ "$GSD_TEST_SEAM_POST_PUBLISH" = "sigterm" ]; then
        kill -TERM $$
      fi
    fi

    CLEANUP_TMP_SYMLINK=""
    RESTORE_TARGET=""
    RESTORE_EXPECTED_SOURCE=""
    RESTORE_BACKUP_TARGET=""
    if [ -n "$backup_target" ]; then
      if rm_owned_backup "$backup_target"; then
        APPROVED_BACKUP_LINK_TARGET=""
        APPROVED_BACKUP_INODE=""
        CLEANUP_BACKUP_TARGET=""
        CLEANUP_QUARANTINE_TARGET=""
      else
        return 1
      fi
    else
      APPROVED_BACKUP_LINK_TARGET=""
      APPROVED_BACKUP_INODE=""
      CLEANUP_BACKUP_TARGET=""
      CLEANUP_QUARANTINE_TARGET=""
    fi
  fi
}

# Extension parents and the optional legacy-agents parent must be real directories.
for p in "$OMP_DIR" "$OMP_AGENT_DIR" "$OMP_EXTENSIONS_DIR" "$OMP_AGENTS_DIR"; do
  check_p="$p"
  if [[ "$check_p" == -* ]]; then
    check_p="./$check_p"
  fi
  if [ -L "$check_p" ]; then
    printf "error: registration parent %s is a symlink; move or remove it, then rerun install.sh.\n" "$p" >&2
    exit 1
  fi
  if [ -e "$check_p" ] && [ ! -d "$check_p" ]; then
    printf "error: registration parent %s exists and is not a directory; move or remove it, then rerun install.sh.\n" "$p" >&2
    exit 1
  fi
done

preflight_legacy_agent_target "$LEGACY_EXEC_TARGET" "$LEGACY_EXEC_SOURCE" "gsd-executor.md" "executor" "LEGACY_EXEC_ACTION" "LEGACY_EXEC_LINK_TARGET"
preflight_legacy_agent_target "$LEGACY_REVIEW_TARGET" "$LEGACY_REVIEW_SOURCE" "gsd-reviewer.md" "reviewer" "LEGACY_REVIEW_ACTION" "LEGACY_REVIEW_LINK_TARGET"
preflight_managed_target "$EXT_TARGET" "$EXT_SOURCE" "EXT" "*/extensions/gsd-context.js"
sync_managed_target "$EXT_TARGET" "$EXT_SOURCE" "EXT" "*/extensions/gsd-context.js"
remove_preflighted_legacy_agent "$LEGACY_EXEC_TARGET" "executor" "LEGACY_EXEC_ACTION" "LEGACY_EXEC_LINK_TARGET"
remove_preflighted_legacy_agent "$LEGACY_REVIEW_TARGET" "reviewer" "LEGACY_REVIEW_ACTION" "LEGACY_REVIEW_LINK_TARGET"

if [ -L "$OMP_COMMANDS_DIR" ]; then
  printf "  warn: preserving legacy command: commands path %s is a symlink.\n" "$OMP_COMMANDS_DIR" >&2
elif [ -e "$OMP_COMMANDS_DIR" ] && [ ! -d "$OMP_COMMANDS_DIR" ]; then
  printf "  warn: preserving legacy command: commands path %s is not a directory.\n" "$OMP_COMMANDS_DIR" >&2
elif [ -d "$OMP_COMMANDS_DIR" ]; then
  remove_legacy_managed_command "$OMP_TARGET" "$REPO" || true
fi
# --- Remove old ~/.agents/skills/gsd* symlinks proven to resolve to this checkout ---
if [ -d "${HOME}/.agents/skills" ]; then
  for link in "${HOME}/.agents/skills"/gsd*; do
    [ -L "$link" ] || continue
    if resolved_target="$(cd -P "$link" 2>/dev/null && pwd -P)"; then
      canonical_repo="$(cd -P "$REPO" 2>/dev/null && pwd -P)"
      if [[ "$resolved_target" == "$canonical_repo"/skills/gsd* ]]; then
        if [ "${GSD_TEST_SEAM_LEGACY_SKILL_REPLACE:-}" = "regular" ]; then
          rm -f -- "$link"
          printf "raced legacy skill content\n" > "$link"
        fi

        current_resolved=""
        if [ -L "$link" ] \
          && current_resolved="$(cd -P "$link" 2>/dev/null && pwd -P)" \
          && [ "$current_resolved" = "$resolved_target" ]; then
          rm -f -- "$link"
        else
          printf "  warn: preserving legacy skill %s: target changed after validation.\n" "$link" >&2
        fi
      fi
    fi
  done
fi

# --- Optional submodule refresh and lavish build ---
LAVISH="$REPO/tools/lavish-axi"
# Record pre-update SHA when possible; never fail install if git is missing/broken.
LAVISH_SHA_BEFORE=""
if [ -d "$LAVISH" ]; then
  LAVISH_SHA_BEFORE="$(git -C "$LAVISH" rev-parse HEAD 2>/dev/null || true)"
fi

if [ -f "$REPO/.gitmodules" ]; then
  git -C "$REPO" submodule update --init --remote --checkout --recursive >/dev/null 2>&1 \
    || echo "  warn: submodule remote update failed — lavish HTML path may be unavailable; skills degrade to terminal."
fi

LAVISH_SHA_AFTER=""
if [ -d "$LAVISH" ]; then
  LAVISH_SHA_AFTER="$(git -C "$LAVISH" rev-parse HEAD 2>/dev/null || true)"
fi

# Rebuild when tip changed or dist is missing. All git/pnpm probes stay non-fatal.
if [ -d "$LAVISH" ] && command -v pnpm >/dev/null 2>&1; then
  if [ ! -f "$LAVISH/dist/cli.mjs" ] || { [ -n "$LAVISH_SHA_AFTER" ] && [ "$LAVISH_SHA_BEFORE" != "$LAVISH_SHA_AFTER" ]; }; then
    echo "  building lavish-axi (pnpm install && pnpm build)..."
    (cd "$LAVISH" && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm build >/dev/null 2>&1) \
      || echo "  warn: lavish-axi build failed — lavish HTML path unavailable; skills degrade to terminal."
  fi
fi

LAVISH_STATE="lavish visual path ready (dist/cli.mjs present)"
[ -f "$LAVISH/dist/cli.mjs" ] || LAVISH_STATE="lavish not built — install pnpm and re-run, or: cd tools/lavish-axi && pnpm i && pnpm build"
printf "\nGSD installation complete\n"
printf "  Source checkout: %s\n" "$REPO"
printf "  OMP extension symlink: %s -> %s\n" "$EXT_TARGET" "$EXT_SOURCE"
printf "  Lavish: %s\n" "$LAVISH_STATE"
printf "  Next: start a new OMP session to load the extension.\n"
