#!/usr/bin/env bash
# Install GSD: register ONLY the `gsd` master entry. Sub-skills are NOT separate
# skills — `/gsd` loads them on demand from its own sibling directory (see the
# "Dynamic Sub-Skill Loading" section of gsd/SKILL.md). One skill, one entry point.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REG="${HOME}/.agents/skills"
mkdir -p "$REG"

# 1. Register the master entry (refresh if already linked).
ln -sfn "$REPO/skills/gsd" "$REG/gsd"

# 2. Remove any stray sub-skill symlinks from older installs that registered them all.
for link in "$REG"/gsd-*; do
  [ -L "$link" ] && rm "$link"
done

echo "Installed: only 'gsd' is registered in $REG (sub-skills load on demand via /gsd)."
