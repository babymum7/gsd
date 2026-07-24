# Deepening

How to deepen shallow modules safely after the owning production capability and context are known. Uses the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, **locality**, and **testability**.

## Dependency categories

Classify dependencies before moving a seam. The category determines the production adapter and fastest honest test surface.

### In-process

Pure computation or in-memory state with no I/O. Merge related shallow modules behind one public interface and test it directly. No adapter is needed.

### Local-substitutable

Infrastructure with a production-faithful local implementation, such as an embedded database or temporary filesystem. Keep the seam internal and run local integration tests through the deep module. Do not expose infrastructure controls through its public interface.

### Remote but owned

An owned HTTP, RPC, queue, or service boundary. Define a contract at the ownership/transport seam. Keep domain/application policy in the owning context and put transport in an adapter. Tests use an in-process contract implementation only when it preserves the observable semantics that matter.

### True external

A third-party provider outside repository and organizational control. Isolate its contract, failures, and translation at the edge. Domain/application policy depends on the smallest needed capability, while integration tests cover the real adapter where feasible.

## Seam discipline

- One production adapter alone is a hypothetical seam. Add an interface only for another justified adapter or a real ownership/transport boundary.
- Internal seams remain private. Never enlarge the external interface because a test wants internal control.
- Framework and persistence adapters should be idiomatic. Wrapping every API creates shallow modules rather than independence.
- Map external, transport, persistence, and cross-context shapes at the boundary that owns the translation.

## Migration

Prefer an atomic cutover. When callers cannot move together:

1. **Expand** — introduce the target interface without changing observable behavior.
2. **Migrate** — move an inventoried set of callers and tests.
3. **Contract** — delete the old path only after references prove no caller remains.

Do not keep aliases or deprecated paths after contraction.

## Testing strategy

- Test business behavior through the deep module's public interface.
- Replace shallow implementation-coupled tests once the higher interface covers their observable contract.
- Use local-substitutable integration rather than mocks when it is deterministic and cheap.
- Mock only true external capability or a remote boundary whose production transport cannot run in the fast loop.
- Tests should survive internal refactors; assertions on private state are evidence that the seam is misplaced.
