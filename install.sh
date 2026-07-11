#!/usr/bin/env bash
# Install GSD: register the `gsd` master entry AND every gsd-* sub-skill.
# Full registration lets the harness resolve skill://gsd-<sub> directly — no
# path-resolution turn per sub-skill. /gsd stays the only user-facing command;
# sub-skills are internal routing targets (each carries a direct-invocation guard).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
AGENTS_DIR="${HOME}/.agents"
REG="$AGENTS_DIR/skills"
if [ -L "$AGENTS_DIR" ]; then
  echo "error: registration parent $AGENTS_DIR is a symlink; move or remove it, then rerun install.sh." >&2
  exit 1
fi
if [ -e "$AGENTS_DIR" ] && [ ! -d "$AGENTS_DIR" ]; then
  echo "error: registration parent $AGENTS_DIR exists and is not a directory; move or remove it, then rerun install.sh." >&2
  exit 1
fi
if [ -L "$REG" ]; then
  echo "error: registration path $REG is a symlink; move or remove it, then rerun install.sh." >&2
  exit 1
fi
if [ -e "$REG" ] && [ ! -d "$REG" ]; then
  echo "error: registration path $REG exists and is not a directory; move or remove it, then rerun install.sh." >&2
  exit 1
fi

# 1. Register every skill (refresh if already linked): master + sub-skills.
# Preflight every target before mutating the registry so a late collision cannot
# leave an earlier subset refreshed.
skill_dirs=()
for dir in "$REPO"/skills/gsd*; do
  [ -d "$dir" ] || continue
  skill_dirs+=("$dir")
  target="$REG/$(basename "$dir")"
  if [ -L "$target" ]; then
    if ! resolved_target="$(cd -P "$target" 2>/dev/null && pwd -P)"; then
      resolved_target=""
    fi
    if [ "$resolved_target" != "$dir" ]; then
      echo "error: $target existing symlink does not point to this checkout; move or remove it, then rerun install.sh." >&2
      exit 1
    fi
  elif [ -e "$target" ]; then
    echo "error: $target exists and is not a symlink; move or remove it, then rerun install.sh." >&2
    exit 1
  fi
done
mkdir -p "$REG"

for dir in "${skill_dirs[@]}"; do
  target="$REG/$(basename "$dir")"
  ln -sfn "$dir" "$target"
done

# 2. Ensure the lavish-axi submodule is present (optional visual surface; skills degrade to terminal if absent/unbuilt).
if [ -f "$REPO/.gitmodules" ]; then
  git -C "$REPO" submodule update --init --recursive >/dev/null 2>&1 \
    || echo "  warn: lavish-axi submodule not initialized — lavish HTML path unavailable; skills degrade to terminal."
fi

# 3. Build lavish-axi when possible (dist missing + pnpm available); otherwise skills degrade to terminal.
LAVISH="$REPO/tools/lavish-axi"
if [ -d "$LAVISH" ] && [ ! -f "$LAVISH/dist/cli.mjs" ] && command -v pnpm >/dev/null 2>&1; then
  echo "  building lavish-axi (pnpm install && pnpm build)..."
  (cd "$LAVISH" && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm build >/dev/null 2>&1) \
    || echo "  warn: lavish-axi build failed — lavish HTML path unavailable; skills degrade to terminal."
fi

VERSION="$(cat "$REPO/VERSION" 2>/dev/null || echo unknown)"
COUNT="${#skill_dirs[@]}"
LAVISH_STATE="lavish visual path ready (dist/cli.mjs present)"
[ -f "$LAVISH/dist/cli.mjs" ] || LAVISH_STATE="lavish not built — install pnpm and re-run, or: cd tools/lavish-axi && pnpm i && pnpm build"
echo "Installed GSD v$VERSION: registered $COUNT skills in $REG (user entry: /gsd only — gsd-* are internal routing targets). $LAVISH_STATE."
