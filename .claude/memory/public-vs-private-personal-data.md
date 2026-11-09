---
name: public-vs-private-personal-data
description: Public places (repo, PRs, issues, CI logs, evidence) never hold personal data, bank data or secrets; private telemetry may hold personal data, never secrets, and bank data only by an explicit recorded decision
metadata:
  type: user
---

The owner's rule (2026-11-08, c006 open question 4 and the software-factory rule that followed, option a): personal data must be stripped from anything publicly accessible, but not from the owner's private Azure telemetry ("those are only visible and accessible to me"). The owner first also wanted bank data allowed in private logs; after Claude's reasons (private logs leak through copying into public issues and AI transcripts, and through anything with read access such as the deploy identity; OWASP and GDPR data minimisation; no gain for one configured account) the owner chose to keep bank data out by default.

**Why:** the repository is public, so its files, PRs, issues, GitHub Actions logs and spike evidence are visible to anyone; Application Insights and the Log Analytics workspace are readable only through Azure access.

**How to apply:**
- **Public places:** no personal data (browser names, IP or email addresses), no bank data, no secrets. Ever. Test data stays made up (RFC 5737 addresses, invented browsers).
- **Private telemetry:** personal data may stay when it helps diagnosis; don't add code just to strip it (c006 design.md D13). Secrets (keys, tokens, session ids) never. Bank data (balances, amounts, counterparties, transaction texts) and account identifiers: no by default (CLAUDE.md, c004 D5), allowed only by an explicit, recorded project decision.
- When unsure whether a place is public, treat it as public.
- It is also a software-factory rule (lesson written in c006 task 10.2).

Claude itself may read bank data in the session (the owner, 2026-11-09): [[claude-may-read-bank-data]].

Related: [[no-personal-ids-in-repo]], [[factory-gets-full-version]].
