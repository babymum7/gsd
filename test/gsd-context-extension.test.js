import { test, describe } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, realpathSync, lstatSync, unlinkSync } from "node:fs";
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
  readStateFile,
  writeStateAtomic,
  parseState,
  validateState,
  serializeState,
} from "../extensions/gsd-context.js";

const FIXTURE_PLAN_SHA = "9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386";
function writeActiveStateFixture(featureDir, feature, overrides = {}) {
  writeStateAtomic(featureDir, {
    schema: "v4",
    feature,
    phase: "executing",
    next_action: "start/continue task",
    plan_path: `.scratch/${feature}/plan.md`,
    plan_sha256: FIXTURE_PLAN_SHA,
    base_ref: "main",
    wip_branch: `wip/${feature}`,
    last_green_task: "none",
    last_green_commit: "none",
    autosync: "none",
    cleanup_preference: "none",
    checkpoint_revision: "1",
    ...overrides,
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REFERENCE_PATH = join(ROOT, "skills/gsd/REFERENCE.md");

// Independent generic renderer derived from the documented constants in REFERENCE.md
function getContractFromReference() {
  const referenceContent = readFileSync(REFERENCE_PATH, "utf8");
  
  const match = referenceContent.match(/#### Compaction Recovery Capsule[\s\S]*?```text\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(match, "Failed to locate Compaction Recovery Capsule text block in REFERENCE.md");
  const template = match[1].replace(/\r\n/g, "\n");

  const baseMatch = referenceContent.match(/It delegates routing to the bootstrap:\s*\n\s*`([^`]+)`/);
  assert.ok(baseMatch, "Failed to locate base resume instruction in REFERENCE.md");
  const baseInstruction = baseMatch[1];

  const overCapMatch = referenceContent.match(/additional clause is appended:\s*\n\s*`([^`]+)`/);
  assert.ok(overCapMatch, "Failed to locate over-cap clause in REFERENCE.md");
  const overCapClause = overCapMatch[1];

  const stopMatch = referenceContent.match(/Both modes end with:\s*\n\s*`([^`]+)`/);
  assert.ok(stopMatch, "Failed to locate stop clause in REFERENCE.md");
  const stopClause = stopMatch[1];

  const normalInstruction = baseInstruction + stopClause;
  const ambiguityInstruction = baseInstruction + overCapClause + stopClause;
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
    .replace("<resume_instruction>", resumeInstruction)
    .replace("<masterPath>", masterPath);

  const capsuleBytes = Buffer.byteLength(capsule, 'utf8');
  if (capsuleBytes > 4000) {
    throw new Error(`Complete capsule size (${capsuleBytes} bytes) exceeds limit of 4000 bytes`);
  }

  return capsule;
}
describe("capsule extension production API contract", () => {
  // 1. Proving byte identity with the generic skill contract
  test("proves byte identity between REFERENCE.md template and JS extension", () => {
    const referenceContent = readFileSync(REFERENCE_PATH, "utf8");
    
    // Extract the text block under #### Compaction Recovery Capsule
    const match = referenceContent.match(/#### Compaction Recovery Capsule[\s\S]*?```text\r?\n([\s\S]*?)\r?\n```/);
    assert.ok(match, "Failed to locate Compaction Recovery Capsule text block in REFERENCE.md");
    
    const extractedTemplate = match[1].replace(/\r\n/g, "\n");
    const normalizedTemplate = CAPSULE_TEMPLATE.replace(/\r\n/g, "\n");
    
    assert.equal(normalizedTemplate, extractedTemplate, "Drift detected: CAPSULE_TEMPLATE does not match REFERENCE.md exactly");
  });

  // 2. Bounded output
  test("proves capsule output is bounded in size", () => {
    const capsule1 = createCapsule(["feature-a"], ROOT);
    assert.ok(capsule1.length > 200, "Capsule too short");
    assert.ok(Buffer.byteLength(capsule1, 'utf8') < 4000, "Capsule too long");

    const capsule2 = createCapsule(["feat1", "feat-two", "feat-three"], ROOT);
    assert.ok(Buffer.byteLength(capsule2, 'utf8') < 4000, "Capsule too long with multiple features");
  });

  // 3. Exact order
  test("proves exact order of rehydration steps is preserved", () => {
    const capsule = createCapsule(["feature-a"], ROOT);
    
    const routingIdx = capsule.indexOf("If resuming, follow the bootstrap routing in ");
    const inventoryIdx = capsule.indexOf("workspace inventory only");

    assert.ok(routingIdx !== -1, "Routing instruction missing");
    assert.ok(inventoryIdx !== -1, "Inventory-only wording missing");
    assert.ok(routingIdx > inventoryIdx, "Routing instruction must follow inventory-only wording");
  });

  // 4. Safe serialization of feature names/paths and hardening
  test("proves safe serialization of feature names and paths", () => {
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
    assert.match(capsule, /Compaction MUST preserve and continue the current user request/);

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
    // So we don't throw on features.length > 5, but we can verify it contains "and 1 more" and the selection step.
    // Let's update this assertion to test that it returns the ambiguity capsule!
    const ambiguityCapsule = createCapsule(["f-1", "f-2", "f-3", "f-4", "f-5", "f-6"], ROOT);
    assert.match(ambiguityCapsule, /Active GSD features: f-1, f-2, f-3, f-4, f-5 \(and 1 more\)/);
    assert.match(ambiguityCapsule, /Some features are omitted from this list — stop and select exactly one active feature before resuming\./);

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

  // 5. Workspace inventory and current-request-preservation language
  test("proves workspace inventory and current-request-preservation language exists", () => {
    const capsule = createCapsule(["feature-a"], ROOT);
    assert.ok(capsule.includes("workspace inventory only"), "Workspace inventory language missing");
    assert.ok(capsule.includes("Compaction MUST preserve and continue the current user request"), "Current request preservation language missing");
  });

  // 6. No model-specific wording
  test("proves no model-specific wording exists in the capsule", () => {
    const capsule = createCapsule(["feature-a"], ROOT);
    
    // List of model-specific keywords to ban
    const banned = ["gpt", "gemini", "claude", "llama", "openai", "anthropic", "google", "deepmind", "copilot", "chatgpt"];
    
    for (const word of banned) {
      const regex = new RegExp(`\\b${word}\\b`, "i");
      assert.doesNotMatch(capsule, regex, `Capsule contains banned model-specific wording: ${word}`);
    }
  });


  // 7. Test production extension factory with filesystem fixtures and fake OMP API
  test("tests production extension factory with filesystem fixtures and fake OMP API", async () => {
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
      writeActiveStateFixture(feat1Dir, feat1);

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
      writeActiveStateFixture(feat6Dir, feat6);

      // Overlong slug (>255 bytes) cannot be created on POSIX (NAME_MAX=255).
      // detectCandidates uses fs.opendirSync, so any readdirSync mock is ineffective.
      // createCapsule(["a".repeat(256)]) already validates renderer rejection.
      // detectCandidates simply skips non-existent entries.
      const { candidates } = detectCandidates(tempDir);
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
        },
        logger: {
          error: (...args) => { piMock._lastError = args; },
          warn: (...args) => { piMock._lastWarn = args; },
        },
        _lastError: null,
        _lastWarn: null,
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

      // Repeated compactions in one agent turn must not queue duplicate
      // nextTurn recovery messages for the same upcoming user prompt.
      const secondCompacting = await registeredEvents["session.compacting"]({}, ctxMock);
      assert.deepEqual(secondCompacting.context, [injectedCapsule], "Compaction context remains a single capsule");
      await registeredEvents["session_compact"]({}, ctxMock);
      const thirdCompacting = await registeredEvents["session.compacting"]({}, ctxMock);
      assert.deepEqual(thirdCompacting.context, [injectedCapsule], "Repeated compaction context remains a single capsule");
      await registeredEvents["session_compact"]({}, ctxMock);
      assert.equal(sentMessages.length, 1, "One user turn receives at most one recovery capsule");
      // OMP drains pending nextTurn messages immediately before
      // before_agent_start, so this event is the queue-consumption boundary.
      await registeredEvents["before_agent_start"]({ systemPrompt: [] });
      await registeredEvents["session.compacting"]({}, ctxMock);
      await registeredEvents["session_compact"]({}, ctxMock);
      assert.equal(sentMessages.length, 2, "A new user turn may receive a fresh recovery capsule");

      // Session boundaries must invalidate a capsule prepared by an older
      // compaction cycle.
      await registeredEvents["session.compacting"]({}, ctxMock);
      const beforeSwitchCount = sentMessages.length;
      await registeredEvents["session_switch"]({}, ctxMock);
      await registeredEvents["session_compact"]({}, ctxMock);
      assert.equal(sentMessages.length, beforeSwitchCount, "Session switch clears an unsent capsule");

      // Regression: a compacting failure must clear pendingCapsule so session_compact emits nothing.
      // Step 1 — seed an unsent successful capsule via a valid feature (do NOT call session_compact).
      const seedDir = mkdtempSync(join(tmpdir(), "omp-gsd-seed-"));
      const seedCtx = { cwd: seedDir };
      const seedFeat = join(seedDir, ".scratch", "seed-feature");
      mkdirSync(seedFeat, { recursive: true });
      writeFileSync(join(seedFeat, "plan.md"), "# Plan\n## Feature\n`seed-feature`\n");
      writeFileSync(join(seedFeat, "state.toon"), [
        "schema:v4", "feature:seed-feature", "phase:executing", "next_action:start task T1",
        "plan_path:.scratch/seed-feature/plan.md",
        "plan_sha256:" + "c".repeat(64),
        "base_ref:main", "wip_branch:wip/seed-feature",
        "last_green_task:none", "last_green_commit:none",
        "autosync:none", "cleanup_preference:none", "checkpoint_revision:1",
      ].join("\n") + "\n");
      const seedResult = await registeredEvents["session.compacting"]({}, seedCtx);
      assert.ok(seedResult.context?.length, "seed: compacting returns a nonempty context (pendingCapsule is set)");
      // Step 2 — empty-scan reset: .scratch is a file so detectCandidates
      // returns { candidates: [], defects: [] } early (opendirSync never reached).
      // pendingCapsule must still be cleared.
      const failDir = mkdtempSync(join(tmpdir(), "omp-gsd-empty-"));
      const failCtx = { cwd: failDir };
      mkdirSync(join(failDir, ".scratch"), { recursive: true });
      rmSync(join(failDir, ".scratch"), { recursive: true, force: true });
      writeFileSync(join(failDir, ".scratch"), "not a directory");
      const beforeEmptyCount = sentMessages.length;
      const emptyResult = await registeredEvents["session.compacting"]({}, failCtx);
      assert.deepEqual(emptyResult, {}, "compacting must return {} when .scratch is not a directory");
      await registeredEvents["session_compact"]({}, failCtx);
      assert.equal(sentMessages.length, beforeEmptyCount, "session_compact must not send capsule after empty scan");
      rmSync(seedDir, { recursive: true, force: true });
      rmSync(failDir, { recursive: true, force: true });

      // Step 3 — real structural throw: exceed SCRATCH_ENTRY_LIMIT (2048).
      // detectCandidates reaches opendirSync and readDirectoryEntriesBounded,
      // which throws "entry limit".  The handler catch sets features=[].
      // Seed another capsule first.
      const seedDir2 = mkdtempSync(join(tmpdir(), "omp-gsd-seed2-"));
      const seedCtx2 = { cwd: seedDir2 };
      const seedFeat2 = join(seedDir2, ".scratch", "seed-two");
      mkdirSync(seedFeat2, { recursive: true });
      writeFileSync(join(seedFeat2, "plan.md"), "# Plan\n## Feature\n`seed-two`\n");
      writeFileSync(join(seedFeat2, "state.toon"), [
        "schema:v4", "feature:seed-two", "phase:executing", "next_action:start task T1",
        "plan_path:.scratch/seed-two/plan.md",
        "plan_sha256:" + "d".repeat(64),
        "base_ref:main", "wip_branch:wip/seed-two",
        "last_green_task:none", "last_green_commit:none",
        "autosync:none", "cleanup_preference:none", "checkpoint_revision:1",
      ].join("\n") + "\n");
      const seedResult2 = await registeredEvents["session.compacting"]({}, seedCtx2);
      assert.ok(seedResult2.context?.length, "seed2: compacting returns nonempty context (capsule set before failure)");
      // Create .scratch with >2048 entries to trigger the entry-limit throw.
      const throwDir = mkdtempSync(join(tmpdir(), "omp-gsd-limit-"));
      const throwScratch = join(throwDir, ".scratch");
      mkdirSync(throwScratch, { recursive: true });
      for (let j = 0; j < 2050; j++) {
        mkdirSync(join(throwScratch, `entry-${j}`));
      }
      // Prove detectCandidates itself throws on the overfull dir.
      assert.throws(
        () => detectCandidates(throwDir, { faultTolerant: true }),
        /entry limit/,
        "detectCandidates must throw entry limit on >2048 scratch entries"
      );
      // Now invoke the handler: it catches the throw and logs it.
      const throwCtx = { cwd: throwDir };
      piMock._lastError = null;
      const beforeLimitCount = sentMessages.length;
      const limitResult = await registeredEvents["session.compacting"]({}, throwCtx);
      assert.deepEqual(limitResult, {}, "compacting must return {} when entry limit throws");
      assert.ok(piMock._lastError, "handler must call logger.error on structural failure");
      assert.match(String(piMock._lastError), /entry limit/, "logged error must mention entry limit");
      await registeredEvents["session_compact"]({}, throwCtx);
      assert.equal(sentMessages.length, beforeLimitCount, "session_compact must not send capsule after entry-limit throw");
      rmSync(seedDir2, { recursive: true, force: true });
      rmSync(throwDir, { recursive: true, force: true });

      // A failed compacting pass must not leave the previous successful
      // capsule available to an unrelated session_compact notification.
      await registeredEvents["before_agent_start"]({ systemPrompt: [] });
      await registeredEvents["session.compacting"]({}, ctxMock);
      const malformedDir = join(tempDir, ".scratch", "malformed-state");
      mkdirSync(malformedDir);
      writeFileSync(join(malformedDir, "plan.md"), "plan");
      writeFileSync(join(malformedDir, "state.toon"), "schema:v3\n");
      // Fault containment: malformed state.toon must not throw; valid features
      // survive alongside the bad packet.  The defect is logged, not fatal.
      const result = await registeredEvents["session.compacting"]({}, ctxMock);
      assert.ok(result.context, "compacting must return context (valid features survive)");
      assert.match(result.context[0], /feat-one|feat-six/, "valid features must appear");
      rmSync(malformedDir, { recursive: true, force: true });
      // Compaction succeeded (valid features survived), so session_compact sends a capsule.
      const beforeCompactCycleCount = sentMessages.length;
      await registeredEvents["session_compact"]({}, ctxMock);
      assert.ok(sentMessages.length > beforeCompactCycleCount, "session_compact sends capsule for surviving valid features");
      // Mixed valid + malformed: valid feature must survive alongside a bad packet.
      const mixedDir = mkdtempSync(join(tmpdir(), "omp-gsd-mixed-"));
      const mixedCtx = { cwd: mixedDir };
      // Create valid feature
      const validDir = join(mixedDir, ".scratch", "good-feature");
      mkdirSync(validDir, { recursive: true });
      writeFileSync(join(validDir, "plan.md"), "# Plan\n## Feature\n`good-feature`\n");
      writeFileSync(join(validDir, "state.toon"), [
        "schema:v4", "feature:good-feature", "phase:executing", "next_action:start task T1",
        "plan_path:.scratch/good-feature/plan.md",
        "plan_sha256:" + "b".repeat(64),
        "base_ref:main", "wip_branch:wip/good-feature",
        "last_green_task:none", "last_green_commit:none",
        "autosync:none", "cleanup_preference:none", "checkpoint_revision:1",
      ].join("\n") + "\n");
      // Create malformed feature
      const badDir = join(mixedDir, ".scratch", "bad-feature");
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, "plan.md"), "# Plan\n");
      writeFileSync(join(badDir, "state.toon"), "feature=bad\nphase=wrong\n");
      // Compaction must return context with the valid feature, skipping the bad one
      const mixedResult = await registeredEvents["session.compacting"]({}, mixedCtx);
      assert.ok(mixedResult.context, "mixed scenario must return context array");
      const capsuleText = mixedResult.context[0];
      assert.match(capsuleText, /good-feature/, "valid feature must appear in capsule");
      assert.doesNotMatch(capsuleText, /bad-feature/, "malformed feature must not appear in capsule");
      rmSync(mixedDir, { recursive: true, force: true });

      // Test inert behavior (empty candidates)
      const emptyTempDir = mkdtempSync(join(tmpdir(), "omp-gsd-empty-"));
      const emptyCtx = { cwd: emptyTempDir };

      const emptyCompactingResult = await registeredEvents["session.compacting"]({}, emptyCtx);
      assert.deepEqual(emptyCompactingResult, {}, "Inert compacting should return empty object");

      const beforeSendCount = sentMessages.length;
      await registeredEvents["session_compact"]({}, emptyCtx);
      assert.equal(sentMessages.length, beforeSendCount, "No message should be sent when inert");

      rmSync(emptyTempDir, { recursive: true, force: true });

      // Regression: compaction preserves current user request as separate context item
      {
        const featureDir = join(tempDir, ".scratch", "active-plan");
        mkdirSync(featureDir, { recursive: true });
        writeFileSync(join(featureDir, "plan.md"), "# Plan\n## Feature\n`active-plan`\n");
        writeFileSync(join(featureDir, "state.toon"), [
          "schema:v4", "feature:active-plan", "phase:executing", "next_action:verify",
          "plan_path:.scratch/active-plan/plan.md",
          "plan_sha256:" + "a".repeat(64),
          "base_ref:main", "wip_branch:wip/active-plan",
          "last_green_task:none", "last_green_commit:none",
          "autosync:none", "cleanup_preference:none", "checkpoint_revision:1",
        ].join("\n") + "\n");

        // Simulate: user asked to fix a bug (unrelated to active-plan)
        const messages = [
          { role: "user", content: "Fix the login timeout bug" },
          { role: "assistant", content: "I'll investigate the login timeout." },
          { role: "user", content: "Can you also check the error logs?" },
        ];
        const result = await registeredEvents["session.compacting"]({ messages }, ctxMock);
        assert.ok(Array.isArray(result.context), "Context must be an array");
        assert.equal(result.context.length, 2, "Context must contain capsule and current request");
        assert.match(result.context[0], /\[GSD Recovery Capsule\]/, "First item must be capsule");
        assert.match(result.context[0], /workspace inventory only/, "Capsule must state inventory-only");
        assert.equal(result.context[1], "[GSD Current Request]\nCan you also check the error logs?",
          "Second item must preserve the last genuine user request");

        // No messages: no current request
        const emptyResult = await registeredEvents["session.compacting"]({ messages: [] }, ctxMock);
        assert.equal(emptyResult.context.length, 1, "Empty messages must not add current request");

        // Bootstrap message must be filtered out
        const bootstrapMsg = { role: "user", content: "<GSD_BOOTSTRAP>\ngsd:session-bootstrap:v2\n</GSD_BOOTSTRAP>" };
        const bootstrapResult = await registeredEvents["session.compacting"]({ messages: [bootstrapMsg] }, ctxMock);
        assert.equal(bootstrapResult.context.length, 1, "Bootstrap messages must not become current request");
        // Bootstrap error message must be filtered out
        const errorMsg = { role: "user", content: "[GSD bootstrap unavailable] skills root vanished. Do not improvise a GSD workflow; continue with ordinary OMP behavior." };
        const errorResult = await registeredEvents["session.compacting"]({ messages: [errorMsg] }, ctxMock);
        assert.equal(errorResult.context.length, 1, "Bootstrap error sentinel must not become current request");
        // Genuine request after bootstrap error must be preserved
        const afterErrorResult = await registeredEvents["session.compacting"](
          { messages: [errorMsg, { role: "user", content: "Fix the login bug" }] }, ctxMock);
        assert.equal(afterErrorResult.context.length, 2, "Genuine request after bootstrap error must produce capsule + current request");
        assert.equal(afterErrorResult.context[1], "[GSD Current Request]\nFix the login bug",
          "Genuine request after bootstrap error must be preserved as current request");
        // Bare "continue" must be preserved as [GSD Current Request] — production real path
        const continueMsg = { role: "user", content: "continue" };
        const continueResult = await registeredEvents["session.compacting"]({ messages: [continueMsg] }, ctxMock);
        assert.equal(continueResult.context.length, 2, "Bare continue must produce capsule + current request");
        assert.equal(continueResult.context[1], "[GSD Current Request]\ncontinue",
          "Bare continue must be preserved as-is in the current request context item");
        // Two-compaction idempotence: first compaction emits [GSD Current Request]\n<request>,
        // second compaction receives that as a user message and must unwrap to the same payload.
        const firstCompactResult = await registeredEvents["session.compacting"](
          { messages: [{ role: "user", content: "Fix the login bug" }] }, ctxMock);
        const firstRequest = firstCompactResult.context[1]; // "[GSD Current Request]\nFix the login bug"
        // Simulate second compaction where the only user-context message is the prior output
        const secondCompactResult = await registeredEvents["session.compacting"](
          { messages: [{ role: "user", content: firstRequest }] }, ctxMock);
        assert.equal(secondCompactResult.context.length, 2,
          "Second compaction must still produce capsule + current request");
        assert.equal(secondCompactResult.context[1], firstRequest,
          "Second compaction output must be byte-identical to first — no prefix nesting");
        // Multibyte truncation: must truncate by UTF-8 bytes, not JS char count.
        // Astral test: emoji 🎉 is 4 UTF-8 bytes but 2 JS chars (surrogate pair).
        // Place emoji at the 500-byte boundary and assert it's never split.
        // "X".repeat(496) = 496 bytes, then 🎉 = 4 bytes → total 500 bytes exactly.
        const prefix = "X".repeat(496);
        const astralMsg = { role: "user", content: prefix + "🎉" + "extra" }; // 501 bytes
        const astralResult = await registeredEvents["session.compacting"]({ messages: [astralMsg] }, ctxMock);
        const astralRequest = astralResult.context[1].replace("[GSD Current Request]\n", "");
        const astralBytes = Buffer.byteLength(astralRequest, "utf8");
        assert.ok(astralBytes <= 500, `Astral truncation must be ≤500 bytes, got ${astralBytes}`);
        assert.ok(astralBytes >= 496, `Should keep prefix, got ${astralBytes} bytes`);
        // The emoji must be fully present or fully absent — never half a surrogate pair.
        assert.ok(astralRequest.includes("🎉") || !astralRequest.includes("\uD83C"),
          "Emoji must be whole: fully present or fully absent, never split surrogate pair");
        // Verify the string is valid UTF-8 by re-encoding and comparing byte length.
        assert.equal(Buffer.byteLength(astralRequest, "utf8"), astralBytes,
          "Truncated output must be valid UTF-8");
        // Prove adding the next code point exceeds 500.
        const oneMore = prefix + "🎉🎉"; // 504 bytes — must be truncated
        const oneMoreMsg = { role: "user", content: oneMore };
        const oneMoreResult = await registeredEvents["session.compacting"]({ messages: [oneMoreMsg] }, ctxMock);
        const oneMoreRequest = oneMoreResult.context[1].replace("[GSD Current Request]\n", "");
        assert.ok(Buffer.byteLength(oneMoreRequest, "utf8") <= 500,
          "Two-emoji string must still be truncated to ≤500 bytes");
      }
    } finally {
      // Clean up tempDir workspace
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("T3 Review Fixes detailed behavior", () => {
  // 1. Symlink root derivation test:
  // "Update behavioral tests to prove absolute real-root emission via a symlink-loaded extension"
  test("proves absolute real-root emission via a symlink-loaded extension", async () => {
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
    writeActiveStateFixture(featDir, "symlink-feat");
    
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
  test("proves exact byte identity between both hooks and no filesystem rediscovery divergence", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-identity-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);
    const featDir = join(scratchDir, "identity-feat");
    mkdirSync(featDir);
    writeFileSync(join(featDir, "plan.md"), "plan");
    writeActiveStateFixture(featDir, "identity-feat");

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
  test("proves over-cap lifecycle behavior and stable ambiguity", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-overcap-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    // Create 6 valid features (exceeding cap of 5)
    const features = ["feat-f", "feat-e", "feat-d", "feat-c", "feat-b", "feat-a"];
    for (const feat of features) {
      const featDir = join(scratchDir, feat);
      mkdirSync(featDir);
      writeFileSync(join(featDir, "plan.md"), "plan");
      writeActiveStateFixture(featDir, feat);
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
      assert.match(capsule, /Some features are omitted from this list — stop and select exactly one active feature before resuming\./);

      // Compacted
      await registeredEvents["session_compact"]({}, { cwd: tempDir });
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].message, capsule);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 4. Regular-file / symlink impostor inertness test:
  test("proves regular-file/symlink impostor inertness", async () => {
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
      const { candidates } = detectCandidates(tempDir)
      // All must be inert, so candidate list should be empty
      assert.deepEqual(candidates, []);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // The matrix splits on plan.md: "Malformed residual bytes without a `plan.md`" routes
  // ordinarily, while a full malformed packet fails closed. A defective state.toon was
  // throwing before plan.md was known, so plan-less residue took down every prompt.
  test("proves a defective state.toon fails closed only beside a real plan.md", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-residual-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);
    const target = join(tempDir, "state-target.toon");
    writeFileSync(target, "schema:v4\n");

    // Plan-less residue: a symlink state.toon and a directory state.toon are both left alone.
    const linkOnly = join(scratchDir, "residual-link");
    mkdirSync(linkOnly);
    symlinkSync(target, join(linkOnly, "state.toon"));
    const dirOnly = join(scratchDir, "residual-dir");
    mkdirSync(dirOnly);
    mkdirSync(join(dirOnly, "state.toon"));

    try {
      assert.deepEqual(detectCandidates(tempDir).candidates, []);

      // Adding plan.md turns the same bytes into a full malformed packet.
      writeFileSync(join(linkOnly, "plan.md"), "# Plan\n");
      assert.throws(() => detectCandidates(tempDir), /symlink|state\.toon/i);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 5. recursion/repeated capsule instructions test:
  test("proves no recursion/repeated capsule instructions in master or handoff", () => {
    const master = readFileSync(join(ROOT, "skills/gsd/SKILL.md"), "utf8");
    const handoff = readFileSync(join(ROOT, "skills/gsd-handoff/SKILL.md"), "utf8");
    const reference = readFileSync(join(ROOT, "skills/gsd/REFERENCE.md"), "utf8");

    // Proves that recovery resumes through handoff without invoking the capsule again
    assert.match(master, /Do not invoke or execute the capsule again, avoiding circular re-entry/);
    
    // Proves handoff does not tell ordinary processing to reload the same bootstrap/capsule
    assert.match(handoff, /without circular re-entry[\s\S]{0,60}capsule execution[\s\S]{0,60}duplicated action/i);

    // Proves REFERENCE.md specifies no recursive master loading
    assert.match(reference, /never load master recursively or execute the capsule again/);
  });

  // 6. five maximum-length valid slugs through both hooks test:
  test("proves five maximum-length valid slugs through both hooks", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-maxlen-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    const maxLengthFeatures = Array.from({ length: 5 }, (_, i) => "a".repeat(253) + "-" + i);
    for (const feat of maxLengthFeatures) {
      const featDir = join(scratchDir, feat);
      mkdirSync(featDir);
      writeFileSync(join(featDir, "plan.md"), "plan");
      writeActiveStateFixture(featDir, feat);
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
  test("proves result.toon directory/symlink impostor inertness", async () => {
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
      const { candidates } = detectCandidates(tempDir)
      assert.deepEqual(candidates, [], "Any entry named result.toon must keep the candidate inert");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 8. exact generic/OMP canonical renderer equality including over-cap ambiguity test:
  test("proves exact generic/OMP canonical renderer equality including over-cap ambiguity", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-equality-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    const features = ["feat-f", "feat-e", "feat-d", "feat-c", "feat-b", "feat-a"];
    for (const feat of features) {
      const featDir = join(scratchDir, feat);
      mkdirSync(featDir);
      writeFileSync(join(featDir, "plan.md"), "plan");
      writeActiveStateFixture(featDir, feat);
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
      sentMessages.length = 0;
      await registeredEvents["before_agent_start"]({ systemPrompt: [] });
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
      assert.ok(maxCapsule.endsWith("Compaction MUST preserve and continue the current user request. Only resume an active feature when the preserved request or a bare continue explicitly selects it."), "Output must end with the final sentence");
      assert.ok(deepCapsule.endsWith("Compaction MUST preserve and continue the current user request. Only resume an active feature when the preserved request or a bare continue explicitly selects it."), "Output must end with the final sentence");

      // 5. Byte count stays within the declared cap (4000 bytes)
      assert.ok(Buffer.byteLength(maxCapsule, 'utf8') <= 4000, "Capsule size must be within the 4000-byte cap");
      assert.ok(Buffer.byteLength(deepCapsule, 'utf8') <= 4000, "Capsule size must be within the 4000-byte cap");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
  test("proves production lifecycle coverage for 1001 candidates without failure", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-1001-"));
    const scratchDir = join(tempDir, ".scratch");
    mkdirSync(scratchDir);

    // Create 1001 valid candidate directories
    for (let i = 1; i <= 1001; i++) {
      const featName = `feat-${String(i).padStart(4, "0")}`;
      const featDir = join(scratchDir, featName);
      mkdirSync(featDir);
      writeFileSync(join(featDir, "plan.md"), "plan");
      writeActiveStateFixture(featDir, featName);
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
      assert.match(capsule, /Some features are omitted from this list — stop and select exactly one active feature before resuming\./);
      assert.ok(Buffer.byteLength(capsule, "utf8") < 4000, "Capsule size must stay under 4000 bytes");

      await registeredEvents["session_compact"]({}, { cwd: tempDir });
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].message, capsule);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 10. Invalid relative/multiline/control roots:
  test("proves rejection of relative, multiline, and control character roots", () => {
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
  test("proves literal insertion of special path characters without replacement pattern expansion", () => {
    const specialRoot = "/path/with/$&/and/$'/and/`backticks`/and/<resume_instruction>/and/日本語";
    const capsule = createCapsule(["feat-a"], specialRoot);

    const expectedMasterPath = `${specialRoot}/skills/gsd/SKILL.md`;
    const handWrittenExpected = `[GSD Recovery Capsule]
Active GSD features: feat-a
The listed features are a workspace inventory only and do not indicate which feature the current session is working on.
If resuming, follow the bootstrap routing in ${expectedMasterPath}: bare "continue" selects gsd-handoff; a prompt naming an active feature routes to that feature's owner skill. Stop immediately on malformed or ambiguous state. Otherwise, continue ordinary routing for the current request.
Compaction MUST preserve and continue the current user request. Only resume an active feature when the preserved request or a bare continue explicitly selects it.`;

    assert.equal(capsule, handWrittenExpected, "Capsule must match hand-written expected bytes exactly with literal special characters");
    assert.ok(capsule.includes(expectedMasterPath), "Master path must contain exact literal special characters");
    assert.ok(!capsule.includes("<GSD_ROOT>"), "<GSD_ROOT> placeholder must not be present");
  });

  // 12. Independent generic discovery and byte formula verification:
  test("proves byte budget formula breakdown and exact accounting", () => {
    const realRootPath = realpathSync(ROOT);
    const { template, normalInstruction, ambiguityInstruction } = getContractFromReference();
    const fixedText = template
      .replace("<features>", "")
      .replace("<GSD_ROOT>/skills/gsd/SKILL.md", "")
      .replace("<resume_instruction>", "");

    const fixedTextBytes = Buffer.byteLength(fixedText, "utf8");
    const normalInstructionBytes = Buffer.byteLength(normalInstruction, "utf8");
    const ambiguityInstructionBytes = Buffer.byteLength(ambiguityInstruction, "utf8");

    assert.equal(fixedTextBytes, 328, "Fixed static text must be exactly 328 UTF-8 bytes");
    assert.equal(normalInstructionBytes, 279, "Normal instruction must be exactly 279 UTF-8 bytes");
    assert.equal(ambiguityInstructionBytes, 384, "Bounded-Ambiguity instruction must be exactly 384 UTF-8 bytes");

    const masterPath = `${realRootPath}/skills/gsd/SKILL.md`;
    const masterPathBytes = Buffer.byteLength(masterPath, "utf8");

    const MASTER_PATH_PLACEHOLDER_LEN = Buffer.byteLength("<masterPath>", "utf8");
    const normalInstructionBase = normalInstructionBytes - MASTER_PATH_PLACEHOLDER_LEN;
    const ambiguityInstructionBase = ambiguityInstructionBytes - MASTER_PATH_PLACEHOLDER_LEN;

    // Worst case totals under maximum 1024-byte path limit (instruction bytes exclude <masterPath> placeholder):
    const normalMaxTotal = 328 + 1024 + normalInstructionBase + 1283;
    const ambiguityMaxTotal = 328 + 1024 + ambiguityInstructionBase + 1305;
    assert.equal(normalMaxTotal, 2902, "Normal mode worst-case total under current maxima must be exactly 2902 bytes");
    assert.equal(ambiguityMaxTotal, 3029, "Bounded-Ambiguity mode worst-case total under current maxima must be exactly 3029 bytes");

    const maxSlugs5 = Array.from({ length: 5 }, (_, i) => "a".repeat(253) + "-" + i);
    const capsule5 = createCapsule(maxSlugs5, realRootPath);
    const actualBytes5 = Buffer.byteLength(capsule5, "utf8");

    // Formula calculation for 5 max slugs: 328 (fixed) + masterPathBytes + normalInstructionBase (267) + 1283 (max 5 features)
    const expectedFormulaMax5 = 328 + masterPathBytes + normalInstructionBase + 1283;
    assert.equal(actualBytes5, expectedFormulaMax5, "Actual Normal capsule size must equal byte formula calculation exactly");
    assert.ok(actualBytes5 <= 2902, "Normal mode total must not exceed 2902 bytes");
    assert.ok(actualBytes5 <= 4000, "Normal capsule must be within the 4000-byte cap");

    // Formula calculation for 6 max slugs (ambiguity mode with 1-digit omitted count: 5*255 + 4*2 + " (and 1 more)" [13 bytes] = 1296 bytes)
    const maxSlugs6 = [...maxSlugs5, "a".repeat(253) + "-5"];
    const capsule6 = createCapsule(maxSlugs6, realRootPath);
    const actualBytes6 = Buffer.byteLength(capsule6, "utf8");
    const expectedFormulaMax6 = 328 + masterPathBytes + ambiguityInstructionBase + 1296;
    assert.equal(actualBytes6, expectedFormulaMax6, "Actual Bounded-Ambiguity capsule size must equal byte formula calculation exactly");
    assert.ok(actualBytes6 <= 4000, "Bounded-Ambiguity capsule must be within the 4000-byte cap");
  });
});
describe("automatic GSD bootstrap metadata and catalog contract", () => {
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
      `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${extra}produces: []\nconsumes: []\n---\n\n${body}\n`,
    );
  };

  test("parses strict single-line metadata", () => {
    assert.deepEqual(
      parseSkillMetadata(
        '---\nname: gsd-example\ndescription: "Example activation"\nhide: true\n---\n\n# Example\n',
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

  test("discovers a deterministic visible catalog and renders only the hidden master body", () => {
    const root = makeRoot();
    try {
      writeSkill(root, "gsd", "Hidden bootstrap", "# Hidden Bootstrap\nAlready loaded.", "hide: true\n");
      writeSkill(root, "gsd-ponytail", "Hidden bounded context", "# Ponytail\nContext only.", "hide: true\n");
      writeSkill(root, "gsd-tdd", "TDD helper", "# Test-Driven Development\nFull TDD body.");
      writeSkill(root, "gsd-diagnosing-bugs", "Bug diagnosis", "# Diagnosing Bugs\nFull diagnosis body.");

      const catalog = discoverSkillCatalog(root);
      assert.deepEqual(catalog.map(({ name }) => name), ["gsd-diagnosing-bugs", "gsd-tdd"]);
      assert.ok(catalog.every(({ skillPath }) => isAbsolute(skillPath)));
      assert.ok(catalog.every(({ skillPath }) => realpathSync(skillPath).startsWith(realpathSync(join(root, "skills")))));
      assert.equal(catalog.some(({ name }) => name === "gsd-ponytail"), false);

      const bootstrap = createBootstrap(root);
      assert.match(bootstrap, /^<GSD_BOOTSTRAP>\ngsd:session-bootstrap:v2\n/);
      assert.match(bootstrap, /# Hidden Bootstrap\nAlready loaded\./);
      assert.match(bootstrap, /"name":"gsd-diagnosing-bugs"/);
      assert.ok(bootstrap.indexOf('"name":"gsd-diagnosing-bugs"') < bootstrap.indexOf('"name":"gsd-tdd"'));
      assert.doesNotMatch(bootstrap, /# Diagnosing Bugs|# Test-Driven Development/);
      const ponytailPath = realpathSync(join(root, "skills", "gsd-ponytail", "SKILL.md"));
      assert.equal(bootstrap.includes(`PONYTAIL_CONTEXT_PATH: ${JSON.stringify(ponytailPath)}`), true);
      assert.doesNotMatch(bootstrap, /"name":"gsd-ponytail"/);
      assert.doesNotMatch(bootstrap, /# Ponytail|Context only\./);
      assert.match(bootstrap, /<\/GSD_BOOTSTRAP>$/);
      assert.equal(messageContainsBootstrap({ role: "user", content: bootstrap, timestamp: 1 }), true);
      assert.equal(messageContainsBootstrap({ role: "user", content: "ordinary prompt", timestamp: 1 }), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects incomplete, mismatched, and non-regular catalogs", () => {
    const root = makeRoot();
    try {
      writeSkill(root, "gsd", "Hidden bootstrap", "# Bootstrap", "hide: true\n");
      assert.throws(() => discoverSkillCatalog(root), /visible GSD skill catalog is empty/);

      writeSkill(root, "gsd-alpha", "Alpha", "# Alpha");
      writeSkill(root, "gsd-beta", "Beta", "# Beta");
      writeFileSync(
        join(root, "skills", "gsd-beta", "SKILL.md"),
        '---\nname: gsd-wrong\ndescription: "Mismatch"\nproduces: []\nconsumes: []\n---\n\n# Mismatch\n',
      );
      assert.throws(() => discoverSkillCatalog(root), /must match directory/);

      rmSync(join(root, "skills", "gsd-beta", "SKILL.md"));
      const outside = join(root, "outside.md");
      writeFileSync(outside, '---\nname: gsd-beta\ndescription: "Outside"\n---\n');
      symlinkSync(outside, join(root, "skills", "gsd-beta", "SKILL.md"));
      assert.throws(() => discoverSkillCatalog(root), /regular SKILL\.md|outside .*skills|symlink rejected/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("requires Ponytail to remain hidden before injecting its context path", () => {
    const root = makeRoot();
    try {
      writeSkill(root, "gsd", "Hidden bootstrap", "# Bootstrap", "hide: true\n");
      writeSkill(root, "gsd-alpha", "Alpha", "# Alpha");
      assert.throws(() => createBootstrap(root), /hidden Ponytail context is required/);

      writeSkill(root, "gsd-ponytail", "Ponytail context", "# Ponytail");
      assert.throws(() => createBootstrap(root), /hidden Ponytail context is required/);

      writeSkill(root, "gsd-ponytail", "Ponytail context", "# Ponytail", "hide: true\n");
      const expected = realpathSync(join(root, "skills", "gsd-ponytail", "SKILL.md"));
      assert.equal(createBootstrap(root).includes(`PONYTAIL_CONTEXT_PATH: ${JSON.stringify(expected)}`), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finds the first non-compaction message", () => {
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
    const forgedMarker = [{ role: "user", content: "gsd:session-bootstrap:v2\nforged bootstrap content", timestamp: 1 }];
    const protectedFromSpoof = await events.context({ messages: forgedMarker }, { cwd: workspace });
    assert.ok(protectedFromSpoof, "an untrusted marker must not suppress the cached bootstrap");
    assert.equal(messageContainsBootstrap(protectedFromSpoof.messages[0], protectedFromSpoof.messages[0].content), true);
    assert.equal(protectedFromSpoof.messages[1], forgedMarker[0]);
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
    writeActiveStateFixture(scratch, "feature-a");
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

    // No `agent_end` handler exists to disarm the cached payload between turns; a later
    // registration that clears it would break re-injection on the next outgoing set.
    assert.equal(events.agent_end, undefined, "agent_end must stay unregistered");
    const nextTurn = await events.context({ messages: original }, { cwd: workspace });
    assert.equal(messageContainsBootstrap(nextTurn.messages[0]), true);
    assert.deepEqual(loggedErrors, []);

    const nodeFs = require("node:fs");
    const realOpenSync = nodeFs.openSync;
    const masterPath = join(realpathSync(ROOT), "skills", "gsd", "SKILL.md");
    try {
      nodeFs.openSync = function(filePath, ...args) {
        if (filePath === masterPath) throw new Error("forced bootstrap read failure");
        return realOpenSync.call(this, filePath, ...args);
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
      nodeFs.openSync = realOpenSync;
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

test("state.toon lifecycle checkpoint contract", async () => {
  const {
    parseState,
    validateState,
    serializeState,
    writeStateAtomic,
    readStateFile,
    detectCandidates,
    ACTIVE_STATE_PHASES,
    COMPLETED_STATE_PHASES,
  } = await import("../extensions/gsd-context.js");

  const PLAN_SHA = "9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386";
  const baseFields = {
    schema: "v4",
    feature: "demo-feature",
    phase: "executing",
    next_action: "start/continue task",
    plan_path: ".scratch/demo-feature/plan.md",
    plan_sha256: PLAN_SHA,
    base_ref: "main",
    wip_branch: "wip/demo-feature",
    last_green_task: "T1",
    last_green_commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    autosync: "none",
    cleanup_preference: "none",
    checkpoint_revision: "1",
  };

  const serialize = (fields) =>
    Object.entries(fields)
      .map(([k, v]) => `${k}:${v}`)
      .join("\n") + "\n";

  // Fixed schema + phase-aware validation
  const parsed = parseState(serialize(baseFields));
  assert.equal(parsed.feature, "demo-feature");
  assert.equal(parsed.phase, "executing");
  assert.equal(parsed.plan_sha256, PLAN_SHA);
  assert.deepEqual(validateState(parsed), parsed);
  assert.ok(ACTIVE_STATE_PHASES.includes("executing"));
  assert.ok(COMPLETED_STATE_PHASES.includes("completed-retained"));

  for (const phase of [
    "draft",
    "approved",
    "executing",
    "paused",
    "verifying",
    "repair",
    "merged-cleanup-pending",
    "completed-retained",
  ]) {
    const draft = phase === "draft";
    const completed = phase === "completed-retained";
    const state = {
      ...baseFields,
      phase,
      next_action: completed ? "none" : phase === "merged-cleanup-pending" ? "cleanup scratch" : baseFields.next_action,
      plan_path: draft ? "none" : baseFields.plan_path,
      plan_sha256: draft ? "none" : baseFields.plan_sha256,
      base_ref: draft ? "none" : baseFields.base_ref,
      wip_branch: draft ? "none" : baseFields.wip_branch,
      last_green_task: draft ? "none" : baseFields.last_green_task,
      last_green_commit: draft ? "none" : baseFields.last_green_commit,
      cleanup_preference: completed || phase === "merged-cleanup-pending" ? "retain" : "none",
    };
    assert.equal(validateState(parseState(serialize(state))).phase, phase);
  }

  // Removed model/review fields are rejected as legacy authority.
  assert.throws(
    () => validateState({ ...baseFields, reviewer_model: "openai-codex/gpt-5.5:high" }),
    /legacy|reviewer_model/i,
  );

  // Malformed schema / unknown keys / partial rows fail closed
  assert.throws(() => parseState("schema:v4\nfeature:demo-feature\n"), /schema|missing required field/i);
  assert.throws(() => parseState(serialize({ ...baseFields, extra_key: "nope" })), /unknown|extra|key/i);
  assert.throws(() => parseState("schema:v1\nfeature:\n"), /empty|malformed|feature/i);
  assert.throws(() => parseState(serialize({ ...baseFields, phase: "task-active" })), /phase/i);
  assert.throws(
    () => parseState(serialize({ ...baseFields, plan_sha256: "not-a-hash" })),
    /plan_sha256|hash/i,
  );

  // `base_ref` is the recorded merge target that a Git command consumes verbatim, so its shape
  // is validated here rather than trusted from whatever wrote the packet. A self-referencing
  // base is rejected too: the squash would target the branch being squashed.
  for (const base of ["--force", "a..b", "x/.y", "y.lock", "has space", "main;rm -rf /", "-x", "x/"]) {
    assert.throws(
      () => validateState({ ...baseFields, base_ref: base }),
      /base_ref must be a Git branch name able to receive the merge/,
      `base_ref ${JSON.stringify(base)} must be rejected`,
    );
  }
  assert.throws(
    () => validateState({ ...baseFields, base_ref: "wip/demo-feature" }),
    /base_ref must not be its own WIP branch wip\/demo-feature/,
  );
  for (const base of ["main", "worktree-onboarding", "release/2026.1"]) {
    assert.equal(validateState({ ...baseFields, base_ref: base }).base_ref, base);
  }

  // Legacy runtime artifacts never parse as state authority
  assert.throws(() => parseState("schema:v1\nmode:execution\nphase:task-active\n"), /legacy|unsupported|phase|unknown/i);

  // Atomic write + read-back validation
  const tempDir = mkdtempSync(join(tmpdir(), "gsd-state-"));
  try {
    const featureDir = join(tempDir, ".scratch", "demo-feature");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
    const statePath = join(featureDir, "state.toon");
    const written = writeStateAtomic(featureDir, baseFields);
    assert.equal(written.feature, "demo-feature");
    assert.equal(readFileSync(statePath, "utf8"), serializeState(baseFields));
    assert.deepEqual(readStateFile(statePath), validateState(baseFields));

    const canonicalBytes = Buffer.from(serializeState(baseFields), "utf8");
    const crlfBytes = Buffer.from(serializeState(baseFields).replaceAll("\n", "\r\n"), "utf8");
    assert.throws(() => parseState(crlfBytes.toString("utf8")), /LF|carriage return/i);
    writeFileSync(statePath, crlfBytes);
    assert.throws(() => readStateFile(statePath), /LF|carriage return/i);
    assert.deepEqual(readFileSync(statePath), crlfBytes, "CRLF state bytes must remain unchanged");

    const invalidUtf8Bytes = Buffer.from(canonicalBytes);
    const nextActionOffset = invalidUtf8Bytes.indexOf(Buffer.from("start/continue task"));
    assert.notEqual(nextActionOffset, -1);
    invalidUtf8Bytes[nextActionOffset] = 0xff;
    writeFileSync(statePath, invalidUtf8Bytes);
    // The contract is that invalid UTF-8 state bytes are rejected as an io-error and left
    // untouched. The reader owns that sentence instead of surfacing the decoder's, whose
    // wording is engine-specific (Node and Bun differ, and Bun changed it in 1.4), and the
    // `io-error` tag is what separates an unreadable file from malformed authority, so pin both.
    assert.throws(
      () => readStateFile(statePath),
      (error) =>
        error.contractFailure === "io-error" &&
        /state\.toon:[\s\S]{0,160}file must be valid UTF-8/.test(error.message),
    );
    assert.deepEqual(readFileSync(statePath), invalidUtf8Bytes, "invalid UTF-8 state bytes must remain unchanged");
    writeStateAtomic(featureDir, baseFields);

    // A predictable pre-existing temp symlink must never be followed or removed.
    const collisionFeature = "collision-probe";
    const collisionDir = join(tempDir, ".scratch", collisionFeature);
    mkdirSync(collisionDir);
    writeFileSync(join(collisionDir, "plan.md"), "# Plan\n");
    const victim = join(tempDir, "victim.txt");
    writeFileSync(victim, "do not modify\n");
    const fixedNow = 1700000000000;
    const tempPath = join(collisionDir, `.state.toon.${process.pid}.${fixedNow}.tmp`);
    symlinkSync(victim, tempPath);
    const originalNow = Date.now;
    try {
      Date.now = () => fixedNow;
      assert.throws(
        () => writeStateAtomic(collisionDir, {
          ...baseFields,
          feature: collisionFeature,
          plan_path: `.scratch/${collisionFeature}/plan.md`,
          wip_branch: `wip/${collisionFeature}`,
        }),
        /EEXIST|exist/i,
      );
    } finally {
      Date.now = originalNow;
    }
    assert.equal(readFileSync(victim, "utf8"), "do not modify\n");
    assert.equal(lstatSync(tempPath).isSymbolicLink(), true, "the colliding object must be preserved");
    assert.throws(() => lstatSync(join(collisionDir, "state.toon")), { code: "ENOENT" });

    // Symlink state is rejected
    const symDir = join(tempDir, ".scratch", "sym-feature");
    mkdirSync(symDir, { recursive: true });
    writeFileSync(join(symDir, "plan.md"), "# Plan\n");
    const target = join(tempDir, "state-target.toon");
    writeFileSync(target, serializeState({ ...baseFields, feature: "sym-feature", plan_path: ".scratch/sym-feature/plan.md", wip_branch: "wip/sym-feature" }));
    symlinkSync(target, join(symDir, "state.toon"));
    assert.throws(() => readStateFile(join(symDir, "state.toon")), /symlink/i);
    // Authoritative plan+symlink-state packets fail closed at discovery; remove after the unit probe.
    rmSync(symDir, { recursive: true, force: true });

    // Partial / truncated body fails closed
    writeFileSync(join(featureDir, "state.toon"), "schema:v4\nfeature:demo-feature\nphase:execut");
    assert.throws(() => readStateFile(statePath), /malformed|incomplete|phase|required/i);
    // Restore a valid checkpoint after the partial-write probe.
    writeStateAtomic(featureDir, baseFields);

    // Discovery: valid active state selects feature; completed is inert; legacy handoff-only is not authority
    const scratch = join(tempDir, ".scratch");
    const activeDir = join(scratch, "active-one");
    mkdirSync(activeDir);
    writeFileSync(join(activeDir, "plan.md"), "plan");
    writeStateAtomic(activeDir, {
      ...baseFields,
      feature: "active-one",
      plan_path: ".scratch/active-one/plan.md",
      wip_branch: "wip/active-one",
    });

    const completedDir = join(scratch, "done-one");
    mkdirSync(completedDir);
    writeFileSync(join(completedDir, "plan.md"), "plan");
    writeStateAtomic(completedDir, {
      ...baseFields,
      feature: "done-one",
      plan_path: ".scratch/done-one/plan.md",
      wip_branch: "wip/done-one",
      phase: "completed-retained",
      next_action: "none",
      cleanup_preference: "retain",
      checkpoint_revision: "2",
    });

    const legacyDir = join(scratch, "legacy-one");
    mkdirSync(legacyDir);
    writeFileSync(join(legacyDir, "plan.md"), "plan");
    writeFileSync(join(legacyDir, "handoff-1.toon"), "schema:v1\nmode:execution\n");

    const cleanupDir = join(scratch, "cleanup-one");
    mkdirSync(cleanupDir);
    writeFileSync(join(cleanupDir, "plan.md"), "plan");
    writeStateAtomic(cleanupDir, {
      ...baseFields,
      feature: "cleanup-one",
      plan_path: ".scratch/cleanup-one/plan.md",
      wip_branch: "wip/cleanup-one",
      phase: "merged-cleanup-pending",
      next_action: "cleanup scratch",
      cleanup_preference: "delete",
      checkpoint_revision: "3",
    });

    // Feature-mismatched authoritative packet fails closed (throw), not silent skip.
    const mismatchDir = join(scratch, "mismatch-one");
    mkdirSync(mismatchDir);
    writeFileSync(join(mismatchDir, "plan.md"), "plan");
    writeFileSync(
      join(mismatchDir, "state.toon"),
      serializeState({
        ...baseFields,
        feature: "other-feature",
        plan_path: ".scratch/other-feature/plan.md",
        wip_branch: "wip/other-feature",
      }),
    );
    assert.throws(() => detectCandidates(tempDir), /feature|mismatch|state\.toon/i);

    // Remove mismatch so remaining discovery can be observed.
    rmSync(mismatchDir, { recursive: true, force: true });

    const malformedDir = join(scratch, "bad-one");
    mkdirSync(malformedDir);
    writeFileSync(join(malformedDir, "plan.md"), "plan");
    writeFileSync(join(malformedDir, "state.toon"), "schema:v1\nphase:executing\n");
    assert.throws(() => detectCandidates(tempDir), /state\.toon|malformed|missing required field/i);
    rmSync(malformedDir, { recursive: true, force: true });

    const { candidates } = detectCandidates(tempDir)
    assert.deepEqual(candidates, ["active-one", "cleanup-one", "demo-feature"]);
    assert.ok(!candidates.includes("done-one"), "completed-retained must be inert for ordinary discovery");
    assert.ok(!candidates.includes("legacy-one"), "legacy handoff-only packets must not be active authority");
    assert.ok(candidates.includes("demo-feature"));

    // writeStateAtomic rejects symlink/non-directory/basename mismatch and cleans temp.
    const realFeature = join(scratch, "safe-feature");
    mkdirSync(realFeature);
    writeFileSync(join(realFeature, "plan.md"), "plan");
    const escapeTarget = join(tempDir, "escape-target");
    mkdirSync(escapeTarget);
    const linkedFeature = join(scratch, "linked-feature");
    symlinkSync(escapeTarget, linkedFeature);
    assert.throws(
      () => writeStateAtomic(linkedFeature, { ...baseFields, feature: "linked-feature", plan_path: ".scratch/linked-feature/plan.md", wip_branch: "wip/linked-feature" }),
      /symlink|featureDir|directory/i,
    );
    assert.equal(readdirSync(escapeTarget).some((n) => n.includes("state.toon") || n.endsWith(".tmp")), false);

    const filePath = join(scratch, "not-a-dir");
    writeFileSync(filePath, "nope");
    assert.throws(
      () => writeStateAtomic(filePath, { ...baseFields, feature: "not-a-dir", plan_path: ".scratch/not-a-dir/plan.md", wip_branch: "wip/not-a-dir" }),
      /directory|featureDir/i,
    );

    assert.throws(
      () => writeStateAtomic(realFeature, { ...baseFields, feature: "other-name", plan_path: ".scratch/other-name/plan.md", wip_branch: "wip/other-name" }),
      /feature|basename|mismatch/i,
    );
    assert.equal(readdirSync(realFeature).some((n) => n.endsWith(".tmp")), false, "failed writes must not leave temp files");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("atomic state writes survive feature-directory swaps", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "gsd-state-race-"));
  const scratch = join(tempDir, ".scratch");
  mkdirSync(scratch, { recursive: true });
  const nodeFs = require("node:fs");
  const realChdir = process.chdir;
  const realRenameSync = nodeFs.renameSync;
  const realSymlinkSync = nodeFs.symlinkSync;
  try {
    const preopenFeature = join(scratch, "preopen-race");
    const preopenMoved = join(scratch, "preopen-race-moved");
    const preopenEscape = join(tempDir, "preopen-escape");
    mkdirSync(preopenFeature);
    writeFileSync(join(preopenFeature, "plan.md"), "plan");
    mkdirSync(preopenEscape);

    let chdirSwapped = false;
    process.chdir = function(dir) {
      if (!chdirSwapped && (dir === "preopen-race" || dir === preopenFeature)) {
        chdirSwapped = true;
        realRenameSync.call(nodeFs, preopenFeature, preopenMoved);
        realSymlinkSync.call(nodeFs, preopenEscape, preopenFeature);
      }
      return realChdir.call(this, dir);
    };
    assert.throws(
      () => writeActiveStateFixture(preopenFeature, "preopen-race"),
      /identity|symlink|stable|directory/i,
    );
    assert.equal(chdirSwapped, true, "the chdir preopen hook must fire");
    assert.equal(
      readdirSync(preopenEscape).some((name) => name === "state.toon" || name.endsWith(".tmp")),
      false,
      "a swapped parent must not receive state output",
    );
    process.chdir = realChdir;

    const prerenameFeature = join(scratch, "prerename-race");
    const prerenameMoved = join(scratch, "prerename-race-moved");
    const prerenameEscape = join(tempDir, "prerename-escape");
    mkdirSync(prerenameFeature);
    writeFileSync(join(prerenameFeature, "plan.md"), "plan");
    mkdirSync(prerenameEscape);

    let renameSwapped = false;
    nodeFs.renameSync = function(source, destination) {
      if (!renameSwapped) {
        renameSwapped = true;
        realRenameSync.call(this, prerenameFeature, prerenameMoved);
        realSymlinkSync.call(this, prerenameEscape, prerenameFeature);
      }
      return realRenameSync.call(this, source, destination);
    };
    writeActiveStateFixture(prerenameFeature, "prerename-race");
    assert.equal(renameSwapped, true, "the rename-boundary swap must run");
    assert.match(readFileSync(join(prerenameMoved, "state.toon"), "utf8"), /feature:prerename-race/);
    assert.equal(
      readdirSync(prerenameEscape).some((name) => name === "state.toon" || name.endsWith(".tmp")),
      false,
      "a swapped parent must not redirect the stable directory handle",
    );
  } finally {
    process.chdir = realChdir;
    nodeFs.renameSync = realRenameSync;
    nodeFs.symlinkSync = realSymlinkSync;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("plan_path and wip_branch must match state.feature on read/validate", () => {
  const base = {
    schema: "v4",
    feature: "demo-feature",
    phase: "executing",
    next_action: "start/continue task",
    plan_path: ".scratch/demo-feature/plan.md",
    plan_sha256: "a".repeat(64),
    base_ref: "main",
    wip_branch: "wip/demo-feature",
    last_green_task: "none",
    last_green_commit: "none",
    autosync: "none",
    cleanup_preference: "none",
    checkpoint_revision: "1",
  };

  assert.deepEqual(validateState(base).feature, "demo-feature");
  assert.equal(parseState(serializeState(base)).plan_path, ".scratch/demo-feature/plan.md");

  assert.throws(
    () =>
      validateState({
        ...base,
        plan_path: ".scratch/other-feature/plan.md",
      }),
    /plan_path feature mismatch|feature mismatch|plan_path/i,
  );
  assert.throws(
    () =>
      validateState({
        ...base,
        wip_branch: "wip/other-feature",
      }),
    /wip_branch feature mismatch|feature mismatch|wip_branch/i,
  );

  // Read/resume path: parseState must reject mismatched feature components in durable bytes.
  const mismatchedPlan = serializeState(base).replace(
    "plan_path:.scratch/demo-feature/plan.md",
    "plan_path:.scratch/other-feature/plan.md",
  );
  assert.throws(() => parseState(mismatchedPlan), /plan_path feature mismatch|feature mismatch|plan_path/i);

  const mismatchedWip = serializeState(base).replace(
    "wip_branch:wip/demo-feature",
    "wip_branch:wip/other-feature",
  );
  assert.throws(() => parseState(mismatchedWip), /wip_branch feature mismatch|feature mismatch|wip_branch/i);
});


test("session-owner state schema omits every model and review binding", () => {
  const state = {
    schema: "v4",
    feature: "demo-feature",
    phase: "approved",
    next_action: "start/continue task",
    plan_path: ".scratch/demo-feature/plan.md",
    plan_sha256: "c".repeat(64),
    base_ref: "main",
    wip_branch: "wip/demo-feature",
    last_green_task: "none",
    last_green_commit: "none",
    autosync: "none",
    cleanup_preference: "none",
    checkpoint_revision: "1",
  };

  const serialized = serializeState(state);
  assert.equal(validateState(state).schema, "v4");
  assert.equal(parseState(serialized).schema, "v4");
  assert.doesNotMatch(serialized, /^(?:executor_model|reviewer_model|review_round|blocking_fingerprint|reviewed_commit|progress_status|ponytail_level):/m);
});

test("exact valid v1 state migrates atomically before resume", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-state-migrate-"));
  try {
    const featureDir = join(temporary, ".scratch", "demo-feature");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
    const statePath = join(featureDir, "state.toon");
    const legacy = {
      schema: "v1",
      feature: "demo-feature",
      phase: "executing",
      next_action: "start/continue task",
      plan_path: ".scratch/demo-feature/plan.md",
      plan_sha256: "d".repeat(64),
      base_ref: "main",
      wip_branch: "wip/demo-feature",
      last_green_task: "T1",
      last_green_commit: "a".repeat(40),
      executor_model: "xai-oauth/grok-4.5",
      reviewer_model: "openai-codex/gpt-5.5:high",
      review_round: "none",
      blocking_fingerprint: "none",
      reviewed_commit: "none",
      progress_status: "none",
      autosync: "none",
      ponytail_level: "none",
      cleanup_preference: "none",
      checkpoint_revision: "7",
    };
    writeFileSync(
      statePath,
      Object.entries(legacy).map(([key, value]) => `${key}:${value}`).join("\n") + "\n",
    );

    const migrated = readStateFile(statePath);
    assert.equal(migrated.schema, "v4");
    assert.equal(migrated.checkpoint_revision, "8");
    for (const key of ["executor_model", "reviewer_model", "review_round", "blocking_fingerprint", "reviewed_commit", "progress_status", "ponytail_level"]) {
      assert.equal(Object.hasOwn(migrated, key), false, key);
    }
    assert.equal(readFileSync(statePath, "utf8"), serializeState(migrated));
    assert.equal(readdirSync(featureDir).some((name) => name.endsWith(".tmp")), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("exact valid v2 state migrates atomically before resume", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-state-migrate-v2-"));
  try {
    const featureDir = join(temporary, ".scratch", "demo-feature");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
    const statePath = join(featureDir, "state.toon");
    const legacy = {
      schema: "v2",
      feature: "demo-feature",
      phase: "paused",
      next_action: "start/continue task",
      plan_path: ".scratch/demo-feature/plan.md",
      plan_sha256: "e".repeat(64),
      base_ref: "main",
      wip_branch: "wip/demo-feature",
      last_green_task: "T2",
      last_green_commit: "b".repeat(40),
      reviewer_model: "openai-codex/gpt-5.5:high",
      review_round: "none",
      blocking_fingerprint: "none",
      reviewed_commit: "none",
      progress_status: "none",
      autosync: "off",
      ponytail_level: "lite",
      cleanup_preference: "retain",
      checkpoint_revision: "9",
    };
    const legacyBytes = Object.entries(legacy).map(([key, value]) => `${key}:${value}`).join("\n") + "\n";
    writeFileSync(statePath, legacyBytes);

    const migrated = readStateFile(statePath);
    assert.equal(migrated.schema, "v4");
    assert.equal(migrated.checkpoint_revision, "10");
    assert.equal(migrated.last_green_task, "T2");
    assert.equal(migrated.autosync, "off");
    assert.equal(Object.hasOwn(migrated, "ponytail_level"), false);
    assert.equal(migrated.cleanup_preference, "retain");
    for (const key of ["reviewer_model", "review_round", "blocking_fingerprint", "reviewed_commit", "progress_status"]) {
      assert.equal(Object.hasOwn(migrated, key), false, key);
    }
    assert.equal(readFileSync(statePath, "utf8"), serializeState(migrated));
    assert.equal(readdirSync(featureDir).some((name) => name.endsWith(".tmp")), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("legacy v2 migration rejects malformed or terminal records without changing bytes", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-state-migrate-v2-reject-"));
  try {
    const featureDir = join(temporary, ".scratch", "demo-feature");
    mkdirSync(featureDir, { recursive: true });
    const statePath = join(featureDir, "state.toon");
    const legacy = {
      schema: "v2",
      feature: "demo-feature",
      phase: "executing",
      next_action: "start/continue task",
      plan_path: ".scratch/demo-feature/plan.md",
      plan_sha256: "e".repeat(64),
      base_ref: "main",
      wip_branch: "wip/demo-feature",
      last_green_task: "T1",
      last_green_commit: "b".repeat(40),
      reviewer_model: "openai-codex/gpt-5.5:high",
      review_round: "none",
      blocking_fingerprint: "none",
      reviewed_commit: "none",
      progress_status: "none",
      autosync: "none",
      ponytail_level: "none",
      cleanup_preference: "none",
      checkpoint_revision: "9",
    };
    const serializeLegacy = (fields) =>
      Object.entries(fields).map(([key, value]) => `${key}:${value}`).join("\n") + "\n";
    const canonical = serializeLegacy(legacy);
    const invalidRecords = [
      canonical.replace("reviewer_model:openai-codex/gpt-5.5:high\n", ""),
      canonical.replace(
        "reviewer_model:openai-codex/gpt-5.5:high\nreview_round:none",
        "review_round:none\nreviewer_model:openai-codex/gpt-5.5:high",
      ),
      canonical.replace("review_round:none", "unknown_field:nope\nreview_round:none"),
      canonical.replace("review_round:none", "reviewer_model:second-reviewer\nreview_round:none"),
      canonical.replace("reviewer_model:openai-codex/gpt-5.5:high", "reviewer_model:none"),
      canonical.replace("ponytail_level:none", "ponytail_level:turbo"),
      serializeLegacy({
        ...legacy,
        phase: "completed-retained",
        next_action: "none",
        cleanup_preference: "retain",
      }),
    ];

    for (const bytes of invalidRecords) {
      writeFileSync(statePath, bytes);
      assert.throws(() => readStateFile(statePath), /state\.toon|legacy|field|key|model|phase/i);
      assert.equal(readFileSync(statePath, "utf8"), bytes);
      assert.equal(readdirSync(featureDir).some((name) => name.endsWith(".tmp")), false);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("legacy v1 migration rejects invalid or terminal records without changing bytes", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-state-migrate-reject-"));
  try {
    const featureDir = join(temporary, ".scratch", "demo-feature");
    mkdirSync(featureDir, { recursive: true });
    const statePath = join(featureDir, "state.toon");
    const legacy = {
      schema: "v1",
      feature: "demo-feature",
      phase: "executing",
      next_action: "start/continue task",
      plan_path: ".scratch/demo-feature/plan.md",
      plan_sha256: "d".repeat(64),
      base_ref: "main",
      wip_branch: "wip/demo-feature",
      last_green_task: "T1",
      last_green_commit: "a".repeat(40),
      executor_model: "xai-oauth/grok-4.5",
      reviewer_model: "openai-codex/gpt-5.5:high",
      review_round: "none",
      blocking_fingerprint: "none",
      reviewed_commit: "none",
      progress_status: "none",
      autosync: "none",
      ponytail_level: "none",
      cleanup_preference: "none",
      checkpoint_revision: "7",
    };
    const serializeLegacy = (fields) =>
      Object.entries(fields).map(([key, value]) => `${key}:${value}`).join("\n") + "\n";
    const canonical = serializeLegacy(legacy);
    const invalidRecords = [
      canonical.replace("executor_model:xai-oauth/grok-4.5\n", ""),
      canonical.replace(
        "executor_model:xai-oauth/grok-4.5\nreviewer_model:openai-codex/gpt-5.5:high",
        "reviewer_model:openai-codex/gpt-5.5:high\nexecutor_model:xai-oauth/grok-4.5",
      ),
      canonical.replace("review_round:none", "unknown_field:nope\nreview_round:none"),
      canonical.replace("review_round:none", "reviewer_model:second-reviewer\nreview_round:none"),
      canonical.replace("reviewer_model:openai-codex/gpt-5.5:high", "reviewer_model:none"),
      canonical.replace("executor_model:xai-oauth/grok-4.5", "executor_model:none"),
      canonical.replace("ponytail_level:none", "ponytail_level:turbo"),
      serializeLegacy({
        ...legacy,
        phase: "completed-retained",
        next_action: "none",
        cleanup_preference: "retain",
      }),
    ];

    for (const bytes of invalidRecords) {
      writeFileSync(statePath, bytes);
      assert.throws(() => readStateFile(statePath), /state\.toon|legacy|field|key|model|phase/i);
      assert.equal(readFileSync(statePath, "utf8"), bytes);
      assert.equal(readdirSync(featureDir).some((name) => name.endsWith(".tmp")), false);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("auto-compact ignores an exact retained v1 terminal state without migration", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-state-retained-v1-"));
  try {
    const featureDir = join(temporary, ".scratch", "fx-carry-value");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
    const statePath = join(featureDir, "state.toon");
    const legacyBytes = [
      "schema:v1",
      "feature:fx-carry-value",
      "phase:completed-retained",
      "next_action:none",
      "plan_path:.scratch/fx-carry-value/plan.md",
      "plan_sha256:b3c80be0be8a1411c47492240719f04cc4441712a0006744ea93c493f9094f75",
      "base_ref:main",
      "wip_branch:wip/fx-carry-value",
      "last_green_task:T4",
      "last_green_commit:0b553d1de4136d949163d74a3bbcbfd92bb182cd",
      "executor_model:xai-oauth/grok-4.5:xhigh",
      "reviewer_model:openai-codex/gpt-5.6-sol:xhigh",
      "review_round:3",
      "blocking_fingerprint:55810586ba453e4c36333edde5bae2829aaa6b70b584c9440f7b6b1d460e486f",
      "reviewed_commit:b301968cfd26c8758b42bda04be76fe64ff2f769",
      "progress_status:merged-clean-wip-deleted-scratch-retained",
      "autosync:none",
      "ponytail_level:none",
      "cleanup_preference:retain",
      "checkpoint_revision:13",
      "",
    ].join("\n");
    writeFileSync(statePath, legacyBytes);

    assert.throws(() => readStateFile(statePath), /legacy phase must be active/);
    assert.deepEqual(detectCandidates(temporary).candidates, []);
    assert.equal(readFileSync(statePath, "utf8"), legacyBytes);
    assert.equal(readdirSync(featureDir).some((name) => name.endsWith(".tmp")), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("auto-compact also ignores a retained v2 terminal state without migration", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-state-retained-v2-"));
  try {
    const featureDir = join(temporary, ".scratch", "retained-v2");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
    const statePath = join(featureDir, "state.toon");
    const legacyBytes = [
      "schema:v2",
      "feature:retained-v2",
      "phase:completed-retained",
      "next_action:none",
      "plan_path:.scratch/retained-v2/plan.md",
      `plan_sha256:${"e".repeat(64)}`,
      "base_ref:main",
      "wip_branch:wip/retained-v2",
      "last_green_task:T2",
      `last_green_commit:${"b".repeat(40)}`,
      "reviewer_model:openai-codex/gpt-5.5:high",
      "review_round:2",
      `blocking_fingerprint:${"c".repeat(64)}`,
      `reviewed_commit:${"d".repeat(40)}`,
      "progress_status:merged-clean-wip-deleted-scratch-retained",
      "autosync:none",
      "ponytail_level:none",
      "cleanup_preference:retain",
      "checkpoint_revision:9",
      "",
    ].join("\n");
    writeFileSync(statePath, legacyBytes);

    assert.throws(() => readStateFile(statePath), /legacy phase must be active/);
    assert.deepEqual(detectCandidates(temporary).candidates, []);
    assert.equal(readFileSync(statePath, "utf8"), legacyBytes);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("candidate discovery leaves retained v3 inert until explicit migration", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-state-retained-v3-"));
  try {
    const featureDir = join(temporary, ".scratch", "retained-v3");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
    const statePath = join(featureDir, "state.toon");
    const legacyBytes = [
      "schema:v3",
      "feature:retained-v3",
      "phase:completed-retained",
      "next_action:none",
      "plan_path:.scratch/retained-v3/plan.md",
      `plan_sha256:${"e".repeat(64)}`,
      "base_ref:main",
      "wip_branch:wip/retained-v3",
      "last_green_task:T2",
      `last_green_commit:${"b".repeat(40)}`,
      "autosync:none",
      "ponytail_level:full",
      "cleanup_preference:retain",
      "checkpoint_revision:9",
      "",
    ].join("\n");
    writeFileSync(statePath, legacyBytes);

    assert.deepEqual(detectCandidates(temporary).candidates, []);
    assert.equal(readFileSync(statePath, "utf8"), legacyBytes);

    const migrated = readStateFile(statePath);
    assert.equal(migrated.schema, "v4");
    assert.equal(migrated.checkpoint_revision, "10");
    assert.equal(Object.hasOwn(migrated, "ponytail_level"), false);
    assert.doesNotMatch(readFileSync(statePath, "utf8"), /ponytail_level/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("candidate discovery is bounded and does not migrate legacy authority", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-candidate-bounds-"));
  try {
    const scratch = join(temporary, ".scratch");
    const legacyDir = join(scratch, "legacy-active");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "plan.md"), "# Plan\n");
    const legacy = {
      schema: "v2",
      feature: "legacy-active",
      phase: "paused",
      next_action: "start/continue task",
      plan_path: ".scratch/legacy-active/plan.md",
      plan_sha256: "e".repeat(64),
      base_ref: "main",
      wip_branch: "wip/legacy-active",
      last_green_task: "none",
      last_green_commit: "none",
      reviewer_model: "openai-codex/gpt-5.5:high",
      review_round: "none",
      blocking_fingerprint: "none",
      reviewed_commit: "none",
      progress_status: "none",
      autosync: "none",
      ponytail_level: "none",
      cleanup_preference: "none",
      checkpoint_revision: "4",
    };
    const legacyBytes = Object.entries(legacy).map(([key, value]) => `${key}:${value}`).join("\n") + "\n";
    const legacyStatePath = join(legacyDir, "state.toon");
    writeFileSync(legacyStatePath, legacyBytes);

    assert.deepEqual(detectCandidates(temporary).candidates, ["legacy-active"]);
    assert.equal(readFileSync(legacyStatePath, "utf8"), legacyBytes, "Discovery must remain read-only");

    const oversizedDir = join(scratch, "oversized-state");
    mkdirSync(oversizedDir);
    writeFileSync(join(oversizedDir, "plan.md"), "# Plan\n");
    const oversizedState = {
      schema: "v3",
      feature: "oversized-state",
      phase: "executing",
      next_action: "x".repeat(70 * 1024),
      plan_path: ".scratch/oversized-state/plan.md",
      plan_sha256: "a".repeat(64),
      base_ref: "main",
      wip_branch: "wip/oversized-state",
      last_green_task: "none",
      last_green_commit: "none",
      autosync: "none",
      ponytail_level: "none",
      cleanup_preference: "none",
      checkpoint_revision: "1",
    };
    writeFileSync(
      join(oversizedDir, "state.toon"),
      Object.entries(oversizedState).map(([key, value]) => `${key}:${value}`).join("\n") + "\n",
    );
    assert.throws(() => detectCandidates(temporary), /state\.toon.*size limit|65536 bytes/i);
    rmSync(oversizedDir, { recursive: true, force: true });

    for (let index = 0; index < 2048; index += 1) {
      mkdirSync(join(scratch, `extra-${index}`));
    }
    assert.throws(() => detectCandidates(temporary), /\.scratch.*entry limit|2048 entries/i);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("skill catalog stays inside GSD root and has bounded inputs", () => {
  const writeCatalogSkill = (root, name, description, body, hidden = false) => {
    const directory = join(root, "skills", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${hidden ? "hide: true\n" : ""}produces: []\nconsumes: []\n---\n\n${body}\n`,
    );
  };

  const externalRoot = mkdtempSync(join(tmpdir(), "gsd-external-skills-"));
  const symlinkRoot = mkdtempSync(join(tmpdir(), "gsd-symlink-root-"));
  const boundedRoot = mkdtempSync(join(tmpdir(), "gsd-bounded-skills-"));
  const countRoot = mkdtempSync(join(tmpdir(), "gsd-counted-skills-"));
  try {
    writeCatalogSkill(externalRoot, "gsd", "Hidden", "# Hidden", true);
    writeCatalogSkill(externalRoot, "gsd-tdd", "Visible", "# Visible");
    symlinkSync(join(externalRoot, "skills"), join(symlinkRoot, "skills"), "dir");
    assert.throws(() => discoverSkillCatalog(symlinkRoot), /skills.*symlink|outside GSD_ROOT/i);
    assert.throws(() => createBootstrap(symlinkRoot), /skills.*symlink|outside GSD_ROOT/i);

    writeCatalogSkill(boundedRoot, "gsd", "Hidden", "# Hidden", true);
    writeCatalogSkill(boundedRoot, "gsd-large", "Large", "x".repeat(140 * 1024));
    assert.throws(() => discoverSkillCatalog(boundedRoot), /SKILL\.md.*size limit|131072 bytes/i);

    writeCatalogSkill(countRoot, "gsd", "Hidden", "# Hidden", true);
    for (let index = 0; index < 129; index += 1) {
      writeCatalogSkill(countRoot, `gsd-s${index}`, `Skill ${index}`, `# Skill ${index}`);
    }
    assert.throws(() => discoverSkillCatalog(countRoot), /skill.*entry limit|128 entries/i);
  } finally {
    rmSync(externalRoot, { recursive: true, force: true });
    rmSync(symlinkRoot, { recursive: true, force: true });
    rmSync(boundedRoot, { recursive: true, force: true });
    rmSync(countRoot, { recursive: true, force: true });
  }
});

