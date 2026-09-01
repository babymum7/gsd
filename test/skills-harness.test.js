import { test } from "bun:test";
import assert from "node:assert/strict";
import { read } from "./support/skills-fixtures.js";

// ownership, and never said that bounded read-only research is still allowed.
test("AC-5/AC-6: injected orchestration keeps ownership and read-only research stays allowed", () => {
  const bootstrap = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const pipeline = reference.match(
    /## Post-plan pipeline contract\n[\s\S]*?(?=\n## Git\/base\/WIP\/scratch mechanics)/,
  );
  assert.ok(pipeline, "REFERENCE must keep its post-plan pipeline contract");
  for (const [label, body] of [
    ["bootstrap", bootstrap],
    ["reference", pipeline[0]],
  ]) {
    assert.match(
      body,
      /injected orchestration[\s\S]{0,160}never transfers[\s\S]{0,80}ownership/i,
      `${label} denies ownership transfer to an injected directive`,
    );
    assert.match(
      body,
      /leav(?:e|ing) the lifecycle/i,
      `${label} routes a lifecycle parallelism demand out of the lifecycle`,
    );
    assert.match(
      body,
      /read-only research[\s\S]{0,200}carries no authority/i,
      `${label} permits read-only research delegation without authority`,
    );
    assert.match(
      body,
      /implementation, repair, diagnosis, architecture, (?:or |and )?verification/i,
      `${label} names every lifecycle category an injected directive cannot dispatch`,
    );
    assert.match(
      body,
      /re-?verif/i,
      `${label} requires the owner to re-verify a delegated result`,
    );
  }
});

// The harness keeps its own todo list, so plan progress was invisible there while `state.toon`
// held the truth. Mirroring must not create a second authority. Slow suites also needed servers
// that a plain shell call leaks past the merge gate.

// that a plain shell call leaks past the merge gate.
test("AC-7/AC-8: execution mirrors tasks into the harness todo and slow suites supervise processes", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  assert.match(
    execution,
    /one phase[\s\S]{0,200}pending `T1\.\.TN`[\s\S]{0,120}after binding/i,
    "execution initializes one todo phase from the exact pending task identities after binding",
  );
  assert.match(
    execution,
    /todo[\s\S]{0,400}(?:same step as|at) (?:its |the )?green checkpoint/i,
    "a task is marked done in the same step as its green checkpoint",
  );
  assert.match(
    execution,
    /`state\.toon`[\s\S]{0,160}sole resumable authority/i,
    "the mirror never displaces state.toon as resumable authority",
  );
  assert.match(
    verify,
    /supervised named process[\s\S]{0,200}readiness/i,
    "the slow suite starts long-lived processes as supervised named processes with observed readiness",
  );
  assert.match(
    verify,
    /(?:server, watcher, (?:or |and )?daemon|watcher)/i,
    "the slow-suite rule names the long-lived process kinds it covers",
  );
  assert.match(
    verify,
    /(?:torn down|teardown)[\s\S]{0,160}merge gate|merge gate[\s\S]{0,160}(?:torn down|teardown)/i,
    "supervised processes are torn down before the merge gate",
  );
});

