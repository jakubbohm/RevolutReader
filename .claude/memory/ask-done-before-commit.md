---
name: ask-done-before-commit
description: A step's own PR carries its done status; ask "is the step done?" before marking the PR ready; a follow-up PR only for real work after the deploy (a phone check), never for a status or routine checks
metadata:
  type: feedback
---

A step's status goes in with its work. Before the step's PR is marked ready, ask the owner "is <step> done?". On yes, mark it `done` in `pm/progress.md` (status, date, notes) in the PR's own last commit, with the archive. The same holds for a commit without a PR: ask before committing.

**The one exception** is real work that can only happen after the merge and the deploy, such as a manual scenario on a real phone, whose date goes into `tests/manual-scenarios.md`. The row then stays `in progress` and names that work, and the PR that records its results marks the step `done`. Routine checks after the deploy (the deploy ran, settings read back, a test message) are reported to the owner, never a PR of their own.

**Why:**
- **2026-11-04 (F0-1):** "you should have asked me before committing": the done-marking then needed a separate commit.
- **2026-11-20 (C8b):** "the PR should contain everything without requiring any followup PRs that would just change a status on one line in the progress. The only exception is if some real work is required after the merge and deployment, eg manual testing on a real phone".
- **The gap:** the first instruction lived only here and spoke of commits, so C8a (PR #70) left its row `in progress` and a docs PR (#72) marked it done with routine deploy checks. The owner called that wrong.

**How to apply:** follow [docs/conventions/workflow.md § 6](../../docs/conventions/workflow.md#6-openspec), "A step's PR is complete on its own". At `/opsx:archive`, the archive guidance in `openspec/config.yaml` says it too. Related: [[archive-inside-the-pr]], [[decisions-one-by-one]].
