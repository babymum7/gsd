---
name: gsd-upgrade
description: "Explicit only: raise dependencies, engines, and toolchains to the newest release at least 14 days old, approve once, then adopt the new APIs."
disable-model-invocation: true
disableModelInvocation: true
produces: [plan.md]
consumes: [AGENTS.md, CLAUDE.md, docs/domain/index.md]
---

# Upgrade

Runs only when the user asks for it: `/gsd:gsd-upgrade`, or a request to upgrade this repository's dependencies. Works in any Git repository, with or without GSD, and is meant to run again whenever the owner wants: when every target is already current, report that and stop without a plan. A single named version bump stays a quick fix.

## Measure

Read-only. For each target, the newest stable release published at least 14 days ago; a newer release is listed as held back with its date. Read publish dates from the registry (`npm view <package> time`, `go list -m -json <module>@<version>`, the PyPI or crates.io JSON API), never from memory. Skip prereleases.

- **Packages:** every manifest in the repository, with its package manager's own outdated command (`npm outdated`, `bun outdated`, `pnpm outdated`, `go list -u -m all`, `pip list --outdated`, `cargo outdated` when installed).
- **Engines and toolchains:** engine and runtime versions pinned in project files, version files, CI workflows, and Dockerfiles (for example a game engine version, `node-version`, `go` directives, `rust-toolchain.toml`, `FROM` image tags), checked against the project's official release page.
- **Changelogs:** for each major upgrade and each minor that deprecates something, read the release notes or migration guide and list the breaking changes, the deprecated APIs this repository calls (with paths), and new APIs that would replace code here.
- **Pins:** a version pinned on purpose (a comment, a decision record, a peer constraint) is listed as doubtful and left unselected.

## Approval

Present in one message: the targets with current, chosen, and held-back versions; the breaking changes and API adoptions found, with paths; the parts below; and the Delivery question from `gsd-brainstorming`. The user approves all, a subset, or an edited list once; after that the run asks nothing more.

## Run

- Patch and minor upgrades together are one part. Each major upgrade and each engine or toolchain change is its own part, so a failure isolates to one target.
- Within a part, the first task raises the version in the manifest and lets the package manager rewrite the lockfile (never edit a lockfile by hand), then fixes what breaks; a second task adopts the new APIs: replace deprecated calls and code the new version makes redundant. Behavior stays the same: the whole suite, slow suites included, stays green after each task.
- A library change that alters observable behavior is kept out: hold that target at its last working version and report why. Never weaken a test to make an upgrade pass.
- Read `GSD_ROOT/skills/gsd-to-plan/SKILL.md` and plan feature `upgrade-<area>`; several parts run back to back on an integration branch that merges into the base once, as `gsd-brainstorming` describes. Then follow `gsd-executing-plans` and `gsd-verify` to the end and deliver as approved.
- Without GSD in the repository, add `.scratch/` to `.git/info/exclude` before writing the plan.

The final report lists each target's old and new version, the targets held back and why, the code changed to the new APIs, and any decision made on the way.
