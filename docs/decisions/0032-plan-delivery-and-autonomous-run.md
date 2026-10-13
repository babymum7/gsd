# 0032 — Plans record their delivery and owners run to the end

- **Status:** Accepted
- **Date:** 2026-10-13

## Decision

A plan may carry an optional `## Delivery` section with one of `merge`, `merge-push`, `pull-request`, or `branch`, chosen with one question when brainstorming converges. `validate-plan` prints `delivery:` only when the section is present, and the terminal gate delivers as it says without asking: a push happens only for `merge-push` or `pull-request`, and a push with no remote to choose, or a rejected push, stops as missing access. A plan without the section keeps the merge-or-pull-request question. The ready `next_action` is now `deliver merge or pull request`; packets that still read `ask merge or pull request` resume the same way.

After binding, the owner runs every task, the terminal gate, and delivery in one go. Material amendments are decided by the owner's own recommendation, recorded as the next `D-n` decision, and listed in the final report. The owner stops only for a destructive or outward action the plan does not cover, missing access, or an acceptance contradiction with no defensible default, and never ends a turn announcing the next step or asking whether to continue. Parts converge in one brainstorm where they can, with one Delivery for the whole list, and run back to back.

## Rationale

Sessions after the 2026-10-13 reinstall stopped twice to ask "continue?" after the user had said to follow the recommendations, and asked the merge and push questions three times at the end. Choosing the delivery up front keeps the outward step a user decision while removing the end-of-run prompt, and an absent section keeps every existing plan's behavior.