test("an executing owner amends the plan in place instead of blocking", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const domain = read("docs/domain/gsd.md");

  // Amending an approved plan mid-execution is a normal move: revalidate the new
  // bytes and rebind the hash. Only unparseable or missing authority still stops.
  assert.match(reference, /### Plan amendment/);
  assert.match(reference, /amend[\s\S]{0,200}revalidate[\s\S]{0,120}rebind/i);
  assert.doesNotMatch(reference, /digest mismatch at those boundaries fails closed as Spec escalation/);
  assert.match(execution, /amend/i);
  assert.doesNotMatch(execution, /Never rewrite the approved Markdown plan/);
  assert.doesNotMatch(execution, /altered, or additional `plan\.md` is Spec escalation/);
  assert.doesNotMatch(verify, /Changed plan bytes, malformed new grammar/);
  assert.match(verify, /changed plan bytes[\s\S]{0,60}revalidate and rebind/i);
  assert.doesNotMatch(handoff, /invalid, missing, or changed plan is Spec escalation/);
  assert.match(handoff, /rebind/i);
  assert.match(planner, /sole writer of the initial|sole writer at creation/i);

  // Self-service vs ask: routine bookkeeping needs no prompt, material changes and
  // drift the owner cannot account for ask one question and still never stop.
  assert.match(reference, /Bookkeeping amendments[\s\S]{0,120}self-service/i);
  assert.match(reference, /Material amendments[\s\S]{0,120}ask one question/i);
  assert.match(reference, /cannot account for[\s\S]{0,120}asks? one question/i);
  assert.doesNotMatch(reference, /amendment[^.\n]{0,80}requires (?:a )?fresh approval/i);
  // A bound-hash exit 1 reports moved bytes, not a lifecycle stop.
  assert.match(reference, /exits 1[\s\S]{0,140}not as a lifecycle stop/);
  assert.doesNotMatch(reference, /mismatched hash fails closed/);

  // The revalidation command must match the packet grammar. A Quick-fix `plan.md`
  // exits 1 under `validate-plan` ("top-level heading must be exactly # Plan"), so
  // naming only that command turns a legal Quick-fix amendment into a false blocker.
  const amendment = reference.match(/### Plan amendment\n[\s\S]*?(?=\n### )/)[0];
  assert.match(amendment, /validate-plan/);
  assert.match(amendment, /validate-quick-fix/);
  assert.match(amendment, /grammar/i);
  assert.match(domain, /validate-quick-fix/);

  // Resume has the same grammar hazard as amendment, but `schema:v4` records no kind
  // discriminator, so "use the matching validator" is unactionable. The probe order is
  // the contract: `validate-quick-fix` first (a full plan exits 1 there), then the bound
  // full-plan form. A bound call checks the hash before parsing, so only an unbound
  // revalidation separates moved bytes from genuinely malformed grammar.
  const resume = handoff.match(/^For every Execution resume[\s\S]*?(?=\nA valid Execution resume)/m)[0];
  assert.match(resume, /validate-quick-fix[\s\S]{0,320}validate-plan/);
  assert.match(resume, /no grammar kind/);
  assert.match(resume, /unbound/);
  assert.match(resume, /Exit 2 is never escalation/);
  assert.doesNotMatch(resume, /For every Execution resume, run `node tools\/gsd-contract\.mjs validate-plan/);
  assert.match(domain, /probing `validate-quick-fix` before the full-plan validator/);
  // The probe reads current bytes, not the bound kind: a packet rewritten into the other
  // grammar probes clean, so a hash mismatch can never prove the prior kind. Any rule that
  // rebinds silently, or claims to know "the same grammar", is unexecutable — ask instead.
  assert.match(resume, /prior kind is unprovable/);
  assert.doesNotMatch(resume, /same proven grammar/);
  assert.match(domain, /prior packet kind is unprovable/);

  // A Quick-fix carries no normal-packet plan authority, yet its state records
  // and rebinds a validated `plan_sha256` — both merged Quick-fix features did. The
  // exception must say which binding is absent instead of denying binding outright.
  const quickFix = reference.match(/### Quick-fix plan exception\n[\s\S]*?(?=\n### Executable contract validator)/)[0];
  assert.doesNotMatch(quickFix, /set, no plan binding, and/);
  assert.match(quickFix, /no normal-packet[\s\S]{0,120}plan binding/i);
  assert.match(quickFix, /`state\.toon`/);
  assert.match(quickFix, /does not accept `--expected-sha256`|unbound/);
  assert.match(domain, /Quick-fix[^.\n]{0,160}runtime binding|runtime binding[^.\n]{0,160}Quick-fix/);
  // A recorded binding nobody checks is decoration: the Quick-fix gate compares it.
  assert.match(verify, /compare the returned hash[\s\S]{0,60}recorded `state\.toon` `plan_sha256`/i);

  // Uncertainty asks one question; it never becomes a stop.
  for (const body of [reference, execution]) {
    assert.match(body, /ask one question/i);
  }
  assert.doesNotMatch(domain, /Approved `plan\.md` bytes remain immutable/);
  assert.match(domain, /amend/i);
});

test("single-task waves execute inline without dispatching sub-agents", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.doesNotMatch(reference, /single-task waves to exactly one sub-agent/i);
  assert.doesNotMatch(execution, /single-task waves are exactly one sub-agent/i);
  assert.match(reference, /single-task wave executes inline by the session owner with `gsd-tdd`/i);
  assert.match(execution, /single-task wave is authored inline by the owner with `gsd-tdd`/i);
  assert.match(reference, /isolation is unavailable or an isolated spawn fails/i);
  assert.match(execution, /isolation is unavailable or an isolated spawn fails/i);
});
