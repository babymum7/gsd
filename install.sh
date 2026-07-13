#!/usr/bin/env bash
# Install GSD: register GSD as an OMP command.
# Registers zero GSD skills in ~/.agents/skills/, cleans up legacy symlinks,
# and creates ~/.omp/agent/commands/gsd.md.
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

# Global variables for cleanup and restoration
TMP_COMMAND_FILE=""
CLEANUP_TMP_SYMLINK=""
CLEANUP_BACKUP_TARGET=""
CLEANUP_QUARANTINE_TARGET=""
RESTORE_TARGET=""
RESTORE_BACKUP_TARGET=""
APPROVED_BACKUP_LINK_TARGET=""
APPROVED_BACKUP_INODE=""
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
    if [ -L "$restore_target" ]; then
      local current_tgt=""
      if read_link_exact "$restore_target" current_tgt; then
        if [ "$current_tgt" = "${EXT_SOURCE:-}" ]; then
          is_committed=1
        fi
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
  if [ -n "${TMP_COMMAND_FILE:-}" ]; then
    rm -f "${TMP_COMMAND_FILE}" 2>/dev/null || true
  fi
}

trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 131' QUIT
trap 'exit 143' TERM
trap cleanup_trap EXIT
preflight_managed_command() {
  local target="$1"
  local repo="$2"

  if [ -L "$target" ]; then
    echo "error: registration path $target is a symlink; move or remove it, then rerun install.sh." >&2
    return 1
  fi

  if [[ "$repo" == *$'\n'* || "$repo" == *$'\r'* ]]; then
    echo "error: repository root cannot contain carriage return or newline characters." >&2
    return 1
  fi

  if [ -e "$target" ]; then
    if [ ! -f "$target" ]; then
      echo "error: registration path $target exists and is not a regular file; move or remove it, then rerun install.sh." >&2
      return 1
    fi
    # Reject NUL before line parsing using a portable non-executing byte check
    local orig_size
    orig_size=$(wc -c < "$target")
    local clean_size
    clean_size=$(tr -d '\000' < "$target" | wc -c)
    if [ "$orig_size" -ne "$clean_size" ]; then
      echo "error: malformed target: $target contains NUL bytes." >&2
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
    local line
    local clean_line
    local marker_ver

    while IFS= read -r line || [ -n "$line" ]; do
      line_no=$((line_no + 1))
      if [[ "$line" == *$'\r'* ]]; then
        has_cr=1
      fi
      clean_line="${line%$'\r'}"

      if [[ "$clean_line" =~ ^"<!-- gsd-managed-command:"(.*)" -->"$ ]]; then
        marker_ver="${BASH_REMATCH[1]}"
        total_markers=$((total_markers + 1))
        if [ $line_no -le 10 ]; then
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

    if [ $total_markers -eq 0 ]; then
      echo "error: existing unmarked/malformed target: $target exists and is not managed by GSD; move or remove it." >&2
      return 1
    fi

    if [ $marker_in_header -ne 1 ] || [ $total_markers -ne 1 ]; then
      echo "error: malformed target: $target must contain exactly one managed marker in the first 10 lines." >&2
      return 1
    fi

    if [ $has_unsupported_version -ne 0 ]; then
      echo "error: malformed target: $target has an unsupported managed command version." >&2
      return 1
    fi

    if [ $root_count -eq 0 ] && [ $malformed_canonical -eq 0 ]; then
      echo "error: existing unmarked/malformed target: $target exists but has no GSD_ROOT; move or remove it." >&2
      return 1
    fi

    if [ $root_count -ne 1 ] || [ $malformed_canonical -ne 0 ]; then
      echo "error: malformed target: $target has duplicate or malformed GSD_ROOT lines." >&2
      return 1
    fi

    if [ $has_cr -ne 0 ]; then
      echo "error: malformed target: $target contains carriage return characters." >&2
      return 1
    fi

    # Strictly decode only emitted escapes
    local decoded=""
    local i=0
    local len=${#root_line}
    local char
    local next_char

    while [ $i -lt $len ]; do
      char="${root_line:$i:1}"
      if [ "$char" = "\\" ]; then
        i=$((i + 1))
        if [ $i -ge $len ]; then
          echo "error: malformed target: $target has an unsupported trailing backslash escape." >&2
          return 1
        fi
        next_char="${root_line:$i:1}"
        if [ "$next_char" = "\\" ]; then
          decoded="${decoded}\\"
        elif [ "$next_char" = "\"" ]; then
          decoded="${decoded}\""
        else
          echo "error: malformed target: $target has an unsupported escape \\${next_char}." >&2
          return 1
        fi
      elif [ "$char" = "\"" ]; then
        echo "error: malformed target: $target has an unescaped double quote." >&2
        return 1
      else
        decoded="${decoded}${char}"
      fi
      i=$((i + 1))
    done

    if [[ "$decoded" != /* ]]; then
      echo "error: malformed target: $target has a non-absolute GSD_ROOT." >&2
      return 1
    fi

    # Classification
    if [ "$decoded" != "$repo" ] && [ -d "$decoded" ]; then
      # Live other checkout
      echo "error: live-other-root managed collision: $target already exists and points to active checkout $decoded; move or remove it." >&2
      return 1
    fi
  fi
  return 0
}

sync_managed_command() {
  local target="$1"
  local repo="$2"

  # Write target atomically
  local commands_dir
  commands_dir="$(dirname "$target")"
  mkdir -p "$commands_dir"

  local tmp_target
  tmp_target=$(mktemp "${commands_dir}/gsd.md.XXXXXX")
  TMP_COMMAND_FILE="$tmp_target"

  local repo_escaped
  repo_escaped="${repo//\\/\\\\}"
  repo_escaped="${repo_escaped//\"/\\\"}"

  cat <<EOF > "$tmp_target"
---
description: Master entry point for all GSD coding tasks. Routes, starts, resumes, and coordinates sub-skills automatically.
---
<!-- gsd-managed-command:v1 -->
# GSD Command
GSD_ROOT="${repo_escaped}"

Run GSD. Execute the GSD loop by loading the master skill directly from the root path:
1. Verify that GSD_ROOT is valid and "\$GSD_ROOT/skills/gsd/SKILL.md" exists. If GSD_ROOT is missing or moved, stop with an actionable error immediately.
2. Read the master skill directly from "\$GSD_ROOT/skills/gsd/SKILL.md".
3. Evaluate the GSD smart routing engine on the arguments: \$ARGUMENTS.
4. Route 0 (Direct/read-only or Nano) must be executed directly without any git subprocess calls (completely git-free).
5. For any routed subskill, load it directly from "\$GSD_ROOT/skills/gsd-<target>/SKILL.md". Never use \`skill://\` or ~/.agents/skills/ or readlink.
6. Pass self-contained direct-root instructions to subagent dispatch so subagents do not depend on skill discovery.
EOF

  mv "$tmp_target" "$target"
  TMP_COMMAND_FILE=""
}

preflight_managed_extension() {
  local target="$1"
  local ext_source="$2"

  if [ -e "$target" ] || [ -L "$target" ]; then
    PREFLIGHT_EXT_EXISTS=1
    if [ -L "$target" ]; then
      local link_target=""
      if read_link_exact "$target" link_target; then
        PREFLIGHT_EXT_LINK_TARGET="$link_target"
        if [ "$link_target" = "$ext_source" ]; then
          # Same exact source is okay
          return 0
        fi

        # Determine if it's relocatable:
        # - Must be absolute: [[ "$link_target" == /* ]]
        # - Must match shape: [[ "$link_target" == */extensions/gsd-context.js ]]
        # - Must be dangling: [ ! -e "$target" ]
        if [[ "$link_target" == /* ]] && [[ "$link_target" == */extensions/gsd-context.js ]] && [ ! -e "$target" ]; then
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
    PREFLIGHT_EXT_EXISTS=0
    PREFLIGHT_EXT_LINK_TARGET=""
  fi
  return 0
}

sync_managed_extension() {
  local target="$1"
  local ext_source="$2"

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

  local template="${extensions_dir}/gsd-context.js.XXXXXX"
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
  local is_stale=0
  local backup_target=""

  if [ -e "$target" ] || [ -L "$target" ]; then
    # Something exists at the target. Re-read and reclassify.
    if [ "$PREFLIGHT_EXT_EXISTS" -ne 1 ]; then
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

    if [ "$curr_link_target" != "$PREFLIGHT_EXT_LINK_TARGET" ]; then
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

    if [[ "$curr_link_target" != /* ]] || [[ "$curr_link_target" != */extensions/gsd-context.js ]]; then
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
        CLEANUP_QUARANTINE_TARGET=""
        RESTORE_TARGET=""
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
          CLEANUP_QUARANTINE_TARGET=""
          RESTORE_TARGET=""
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
        CLEANUP_QUARANTINE_TARGET=""
        RESTORE_TARGET=""
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

# --- Complete Preflight ---

# Check each parent dir in the ~/.omp path
for p in "$OMP_DIR" "$OMP_AGENT_DIR" "$OMP_COMMANDS_DIR" "$OMP_EXTENSIONS_DIR"; do
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

preflight_managed_command "$OMP_TARGET" "$REPO"
preflight_managed_extension "$EXT_TARGET" "$EXT_SOURCE"

sync_managed_command "$OMP_TARGET" "$REPO"
sync_managed_extension "$EXT_TARGET" "$EXT_SOURCE"
# --- Remove old ~/.agents/skills/gsd* symlinks proven to resolve to this checkout ---
if [ -d "${HOME}/.agents/skills" ]; then
  for link in "${HOME}/.agents/skills"/gsd*; do
    [ -L "$link" ] || continue
    if resolved_target="$(cd -P "$link" 2>/dev/null && pwd -P)"; then
      canonical_repo="$(cd -P "$REPO" 2>/dev/null && pwd -P)"
      if [[ "$resolved_target" == "$canonical_repo"/skills/gsd* ]]; then
        rm -f "$link"
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

VERSION="$(cat "$REPO/VERSION" 2>/dev/null || echo unknown)"
LAVISH_STATE="lavish visual path ready (dist/cli.mjs present)"
[ -f "$LAVISH/dist/cli.mjs" ] || LAVISH_STATE="lavish not built — install pnpm and re-run, or: cd tools/lavish-axi && pnpm i && pnpm build"

echo "Installed GSD v$VERSION: registered OMP command at $OMP_TARGET. $LAVISH_STATE."