test("readStateFile binds authority to its feature directory", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-state-directory-binding-"));
  try {
    const featureDir = join(temporary, ".scratch", "expected-feature");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
    const mismatchedState = {
      schema: "v3",
      feature: "other-feature",
      phase: "executing",
      next_action: "start/continue task",
      plan_path: ".scratch/other-feature/plan.md",
      plan_sha256: "a".repeat(64),
      base_ref: "main",
      wip_branch: "wip/other-feature",
      last_green_task: "none",
      last_green_commit: "none",
      autosync: "none",
      ponytail_level: "none",
      cleanup_preference: "none",
      checkpoint_revision: "1",
    };
    writeFileSync(
      join(featureDir, "state.toon"),
      Object.entries(mismatchedState).map(([key, value]) => `${key}:${value}`).join("\n") + "\n",
    );
    assert.throws(() => readStateFile(join(featureDir, "state.toon")), /featureDir basename|feature mismatch/i);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("schema v4 and hidden architecture catalog cutover", () => {
  const catalogNames = discoverSkillCatalog(ROOT).map(({ name }) => name);
  assert.ok(catalogNames.includes("gsd-codebase-architecture"));
  assert.ok(!catalogNames.includes("gsd-codebase-design"));
  assert.ok(!catalogNames.includes("gsd-improve-codebase-architecture"));
  assert.ok(!catalogNames.includes("gsd-ponytail"));

  const tmp = mkdtempSync(join(tmpdir(), "gsd-schema-v4-"));
  try {
    const featureDir = join(tmp, ".scratch", "demo");
    mkdirSync(featureDir, { recursive: true });
    const statePath = join(featureDir, "state.toon");
    const legacyV3 = [
      "schema:v3",
      "feature:demo",
      "phase:executing",
      "next_action:start/continue task",
      "plan_path:.scratch/demo/plan.md",
      `plan_sha256:${FIXTURE_PLAN_SHA}`,
      "base_ref:main",
      "wip_branch:wip/demo",
      "last_green_task:none",
      "last_green_commit:none",
      "autosync:off",
      "ponytail_level:lite",
      "cleanup_preference:retain",
      "checkpoint_revision:7",
      "",
    ].join("\n");
    writeFileSync(statePath, legacyV3);

    const migrated = readStateFile(statePath);
    assert.equal(migrated.schema, "v4");
    assert.equal(migrated.autosync, "off");
    assert.equal(migrated.cleanup_preference, "retain");
    assert.equal(migrated.checkpoint_revision, "8");
    assert.equal(Object.hasOwn(migrated, "ponytail_level"), false);
    assert.doesNotMatch(readFileSync(statePath, "utf8"), /ponytail_level/);

    const invalidLegacy = legacyV3.replace("ponytail_level:lite", "ponytail_level:turbo");
    writeFileSync(statePath, invalidLegacy);
    assert.throws(() => readStateFile(statePath), /ponytail_level/);
    assert.equal(readFileSync(statePath, "utf8"), invalidLegacy);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("readStateFile rejects FIFO instead of blocking", () => {
  const { execFileSync } = require("node:child_process");
  const tmp = mkdtempSync(join(tmpdir(), "gsd-fifo-test-"));
  const featureDir = join(tmp, ".scratch", "demo");
  mkdirSync(featureDir, { recursive: true });
  const statePath = join(featureDir, "state.toon");

  // Write a valid state file first so lstat sees a regular file.
  writeFileSync(statePath, [
    "schema:v4",
    "feature:demo",
    "phase:executing",
    "plan_path:.scratch/demo/plan.md",
    `plan_sha256:${FIXTURE_PLAN_SHA}`,
    "base_ref:main",
    "wip_branch:wip/demo",
    "last_green_task:none",
    "last_green_commit:none",
    "autosync:off",
    "cleanup_preference:retain",
    "checkpoint_revision:7",
    "",
  ].join("\n"));

  // Replace the regular file with a FIFO before reading.
  // With O_NONBLOCK the open succeeds but fstat shows non-regular → rejected.
  const moduleUrl = new URL("../extensions/gsd-context.js", import.meta.url).href;
  const childScript = `
    import fs from "node:fs";
    import { readStateFile } from ${JSON.stringify(moduleUrl)};
    const statePath = ${JSON.stringify(statePath)};
    // Replace regular file with FIFO.
    fs.unlinkSync(statePath);
    const { execFileSync } = await import("node:child_process");
    execFileSync("mkfifo", [statePath]);
    try {
      readStateFile(statePath);
      process.exit(1); // must not succeed
    } catch (e) {
      process.exit(/cannot read|expected a regular file|FIFO|pipe|ENXIO/.test(e.message) ? 0 : 2);
    }
  `;
  try {
    execFileSync(process.execPath, ["-e", childScript], {
      timeout: 10_000,
      stdio: "pipe",
    });
    // execFileSync does not throw = child exited 0 = correct rejection
  } finally {
    try { unlinkSync(statePath); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("readStateFile rejects state.toon swap after feature dir pin", () => {
  const { execFileSync } = require("node:child_process");
  const tmp = mkdtempSync(join(tmpdir(), "gsd-swap-test-"));
  const featureDir = join(tmp, ".scratch", "demo");
  mkdirSync(featureDir, { recursive: true });
  const statePath = join(featureDir, "state.toon");

  writeFileSync(statePath, [
    "schema:v4",
    "feature:demo",
    "phase:executing",
    "plan_path:.scratch/demo/plan.md",
    `plan_sha256:${FIXTURE_PLAN_SHA}`,
    "base_ref:main",
    "wip_branch:wip/demo",
    "last_green_task:none",
    "last_green_commit:none",
    "autosync:off",
    "cleanup_preference:retain",
    "checkpoint_revision:7",
    "",
  ].join("\n"));

  // Race: swap state.toon with a FIFO after the feature dir is pinned
  // but before the file open. Hook process.chdir to detect the feature-dir pin,
  // then swap state.toon with a FIFO before the file open.
  const moduleUrl = new URL("../extensions/gsd-context.js", import.meta.url).href;
  const childScript = `
    import fs from "node:fs";
    import { readStateFile } from ${JSON.stringify(moduleUrl)};
    const statePath = ${JSON.stringify(statePath)};
    const origChdir = process.chdir.bind(process);
    let chdirCount = 0;
    const { execFileSync } = await import("node:child_process");
    process.chdir = (dir) => {
      const result = origChdir(dir);
      if (dir === "demo" || (typeof dir === "string" && dir.endsWith("demo"))) {
        chdirCount++;
        // Feature dir just pinned. Swap state.toon with a FIFO now.
        try {
          fs.unlinkSync(statePath);
          execFileSync("mkfifo", [statePath]);
        } catch {}
      }
      return result;
    };
    try {
      readStateFile(statePath);
      process.exit(1); // must not succeed
    } catch (e) {
      if (chdirCount === 0) process.exit(3); // hook never fired!
      process.exit(/cannot read|expected a regular file|FIFO|pipe|identity changed/.test(e.message) ? 0 : 2);
    }
  `;
  try {
    execFileSync(process.execPath, ["-e", childScript], {
      timeout: 10_000,
      stdio: "pipe",
    });
  } finally {
    try { unlinkSync(statePath); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  }
});
