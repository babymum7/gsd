import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readStateFile, writeStateAtomic } from '../lib/gsd-state.mjs';
import { readPlanFile } from '../lib/gsd-contract.mjs';

const isDarwin = process.platform === 'darwin';
const testDarwin = isDarwin ? test : test.skip;

function canonicalPlanFixture(feature) {
  return [
    '# Plan',
    '## Feature',
    `\`${feature}\``,
    '## Base',
    '`main`',
    '## Summary',
    'Darwin probe canonical plan fixture.',
    '## Context',
    'gsd',
    '## Domain Impact',
    '- **Classification:** none',
    '- **Contexts:** none',
    '- **Documentation:** none',
    '- **Broad bootstrap:** not-offered',
    '- **Evidence:** None.',
    '## Scope',
    '- Darwin probe.',
    '## Acceptance Criteria',
    '### AC-1: Darwin probe',
    '- **State:** active',
    '- **Outcome:** Canonical plan reads on darwin.',
    '- **Action:** Run readPlanFile.',
    '- **Expected:** Returns plan content and feature.',
    '## Decisions',
    'None.',
    '## Invariants',
    '- **I-1:** Darwin probe preserves contracts.',
    '## Non-goals',
    '- **NG-1:** None.',
    '## Interfaces',
    '| Criterion | Seam | Path | Lower-seam reason |',
    '| --- | --- | --- | --- |',
    '| AC-1 | readPlanFile | `lib/gsd-contract.mjs` | none |',
    '## Publication',
    'null',
    '## Tasks',
    '### T1: Probe task',
    '- **Satisfies:** AC-1',
    '- **Files:**',
    '  - `test/gsd-darwin-probe.test.js` — create: probe',
    '- **Test:** `bun test test/gsd-darwin-probe.test.js`',
    '- **Status:** pending',
    '',
  ].join('\n');
}

testDarwin('T2: writeStateAtomic and readStateFile roundtrip on darwin', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'gsd-darwin-probe-'));
  const feature = 'darwin-roundtrip';
  const featureDir = join(workspace, '.scratch', feature);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, 'plan.md'), canonicalPlanFixture(feature));

  const stateInput = {
    schema: 'v4',
    feature,
    phase: 'executing',
    next_action: 'start/continue task',
    plan_path: `.scratch/${feature}/plan.md`,
    plan_sha256: 'a'.repeat(64),
    base_ref: 'main',
    wip_branch: `wip/${feature}`,
    last_green_task: 'none',
    last_green_commit: 'none',
    autosync: 'none',
    cleanup_preference: 'none',
    checkpoint_revision: '1',
  };

  try {
    const written = writeStateAtomic(featureDir, stateInput);
    assert.equal(written.feature, feature);
    assert.equal(written.phase, 'executing');

    const statePath = join(featureDir, 'state.toon');
    const read = readStateFile(statePath);
    assert.equal(read.feature, feature);
    assert.equal(read.phase, 'executing');
    assert.equal(read.plan_path, `.scratch/${feature}/plan.md`);
    assert.equal(read.plan_sha256, 'a'.repeat(64));
    assert.equal(read.base_ref, 'main');
    assert.equal(read.wip_branch, `wip/${feature}`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

testDarwin('T2: readPlanFile on canonical plan fixture on darwin', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'gsd-darwin-probe-'));
  const feature = 'darwin-plan-probe';
  const featureDir = join(workspace, '.scratch', feature);
  mkdirSync(featureDir, { recursive: true });
  const planContent = canonicalPlanFixture(feature);
  const planPath = join(featureDir, 'plan.md');
  writeFileSync(planPath, planContent);

  try {
    const result = readPlanFile(`.scratch/${feature}/plan.md`, { cwd: workspace });
    assert.equal(result.content, planContent);
    assert.equal(result.feature, feature);
    assert.equal(result.path, planPath);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

testDarwin('T2: dynamic import of extensions/gsd-context.js exercises state read on darwin', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'gsd-darwin-probe-'));
  const feature = 'darwin-ext-probe';
  const featureDir = join(workspace, '.scratch', feature);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, 'plan.md'), canonicalPlanFixture(feature));

  const stateInput = {
    schema: 'v4',
    feature,
    phase: 'executing',
    next_action: 'start/continue task',
    plan_path: `.scratch/${feature}/plan.md`,
    plan_sha256: 'b'.repeat(64),
    base_ref: 'main',
    wip_branch: `wip/${feature}`,
    last_green_task: 'none',
    last_green_commit: 'none',
    autosync: 'none',
    cleanup_preference: 'none',
    checkpoint_revision: '1',
  };

  try {
    const ext = await import('../extensions/gsd-context.js');
    ext.writeStateAtomic(featureDir, stateInput);
    const statePath = join(featureDir, 'state.toon');
    const read = ext.readStateFile(statePath);
    assert.equal(read.feature, feature);
    assert.equal(read.phase, 'executing');
    assert.equal(read.plan_sha256, 'b'.repeat(64));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
