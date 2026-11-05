---
name: git-bash-az-path-conversion
description: In the Bash tool, az arguments starting with "/" (e.g. --scope /subscriptions/...) get rewritten to Windows paths; prefix MSYS_NO_PATHCONV=1
metadata:
  type: reference
---

Claude's Bash tool on this machine is Git Bash (MSYS). It rewrites any argument that starts with `/` into a Windows path, so `az role assignment create --scope /subscriptions/...` reaches Azure as `C:/Program Files/Git/subscriptions/...` and fails with the misleading `(MissingSubscription) The request did not have a subscription or a valid tenant level resource provider`. Found in M3 (2026-11-05).

**How to apply:** prefix such az calls with `MSYS_NO_PATHCONV=1`, or run them through the PowerShell tool. Every az call also names the subscription: [[az-always-explicit-subscription]]. In a worktree session, keep az/gh commands plain (literal values, no shell variables in compound commands), or the worktree guard refuses them.
