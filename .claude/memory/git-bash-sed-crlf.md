---
name: git-bash-sed-crlf
description: sed -i in Git Bash rewrites CRLF files with LF line endings; edit .cs files with the Edit tool and run the whitespace check
metadata:
  type: feedback
---

`sed -i` in Git Bash on Windows wrote two CRLF `.cs` files back with LF line endings (2026-11-07, a rename in the traceability check). `.editorconfig` requires CRLF for `.cs` files, and `dotnet format whitespace --verify-no-changes` then failed on every line.

**Why:** the build and CI treat line endings as a formatting error, and a whole-file line-ending change also hides the real diff.

**How to apply:** edit `.cs`, Bicep and docs files with the Edit tool, not `sed -i`. If a shell rewrite was used, check with `file <path>` and restore with `dotnet format whitespace RevolutReader.slnx --include <files>`. Frontend files are LF. Related: [[git-bash-az-path-conversion]].
