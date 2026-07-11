# Refactoring

Refactor changes structure without changing behavior. The tests are the proof: green before, green after, no test edited to make the change pass.

## When to refactor

- **Only on green.** All tests pass before you start. Refactoring on RED means you can't tell a structural slip from the failure you already had. **Never refactor while RED.**
- **After the cycle, not during.** In the TDD loop, refactor is step 4 — once behavior is proven, not while chasing GREEN.
- **When the new code reveals old debt.** The behavior you just added often exposes duplication or a shallow module that was invisible before. That's the moment to deepen.
- **Not** when behavior is still moving. If the next test will reshape this code anyway, wait — refactoring code that's about to change is wasted motion.

## The safety loop

Structure changes, behavior doesn't — the tests are your ratchet:

1. Tests green.
2. One small structural change (extract, move, rename, combine).
3. Run tests. Still green → keep it. RED → revert this step, it changed behavior.
4. Repeat.

Rules that keep it safe:

- **One change at a time**, tests between each. A batch of five that goes RED hides which one broke behavior.
- **Never mix refactor with a behavior change** in the same step. Add behavior (RED→GREEN) *or* restructure (green→green) — never both at once, or the tests can't tell you which moved.
- **Don't touch the tests.** If a refactor forces a test edit, it changed observable behavior — that's not a refactor. (Renaming a symbol the test names is the one exception, and it's mechanical.)
- **Refactor through the public interface.** Extracted helpers stay private; tests keep exercising the same interface, so they survive.

## Candidates

- **Duplication** → extract function/class.
- **Long methods** → break into private helpers (tests stay on the public interface).
- **Shallow module** (interface ≈ implementation complexity) → combine or deepen: push behavior behind a smaller interface so callers learn less and get more (see `gsd-codebase-design` — depth, leverage).
- **Feature envy** → move logic to where the data lives.
- **Primitive obsession** → introduce a value object.
- **Leaky seam** → relocate the seam so behavior can vary without editing call sites (`gsd-codebase-design` — seam, adapter).
- **Existing code** the new code reveals as problematic.

## Example

Green tests: `checkout` returns `confirmed` for a valid cart, `rejected` for an empty one. Two call sites duplicate the total math.

```typescript
// BEFORE — duplication across call sites, total logic inline
function checkout(cart, payment) {
  const total = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
  if (cart.items.length === 0) return { status: "rejected" };
  return payment.charge(total);
}
function preview(cart) {
  const total = cart.items.reduce((s, i) => s + i.price * i.qty, 0); // same math, second copy
  return { total };
}

// AFTER — duplication extracted behind a small interface; behavior identical
function cartTotal(cart) {                       // deep enough: callers stop knowing the formula
  return cart.items.reduce((s, i) => s + i.price * i.qty, 0);
}
function checkout(cart, payment) {
  if (cart.items.length === 0) return { status: "rejected" };
  return payment.charge(cartTotal(cart));
}
function preview(cart) {
  return { total: cartTotal(cart) };
}
```

Tests untouched, still green. `cartTotal` is private to the module; the public interface (`checkout`, `preview`) is unchanged, so the tests never noticed the restructure.

## Boundary — when to stop

Refactoring is done when the smell is gone, not when the code is maximally clever.

- **Stop at "no duplication, small interface, tests survive."** Deepening past that is speculative abstraction — the thing ponytail/YAGNI warns against.
- **Don't gold-plate.** A helper used once, an interface with one implementation, a config knob nobody asked for — these add interface without leverage. Shallow the other direction.
- **Don't reopen settled design.** Settled terms and decisions in the relevant `docs/domain/<scope>.md` shard are not refactor targets; a genuine structural rethink is a `gsd-improve-codebase-architecture` candidate, not a step in this loop.
- **Time-box it.** If a refactor balloons past the task's scope, note it as a deepening candidate and move on — don't stall the tracer bullet.
