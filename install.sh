#!/usr/bin/env bash
# Stable root entry point. The OMP installer was re-homed under adapters/omp/
# (decision 0015), so this file forwards every argument and the environment to
# adapters/omp/install.sh. Keeping the root path working means `bash install.sh`
# and the documented install command are unchanged.
set -euo pipefail
# Keep pwd's terminator behind a sentinel so path-ending CR/LF survives, exactly
# as adapters/omp/install.sh does — a trailing-newline repository root must reach
# the installer intact so its own path validation can reject it.
REPO_WITH_SENTINEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P && printf "x")"
REPO="${REPO_WITH_SENTINEL%??}"
exec bash "${REPO}/adapters/omp/install.sh" "$@"
