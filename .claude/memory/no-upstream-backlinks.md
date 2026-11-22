---
name: no-upstream-backlinks
description: GitHub text never names another repo's issue as owner/repo#n or a github.com issue URL; that posts a backlink there; nothing outside the owner's repo without an explicit go
metadata:
  type: feedback
---

Nothing may appear outside the owner's own repository without the owner's explicit go, and that includes the "mentioned this" backlink GitHub adds by itself to another repository's issue when an issue, PR body, comment or pushed commit message here names it as `owner/repo#123` or as a `github.com/owner/repo/issues/123` link. In GitHub-published text, name upstream issues with a `https://redirect.github.com/owner/repo/issues/123` link (GitHub Docs, "Avoiding backlinks to linked references"), or in words with no link. Repository files (code comments, docs) are not scanned and may keep the plain form. A squash-merge message is published text too.

**Why:** in #68 / PR #94 (2026-11-21) the findings comment on #68 and the PR body named dotnet/runtime#110917, dotnet/runtime#135978 and App-vNext/Polly#2412 in the plain form. GitHub put 5 backlinks with the owner's name on those upstream issues. The owner: "I don't want to publish anything outside of my repo without my explicit approval!!!" No documented way exists to remove a backlink: editing the text does not (confirmed here 2026-11-22: both texts rewritten to redirect.github.com links, all 5 backlinks stayed); a 2023 user report says only deleting the whole issue or GitHub Support does.

**How to apply:** before posting or editing any issue, PR, comment, review reply or commit message that will be pushed, scan it for `[\w.-]+/[\w.-]+#\d+` and `github.com/<other owner>/.../(issues|pull)/\d+` and rewrite each one. Delegated agents that post (code review, triage) get the same rule in their brief. Related: [[public-vs-private-personal-data]], [[decisions-one-by-one]].
