import { test } from "bun:test";
import assert from "node:assert/strict";
import { filesUnder, ROOT } from "./support/skills-fixtures.js";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

// The harness keeps its own todo list, so plan progress was invisible there while `state.toon`
// held the truth. Mirroring must not create a second authority. Slow suites also needed servers
// that a plain shell call leaks past the merge gate.

// Decision 0009 locks the host-adapter boundary: `lib/`, `tools/`, and `skills/` are the
// harness-generic core, and every host's coupling lives behind `adapters/<host>/` (the OMP
// surfaces were re-homed to `adapters/omp/` by decision 0015, with the `extensions/
// gsd-context.js` entry kept as a thin shim). Nothing enforced
// that, so a stray `omp config` in a tool or an
// `omp/task/` name in a skill would silently break the portability contract of decision 0004.
test("AC: the harness-generic core never names harness identifiers", () => {
  const HARNESS_PATTERNS = [
    /OMP_/,
    // A bare host name is the same leak as an env prefix. `lib/gsd-bootstrap.mjs`
    // shipped "continue with ordinary OMP behavior" in its fail-closed diagnostic,
    // which forced the Claude Code and Codex adapters to string-replace the core's
    // bytes; decision 0012 §1 says the core names no host identifier at all.
    /\bOMP\b/,
    /\bClaude\b/,
    /\bCodex\b/,
    /PI_CODING_AGENT_DIR/,
    /PI_PROFILE/,
    /pi\.on\(/,
    /pi\.logger/,
    /pi\.sendMessage/,
    /\.omp\//,
    /omp config/,
    /omp\/task\//,
    /session\.compacting/,
    /event\.messages/,
  ];
  // Decision 0009's deferred de-drift round landed: the canon's Current Request
  // Preservation no longer names this harness's event tokens, so the guard now
  // fails on any harness identifier anywhere in lib, tools, and skills with no
  // exception left.
  for (const [label, directory] of [["lib", "lib"], ["tools", "tools"], ["skills", "skills"]]) {
    for (const file of filesUnder(join(ROOT, directory))) {
      const content = readFileSync(file, "utf8");
      const relativePath = relative(ROOT, file);
      for (const pattern of HARNESS_PATTERNS) {
        const match = content.match(pattern);
        assert.ok(
          match === null,
          `${label}: ${relativePath} must not name a harness identifier (found ${String(pattern)}: ${match?.[0]})`,
        );
      }
    }
  }
});
