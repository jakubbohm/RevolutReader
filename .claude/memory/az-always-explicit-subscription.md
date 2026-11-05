---
name: az-always-explicit-subscription
description: Every az command must name the personal subscription with --subscription; never rely on the CLI default (an employer tenant), never use --tenant alone, never az account set
metadata:
  type: feedback
---

Every `az` command — reads included, and `az account get-access-token` — must carry `--subscription 7811bd13-d9ae-46bb-9355-3e3d885e544e` (the owner's personal subscription, [docs/operations/azure-prerequisites.md](../../docs/operations/azure-prerequisites.md)). It must never be possible for a command to write to the employer's (CEMEX) Azure. The user, 2026-11-05 (M4): "whenever you use any az command, you always have to explicitly specify the subscription - it must not ever happen that you'd write it on the Cemex's azure."

**Why:** the owner's CLI login holds an employer work account too, and the CLI's default subscription is a tenant-level account in the employer's directory. In M4, `az account get-access-token --tenant <personal tenant>` silently picked the employer account (it failed with AADSTS50020 instead of writing anywhere, but it could have hit the wrong directory).

**How to apply:**
- `--subscription 7811bd13-…` on every az call; for Microsoft Graph, get the token with `az account get-access-token --subscription 7811bd13-… --resource-type ms-graph` (the subscription pins both the account and the directory), then call Graph with that token.
- Never `--tenant` alone, never `az account set` (it changes the owner's global CLI state), never an az command without the flag, even read-only.
- Commands written for the user (docs, scripts) follow the same rule.
- Related: [[git-bash-az-path-conversion]].
