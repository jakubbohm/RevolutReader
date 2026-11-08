---
name: orchestrate-with-subagents
description: In long multi-item rounds the main session orchestrates and subagents implement, to keep the main context lean; state goes to a file before a compaction
metadata:
  type: feedback
---

In a long round of fixes (e.g. going through code-review findings one by one), the main session does not edit code itself. It explains each item, collects the user's decision, briefs one implementation subagent, then verifies the result (tests, diff) and reports. The user, 2026-11-07: "you shouldn't fix it yourself, that would be too context-intensive ... I would like you to be the orchestrator, but you will use sub-agents for implementations."

**Why:** implementing inline fills the main context with file dumps and test output, so the session needs compacting mid-round and loses detail.

**How to apply:** one implementation subagent at a time when they share a worktree (builds lock files); give each the decision, the exact files and lines, the test-first order and the repo's pitfalls; check its claims before reporting them. Before the user compacts, write the round's state (decisions made, items left, proposals, setup) to a file in the session scratchpad and give the user a restart prompt that points to it. Related: [[decisions-one-by-one]], [[continue-announced-steps]].

**Reviews in a test-first apply (C6, the user asked for ultracode):** commit each verified group, then run a read-only
adversarial review workflow (two lenses, one skeptic per finding) on that fixed commit while the next group is built;
reviewers read with `git show <commit>:<path>` and never build. A confirmed finding becomes a guard test by the
test-writer (red) where a test is possible, then a fix by the implementer, as separate commits; pure look differences go
straight to the implementer. The agents' own "possibly missing test" notes are worth the same treatment. In C6 this found
about a dozen real defects the scenario tests passed over.
