---
name: gh-api-slurp-excludes-jq
description: gh api --paginate --slurp refuses --jq and --template; shape paged results with node instead
metadata:
  type: feedback
---

`gh api <endpoint> --paginate --slurp` (gh 2.92.0, checked 2026-11-08) exits with "the `--slurp` option is not supported with `--jq` or `--template`". `--paginate` with `--jq` alone runs the filter once per page, so counters and sorts restart on every page.

**Why:** the triage-review skill's gather script first combined the two and failed on its first run.

**How to apply:** write the slurped pages to a file (an array of pages, `[[]]` when empty) and shape them with a short `node -e` script (`pages.flat()`), as `.claude/skills/triage-review/SKILL.md` script A does. Single-page results may still use `--jq` without `--slurp`.
