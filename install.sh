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

sync_managed_command() {
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
    # Same or stale checkout: proceed to the atomic refresh.
  fi

  # Write target atomically
  local commands_dir
  commands_dir="$(dirname "$target")"
  mkdir -p "$commands_dir"

  local tmp_target
  tmp_target=$(mktemp "${commands_dir}/gsd.md.XXXXXX")
  trap 'rm -f "$tmp_target"' EXIT

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
  trap - EXIT
}

# --- Complete Preflight ---

# Check each parent dir in the ~/.omp path
for p in "$OMP_DIR" "$OMP_AGENT_DIR" "$OMP_COMMANDS_DIR"; do
  if [ -L "$p" ]; then
    echo "error: registration parent $p is a symlink; move or remove it, then rerun install.sh." >&2
    exit 1
  fi
  if [ -e "$p" ] && [ ! -d "$p" ]; then
    echo "error: registration parent $p exists and is not a directory; move or remove it, then rerun install.sh." >&2
    exit 1
  fi
done

sync_managed_command "$OMP_TARGET" "$REPO"

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
