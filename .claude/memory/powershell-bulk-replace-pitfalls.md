---
name: powershell-bulk-replace-pitfalls
description: Scripted text replacements in PowerShell: one-pair arrays flatten and the comma binds tighter than +; prefer the Edit tool, and check git diff --stat right after
metadata:
  type: feedback
---

Two PowerShell traps broke scripted doc edits on 2026-11-08 (C6):

- `@( @('old','new') )` flattens to `@('old','new')`, so a loop over "pairs" saw strings, `$p[0]` was the character `t`,
  and `.Replace('t','h')` rewrote every `t` in proposal.md (restored from git before committing).
- `@('old', 'a' + "`r`n" + 'b')`: the comma binds tighter than `+`, so the pair became four elements and the
  replacement silently swapped the text for itself.

**Why:** both failures looked like success ("ok" printed), and the first one corrupted a whole file.

**How to apply:** for a handful of edits use the Edit tool. If a script is worth it, build pairs with
`[System.Collections.Generic.List[string[]]]` and `[string[]]@(...)`, wrap concatenations in parentheses, skip a pair
whose old text is missing, keep CRLF by using `[IO.File]::ReadAllText`/`WriteAllText` (UTF-8 without BOM), and run
`git diff --stat` at once: a line count far above the intended edits means damage. Related: [[git-bash-sed-crlf]].
