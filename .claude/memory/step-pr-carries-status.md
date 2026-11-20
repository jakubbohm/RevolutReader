---
name: step-pr-carries-status
description: A step's own PR carries its done status (about the PR, not a commit); ask "is the step done?" before marking it ready; its own commit, pushed with the rest (review fixes wait for the archive, one push); a later PR only for real post-PR work
metadata:
  type: feedback
---

**The rule is about the PR, not a commit.** A step's own PR carries its status.
- **Ask first:** before the PR is marked ready, ask the owner "is <step> done?".
- **On yes:** mark it `done` in `pm/progress.md` (status, date, notes) in that PR. A commit of its own is fine, and preferred.
- **Pushed with the rest:** push it together with the PR's other commits, so one CI run covers them. The same goes for a review's fixes: after `/triage-review`, run `/opsx:archive` first, then push the fixes and the archive in one push. Never offer to push the fixes on their own.
- **Always in the PR itself:** so the merge's one deploy covers it.

**The one exception** is real work that can only happen after the merge and the deploy, such as a manual scenario on a real phone, whose date goes into `tests/manual-scenarios.md`. The row then stays `in progress` and names that work, and the PR that records its results marks the step `done`. Routine checks after the deploy (the deploy ran, settings read back, a test message) are reported to the owner, never a PR of their own.

**Why:**
- **2026-11-04 (F0-1):** "you should have asked me before committing". The done-marking then needed a separate commit. This memory first recorded it as "the same commit", which was wrong.
- **2026-11-20 (C8b):**
  - "the PR should contain everything without requiring any followup PRs that would just change a status on one line in the progress. The only exception is if some real work is required after the merge and deployment, eg manual testing on a real phone".
  - Then: "It's not about commit, it's about PR. So I'm perfectly fine, and actually prefer it, if it does its own commit. But it should be pushed together with the rest of the commits so it is covered by the same CI run ideally. And for sure it should be part of the same PR, so it's covered by the same deployment run."
- **2026-11-20 (C8c):** after the triage I offered to push its commits before the archive. The owner: "why push when you haven't run opsx:archive?"
- **What it cost before:** C8a's PR (#70) left its row `in progress`, and a docs PR (#72) marked it done with routine deploy checks. The owner called that wrong.

**How to apply:** follow [docs/conventions/workflow.md § 6](../../docs/conventions/workflow.md#6-openspec), "A step's PR is complete on its own". At `/opsx:archive`, the archive guidance in `openspec/config.yaml` says it too. Related: [[archive-inside-the-pr]], [[decisions-one-by-one]].
