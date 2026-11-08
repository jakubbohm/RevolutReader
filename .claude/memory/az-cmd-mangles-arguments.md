---
name: az-cmd-mangles-arguments
description: On Windows az runs through az.cmd, so an argument with & or ( ) breaks; page ARM lists with Invoke-RestMethod and an ARM token instead
metadata:
  type: reference
---

`az` on Windows is `az.cmd`, and cmd re-parses its arguments (seen 2026-11-08, C6):

- a URL with `&` (an ARM `nextLink` with `$skiptoken`) is cut at the `&`, so `az rest --url $page.nextLink` fetched page
  one again and again;
- a `--query` with parentheses, e.g. `length(...)`, fails with "-o was unexpected at this time".

Instead: take a token with `az account get-access-token --subscription <sub> --query accessToken -o tsv` (ARM by
default, or `--resource-type ms-graph`) and call `Invoke-RestMethod` with `Authorization: Bearer`, following `nextLink`
in a loop; do counting in PowerShell, not JMESPath. The management API also lists a firewalled vault's secret names
(`.../vaults/<name>/secrets?api-version=2023-07-01`, 3 per page) without opening the vault.

Also: `az role assignment list --assignee <principalId>` failed for the deploy identity ("Cannot find user or service
principal in graph database"); filter with `--query "[?principalId=='<id>']"` instead.

Related: [[git-bash-az-path-conversion]], [[az-always-explicit-subscription]].
