import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import nodeFs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export { existsSync, readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, nodeFs, dirname, join, resolve, tmpdir };

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SKILLS = join(ROOT, "skills");
export const read = (path) => readFileSync(join(ROOT, path), "utf8");
export const skillNames = () => readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("gsd") && existsSync(join(SKILLS, entry.name, "SKILL.md")))
  .map((entry) => entry.name);
export const filesUnder = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
export const markdownFiles = (directory) => filesUnder(directory)
  .filter((path) => path.endsWith(".md"));
export const canonicalPacket = () => ({
  "plan.md": [
    "# Plan",
    "## Feature",
    "`canonical-fixture`",
    "## Base",
    "`main`",
    "## Summary",
    "Validate Markdown plan.",
    "## Context",
    "A tracked inline fixture.",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** Parser-only fixture changes no production domain behavior.",
    "## Scope",
    "- Validate plan",
    "## Acceptance Criteria",
    "### AC-1: Plan parses",
    "- **State:** active",
    "- **Outcome:** A valid plan becomes an execution contract.",
    "- **Action:** Parse the approved Markdown plan.",
    "- **Expected:** Return the matching feature and acceptance criterion.",
    "- **Scenario:** GIVEN a canonical plan WHEN the parser reads it THEN it returns the matching feature and criterion.",
    "## Decisions",
    "None.",
    "## Invariants",
    "- **I-1:** Approved source bytes remain immutable.",
    "## Non-goals",
    "- **NG-1:** Runtime TOON is not edited by the parser.",
    "## Interfaces",
    "| Criterion | Seam | Path | Lower-seam reason |",
    "| --- | --- | --- | --- |",
    "| AC-1 | parser | `test/skills.test.js` | none |",
    "## Tasks",
    "### T1: Parse plan",
    "- **Satisfies:** AC-1",
    "- **Files:**",
    "  - `test/skills.test.js` — modify: exercise the canonical parser fixture",
    "- **Test:** `bun test test/skills.test.js`",
    "- **Status:** pending",
    "",
  ].join("\n"),
});

// Single source of truth for the canonical fixture's Files block. Tests replace
// against these constants so a drifted literal fails loudly instead of no-oping.
export const FILES_BLOCK = "- **Files:**\n  - `test/skills.test.js` — modify: exercise the canonical parser fixture";
export const T1_BLOCK = `### T1: Parse plan\n- **Satisfies:** AC-1\n${FILES_BLOCK}\n- **Test:** \`bun test test/skills.test.js\`\n- **Status:** pending`;
export const INTERFACE_ROW = "| AC-1 | parser | `test/skills.test.js` | none |";
export const replaceOnce = (source, needle, replacement) => {
  const count = source.split(needle).length - 1;
  assert.equal(count, 1, `fixture needle must occur exactly once: ${needle.slice(0, 60)}`);
  return source.replace(needle, replacement);
};

export const structuredPacket = () => {
  const packet = canonicalPacket();
  packet["plan.md"] = replaceOnce(
    packet["plan.md"],
    FILES_BLOCK,
    "- **Files:**\n  - `src/new.js` — create: expose the planned public entrypoint\n  - `src/current.js` — modify: enforce the approved behavior contract\n  - `src/obsolete.js` — delete: remove the superseded runtime path",
  );
  return packet;
};
