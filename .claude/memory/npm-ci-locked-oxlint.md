---
name: npm-ci-locked-oxlint
description: "Don't run npm ci after a merge unless package-lock.json changed; the editor's oxlint LSP locks a binary, so npm ci fails halfway with node_modules wiped"
metadata:
  node_type: memory
  type: feedback
  originSessionId: affe0d72-c450-4ea0-aad3-929fdd723f14
  modified: 2026-11-21T07:33:08.561Z
---

Run `npm --prefix src/RevolutReader.Web ci` only when `package.json` or `package-lock.json` actually changed (check `git diff --stat <old> <new> -- src/RevolutReader.Web/package*.json` first). Otherwise just run the tests and checks.

**Why:** on 2026-11-21, after merging main (C9b changed no package), an unneeded `npm ci` deleted `node_modules` and then failed with EPERM on `node_modules/@oxlint/.binding-win32-x64-msvc-*/oxlint.win32-x64-msvc.node`, held by the owner's editor running `oxlint --lsp`. Stopping that process was denied by the permission classifier (it is the owner's process). `npm install --no-audit --no-fund` restored everything without touching the locked file and left the lockfile unchanged; the owner then reloads the editor window to restart oxlint.

**How to apply:** if node_modules does need refreshing while the editor is open, prefer `npm install` (lockfile unchanged — verify with `git status`) over `npm ci`, or ask the owner to close the editor first. Related: [[git-bash-sed-crlf]].
