import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPlanFile } from '../lib/gsd-contract.mjs';
import { readStateFile, writeStateAtomic } from '../lib/gsd-state.mjs';

const FEATURE = 'parity-feature';

const VALID_STATE = {
  schema: 'v4',
  feature: FEATURE,
  phase: 'approved',
  next_action: 'start task T1',
  plan_path: `.scratch/${FEATURE}/plan.md`,
  plan_sha256: '9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386',
  base_ref: 'main',
  wip_branch: `wip/${FEATURE}`,
  last_green_task: 'none',
  last_green_commit: 'none',
  autosync: 'none',
  cleanup_preference: 'none',
  checkpoint_revision: '1',
};

const CANONICAL_PLAN = `# Plan
## Feature
${FEATURE}
## Base
main
## Summary
Parity test fixture plan summary.
`;

function makeTmpDir(prefix = 'gsd-parity-test-') {
  return fs.mkdtempSync(path.join(tmpdir(), prefix));
}

/**
 * Shared scenario table pinning parity between resolvePlanLocation (via readPlanFile)
 * and resolveFeatureDirectory (via writeStateAtomic / readStateFile).
 */
const SCENARIOS = [
  {
    id: 'feature-dir-symlink',
    name: 'feature directory inside .scratch is a symlink to an outside directory',
    expected: 'reject',
    planMatch: /Markdown contract: feature directory must be a real directory/,
    stateMatch: /featureDir symlink rejected/,
    setup(base) {
      const workspace = path.join(base, 'workspace');
      const outside = path.join(base, 'outside-target');
      fs.mkdirSync(path.join(workspace, '.scratch'), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, 'plan.md'), CANONICAL_PLAN);
      fs.writeFileSync(path.join(outside, 'state.toon'), `schema:v4\nfeature:${FEATURE}\nphase:approved\n`);

      const featureDir = path.join(workspace, '.scratch', FEATURE);
      fs.symlinkSync(outside, featureDir);

      return {
        workspace,
        featureDir,
        planRelativePath: `.scratch/${FEATURE}/plan.md`,
        statePath: path.join(featureDir, 'state.toon'),
      };
    },
    runPlan(fixture) {
      readPlanFile(fixture.planRelativePath, { cwd: fixture.workspace });
    },
    runState(fixture) {
      writeStateAtomic(fixture.featureDir, VALID_STATE);
    },
  },
  {
    id: 'scratch-dir-symlink',
    name: '.scratch directory itself is a symlink to an outside directory',
    expected: 'reject',
    planMatch: /Markdown contract: \.scratch must be a real directory/,
    stateMatch: /featureDir parent symlink rejected/,
    setup(base) {
      const workspace = path.join(base, 'workspace');
      const outside = path.join(base, 'outside-scratch');
      const outsideFeature = path.join(outside, FEATURE);
      fs.mkdirSync(workspace, { recursive: true });
      fs.mkdirSync(outsideFeature, { recursive: true });
      fs.writeFileSync(path.join(outsideFeature, 'plan.md'), CANONICAL_PLAN);
      fs.writeFileSync(path.join(outsideFeature, 'state.toon'), `schema:v4\nfeature:${FEATURE}\nphase:approved\n`);

      const scratchDir = path.join(workspace, '.scratch');
      fs.symlinkSync(outside, scratchDir);
      const featureDir = path.join(scratchDir, FEATURE);

      return {
        workspace,
        featureDir,
        planRelativePath: `.scratch/${FEATURE}/plan.md`,
        statePath: path.join(featureDir, 'state.toon'),
      };
    },
    runPlan(fixture) {
      readPlanFile(fixture.planRelativePath, { cwd: fixture.workspace });
    },
    runState(fixture) {
      writeStateAtomic(fixture.featureDir, VALID_STATE);
    },
  },
  {
    id: 'workspace-root-symlink',
    name: 'workspace root (grandparent / cwd) is a symlink to a real workspace',
    expected: 'accept',
    setup(base) {
      const realWorkspace = path.join(base, 'real-workspace');
      const realFeatureDir = path.join(realWorkspace, '.scratch', FEATURE);
      fs.mkdirSync(realFeatureDir, { recursive: true });
      fs.writeFileSync(path.join(realFeatureDir, 'plan.md'), CANONICAL_PLAN);

      const linkWorkspace = path.join(base, 'link-workspace');
      fs.symlinkSync(realWorkspace, linkWorkspace);
      const linkFeatureDir = path.join(linkWorkspace, '.scratch', FEATURE);

      return {
        workspace: linkWorkspace,
        featureDir: linkFeatureDir,
        planRelativePath: `.scratch/${FEATURE}/plan.md`,
        statePath: path.join(linkFeatureDir, 'state.toon'),
      };
    },
    runPlan(fixture) {
      const result = readPlanFile(fixture.planRelativePath, { cwd: fixture.workspace });
      assert.equal(result.feature, FEATURE);
      assert.equal(result.content, CANONICAL_PLAN);
      return result;
    },
    runState(fixture) {
      const written = writeStateAtomic(fixture.featureDir, VALID_STATE);
      assert.equal(written.feature, FEATURE);
      assert.equal(written.phase, 'approved');
      const readBack = readStateFile(fixture.statePath);
      assert.deepEqual(readBack, written);
      return written;
    },
  },
  {
    id: 'authority-file-symlink',
    name: 'plan.md or state.toon is a symlink pointing to an outside file',
    expected: 'reject',
    planMatch: /Markdown contract: plan file is a symlink/,
    stateMatch: /state\.toon: symlink rejected/,
    setup(base) {
      const workspace = path.join(base, 'workspace');
      const outside = path.join(base, 'outside-files');
      const featureDir = path.join(workspace, '.scratch', FEATURE);
      fs.mkdirSync(featureDir, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      const outsidePlan = path.join(outside, 'external-plan.md');
      const outsideState = path.join(outside, 'external-state.toon');
      fs.writeFileSync(outsidePlan, CANONICAL_PLAN);
      fs.writeFileSync(outsideState, `schema:v4\nfeature:${FEATURE}\nphase:approved\nnext_action:start task T1\nplan_path:.scratch/${FEATURE}/plan.md\nplan_sha256:9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386\nbase_ref:main\nwip_branch:wip/${FEATURE}\nlast_green_task:none\nlast_green_commit:none\nautosync:none\ncleanup_preference:none\ncheckpoint_revision:1\n`);

      const planPath = path.join(featureDir, 'plan.md');
      const statePath = path.join(featureDir, 'state.toon');
      fs.symlinkSync(outsidePlan, planPath);
      fs.symlinkSync(outsideState, statePath);

      return {
        workspace,
        featureDir,
        planRelativePath: `.scratch/${FEATURE}/plan.md`,
        statePath,
      };
    },
    runPlan(fixture) {
      readPlanFile(fixture.planRelativePath, { cwd: fixture.workspace });
    },
    runState(fixture) {
      readStateFile(fixture.statePath);
    },
  },
  {
    id: 'benign-identical-fixture',
    name: 'benign canonical hierarchy with real directories and regular files',
    expected: 'accept',
    setup(base) {
      const workspace = path.join(base, 'workspace');
      const featureDir = path.join(workspace, '.scratch', FEATURE);
      fs.mkdirSync(featureDir, { recursive: true });
      fs.writeFileSync(path.join(featureDir, 'plan.md'), CANONICAL_PLAN);

      return {
        workspace,
        featureDir,
        planRelativePath: `.scratch/${FEATURE}/plan.md`,
        statePath: path.join(featureDir, 'state.toon'),
      };
    },
    runPlan(fixture) {
      const result = readPlanFile(fixture.planRelativePath, { cwd: fixture.workspace });
      assert.equal(result.feature, FEATURE);
      assert.equal(result.content, CANONICAL_PLAN);
      return result;
    },
    runState(fixture) {
      const written = writeStateAtomic(fixture.featureDir, VALID_STATE);
      assert.equal(written.feature, FEATURE);
      assert.equal(written.phase, 'approved');
      const readBack = readStateFile(fixture.statePath);
      assert.deepEqual(readBack, written);
      return written;
    },
  },
];

