---
name: parallel-prs-squash-merge
description: Two change branches in flight with squash merges: merge the earlier PR's latest tip into yours before it squashes; after the squash, merge main taking your side and prove the delta is unchanged
metadata:
  type: project
---

When an earlier PR (here #29, C12) must merge before yours (#30, C6) and the repo squash-merges:

1. Merge the earlier PR's **latest tip** into your branch while it is still open (the owner held #29 for this, 2026-11-08),
   resolving the conflicts with full knowledge of both sides. Also look for semantic clashes git cannot see: both
   branches had added a "fifth" grantable role and lessons R-53/R-54, and both added the same package line (NU1506).
2. A draft PR can be stacked on the earlier PR's branch so its diff (and a cloud review) shows only your change; GitHub
   retargets it to `main` when the base branch is deleted after the merge.
3. After the squash, merging `main` conflicts again wherever your merge edited lines the earlier PR also changed, and
   files the earlier PR added become add/add conflicts even when untouched. If the squash tree equals the tip you
   merged (`git diff <tip> <squash>` empty), take your side for the files you edited and `main`'s for the rest.
4. Prove it: `git diff main <merged>` must equal `git diff <tip> <your pre-merge head>` line for line (compare the
   `+`/`-` lines of both diffs).

**Why:** the squash erases the earlier PR's own commits, so resolving after it means guessing what changed.

**How to apply:** any two PRs that touch shared docs or infra. Related: [[orchestrate-with-subagents]],
[[az-cmd-mangles-arguments]].
