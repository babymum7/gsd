// Canonical surface fixes for a plan: `normalize-plan` proposes them as a diff and, with
// --write, rewrites the plan through the same pinned directory chain that reads it.
import fs from "node:fs";
import path from "node:path";
import { CANONICAL_PLAN_SECTIONS, fail, failIo, readPlanFile, resolvePlanLocation } from "./gsd-contract.mjs";
import { removeIfSameFile, syncDirectory, withPinnedDirectoryChain, writeFully } from "./gsd-fs.mjs";
import { generateUnifiedDiff } from "./gsd-unified-diff.mjs";

export function normalizePlan(content) {
  if (typeof content !== "string") {
    fail("plan content must be a string", "pass a string containing plan content");
  }
  const rawLines = content.split("\n");
  const fixes = [];
  const lines = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const rawLine = rawLines[i];
    const stripped = rawLine.replace(/[ \t]+$/, "");
    if (stripped !== rawLine) {
      fixes.push({
        type: "trailing-whitespace",
        line: i + 1,
        from: rawLine,
        to: stripped,
      });
    }
    lines.push(stripped);
  }

  // A known section written at another level, case, or spacing would be absorbed into the
  // section above it; the validator rejects it, and its exact spelling is the only reading.
  const sectionByLowerName = new Map(CANONICAL_PLAN_SECTIONS.map((name) => [name.toLowerCase(), name]));
  for (let i = 0; i < lines.length; i += 1) {
    const near = lines[i].match(/^#{1,6}[ \t]*(.*?)[ \t]*$/);
    const name = near && sectionByLowerName.get(near[1].toLowerCase());
    if (name && lines[i] !== `## ${name}`) {
      fixes.push({ type: "heading", line: i + 1, from: lines[i], to: `## ${name}` });
      lines[i] = `## ${name}`;
    }
  }

  // Markdown habit puts a blank line around every heading and between blocks. The grammar
  // rejects those one section per run, and none of them carries content, so they go: every
  // blank line next to a heading, and every blank line inside the line-structured sections.
  // A blank line between two paragraphs of free prose stays for the validator to judge.
  const STRUCTURED = new Set(["Repos", "Domain Impact", "Acceptance Criteria", "Decisions", "Invariants", "Non-goals", "Interfaces", "Tasks"]);
  const isHeading = (line) => line !== undefined && /^#{1,3} /.test(line);
  const unspaced = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("## ")) current = line.slice(3);
    if (line === "") {
      let next = i + 1;
      while (next < lines.length && lines[next] === "") next += 1;
      const atEnd = next === lines.length;
      if (!atEnd && (isHeading(unspaced.at(-1)) || isHeading(lines[next]) || STRUCTURED.has(current))) {
        fixes.push({ type: "blank-line", line: i + 1, from: "", to: "" });
        continue;
      }
    }
    unspaced.push(line);
  }
  lines.length = 0;
  lines.push(...unspaced);

  // Wrap unwrapped scalar values of ## Feature and ## Base
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "## Feature" || line === "## Base") {
      const heading = line.slice(3);
      if (i + 1 < lines.length) {
        const valLine = lines[i + 1];
        if (valLine.length > 0 && !valLine.startsWith("#")) {
          const isWrapped = /^`[^`]+`$/.test(valLine);
          if (!isWrapped) {
            // A stray backtick on one side would otherwise end up doubled inside the wrap.
            const wrapped = `\`${valLine.replace(/`/g, "")}\``;
            fixes.push({
              type: "wrap-scalar",
              line: i + 2,
              heading,
              from: valLine,
              to: wrapped,
            });
            lines[i + 1] = wrapped;
          }
        }
      }
    }
  }

  // Contexts must be sorted; the order carries no meaning, so sorting is a pure surface fix.
  // Duplicates and malformed values stay for the validator to reject.
  let inDomainImpact = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) inDomainImpact = lines[i] === "## Domain Impact";
    const match = inDomainImpact ? /^(- \*\*Contexts:\*\* )(.+)$/.exec(lines[i]) : null;
    if (!match || match[2] === "none") continue;
    const sorted = match[2].split(", ").sort().join(", ");
    if (sorted === match[2]) continue;
    fixes.push({ type: "sort-contexts", line: i + 1, from: match[2], to: sorted });
    lines[i] = `${match[1]}${sorted}`;
  }

  // Strip trailing empty lines before section extraction so terminal newline doesn't pollute the last section
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  // Reorder known top-level sections into canonical order
  if (lines.length > 0 && lines[0] === "# Plan") {
    // Only proceed if there is no preamble between # Plan and the first ## section
    if (lines.length > 1 && lines[1].startsWith("## ")) {
      const sections = [];
      let currentSection = null;
      for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].startsWith("## ")) {
          if (currentSection !== null) {
            currentSection.lines = lines.slice(currentSection.startLine, i);
            sections.push(currentSection);
          }
          currentSection = { heading: lines[i].slice(3), startLine: i };
        }
      }
      if (currentSection !== null) {
        currentSection.lines = lines.slice(currentSection.startLine, lines.length);
        sections.push(currentSection);
      }

      const foundHeadings = sections.map((s) => s.heading);
      const headingSet = new Set(foundHeadings);
      // Sort the present sections into canonical order when every heading is known and
      // unique; an unknown or repeated heading leaves the file for the validator to reject.
      const canSort =
        headingSet.size === foundHeadings.length &&
        foundHeadings.every((h) => CANONICAL_PLAN_SECTIONS.includes(h));

      if (canSort) {
        const ordered = CANONICAL_PLAN_SECTIONS.filter((h) => headingSet.has(h));
        const isOutOfOrder = ordered.some((h, index) => foundHeadings[index] !== h);
        if (isOutOfOrder) {
          const sectionMap = new Map(sections.map((s) => [s.heading, s.lines]));
          const newLines = [lines[0]];
          for (const heading of ordered) {
            newLines.push(...sectionMap.get(heading));
          }
          lines.length = 0;
          lines.push(...newLines);
          fixes.push({
            type: "reorder-sections",
            line: 2,
            from: foundHeadings,
            to: ordered,
          });
        }
      }
    }
  }

  // Ensure exactly one terminal newline
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const normalized = lines.length > 0 ? lines.join("\n") + "\n" : "\n";
  if (normalized !== content && !fixes.some((f) => f.type === "terminal-newline" || f.type === "trailing-newlines")) {
    if (!content.endsWith("\n")) {
      fixes.push({
        type: "terminal-newline",
        line: lines.length,
        from: "",
        to: "\\n",
      });
    } else if (content.endsWith("\n\n")) {
      fixes.push({
        type: "trailing-newlines",
        line: lines.length + 1,
        from: "\\n\\n",
        to: "\\n",
      });
    }
  }

  return {
    content: normalized,
    fixes,
  };
}

