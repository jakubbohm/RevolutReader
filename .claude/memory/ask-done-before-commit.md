---
name: ask-done-before-commit
description: Before committing a step's final work, ask whether the step is done, so the status update goes into the same commit
metadata:
  type: feedback
---

When a roadmap step's work is ready to commit, ask the user in the same question whether the step is done (and should be marked `done` in `pm/progress.md`) before committing. The user, 2026-11-04 (F0-1): "you should have asked me before committing" — the done-marking then needed a separate commit.

**Why:** CLAUDE.md forbids declaring a step complete on my own, but splitting the status update from the work leaves extra commits and a stale status in between.

**How to apply:** at the end of a step, propose the commit and ask "is <step> done?" together; on yes, update `pm/progress.md` (status, date, notes) and commit it with the work. Related: [[decisions-one-by-one]].
