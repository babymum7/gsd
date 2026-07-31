import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import nodeFs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  bindApprovedSources, parseMarkdownPacket, parseQuickFixPlan, rejectLegacyPreapprovalFiles,
  sha256, verifyApprovedSources, validateSectionEdges,
} from "../../lib/gsd-contract.mjs";
import {
  parseActivationResponse, responseMatchesFixture, selectEvalBackend, validateActivationTarget,
  validateFixtureSet,
} from "../eval/activation-eval-contract.mjs";
import gsdContextExtension, { CAPSULE_TEMPLATE } from "../../extensions/gsd-context.js";

export { existsSync, readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, nodeFs, dirname, join, resolve, tmpdir };

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SKILLS = join(ROOT, "skills");
export const read = (path) => readFileSync(join(ROOT, path), "utf8");
export function parseAgentFrontmatter(content, label) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new Error(`${label}: missing frontmatter`);
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) throw new Error(`${label}: unterminated frontmatter`);
  const sourceLines = normalized.slice(4, end).split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  const scalar = (value) => {
    if (value === "") return {};
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
    return value;
  };
  const parseBlock = (start, indent) => {
    const isList = sourceLines[start]?.indent === indent && sourceLines[start].text.startsWith("- ");
    const result = isList ? [] : {};
    let index = start;
    while (index < sourceLines.length && sourceLines[index].indent === indent) {
      const { text } = sourceLines[index];
      if (isList) {
        if (!text.startsWith("- ")) break;
        result.push(scalar(text.slice(2).trim()));
        index++;
        continue;
      }
      const match = text.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/);
      if (!match) throw new Error(`${label}: malformed frontmatter line "${text}"`);
      const [, key, rawValue = ""] = match;
      if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error(`${label}: duplicate ${key}`);
      if (rawValue !== "") {
        result[key] = scalar(rawValue);
        index++;
        continue;
      }
      if (sourceLines[index + 1]?.indent > indent) {
        [result[key], index] = parseBlock(index + 1, sourceLines[index + 1].indent);
      } else {
        result[key] = {};
        index++;
      }
    }
    return [result, index];
  };
  const [frontmatter, next] = parseBlock(0, sourceLines[0]?.indent ?? 0);
  assert.equal(next, sourceLines.length, `${label}: unparsed frontmatter`);
  return frontmatter;
}
export const skillNames = () => readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("gsd") && existsSync(join(SKILLS, entry.name, "SKILL.md")))
  .map((entry) => entry.name);
export const visibleSkillNames = () => skillNames().filter((name) =>
  parseAgentFrontmatter(read(`skills/${name}/SKILL.md`), name).hide !== true);
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
    "## UI Impact",
    "- **Classification:** none",
    "- **Surfaces:** none",
    "- **Prototype:** none",
    "- **Evidence:** Parser-only fixture renders no user-facing surface and converts no locked prototype.",
    "## Scope",
    "- Validate plan",
    "## Acceptance Criteria",
    "### AC-1: Plan parses",
    "- **State:** active",
    "- **Outcome:** A valid plan becomes an execution contract.",
    "- **Action:** Parse the approved Markdown plan.",
    "- **Expected:** Return the matching feature and acceptance criterion.",
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
    "## Publication",
    "null",
    "## Tasks",
    "### T1: Parse plan",
    "- **Satisfies:** AC-1",
    "- **Files:**",
    "  - `test/skills.test.js` — modify: exercise the canonical parser fixture",
    "- **Test:** `node --test test/skills.test.js`",
    "- **Status:** pending",
    "",
  ].join("\n"),
});

// Single source of truth for the canonical fixture's Files block. Tests replace
// against these constants so a drifted literal fails loudly instead of no-oping.
export const FILES_BLOCK = "- **Files:**\n  - `test/skills.test.js` — modify: exercise the canonical parser fixture";
export const filesBlockWith = (...entries) => [FILES_BLOCK, ...entries].join("\n");
export const T1_BLOCK = `### T1: Parse plan\n- **Satisfies:** AC-1\n${FILES_BLOCK}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** pending`;
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