export function normalizePlanFile(planPath, { cwd = process.cwd(), write = false } = {}) {
  const source = readPlanFile(planPath, { cwd });
  const normalized = normalizePlan(source.content);
  const diff = generateUnifiedDiff(planPath, source.content, normalized.content);

  if (write && normalized.fixes.length > 0) {
    const location = resolvePlanLocation(planPath, cwd);
    const { expected } = location;
    const workspaceRoot = path.resolve(location.absolute, "..", "..", "..");
    const hops = [
      { name: workspaceRoot, identity: { dev: expected.rootDev, ino: expected.rootIno } },
      { name: ".scratch", identity: { dev: expected.scratchDev, ino: expected.scratchIno } },
      { name: location.feature, identity: { dev: expected.featureDev, ino: expected.featureIno } },
    ];

    try {
      withPinnedDirectoryChain(hops, () => {
        const temp = `.plan.md.${process.pid}.${Date.now()}.tmp`;
        let fd;
        // Set once this call has created the temp file, so cleanup removes only that file.
        let tempIdentity = null;
        try {
          try {
            const flags =
              fs.constants.O_WRONLY |
              fs.constants.O_CREAT |
              fs.constants.O_EXCL |
              (fs.constants.O_NOFOLLOW ?? 0);
            // The rewrite replaces the plan, so it keeps the plan's permissions.
            const mode = fs.lstatSync("plan.md").mode & 0o7777;
            fd = fs.openSync(temp, flags, 0o600);
            const opened = fs.fstatSync(fd);
            tempIdentity = { dev: opened.dev, ino: opened.ino };
            fs.fchmodSync(fd, mode);
            writeFully(fd, normalized.content);
            fs.fsyncSync(fd);
          } finally {
            if (fd !== undefined) {
              try {
                fs.closeSync(fd);
              } catch {
                /* ignore */
              }
            }
          }

          fs.renameSync(temp, "plan.md");
        } catch (error) {
          if (tempIdentity) removeIfSameFile(temp, tempIdentity);
          throw error;
        }
        syncDirectory(".");
      });
    } catch (error) {
      failIo(`cannot write normalized plan file: ${error.message}`);
    }
  }

  return {
    fixed: normalized.fixes.length > 0,
    fixes: normalized.fixes,
    diff,
    content: normalized.content,
    path: source.path,
  };
}
