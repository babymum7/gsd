import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

import gsdContextExtension, {
  createCapsule,
  CAPSULE_TEMPLATE,
  detectCandidates,
  parseSkillMetadata,
  discoverSkillCatalog,
  createBootstrap,
  messageContainsBootstrap,
  firstNonCompactionSummaryIndex,
} from "../extensions/gsd-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REFERENCE_PATH = join(ROOT, "skills/gsd/REFERENCE.md");

// Independent generic renderer derived from the documented constants in REFERENCE.md
function getContractFromReference() {
  const referenceContent = readFileSync(REFERENCE_PATH, "utf8");
  
  const match = referenceContent.match(/#### Compaction Recovery Capsule[\s\S]*?```text\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(match, "Failed to locate Compaction Recovery Capsule text block in REFERENCE.md");
  const template = match[1].replace(/\r\n/g, "\n");

  const normalMatch = referenceContent.match(/For Normal mode[\s\S]*?`([^`]{30,})`/);
  assert.ok(normalMatch, "Failed to locate Normal instruction in REFERENCE.md");
  const normalInstruction = normalMatch[1];

  const ambiguityMatch = referenceContent.match(/For Bounded-Ambiguity mode[\s\S]*?`([^`]{30,})`/);
  assert.ok(ambiguityMatch, "Failed to locate Bounded-Ambiguity instruction in REFERENCE.md");
  const ambiguityInstruction = ambiguityMatch[1];
  return { template, normalInstruction, ambiguityInstruction };
}

function testIndependentRenderer(features, gsdRoot) {
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error("At least one active feature is required");
  }
  if (!gsdRoot || typeof gsdRoot !== 'string') {
    throw new Error("GSD_ROOT is a required capsule input");
  }
  if (!isAbsolute(gsdRoot)) {
    throw new Error("GSD_ROOT must be an absolute path");
  }
  if (/[\x00-\x1F\x7F]/.test(gsdRoot)) {
    throw new Error("GSD_ROOT contains invalid control characters");
  }

  const rootBytes = Buffer.byteLength(gsdRoot, 'utf8');
  if (rootBytes > 1024) {
    throw new Error("GSD_ROOT path length exceeds limit of 1024 bytes");
  }

  const masterPath = `${gsdRoot}/skills/gsd/SKILL.md`;
  const masterPathBytes = Buffer.byteLength(masterPath, 'utf8');
  if (masterPathBytes > 1024) {
    throw new Error("Emitted master path length exceeds limit of 1024 bytes");
  }

  const seen = new Set();
  for (const feature of features) {
    if (typeof feature !== 'string') {
      throw new Error("Feature must be a string");
    }
    const slugBytes = Buffer.byteLength(feature, 'utf8');
    if (slugBytes > 255) {
      throw new Error("Feature slug exceeds field length cap of 255 bytes");
    }
    if (/[\x00-\x1F\x7F]/.test(feature)) {
      throw new Error("Invalid feature slug: must be kebab-case (control characters are rejected)");
    }
    if (/[/\\.]/.test(feature)) {
      throw new Error("Invalid feature slug: must be kebab-case (path separators or dots are rejected)");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature)) {
      throw new Error("Invalid feature slug: must be kebab-case");
    }
    if (seen.has(feature)) {
      throw new Error("Duplicate features are not allowed");
    }
    seen.add(feature);
  }

  const { template, normalInstruction, ambiguityInstruction } = getContractFromReference();
  const sorted = [...features].sort();
  const isOverCap = features.length > 5;
  const prefix = isOverCap ? sorted.slice(0, 5) : sorted;
  const omittedCount = isOverCap ? features.length - 5 : 0;

  let featuresStr = prefix.join(", ");
  if (isOverCap) {
    featuresStr += ` (and ${omittedCount} more)`;
  }

  const resumeInstruction = isOverCap ? ambiguityInstruction : normalInstruction;

  const capsule = template
    .replace("<features>", featuresStr)
    .replace("<GSD_ROOT>/skills/gsd/SKILL.md", masterPath)
    .replace("<resume_instruction>", resumeInstruction);

  const capsuleBytes = Buffer.byteLength(capsule, 'utf8');
  if (capsuleBytes > 4000) {
    throw new Error(`Complete capsule size (${capsuleBytes} bytes) exceeds limit of 4000 bytes`);
  }

  return capsule;
}
test("capsule extension production API contract", (t) => {
  // 1. Proving byte identity with the generic skill contract
  t.test("proves byte identity between REFERENCE.md template and JS extension", () => {
    const referenceContent = readFileSync(REFERENCE_PATH, "utf8");
    
    // Extract the text block under #### Compaction Recovery Capsule
    const match = referenceContent.match(/#### Compaction Recovery Capsule[\s\S]*?```text\r?\n([\s\S]*?)\r?\n```/);
    assert.ok(match, "Failed to locate Compaction Recovery Capsule text block in REFERENCE.md");
    
    const extractedTemplate = match[1].replace(/\r\n/g, "\n");
    const normalizedTemplate = CAPSULE_TEMPLATE.replace(/\r\n/g, "\n");
    
    assert.equal(normalizedTemplate, extractedTemplate, "Drift detected: CAPSULE_TEMPLATE does not match REFERENCE.md exactly");
  });

  // 2. Bounded output
  t.test("proves capsule output is bounded in size", () => {
    const capsule1 = createCapsule(["feature-a"], ROOT);
    assert.ok(capsule1.length > 200, "Capsule too short");
    assert.ok(Buffer.byteLength(capsule1, 'utf8') < 4000, "Capsule too long");

    const capsule2 = createCapsule(["feat1", "feat-two", "feat-three"], ROOT);
    assert.ok(Buffer.byteLength(capsule2, 'utf8') < 4000, "Capsule too long with multiple features");
  });

  // 3. Exact order
  t.test("proves exact order of rehydration steps is preserved", () => {
    const capsule = createCapsule(["feature-a"], ROOT);
    
    const step1Idx = capsule.indexOf("1. Use the already-loaded GSD bootstrap from ");
    const step2Idx = capsule.indexOf("2. Load gsd-handoff from the injected catalog and perform exactly one validated resume.");
    
    assert.ok(step1Idx !== -1, "Step 1 missing");
    assert.ok(step2Idx !== -1, "Step 2 missing");
    assert.ok(step1Idx < step2Idx, "Step 1 must precede Step 2");
  });

  // 4. Safe serialization of feature names/paths and hardening
  t.test("proves safe serialization of feature names and paths", () => {
    // Empty feature list should throw
    assert.throws(() => {
      createCapsule([], ROOT);
    }, /At least one active feature is required/);

    // Mismatched types should throw
    assert.throws(() => {
      createCapsule(null, ROOT);
    });

    // Check stable alphabetical sorting (stable slug order)
    const capsule = createCapsule(["feat-z", "feat-a", "feat-m"], ROOT);
    assert.match(capsule, /Active GSD features: feat-a, feat-m, feat-z/);
    assert.match(capsule, /Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features\./);

    // Invalid names (paths, spaces, capitals, etc.) should throw
    const invalidFeatures = ["pkg/auth", "dbMigration", "app test", "feat_a", "feat.", "../escape"];
    for (const feat of invalidFeatures) {
      assert.throws(() => {
        createCapsule([feat], ROOT);
      }, /Invalid feature slug: must be kebab-case/);
    }

    // Duplicates should throw
    assert.throws(() => {
      createCapsule(["feat-a", "feat-a"], ROOT);
    }, /Duplicate features are not allowed/);

    // Candidate count cap (max 5) - wait, over-cap now emits ambiguity capsule instead of throwing, unless we test direct creation or another cap?
    // Wait, the change says: "for over-cap active candidates emit a deterministic bounded ambiguity capsule"
    // So createCapsule with 6 features does NOT throw, it returns a capsule.
    // But wait! Is there still a candidate count cap check?
    // Let's check: "for over-cap active candidates emit a deterministic bounded ambiguity capsule"
    // So we don't throw on features.length > 5, but we can verify it contains "and 1 more" and the "Stop immediately" step.
    // Let's update this assertion to test that it returns the ambiguity capsule!
    const ambiguityCapsule = createCapsule(["f-1", "f-2", "f-3", "f-4", "f-5", "f-6"], ROOT);
    assert.match(ambiguityCapsule, /Active GSD features: f-1, f-2, f-3, f-4, f-5 \(and 1 more\)/);
    assert.match(ambiguityCapsule, /2\. Stop immediately and select exactly one active feature to resume\./);

    // Five maximum-length (255-byte) valid slugs do NOT throw and yield a capsule < 4000 bytes
    const maxLengthFeatures = Array.from({ length: 5 }, (_, i) => "a".repeat(253) + "-" + i);
    const maxCapsule = createCapsule(maxLengthFeatures, ROOT);
    assert.ok(Buffer.byteLength(maxCapsule, 'utf8') < 4000, "Capsule with five 255-byte slugs must be under 4000 bytes");
    assert.doesNotThrow(() => {
      createCapsule(maxLengthFeatures, ROOT);
    });
    
    // Explicit feature-field length cap (max 255)
    assert.throws(() => {
      createCapsule(["a".repeat(256)], ROOT);
    }, /Feature slug exceeds field length cap/);
    // Unsafe/control/path names
    assert.throws(() => {
      createCapsule(["feat\x00name"], ROOT);
    }, /control characters are rejected/);
    assert.throws(() => {
      createCapsule(["feat/../name"], ROOT);
    }, /path separators or dots are rejected/);
  });

  // 5. Ambiguity/unrelated stop language
  t.test("proves ambiguity/unrelated stop language exists", () => {
    const capsule = createCapsule(["feature-a"], ROOT);
    const stopLanguage = "Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features.";
    assert.ok(capsule.includes(stopLanguage), "Stop language missing or mismatch");
  });

  // 6. No model-specific wording
  t.test("proves no model-specific wording exists in the capsule", () => {
    const capsule = createCapsule(["feature-a"], ROOT);
    
    // List of model-specific keywords to ban
    const banned = ["gpt", "gemini", "claude", "llama", "openai", "anthropic", "google", "deepmind", "copilot", "chatgpt"];
    
    for (const word of banned) {
      const regex = new RegExp(`\\b${word}\\b`, "i");
      assert.doesNotMatch(capsule, regex, `Capsule contains banned model-specific wording: ${word}`);
    }
  });


  // 7. Test production extension factory with filesystem fixtures and fake OMP API
  t.test("tests production extension factory with filesystem fixtures and fake OMP API", async () => {
    // Set up temp workspace directory
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-test-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    try {
      // Setup mock candidates
      // Candidate 1: valid candidate
      const feat1 = "feat-one";
      const feat1Dir = join(scratchDir, feat1);
      mkdirSync(feat1Dir);
      writeFileSync(join(feat1Dir, "plan.md"), "plan");
      writeFileSync(join(feat1Dir, "handoff-1.toon"), "handoff");

      // Candidate 2: invalid candidate (no plan.md)
      const feat2 = "feat-two";
      const feat2Dir = join(scratchDir, feat2);
      mkdirSync(feat2Dir);
      writeFileSync(join(feat2Dir, "handoff-1.toon"), "handoff");

      // Candidate 3: invalid candidate (no handoff)
      const feat3 = "feat-three";
      const feat3Dir = join(scratchDir, feat3);
      mkdirSync(feat3Dir);
      writeFileSync(join(feat3Dir, "plan.md"), "plan");

      // Candidate 4: invalid candidate (has result.toon)
      const feat4 = "feat-four";
      const feat4Dir = join(scratchDir, feat4);
      mkdirSync(feat4Dir);
      writeFileSync(join(feat4Dir, "plan.md"), "plan");
      writeFileSync(join(feat4Dir, "handoff-2.toon"), "handoff");
      writeFileSync(join(feat4Dir, "result.toon"), "result");

      // Candidate 5: invalid candidate (non kebab-case name)
      const feat5 = "feat_five";
      const feat5Dir = join(scratchDir, feat5);
      mkdirSync(feat5Dir);
      writeFileSync(join(feat5Dir, "plan.md"), "plan");
      writeFileSync(join(feat5Dir, "handoff-1.toon"), "handoff");

      // Candidate 6: valid candidate
      const feat6 = "feat-six";
      const feat6Dir = join(scratchDir, feat6);
      mkdirSync(feat6Dir);
      writeFileSync(join(feat6Dir, "plan.md"), "plan");
      writeFileSync(join(feat6Dir, "handoff-5.toon"), "handoff");

      // Candidate 7: overlong otherwise-active candidate (>255 UTF-8 bytes, has plan.md and handoff-1.toon)
      // On POSIX filesystems, component length cap is 255 bytes so mkdirSync of >255 bytes fails at OS layer.
      // We intercept fs.readdirSync for scratchDir to present a Dirent for an overlong directory.
      const feat7 = "feat-overlong-" + "a".repeat(250);
      const realReaddirSync = require("node:fs").readdirSync;
      let candidates;
      try {
        require("node:fs").readdirSync = function(p, opts) {
          const res = realReaddirSync.call(this, p, opts);
          if (p === scratchDir && opts?.withFileTypes) {
            return [
              ...res,
              {
                name: feat7,
                isDirectory: () => true,
                isFile: () => false,
                isSymbolicLink: () => false
              }
            ];
          }
          return res;
        };

        // 1. Test detectCandidates
        candidates = detectCandidates(tempDir);
      } finally {
        require("node:fs").readdirSync = realReaddirSync;
      }
      // Expected active candidates sorted: feat-one, feat-six (overlong candidate feat7 is skipped)
      assert.deepEqual(candidates, ["feat-one", "feat-six"]);
      // 2. Test fake OMP API and event registration
      const registeredEvents = {};
      const sentMessages = [];

      const piMock = {
        on: (event, handler) => {
          registeredEvents[event] = handler;
        },
        sendMessage: async (message, options) => {
          sentMessages.push({ message, options });
        }
      };

      const ctxMock = {
        cwd: tempDir
      };

      // Load extension factory
      gsdContextExtension(piMock);

      // Verify exact event registration
      assert.ok(registeredEvents["session.compacting"], "session.compacting handler not registered");
      assert.ok(registeredEvents["session_compact"], "session_compact handler not registered");

      // Trigger session.compacting handler
      const compactingResult = await registeredEvents["session.compacting"]({}, ctxMock);
      assert.ok(compactingResult.context, "Compacting result should contain context");
      assert.equal(compactingResult.context.length, 1);
      
      const injectedCapsule = compactingResult.context[0];
      assert.match(injectedCapsule, /Active GSD features: feat-one, feat-six/);
      assert.match(injectedCapsule, /skills\/gsd\/SKILL\.md/); // exact root/master path

      // Trigger session_compact handler
      await registeredEvents["session_compact"]({}, ctxMock);

      // Verify sentMessages options (nextTurn/no-trigger options)
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].message, injectedCapsule);
      assert.deepEqual(sentMessages[0].options, { deliverAs: "nextTurn", triggerTurn: false });

      // Trigger session_compact again without compacting -> should not send since pending state was cleared
      await registeredEvents["session_compact"]({}, ctxMock);
      assert.equal(sentMessages.length, 1, "Should not send when pending state is cleared");

      // Trigger session.compacting and session_compact again -> should send unconditionally (repeated compaction)
      await registeredEvents["session.compacting"]({}, ctxMock);
      await registeredEvents["session_compact"]({}, ctxMock);
      assert.equal(sentMessages.length, 2, "Repeated compaction should send unconditionally");

      // Test inert behavior (empty candidates)
      const emptyTempDir = mkdtempSync(join(tmpdir(), "omp-gsd-empty-"));
      const emptyCtx = { cwd: emptyTempDir };

      const emptyCompactingResult = await registeredEvents["session.compacting"]({}, emptyCtx);
      assert.deepEqual(emptyCompactingResult, {}, "Inert compacting should return empty object");

      const beforeSendCount = sentMessages.length;
      await registeredEvents["session_compact"]({}, emptyCtx);
      assert.equal(sentMessages.length, beforeSendCount, "No message should be sent when inert");

      rmSync(emptyTempDir, { recursive: true, force: true });
    } finally {
      // Clean up tempDir workspace
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

test("T3 Review Fixes detailed behavior", async (t) => {
  // 1. Symlink root derivation test:
  // "Update behavioral tests to prove absolute real-root emission via a symlink-loaded extension"
  await t.test("proves absolute real-root emission via a symlink-loaded extension", async () => {
    const symlinkDir = mkdtempSync(join(tmpdir(), "omp-gsd-symlink-"));
    const symlinkPath = join(symlinkDir, "gsd-context-symlink.js");
    const realExtensionPath = join(ROOT, "extensions/gsd-context.js");
    
    // Create symlink
    symlinkSync(realExtensionPath, symlinkPath);
    
    // Load extension via symlink
    const { default: symlinkExtensionFactory } = await import(
      `${pathToFileURL(symlinkPath).href}?symlink-test=${Date.now()}`,
    );
    
    // Setup mock pi
    const registeredEvents = {};
    const piMock = {
      on: (event, handler) => {
        registeredEvents[event] = handler;
      }
    };
    
    // Run factory
    symlinkExtensionFactory(piMock);
    
    // Create mock temp workspace
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-symlink-ws-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);
    const featDir = join(scratchDir, "symlink-feat");
    mkdirSync(featDir);
    writeFileSync(join(featDir, "plan.md"), "plan");
    writeFileSync(join(featDir, "handoff-1.toon"), "handoff");
    
    try {
      const compactResult = await registeredEvents["session.compacting"]({}, { cwd: tempDir });
      assert.ok(compactResult.context);
      assert.equal(compactResult.context.length, 1);
      
      const capsule = compactResult.context[0];
      // Derived root must be the real workspace root of the extension (ROOT), not symlinkDir or tempDir
      const realRootPath = realpathSync(ROOT);
      const expectedPath = join(realRootPath, "skills/gsd/SKILL.md");
      assert.match(capsule, new RegExp(expectedPath.replace(/\\/g, "\\\\")));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(symlinkDir, { recursive: true, force: true });
    }
  });

  // 2. Exact byte identity and no filesystem rediscovery divergence test:
  await t.test("proves exact byte identity between both hooks and no filesystem rediscovery divergence", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-identity-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);
    const featDir = join(scratchDir, "identity-feat");
    mkdirSync(featDir);
    writeFileSync(join(featDir, "plan.md"), "plan");
    writeFileSync(join(featDir, "handoff-1.toon"), "handoff");

    try {
      const registeredEvents = {};
      const sentMessages = [];
      const piMock = {
        on: (event, handler) => { registeredEvents[event] = handler; },
        sendMessage: async (message, options) => { sentMessages.push({ message, options }); }
      };

      gsdContextExtension(piMock);

      // 1. Compacting
      const compactResult = await registeredEvents["session.compacting"]({}, { cwd: tempDir });
      const capsuleCompacting = compactResult.context[0];

      // 2. Modify filesystem (remove all candidates to cause divergence if rediscovered)
      rmSync(scratchDir, { recursive: true, force: true });

      // 3. Compacted
      await registeredEvents["session_compact"]({}, { cwd: tempDir });

      // Verify that session_compact sent the EXACT same capsule bytes computed during compacting,
      // proving no filesystem rediscovery divergence and exact byte identity.
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].message, capsuleCompacting);
      assert.deepEqual(sentMessages[0].options, { deliverAs: "nextTurn", triggerTurn: false });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 3. Over-cap lifecycle behavior and stable ambiguity test:
  await t.test("proves over-cap lifecycle behavior and stable ambiguity", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-overcap-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    // Create 6 valid features (exceeding cap of 5)
    const features = ["feat-f", "feat-e", "feat-d", "feat-c", "feat-b", "feat-a"];
    for (const feat of features) {
      const featDir = join(scratchDir, feat);
      mkdirSync(featDir);
      writeFileSync(join(featDir, "plan.md"), "plan");
      writeFileSync(join(featDir, "handoff-1.toon"), "handoff");
    }

    try {
      const registeredEvents = {};
      const sentMessages = [];
      const piMock = {
        on: (event, handler) => { registeredEvents[event] = handler; },
        sendMessage: async (message, options) => { sentMessages.push({ message, options }); }
      };

      gsdContextExtension(piMock);

      // Compacting
      const compactResult = await registeredEvents["session.compacting"]({}, { cwd: tempDir });
      assert.ok(compactResult.context);
      assert.equal(compactResult.context.length, 1);

      const capsule = compactResult.context[0];
      
      // Sorted alphabetically: feat-a, feat-b, feat-c, feat-d, feat-e, feat-f
      // Prefix is first 5: feat-a, feat-b, feat-c, feat-d, feat-e
      // Omitted: feat-f (1 more)
      assert.match(capsule, /Active GSD features: feat-a, feat-b, feat-c, feat-d, feat-e \(and 1 more\)/);
      assert.match(capsule, /2\. Stop immediately and select exactly one active feature to resume\./);

      // Compacted
      await registeredEvents["session_compact"]({}, { cwd: tempDir });
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].message, capsule);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 4. Regular-file / symlink impostor inertness test:
  await t.test("proves regular-file/symlink impostor inertness", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-inertness-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    // Feature 1: plan.md is a directory
    const f1Dir = join(scratchDir, "feat-one");
    mkdirSync(f1Dir);
    mkdirSync(join(f1Dir, "plan.md")); // directory impostor
    writeFileSync(join(f1Dir, "handoff-1.toon"), "handoff");

    // Feature 2: handoff-1.toon is a directory
    const f2Dir = join(scratchDir, "feat-two");
    mkdirSync(f2Dir);
    writeFileSync(join(f2Dir, "plan.md"), "plan");
    mkdirSync(join(f2Dir, "handoff-1.toon")); // directory impostor

    // Feature 3: plan.md is a symlink
    const f3Dir = join(scratchDir, "feat-three");
    mkdirSync(f3Dir);
    const targetFile = join(tempDir, "dummy.txt");
    writeFileSync(targetFile, "dummy");
    symlinkSync(targetFile, join(f3Dir, "plan.md")); // symlink impostor
    writeFileSync(join(f3Dir, "handoff-1.toon"), "handoff");

    // Feature 4: handoff-1.toon is a symlink
    const f4Dir = join(scratchDir, "feat-four");
    mkdirSync(f4Dir);
    writeFileSync(join(f4Dir, "plan.md"), "plan");
    symlinkSync(targetFile, join(f4Dir, "handoff-1.toon")); // symlink impostor

    try {
      const candidates = detectCandidates(tempDir);
      // All must be inert, so candidate list should be empty
      assert.deepEqual(candidates, []);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 5. recursion/repeated capsule instructions test:
  await t.test("proves no recursion/repeated capsule instructions in master or handoff", () => {
    const master = readFileSync(join(ROOT, "skills/gsd/SKILL.md"), "utf8");
    const handoff = readFileSync(join(ROOT, "skills/gsd-handoff/SKILL.md"), "utf8");
    const reference = readFileSync(join(ROOT, "skills/gsd/REFERENCE.md"), "utf8");

    // Proves that recovery resumes through handoff without invoking the capsule again
    assert.match(master, /Do not invoke or execute the capsule again, avoiding circular re-entry/);
    
    // Proves handoff does not tell ordinary processing to reload the same bootstrap/capsule
    assert.match(handoff, /without circular re-entry, capsule execution, or duplicated action/);

    // Proves REFERENCE.md specifies no recursive master loading
    assert.match(reference, /never load master recursively or execute the capsule again/);
  });

  // 6. five maximum-length valid slugs through both hooks test:
  await t.test("proves five maximum-length valid slugs through both hooks", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-maxlen-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    const maxLengthFeatures = Array.from({ length: 5 }, (_, i) => "a".repeat(253) + "-" + i);
    for (const feat of maxLengthFeatures) {
      const featDir = join(scratchDir, feat);
      mkdirSync(featDir);
      writeFileSync(join(featDir, "plan.md"), "plan");
      writeFileSync(join(featDir, "handoff-1.toon"), "handoff");
    }

    try {
      const registeredEvents = {};
      const sentMessages = [];
      const piMock = {
        on: (event, handler) => { registeredEvents[event] = handler; },
        sendMessage: async (message, options) => { sentMessages.push({ message, options }); }
      };

      gsdContextExtension(piMock);

      const compactResult = await registeredEvents["session.compacting"]({}, { cwd: tempDir });
      assert.ok(compactResult.context);
      assert.equal(compactResult.context.length, 1);

      const capsule = compactResult.context[0];
      assert.ok(Buffer.byteLength(capsule, "utf8") < 2000, "Capsule must be under 2000 bytes even for five 255-byte slugs");

      await registeredEvents["session_compact"]({}, { cwd: tempDir });
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].message, capsule);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 7. result.toon directory/symlink impostors test:
  await t.test("proves result.toon directory/symlink impostor inertness", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-result-impostor-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    // Feature 1: result.toon is a directory
    const f1Dir = join(scratchDir, "feat-one");
    mkdirSync(f1Dir);
    writeFileSync(join(f1Dir, "plan.md"), "plan");
    writeFileSync(join(f1Dir, "handoff-1.toon"), "handoff");
    mkdirSync(join(f1Dir, "result.toon")); // directory impostor

    // Feature 2: result.toon is a symlink
    const f2Dir = join(scratchDir, "feat-two");
    mkdirSync(f2Dir);
    writeFileSync(join(f2Dir, "plan.md"), "plan");
    writeFileSync(join(f2Dir, "handoff-1.toon"), "handoff");
    const targetFile = join(tempDir, "dummy.txt");
    writeFileSync(targetFile, "dummy");
    symlinkSync(targetFile, join(f2Dir, "result.toon")); // symlink impostor

    try {
      const candidates = detectCandidates(tempDir);
      assert.deepEqual(candidates, [], "Any entry named result.toon must keep the candidate inert");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 8. exact generic/OMP canonical renderer equality including over-cap ambiguity test:
  await t.test("proves exact generic/OMP canonical renderer equality including over-cap ambiguity", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-equality-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    const features = ["feat-f", "feat-e", "feat-d", "feat-c", "feat-b", "feat-a"];
    for (const feat of features) {
      const featDir = join(scratchDir, feat);
      mkdirSync(featDir);
      writeFileSync(join(featDir, "plan.md"), "plan");
      writeFileSync(join(featDir, "handoff-1.toon"), "handoff");
    }

    try {
      const registeredEvents = {};
      const sentMessages = [];
      const piMock = {
        on: (event, handler) => { registeredEvents[event] = handler; },
        sendMessage: async (message, options) => { sentMessages.push({ message, options }); }
      };

      gsdContextExtension(piMock);

      const realRootPath = realpathSync(ROOT);

      // Case 1: Over-cap ambiguity (6 features)
      const compactResult = await registeredEvents["session.compacting"]({}, { cwd: tempDir });
      const hookCapsule = compactResult.context[0];
      
      // 1. Generic expected bytes equal both production hook paths
      const expectedCapsuleOverCap = testIndependentRenderer(features, realRootPath);
      assert.equal(hookCapsule, expectedCapsuleOverCap, "Over-cap hook 1 (compacting) output must match independent renderer exactly");

      await registeredEvents["session_compact"]({}, { cwd: tempDir });
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].message, expectedCapsuleOverCap, "Over-cap hook 2 (compacted) output must match independent renderer exactly");

      // Case 2: Normal multiple (3 features)
      sentMessages.length = 0; // reset
      rmSync(join(scratchDir, "feat-f"), { recursive: true, force: true });
      rmSync(join(scratchDir, "feat-e"), { recursive: true, force: true });
      rmSync(join(scratchDir, "feat-d"), { recursive: true, force: true });

      const compactResult3 = await registeredEvents["session.compacting"]({}, { cwd: tempDir });
      const hookCapsule3 = compactResult3.context[0];
      
      const expectedCapsuleNormal = testIndependentRenderer(["feat-a", "feat-b", "feat-c"], realRootPath);
      assert.equal(hookCapsule3, expectedCapsuleNormal, "Normal hook 1 (compacting) output must match independent renderer exactly");

      await registeredEvents["session_compact"]({}, { cwd: tempDir });
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].message, expectedCapsuleNormal, "Normal hook 2 (compacted) output must match independent renderer exactly");

      // 2. Verify five distinct maximum-length (255-byte) accepted slugs survive exactly and remain distinct
      const maxLengthFeatures = Array.from({ length: 5 }, (_, i) => "a".repeat(253) + "-" + i);
      const maxCapsule = createCapsule(maxLengthFeatures, realRootPath);
      for (const feat of maxLengthFeatures) {
        assert.ok(maxCapsule.includes(feat), `Slug ${feat} must survive exactly`);
        const count = maxCapsule.split(feat).length - 1;
        assert.equal(count, 1, `Slug ${feat} must appear exactly once and remain distinct`);
      }

      // 3. Deep and non-ASCII roots are complete or explicitly rejected at the declared input boundary
      // Deep root within limit (master path = 1004 + 20 = 1024 bytes total)
      const deepRootOk = "/" + "a".repeat(1003); // 1004 bytes total gsdRoot, 1024 bytes master path
      const deepCapsule = createCapsule(["feat-a"], deepRootOk);
      assert.ok(deepCapsule.includes(deepRootOk), "Deep root path within limit must survive exactly");

      // Deep root exceeding limit (1005 bytes gsdRoot -> 1025 bytes master path)
      const deepRootOver = "/" + "a".repeat(1004); // 1005 bytes total gsdRoot
      assert.throws(() => {
        createCapsule(["feat-a"], deepRootOver);
      }, /limit/);

      // Non-ASCII root within limit
      const nonAsciiRootOk = "/path/to/日本語/root";
      const nonAsciiCapsule = createCapsule(["feat-a"], nonAsciiRootOk);
      assert.ok(nonAsciiCapsule.includes(nonAsciiRootOk), "Non-ASCII root path must survive exactly");

      // Non-ASCII root exceeding limit in bytes
      const longNonAsciiRoot = "/path/" + "あ".repeat(340); // 340 * 3 + 6 = 1026 bytes
      assert.throws(() => {
        createCapsule(["feat-a"], longNonAsciiRoot);
      }, /GSD_ROOT path length exceeds limit/);

      // 4. No rendered output is syntactically partial
      assert.ok(maxCapsule.endsWith("Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features."), "Output must end with the final sentence");
      assert.ok(deepCapsule.endsWith("Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features."), "Output must end with the final sentence");

      // 5. Byte count stays within the declared cap (4000 bytes)
      assert.ok(Buffer.byteLength(maxCapsule, 'utf8') <= 4000, "Capsule size must be within the 4000-byte cap");
      assert.ok(Buffer.byteLength(deepCapsule, 'utf8') <= 4000, "Capsule size must be within the 4000-byte cap");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
  await t.test("proves production lifecycle coverage for 1001 candidates without failure", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-1001-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    // Create 1001 valid candidate directories
    for (let i = 1; i <= 1001; i++) {
      const featName = `feat-${String(i).padStart(4, "0")}`;
      const featDir = join(scratchDir, featName);
      mkdirSync(featDir);
      writeFileSync(join(featDir, "plan.md"), "plan");
      writeFileSync(join(featDir, "handoff-1.toon"), "handoff");
    }

    try {
      const registeredEvents = {};
      const sentMessages = [];
      const piMock = {
        on: (event, handler) => { registeredEvents[event] = handler; },
        sendMessage: async (message, options) => { sentMessages.push({ message, options }); }
      };

      gsdContextExtension(piMock);

      const compactResult = await registeredEvents["session.compacting"]({}, { cwd: tempDir });
      assert.ok(compactResult.context, "Compacting context must be returned for 1001 candidates");
      assert.equal(compactResult.context.length, 1);

      const capsule = compactResult.context[0];
      assert.match(capsule, /Active GSD features: feat-0001, feat-0002, feat-0003, feat-0004, feat-0005 \(and 996 more\)/);
      assert.match(capsule, /2\. Stop immediately and select exactly one active feature to resume\./);
      assert.ok(Buffer.byteLength(capsule, "utf8") < 4000, "Capsule size must stay under 4000 bytes");

      await registeredEvents["session_compact"]({}, { cwd: tempDir });
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].message, capsule);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 10. Invalid relative/multiline/control roots:
  await t.test("proves rejection of relative, multiline, and control character roots", () => {
    const validFeatures = ["feat-a"];

    // Relative root
    assert.throws(() => {
      createCapsule(validFeatures, "relative/path/to/root");
    }, /absolute/);

    // Multiline root with LF
    assert.throws(() => {
      createCapsule(validFeatures, "/valid/root\n2. forged instruction");
    }, /control/);

    // Control character NUL
    assert.throws(() => {
      createCapsule(validFeatures, "/valid/\0root");
    }, /control/);

    // Control character CR
    assert.throws(() => {
      createCapsule(validFeatures, "/valid/\rroot");
    }, /control/);

    // Emitted master path exceeding 1024 bytes
    const rootCausingOverMaster = "/" + "a".repeat(1004); // 1005 + 20 = 1025 bytes master path
    assert.throws(() => {
      createCapsule(validFeatures, rootCausingOverMaster);
    }, /limit/);
  });

  // 11. Literal replacement-metacharacter/placeholder paths:
  await t.test("proves literal insertion of special path characters without replacement pattern expansion", () => {
    const specialRoot = "/path/with/$&/and/$'/and/`backticks`/and/<resume_instruction>/and/日本語";
    const capsule = createCapsule(["feat-a"], specialRoot);

    const expectedMasterPath = `${specialRoot}/skills/gsd/SKILL.md`;
    const handWrittenExpected = `[GSD Recovery Capsule]
Active GSD features: feat-a
To resume execution, perform direct-root rehydration in this exact order:
1. Use the already-loaded GSD bootstrap from ${expectedMasterPath}; do not load it again.
2. Load gsd-handoff from the injected catalog and perform exactly one validated resume.
Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features.`;

    assert.equal(capsule, handWrittenExpected, "Capsule must match hand-written expected bytes exactly with literal special characters");
    assert.ok(capsule.includes(expectedMasterPath), "Master path must contain exact literal special characters");
    assert.ok(!capsule.includes("<GSD_ROOT>"), "<GSD_ROOT> placeholder must not be present");
  });

  // 12. Independent generic discovery and byte formula verification:
  await t.test("proves byte budget formula breakdown and exact accounting", () => {
    const realRootPath = realpathSync(ROOT);
    const { template, normalInstruction, ambiguityInstruction } = getContractFromReference();
    const fixedText = template
      .replace("<features>", "")
      .replace("<GSD_ROOT>/skills/gsd/SKILL.md", "")
      .replace("<resume_instruction>", "");

    const fixedTextBytes = Buffer.byteLength(fixedText, "utf8");
    const normalInstructionBytes = Buffer.byteLength(normalInstruction, "utf8");
    const ambiguityInstructionBytes = Buffer.byteLength(ambiguityInstruction, "utf8");

    assert.equal(fixedTextBytes, 299, "Fixed static text must be exactly 299 UTF-8 bytes");
    assert.equal(normalInstructionBytes, 84, "Normal instruction must be exactly 84 UTF-8 bytes");
    assert.equal(ambiguityInstructionBytes, 65, "Bounded-Ambiguity instruction must be exactly 65 UTF-8 bytes");

    const masterPath = `${realRootPath}/skills/gsd/SKILL.md`;
    const masterPathBytes = Buffer.byteLength(masterPath, "utf8");

    // Worst case totals under maximum 1024-byte path limit:
    const normalMaxTotal = 299 + 1024 + 84 + 1283;
    const ambiguityMaxTotal = 299 + 1024 + 65 + 1311;
    assert.equal(normalMaxTotal, 2690, "Normal mode worst-case total under current maxima must be exactly 2690 bytes");
    assert.equal(ambiguityMaxTotal, 2699, "Bounded-Ambiguity mode worst-case total under current maxima must be exactly 2699 bytes");

    const maxSlugs5 = Array.from({ length: 5 }, (_, i) => "a".repeat(253) + "-" + i);
    const capsule5 = createCapsule(maxSlugs5, realRootPath);
    const actualBytes5 = Buffer.byteLength(capsule5, "utf8");

    // Formula calculation for 5 max slugs: 299 (fixed) + masterPathBytes + 84 (normal instruction) + 1283 (max 5 features)
    const expectedFormulaMax5 = 299 + masterPathBytes + 84 + 1283;
    assert.equal(actualBytes5, expectedFormulaMax5, "Actual Normal capsule size must equal byte formula calculation exactly");
    assert.ok(actualBytes5 <= 2690, "Normal mode total must not exceed 2690 bytes");
    assert.ok(actualBytes5 <= 4000, "Normal capsule must be within the 4000-byte cap");

    // Formula calculation for 6 max slugs (ambiguity mode with 1-digit omitted count: 5*255 + 4*2 + " (and 1 more)" [13 bytes] = 1296 bytes)
    const maxSlugs6 = [...maxSlugs5, "a".repeat(253) + "-5"];
    const capsule6 = createCapsule(maxSlugs6, realRootPath);
    const actualBytes6 = Buffer.byteLength(capsule6, "utf8");
    const expectedFormulaMax6 = 299 + masterPathBytes + 65 + 1296;
    assert.equal(actualBytes6, expectedFormulaMax6, "Actual Bounded-Ambiguity capsule size must equal byte formula calculation exactly");
    assert.ok(actualBytes6 <= 4000, "Bounded-Ambiguity capsule must be within the 4000-byte cap");
  });
});

test("automatic GSD bootstrap metadata and catalog contract", async (t) => {
  const makeRoot = () => {
    const root = mkdtempSync(join(tmpdir(), "omp-gsd-bootstrap-"));
    mkdirSync(join(root, "skills"), { recursive: true });
    return root;
  };
  const writeSkill = (root, name, description, body, extra = "") => {
    const directory = join(root, "skills", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${extra}triggers: test\nproduces: []\nconsumes: []\n---\n\n${body}\n`,
    );
  };

  await t.test("parses strict single-line metadata", () => {
    assert.deepEqual(
      parseSkillMetadata(
        '---\nname: gsd-example\ndescription: "Example activation"\nhide: true\ntriggers: test\n---\n\n# Example\n',
        "/tmp/gsd-example/SKILL.md",
      ),
      { name: "gsd-example", description: "Example activation", hidden: true },
    );
    assert.throws(
      () => parseSkillMetadata("---\nname: gsd-example\n---\n", "/tmp/missing.md"),
      /description/,
    );
    assert.throws(
      () => parseSkillMetadata("---\nname: gsd-example\ndescription: unquoted\n---\n", "/tmp/unquoted.md"),
      /JSON-quoted/,
    );
    assert.throws(
      () => parseSkillMetadata('---\nname: gsd-example\ndescription: "one"\ndescription: "two"\n---\n', "/tmp/duplicate.md"),
      /duplicate description/,
    );
    assert.throws(
      () => parseSkillMetadata('---\nname: gsd-example\ndescription: "line\\u0000break"\n---\n', "/tmp/control.md"),
      /control character/,
    );
  });

  await t.test("discovers a deterministic visible catalog and renders only the hidden master body", () => {
    const root = makeRoot();
    try {
      writeSkill(root, "gsd", "Hidden bootstrap", "# Hidden Bootstrap\nAlready loaded.", "hide: true\n");
      writeSkill(root, "gsd-tdd", "TDD helper", "# Test-Driven Development\nFull TDD body.");
      writeSkill(root, "gsd-diagnosing-bugs", "Bug diagnosis", "# Diagnosing Bugs\nFull diagnosis body.");

      const catalog = discoverSkillCatalog(root);
      assert.deepEqual(catalog.map(({ name }) => name), ["gsd-diagnosing-bugs", "gsd-tdd"]);
      assert.ok(catalog.every(({ skillPath }) => isAbsolute(skillPath)));
      assert.ok(catalog.every(({ skillPath }) => realpathSync(skillPath).startsWith(realpathSync(join(root, "skills")))));

      const bootstrap = createBootstrap(root);
      assert.match(bootstrap, /^<GSD_BOOTSTRAP>\ngsd:session-bootstrap:v2\n/);
      assert.match(bootstrap, /# Hidden Bootstrap\nAlready loaded\./);
      assert.match(bootstrap, /"name":"gsd-diagnosing-bugs"/);
      assert.ok(bootstrap.indexOf('"name":"gsd-diagnosing-bugs"') < bootstrap.indexOf('"name":"gsd-tdd"'));
      assert.doesNotMatch(bootstrap, /# Diagnosing Bugs|# Test-Driven Development/);
      assert.match(bootstrap, /<\/GSD_BOOTSTRAP>$/);
      assert.equal(messageContainsBootstrap({ role: "user", content: bootstrap, timestamp: 1 }), true);
      assert.equal(messageContainsBootstrap({ role: "user", content: "ordinary prompt", timestamp: 1 }), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("rejects incomplete, mismatched, and non-regular catalogs", () => {
    const root = makeRoot();
    try {
      writeSkill(root, "gsd", "Hidden bootstrap", "# Bootstrap", "hide: true\n");
      assert.throws(() => discoverSkillCatalog(root), /visible GSD skill catalog is empty/);

      writeSkill(root, "gsd-alpha", "Alpha", "# Alpha");
      writeSkill(root, "gsd-beta", "Beta", "# Beta");
      writeFileSync(
        join(root, "skills", "gsd-beta", "SKILL.md"),
        '---\nname: gsd-wrong\ndescription: "Mismatch"\ntriggers: test\nproduces: []\nconsumes: []\n---\n\n# Mismatch\n',
      );
      assert.throws(() => discoverSkillCatalog(root), /must match directory/);

      rmSync(join(root, "skills", "gsd-beta", "SKILL.md"));
      const outside = join(root, "outside.md");
      writeFileSync(outside, '---\nname: gsd-beta\ndescription: "Outside"\n---\n');
      symlinkSync(outside, join(root, "skills", "gsd-beta", "SKILL.md"));
      assert.throws(() => discoverSkillCatalog(root), /regular SKILL\.md|outside .*skills/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("finds the first non-compaction message", () => {
    assert.equal(firstNonCompactionSummaryIndex([]), 0);
    assert.equal(firstNonCompactionSummaryIndex([
      { role: "compactionSummary", summary: "one" },
      { role: "compactionSummary", summary: "two" },
      { role: "user", content: "continue", timestamp: 1 },
    ]), 2);
  });
});

test("automatic GSD bootstrap lifecycle is cached and idempotent", async () => {
  const events = {};
  const sentMessages = [];
  const loggedErrors = [];
  const piMock = {
    on(event, handler) {
      events[event] = handler;
    },
    async sendMessage(message, options) {
      sentMessages.push({ message, options });
    },
    logger: {
      error(message) {
        loggedErrors.push(message);
      },
    },
  };
  gsdContextExtension(piMock);

  for (const event of [
    "session_start",
    "session_switch",
    "session_branch",
    "session_tree",
    "session.compacting",
    "session_compact",
    "before_agent_start",
    "context",
    "agent_end",
    "session_shutdown",
  ]) {
    assert.equal(typeof events[event], "function", `${event} handler`);
  }

  const registrationContext = await events.context({
    messages: [{ role: "user", content: "first prompt", timestamp: 0 }],
  });
  assert.equal(messageContainsBootstrap(registrationContext.messages[0]), true);
  const baseSystemPrompt = ["base system prompt"];
  const registrationPolicy = await events.before_agent_start({ systemPrompt: baseSystemPrompt });
  assert.deepEqual(baseSystemPrompt, ["base system prompt"], "base system prompt must not be mutated");
  assert.equal(registrationPolicy.systemPrompt[0], baseSystemPrompt[0]);
  assert.match(registrationPolicy.systemPrompt[1], /gsd:system-policy:v1/);
  assert.match(registrationPolicy.systemPrompt[1], /first action MUST be one read tool call/);
  assert.equal(
    await events.before_agent_start({ systemPrompt: registrationPolicy.systemPrompt }),
    undefined,
    "system policy must not duplicate",
  );

  const workspace = mkdtempSync(join(tmpdir(), "omp-gsd-lifecycle-"));
  try {
    await events.session_start({}, { cwd: workspace });
    const original = [{ role: "user", content: "design a feature", timestamp: 1 }];
    const first = await events.context({ messages: original }, { cwd: workspace });
    assert.equal(first.messages.length, 2);
    assert.equal(first.messages[0].role, "user");
    assert.equal(messageContainsBootstrap(first.messages[0]), true);
    assert.equal(first.messages[1], original[0]);

    assert.equal(await events.context({ messages: first.messages }, { cwd: workspace }), undefined);
    const nextProviderRequest = await events.context({ messages: original }, { cwd: workspace });
    assert.equal(messageContainsBootstrap(nextProviderRequest.messages[0]), true);
    await events.session_switch({}, { cwd: workspace });
    assert.equal(await events.context({ messages: first.messages }, { cwd: workspace }), undefined);

    const scratch = join(workspace, ".scratch", "feature-a");
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, "plan.md"), "plan");
    writeFileSync(join(scratch, "handoff-1.toon"), "handoff");
    await events["session.compacting"]({}, { cwd: workspace });
    await events.session_compact({}, { cwd: workspace });
    assert.equal(sentMessages.length, 1);
    assert.deepEqual(sentMessages[0].options, { deliverAs: "nextTurn", triggerTurn: false });

    const compacted = [
      { role: "compactionSummary", summary: "summary" },
      { role: "user", content: "continue", timestamp: 2 },
    ];
    const reinjected = await events.context({ messages: compacted }, { cwd: workspace });
    assert.equal(reinjected.messages[0], compacted[0]);
    assert.equal(messageContainsBootstrap(reinjected.messages[1]), true);
    assert.equal(reinjected.messages[2], compacted[1]);

    await events.agent_end({}, { cwd: workspace });
    const nextTurn = await events.context({ messages: original }, { cwd: workspace });
    assert.equal(messageContainsBootstrap(nextTurn.messages[0]), true);
    assert.deepEqual(loggedErrors, []);

    const nodeFs = require("node:fs");
    const realReadFileSync = nodeFs.readFileSync;
    const masterPath = join(realpathSync(ROOT), "skills", "gsd", "SKILL.md");
    try {
      nodeFs.readFileSync = function(filePath, ...args) {
        if (filePath === masterPath) throw new Error("forced bootstrap read failure");
        return realReadFileSync.call(this, filePath, ...args);
      };
      await events.session_switch({}, { cwd: workspace });
      await events.session_switch({}, { cwd: workspace });
      assert.equal(loggedErrors.length, 1, "same cached bootstrap error logs once");
      const failed = await events.context({ messages: original }, { cwd: workspace });
      assert.match(failed.messages[0].content, /^\[GSD bootstrap unavailable\]/);
      const failedPolicy = await events.before_agent_start({ systemPrompt: baseSystemPrompt });
      assert.match(failedPolicy.systemPrompt[1], /gsd:system-policy:v1/);
      assert.match(failedPolicy.systemPrompt[1], /\[GSD bootstrap unavailable\]/);
    } finally {
      nodeFs.readFileSync = realReadFileSync;
    }

    await events.session_start({}, { cwd: workspace });
    const recovered = await events.context({ messages: original }, { cwd: workspace });
    assert.equal(messageContainsBootstrap(recovered.messages[0]), true);
    await events.session_shutdown({}, { cwd: workspace });
    assert.equal(await events.context({ messages: original }, { cwd: workspace }), undefined);
    assert.equal(
      await events.before_agent_start({ systemPrompt: baseSystemPrompt }),
      undefined,
      "shutdown must disable the per-turn system policy",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
