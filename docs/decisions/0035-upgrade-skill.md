# 0035 — Explicit-only upgrade skill with a 14-day release age

- **Status:** Accepted
- **Date:** 2026-10-13

## Decision

`gsd-upgrade` is a third explicit-only skill, separate from `gsd-refactor`. It measures packages from every manifest, plus engines and toolchains pinned in project files, CI workflows, and Dockerfiles, and picks for each the newest stable release published at least 14 days ago, majors included; a newer release is reported as held back. Publish dates come from the registry, never from memory. One approval covers the targets, the breaking changes and API adoptions found in changelogs, and the Delivery.

Patch and minor upgrades form one part; each major upgrade and each engine or toolchain change is its own part. In each part the first task raises the version, letting the package manager rewrite the lockfile, and fixes what breaks; the second adopts the new APIs. Behavior stays the same with every suite green; a target whose new version changes observable behavior is held back and reported. Parts run on an integration branch merged into the base once. When everything is current the skill reports that and stops without a plan. `gsd-refactor` lists outdated dependencies as a finding that recommends `gsd-upgrade` and never upgrades itself.

## Rationale

The pet-game owner wants libraries kept current and the code moved to new APIs, and expects to run this repeatedly. A separate skill stops cheaply when nothing is outdated instead of re-running the whole refactor measurement. Hijacked package releases are usually caught within days, so a 14-day floor trades two weeks of freshness for that window. One part per major keeps a failing upgrade from blocking the others.
