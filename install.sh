#!/usr/bin/env bash
# Install GSD: register the `gsd` master entry AND every gsd-* sub-skill.
# Full registration lets the harness resolve skill://gsd-<sub> directly — no
# path-resolution turn per sub-skill. /gsd stays the only user-facing command;
# sub-skills are internal routing targets (each carries a direct-invocation guard).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REG="${HOME}/.agents/skills"
mkdir -p "$REG"

# 1. Register every skill (refresh if already linked): master + sub-skills.
for dir in "$REPO"/skills/gsd*; do
  [ -d "$dir" ] && ln -sfn "$dir" "$REG/$(basename "$dir")"
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
COUNT="$(ls -d "$REPO"/skills/gsd* 2>/dev/null | wc -l | tr -d ' ')"
LAVISH_STATE="lavish visual path ready (dist/cli.mjs present)"
[ -f "$LAVISH/dist/cli.mjs" ] || LAVISH_STATE="lavish not built — install pnpm and re-run, or: cd tools/lavish-axi && pnpm i && pnpm build"
echo "Installed GSD v$VERSION: registered $COUNT skills in $REG (user entry: /gsd only — gsd-* are internal routing targets). $LAVISH_STATE."