for (const scenario of SCENARIOS) {
  test(`T1: path parity - ${scenario.id} (${scenario.name})`, () => {
    const base = makeTmpDir(`gsd-parity-${scenario.id}-`);
    try {
      const fixture = scenario.setup(base);

      if (scenario.expected === 'reject') {
        // Assert plan-side resolver rejects with expected failure pattern
        assert.throws(
          () => scenario.runPlan(fixture),
          (error) => {
            assert.ok(error instanceof Error, 'plan resolver should throw Error');
            assert.match(
              error.message,
              scenario.planMatch,
              `plan resolver error message mismatch: ${error.message}`,
            );
            return true;
          },
          `plan resolver should reject scenario: ${scenario.name}`,
        );

        // Assert state-side resolver rejects with expected failure pattern
        assert.throws(
          () => scenario.runState(fixture),
          (error) => {
            assert.ok(error instanceof Error, 'state resolver should throw Error');
            assert.match(
              error.message,
              scenario.stateMatch,
              `state resolver error message mismatch: ${error.message}`,
            );
            return true;
          },
          `state resolver should reject scenario: ${scenario.name}`,
        );
      } else if (scenario.expected === 'accept') {
        // Assert both resolvers accept the scenario
        const planResult = scenario.runPlan(fixture);
        assert.ok(planResult, 'plan resolver should return result');

        const stateResult = scenario.runState(fixture);
        assert.ok(stateResult, 'state resolver should return result');
      } else {
        throw new Error(`unknown scenario expectation: ${scenario.expected}`);
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
}
