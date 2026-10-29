// Scaffolds `.scratch/<feature>/plan.md` for `init-plan`, never over an existing plan; the
// validator rejects every `<slot>` the scaffold leaves for the author to fill.
import fs from "node:fs";
import path from "node:path";
import {
  ENVIRONMENT_IO_ERRNOS,
  fail,
  failIo,
  inspectPlanDirectories,
  isSafeBranchRef,
  locatePlanInWorkspace,
} from "./gsd-contract.mjs";
import { withPinnedDirectoryChain, writeFully } from "./gsd-fs.mjs";

export function initPlanFile(planPath, { base, cwd = process.cwd() } = {}) {
  if (typeof planPath !== "string" || planPath === "") {
    fail("plan path is required", "provide a valid plan path");
  }
  if (typeof cwd !== "string" || cwd === "") {
    fail("workspace path is required", "provide a valid workspace root path");
  }
  if (typeof base !== "string" || base === "") {
    fail("base branch is required", "specify a base branch with --base");
  }
  if (!isSafeBranchRef(base)) {
    fail("base branch must be one Git branch name able to receive a merge", "specify a safe branch name for --base");
  }

  const { workspace, absolute, feature } = locatePlanInWorkspace(planPath, cwd);

  // The WIP branch is cut from the base, so scaffolding with the packet's own WIP branch
  // as base would produce a plan the validator always rejects: block before any write.
  if (base === `wip/${feature}`) {
    fail(`Base must name the branch the packet was cut from, never its own WIP branch wip/${feature}`, "name the base branch the packet was cut from, not the WIP branch");
  }
  const scratch = path.join(workspace, ".scratch");
  const featureDirectory = path.join(scratch, feature);

  let scratchInspected = null;
  try {
    scratchInspected = fs.lstatSync(scratch);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      if (ENVIRONMENT_IO_ERRNOS.has(error.code)) {
        failIo(".scratch cannot be inspected: " + error.message);
      }
      fail(".scratch cannot be inspected: " + error.message, "ensure .scratch is accessible");
    }
  }
  if (scratchInspected && (scratchInspected.isSymbolicLink() || !scratchInspected.isDirectory())) {
    fail(".scratch must be a real directory", "ensure .scratch is a directory and not a symlink");
  }

  try {
    fs.mkdirSync(featureDirectory, { recursive: true });
  } catch (error) {
    if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
      failIo(`feature directory cannot be created: ${error.message}`);
    }
    fail(`feature directory cannot be created: ${error.message}`, "ensure the feature directory can be created");
  }

  const expected = inspectPlanDirectories(workspace, feature);

  const hops = [
    { name: workspace, identity: { dev: expected.rootDev, ino: expected.rootIno } },
    { name: ".scratch", identity: { dev: expected.scratchDev, ino: expected.scratchIno } },
    { name: feature, identity: { dev: expected.featureDev, ino: expected.featureIno } },
  ];

  const content = [
    "# Plan",
    "## Feature",
    `\`${feature}\``,
    "## Base",
    `\`${base}\``,
    "## Summary",
    "<one concrete outcome>",
    "## Context",
    "<bounded context>",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** <concrete code/schema/contract evidence>",
    "## Scope",
    "- <included behavior>",
    "## Acceptance Criteria",
    "### AC-1: <title>",
    "- **State:** active",
    "- **Scenario:** GIVEN <precondition> WHEN <operation> THEN <observable result>.",
    "## Decisions",
    "None.",
    "## Invariants",
    "- **I-1:** <must remain true>",
    "## Non-goals",
    "- **NG-1:** <explicit exclusion>",
    "## Interfaces",
    "| Criterion | Seam | Path | Lower-seam reason |",
    "| --- | --- | --- | --- |",
    "| AC-1 | <public seam> | `<repository-relative path>` | none |",
    "## Tasks",
    "### T1: <short task>",
    "- **Satisfies:** AC-1",
    "- **Files:**",
    "  - `<repository-relative path>` \u2014 create: <intent>",
    "- **Test:** `<focused test command>`",
    "- **Status:** pending",
    "",
  ].join("\n");

  try {
    withPinnedDirectoryChain(hops, () => {
      let stat;
      try {
        stat = fs.lstatSync("plan.md");
      } catch (error) {
        if (error.code !== "ENOENT") {
          if (ENVIRONMENT_IO_ERRNOS.has(error.code)) {
            failIo(`plan file cannot be inspected: ${error.message}`);
          }
          fail(`plan file cannot be inspected: ${error.message}`);
        }
      }
      if (stat) {
        if (stat.isSymbolicLink()) {
          fail("plan file is a symlink", "replace the symlink with a regular file");
        }
        const existsErr = new Error("Markdown contract: plan file already exists");
        existsErr.contractCode = "plan-exists";
        existsErr.contractFailure = "plan-exists";
        existsErr.code = "plan-exists";
        existsErr.hint = "do not overwrite existing plan files; choose another feature name or edit the existing plan";
        throw existsErr;
      }

      const flags =
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0);
      let fd;
      try {
        try {
          fd = fs.openSync("plan.md", flags, 0o644);
        } catch (error) {
          if (error.code === "ELOOP") {
            fail("plan file is a symlink", "replace the symlink with a regular file");
          }
          if (error.code === "EEXIST") {
            let existingStat;
            try {
              existingStat = fs.lstatSync("plan.md");
            } catch {
              /* ignore */
            }
            if (existingStat && existingStat.isSymbolicLink()) {
              fail("plan file is a symlink", "replace the symlink with a regular file");
            }
            const existsErr = new Error("Markdown contract: plan file already exists");
            existsErr.contractCode = "plan-exists";
            existsErr.contractFailure = "plan-exists";
            existsErr.code = "plan-exists";
            existsErr.hint = "do not overwrite existing plan files; choose another feature name or edit the existing plan";
            throw existsErr;
          }
          if (ENVIRONMENT_IO_ERRNOS.has(error.code)) {
            failIo(`cannot create plan file: ${error.message}`);
          }
          fail(`cannot create plan file: ${error.message}`);
        }

        try {
          writeFully(fd, content);
          fs.fsyncSync(fd);
        } finally {
          try {
            fs.closeSync(fd);
          } catch {
            /* ignore */
          }
        }

        let dirFd;
        try {
          const dirFlags =
            fs.constants.O_RDONLY |
            (fs.constants.O_DIRECTORY ?? 0) |
            (fs.constants.O_NOFOLLOW ?? 0);
          dirFd = fs.openSync(".", dirFlags);
          fs.fsyncSync(dirFd);
        } catch {
          // Directory fsync is best-effort where unsupported.
        } finally {
          if (dirFd !== undefined) {
            try {
              fs.closeSync(dirFd);
            } catch {
              /* ignore */
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Markdown contract:")) {
          throw error;
        }
        if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
          failIo(`cannot write plan file: ${error.message}`);
        }
        fail(`cannot write plan file: ${error.message}`);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Markdown contract:")) throw error;
    failIo(`cannot create plan file: ${error.message}`);
  }

  return {
    feature,
    base,
    path: absolute,
    content,
    bytes: Buffer.from(content, "utf8"),
  };
}
