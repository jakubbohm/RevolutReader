---
name: step-pr-carries-status
description: A work item's own PR carries its done status (about the PR, not a commit); ask "is it done?" before marking it ready, then the PR closes its issue; review fixes wait for the archive, one push; a later PR only for real post-deploy work
metadata:
  type: feedback
---

**The rule is about the PR, not a commit.** A work item's own PR carries its status. Since 2026-11-23 the status is the GitHub issue, not `pm/progress.md`, which is frozen ([docs/conventions/workflow.md § 9](../../docs/conventions/workflow.md#9-project-management)).
- **Ask first:** before the PR is marked ready, ask the owner "is <the work> done?".
- **On yes:** the PR closes its issue (`Closes #<n>` in its description). Until 2026-11-23 this meant marking the step `done` in `pm/progress.md`, in a commit of its own.
- **Pushed with the rest:** a review's fixes and the archive go in one push: after `/triage-review`, run `/opsx:archive` first, then push the fixes and the archive together, so one CI run covers them. Never offer to push the fixes on their own.
- **Always in the PR itself:** so the merge's one deploy covers it.

**The one exception** is real work that can only happen after the merge and the deploy, such as a manual scenario on a real phone, whose date goes into `tests/manual-scenarios.md`. The issue then stays open and names that work, and the PR that records its results closes it. Routine checks after the deploy (the deploy ran, settings read back, a test message) are reported to the owner, never a PR of their own.

**Why:**
- **2026-11-04 (F0-1):** "you should have asked me before committing". The done-marking then needed a separate commit. This memory first recorded it as "the same commit", which was wrong.
- **2026-11-20 (C8b):**
  - "the PR should contain everything without requiring any followup PRs that would just change a status on one line in the progress. The only exception is if some real work is required after the merge and deployment, eg manual testing on a real phone".
  - Then: "It's not about commit, it's about PR. So I'm perfectly fine, and actually prefer it, if it does its own commit. But it should be pushed together with the rest of the commits so it is covered by the same CI run ideally. And for sure it should be part of the same PR, so it's covered by the same deployment run."
- **2026-11-20 (C8c):** after the triage I offered to push its commits before the archive. The owner: "why push when you haven't run opsx:archive?"
- **What it cost before:** C8a's PR (#70) left its row `in progress`, and a docs PR (#72) marked it done with routine deploy checks. The owner called that wrong.

**How to apply:** follow [docs/conventions/workflow.md § 6](../../docs/conventions/workflow.md#6-openspec), "A step's PR is complete on its own". At `/opsx:archive`, the archive guidance in `openspec/config.yaml` says it too. Related: [[archive-inside-the-pr]], [[decisions-one-by-one]].
