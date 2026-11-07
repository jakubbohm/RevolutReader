---
name: orchestrate-with-subagents
description: In long multi-item rounds the main session orchestrates and subagents implement, to keep the main context lean; state goes to a file before a compaction
metadata:
  type: feedback
---

In a long round of fixes (e.g. going through code-review findings one by one), the main session does not edit code itself. It explains each item, collects the user's decision, briefs one implementation subagent, then verifies the result (tests, diff) and reports. The user, 2026-11-07: "you shouldn't fix it yourself, that would be too context-intensive ... I would like you to be the orchestrator, but you will use sub-agents for implementations."

**Why:** implementing inline fills the main context with file dumps and test output, so the session needs compacting mid-round and loses detail.

**How to apply:** one implementation subagent at a time when they share a worktree (builds lock files); give each the decision, the exact files and lines, the test-first order and the repo's pitfalls; check its claims before reporting them. Before the user compacts, write the round's state (decisions made, items left, proposals, setup) to a file in the session scratchpad and give the user a restart prompt that points to it. Related: [[decisions-one-by-one]], [[continue-announced-steps]].
