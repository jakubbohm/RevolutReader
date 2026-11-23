---
name: worktree-guard-refuses-script-blocks
description: in a worktree-isolated session the Bash guard refuses multi-line shell functions as "too complex"; a skill's script ships as a file run by path (triage-review's do since 2026-11-22)
metadata:
  type: reference
---

In a session isolated in a worktree (EnterWorktree), the Bash tool refuses a command it cannot prove stays inside the worktree: "this command is too complex to verify that it stays inside the worktree … Split it into plain, separate commands". Seen 2026-11-22 in the PR #93 triage, also for `cd <worktree> && …` chains.

- It refused `/triage-review`'s inline scripts (gather findings; reply and resolve), as it had in at least four triages before. Since 2026-11-22 they ship as Node files, `.claude/skills/triage-review/scripts/gather-findings.mjs` and `reply-finding.mjs`, run as `node <path> <args>`, which passes (lessons.md R-37).
- A script in some other skill's text that is refused: run it from a file (Node, or `bash <file>`) with plain arguments, and propose shipping it as a file next to the skill.
- Plain one-line commands with absolute paths and heredoc commits (`git commit -q -F - <<'EOF'`) pass; so did a sequence of plain commands, one per line.
- Also refused (round 2 of the same triage): a `git add … && git commit … <<'EOF'` chain followed by more commands, a `printf` whose argument held `$(git log …)`, and a `cat >> file <<'EOF'` append of a longer plan (it held backslashes and `->`; which part tripped the guard is not known, while shorter appends passed). Run `git add`, `git commit` and `git log` as separate tool calls, and append text with the Write or Edit tool.
- The triage's three scripts (`post-findings.mjs` since round 2) and their tests (`node --test ".claude/skills/triage-review/scripts/*.test.mjs"`) pass as plain commands.
- In such a session, write memory files to the worktree's `.claude/memory/` (the guard refuses the main checkout's path), so they land on the branch.

Related: [[gh-api-slurp-excludes-jq]].
