---
name: azure-grants-run-by-owner
description: Claude's permission classifier blocks Azure role assignments even with the owner's go; hand the owner the exact PowerShell block instead
metadata:
  type: project
---

On 2026-11-06 (C4, task 6.4) the owner gave an explicit go for `az role assignment create` (Key Vault Secrets Officer on rg-revolutreader), and Claude Code's auto-mode classifier still denied it as a "Permission Grant". The owner then ran the block in their own PowerShell 7 window, together with the Key Vault secret writes that depended on it.

**Why:** the classifier treats any role grant as a permission escalation, whatever the user said in chat; working around it is not allowed.

**How to apply:** for any step that grants a role or writes secrets in Azure (e.g. C6's client secret and allowlist, C8's VAPID keys), give the owner the exact PowerShell 7 block to run themselves (with `Set-Location` where paths are relative, and the note that a new role can take minutes to apply), then run only the read-only checks afterwards. Related: [[az-always-explicit-subscription]], [[no-personal-ids-in-repo]].
