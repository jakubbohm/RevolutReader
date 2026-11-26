---
name: npm-ci-locked-oxlint
description: "The editor's oxlint LSP holds a binary, so npm ci fails halfway with node_modules wiped; installs are made by tdd install, and after its ERROR the owner frees the file and it runs again, never npm install"
metadata:
  node_type: memory
  type: feedback
  originSessionId: affe0d72-c450-4ea0-aad3-929fdd723f14
  modified: 2026-11-26T15:09:52.000Z
---

An `npm ci` in `src/RevolutReader.Web` fails half-way, with `node_modules` already emptied, while the owner's editor is open on that folder: the editor's oxlint server (`oxlint --lsp`) holds a binary under `node_modules/@oxlint/`. Since 2026-11-26 the installs are made by `tdd install` (`node .claude/skills/tdd-apply/scripts/tdd.mjs install`): `/tdd-apply` and `/triage-review` run it themselves at every start and resume, and it runs `npm ci` only where an install is missing or behind its lockfile. After its `ERROR: install:` line for this failure, the way on is to have the file freed and to run `tdd install` again, never `npm install` in that folder.

**Why:** on 2026-11-21, after merging main (C9b changed no package), an unneeded `npm ci` deleted `node_modules` and then failed with EPERM on `node_modules/@oxlint/.binding-win32-x64-msvc-*/oxlint.win32-x64-msvc.node`, held by the owner's editor running `oxlint --lsp`. Stopping that process was denied by the permission classifier (it is the owner's process). That day `npm install --no-audit --no-fund` restored the folder without touching the held file. The skills' texts now rule that way out (`.claude/skills/tdd-apply/once.md` § The npm installs: no `npm install`, and no `npm ci` of one's own): an install is made with `npm ci` alone, the clean install from the lockfile that CI runs too, and `tdd install` then checks it against the lockfile.

**How to apply:** make an install with `tdd install`, which a skill's run does by itself; with `--dry-run` it only says each folder's state, and it starts no `npm ci` in a folder that is `ok`, so a merge that changed no lockfile costs nothing. When its line for a folder says that `npm ci` failed with EPERM on a file under `node_modules`, that is a full stop: tell the owner the line, and ask the owner to free the file, by closing the editor's window on that folder or stopping its oxlint server (never stop that process yourself). On the owner's word run `tdd install` again: the folder then reads `stale`, and it is installed anew. The owner reloads the editor window afterwards. Related: [[git-bash-sed-crlf]].
