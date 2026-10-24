# Parts

When one feature needs several pieces that each need their own discussion, write `.scratch/<feature>/parts.md` as a plain checklist, one line per part in dependency order:

```markdown
Integration: `<feature>` from `<base>`
Delivery: `<merge|merge-push|pull-request|branch>`
- [ ] P1: <user-visible outcome>
  - GIVEN <precondition> WHEN <operation> THEN <observable result>
- [ ] P2: <user-visible outcome>
- [ ] Merge `<feature>` into `<base>`
```

Split by user-visible outcome, never by file, layer, or task count. In one brainstorm, converge every part you can and write its criteria under its line, and ask the Delivery question once for the whole list. Plan the next unchecked part as its own feature `<feature>-pN` from its recorded criteria. When that part merges or its pull request opens, tick it `[x]`.
After a pull request HEAD stays on its WIP branch, so before planning the next part check out `base_ref`, or have the user cut a non-WIP branch from the open part when the next one needs its code. The checklist has no validator or lifecycle authority.
- **Back to back:** once the list converged, start the next part as soon as one is ticked, without asking. A part whose criteria could not converge up front is brainstormed on arrival: decide by recommendation where a defensible default exists, and ask only a question that changes behavior, scope, or a destructive action.
- **Integration branch:** when the base is checked out in another worktree (another session works there), or the parts should land on the base together (the user wants fewer commits on the base, or one merge or push at the end), cut a non-WIP branch `<feature>` from the base before P1, in its own worktree when this one is busy (`git worktree add -b <feature> <dir> <base>`), and plan every part from there.
  `derive-base` then records `<feature>` as each part's Base, so a part merges without waiting for the base. Without one, omit the `Integration:` line and the closing line, and parts merge straight into the base.
- **Closing merge:** the last line merges the integration branch into its base, as the list's Delivery says; each part then delivers with `merge` into the integration branch. When every part is ticked, deliver it without asking, but only in the worktree holding the base once its session is idle; otherwise report it and leave it to the user. Without a recorded Delivery, ask the user. Before starting each part, merge the base into the integration branch if the base moved.
