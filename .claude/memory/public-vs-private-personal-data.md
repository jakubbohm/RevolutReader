---
name: public-vs-private-personal-data
description: Personal data (browser names, IP and email addresses) must stay out of everything public (repo, PRs, CI logs, evidence); the owner's private Azure telemetry may hold it. Bank data stays out of all logs
metadata:
  type: user
---

The owner's rule for personal data (2026-11-08, c006 open question 4): "we need to strip out the personal data from any public logs, which is typically whatever is on the GitHub repo, because that's public. I don't need to have my personal data stripped out from the Azure Application Insights, as those are only visible and accessible to me."

**Why:** the repository is public, so anything in it (files, PRs, issues, GitHub Actions logs, spike evidence) is visible to anyone; Application Insights and the Log Analytics workspace are readable only through the owner's Azure access.

**How to apply:**
- Public places: never the users' browser names, IP or email addresses, or other personal data. Test data stays made up (RFC 5737 addresses, invented browsers).
- Private telemetry (Application Insights, the workspace): personal data such as the request's browser name may stay; don't add code just to strip it (c006 design.md D13).
- Bank data (balances, amounts, counterparties, transaction texts) and account identifiers stay out of every log, private ones included: CLAUDE.md's rule is unchanged.
- When unsure whether a place is public, treat it as public.

Related: [[no-personal-ids-in-repo]].
