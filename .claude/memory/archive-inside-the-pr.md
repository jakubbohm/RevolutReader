---
name: archive-inside-the-pr
description: /opsx:archive is always part of the change's own PR, run before the merge; never a follow-up or a separate PR
metadata:
  type: feedback
---

`/opsx:archive` belongs to the change's own PR: once the change's tasks are done (and its guided tasks are run), archive on the change branch, commit `[archive]`, push, and only then is the PR ready to merge. Never list the archive as an after-merge follow-up, and never plan a separate PR for it.

**Why:** the owner said so (2026-11-08, C12, after Claude listed `/opsx:archive` as an after-merge step): "I thought we already made clear that the opsx:archive is always part of the PR and doesn't require its own PR!" The main specs in `openspec/specs/` should change in the same squash merge as the code.

**How to apply:** at the end of `/tdd-apply`'s close, the next step offered is `/opsx:archive` on the same branch, before "ready for review"; progress notes and PR descriptions never put the archive under "after the merge". Written in [docs/conventions/workflow.md § 6](../../docs/conventions/workflow.md#6-openspec).

Related: [[continue-announced-steps]], [[ask-done-before-commit]].
