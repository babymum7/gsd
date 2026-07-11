#!/usr/bin/env bash
# Install GSD: register GSD as an OMP command.
# Registers zero GSD skills in ~/.agents/skills/, cleans up legacy symlinks,
# and creates ~/.omp/agent/commands/gsd.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# Escaping double quotes and backslashes in REPO
REPO_ESCAPED="${REPO//\\/\\\\}"
REPO_ESCAPED="${REPO_ESCAPED//\"/\\\"}"

OMP_DIR="${HOME}/.omp"
OMP_AGENT_DIR="${OMP_DIR}/agent"
OMP_COMMANDS_DIR="${OMP_AGENT_DIR}/commands"
OMP_TARGET="${OMP_COMMANDS_DIR}/gsd.md"

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

# Check target
if [ -L "$OMP_TARGET" ]; then
  echo "error: registration path $OMP_TARGET is a symlink; move or remove it, then rerun install.sh." >&2
  exit 1
fi
if [ -e "$OMP_TARGET" ]; then
  if [ ! -f "$OMP_TARGET" ]; then
    echo "error: registration path $OMP_TARGET exists and is not a regular file; move or remove it, then rerun install.sh." >&2
    exit 1
  fi
  if ! head -n 10 "$OMP_TARGET" | grep -q '^<!-- gsd-managed-command:v1 -->$'; then
    echo "error: existing unmarked/malformed target: $OMP_TARGET exists and is not managed by GSD; move or remove it." >&2
    exit 1
  fi
  if ! grep -q '^GSD_ROOT=".*"$' "$OMP_TARGET"; then
    echo "error: existing unmarked/malformed target: $OMP_TARGET exists but has no GSD_ROOT; move or remove it." >&2
    exit 1
  fi
  existing_root=$(grep -E '^GSD_ROOT=' "$OMP_TARGET" | head -n1 | cut -d'"' -f2 || true)

  if [ "$existing_root" != "$REPO" ]; then
    if [ -d "$existing_root" ]; then
      echo "error: live-other-root managed collision: $OMP_TARGET already exists and points to active checkout $existing_root; move or remove it." >&2
      exit 1
    fi
  fi
fi

# --- Write Target atomically ---
mkdir -p "$OMP_COMMANDS_DIR"

tmp_target=$(mktemp "${OMP_COMMANDS_DIR}/gsd.md.XXXXXX")
trap 'rm -f "$tmp_target"' EXIT

cat <<EOF > "$tmp_target"
---
description: Master entry point for all GSD coding tasks. Routes, starts, resumes, and coordinates sub-skills automatically.
---
<!-- gsd-managed-command:v1 -->
# GSD Command
GSD_ROOT="${REPO_ESCAPED}"

Run GSD. Execute the GSD loop by loading the master skill directly from the root path:
1. Verify that GSD_ROOT is valid and "\$GSD_ROOT/skills/gsd/SKILL.md" exists. If GSD_ROOT is missing or moved, stop with an actionable error immediately.
2. Read the master skill directly from "\$GSD_ROOT/skills/gsd/SKILL.md".
3. Evaluate the GSD smart routing engine on the arguments: \$ARGUMENTS.
4. Route 0 (Direct/read-only or Nano) must be executed directly without any git subprocess calls (completely git-free).
5. For any routed subskill, load it directly from "\$GSD_ROOT/skills/gsd-<target>/SKILL.md". Never use \`skill://\` or ~/.agents/skills/ or readlink.
6. Pass self-contained direct-root instructions to subagent dispatch so subagents do not depend on skill discovery.
EOF

mv "$tmp_target" "$OMP_TARGET"
trap - EXIT

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
