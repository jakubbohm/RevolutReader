---
name: claude-may-read-bank-data
description: Claude may read the owner's bank data locally (files, telemetry) and show it in the session; it must never be published (GitHub, commits, PRs, issues, CI logs, evidence)
metadata:
  type: feedback
---

The owner, 2026-11-09 (C7b's history import, after Claude refused to open the M1 history file and asked the owner to run a keys-only probe): "You seem to be overly cautious. I don't care if you read my bank details. Just please don't publish them on GitHub. … whatever can help you, you can read it and you don't need to hide it from the session log."

**Why:** hiding the data from Claude cost round trips (the owner running probes by hand) with no gain; the risk the owner cares about is publication, since the repository is public.

**How to apply:**
- Read bank data files (e.g. `spikes/enable-banking/secrets/`), table rows and telemetry directly when it helps to diagnose or verify; no need to ask the owner to run counts-only probes.
- Never put bank data anywhere published: commits, PRs, issues, PR comments, CI logs, committed evidence. Summaries that go public stay counts-only.
- Unchanged: the app itself never logs bank data (CLAUDE.md, the code rule), and tests and fixtures stay made up.

Related: [[public-vs-private-personal-data]].
