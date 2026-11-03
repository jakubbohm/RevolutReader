---
name: memory-in-repo
description: Claude auto-memory is stored in-repo at .claude/memory via autoMemoryDirectory in the gitignored settings.local.json
metadata:
  type: project
---

Claude Code auto-memory for RevolutReader lives in the repo at `.claude/memory/` and is committed to git. The redirect is configured in `.claude/settings.local.json` (gitignored, per-machine):

```json
{ "autoMemoryDirectory": "<absolute-repo-path>/.claude/memory" }
```

**Why:** project knowledge should be versioned with the repo and survive machine moves (set up 2026-11-04, same pattern as Jakub's DoseUp project).

**How to apply:** on a new machine, re-create `settings.local.json` with that machine's absolute repo path. A canary MEMORY.md sits at the default global location (`~/.claude/projects/d--source-jakubbohm-RevolutReader/memory/`) — if its line ever shows up in loaded memories, the redirect is not being applied; fix the local setting before writing memories. Memory may contain personal facts about Jakub and his daughter — scrub before ever making this repo public.
