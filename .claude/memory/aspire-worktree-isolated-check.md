---
name: aspire-worktree-isolated-check
description: Start the AppHost from a git worktree with --isolated; for a start-up check without real secrets pass Parameters__* env vars for that run, never write user-secrets
metadata:
  type: project
---

From a Claude Code worktree, start the app through the aspire skill with
`aspire start --non-interactive --isolated --apphost src/RevolutReader.AppHost/RevolutReader.AppHost.csproj`, wait with
`aspire wait <resource>`, read state and addresses with `aspire describe --format Json`, and stop with
`aspire stop --non-interactive --apphost …`. Isolated mode still reads the AppHost's user-secrets, which are per machine
and shared with the main checkout and every worktree (checked 2026-11-08, C6).

To check a start-up when a parameter has no value yet (it shows `ValueMissing` and the dependent resource waits), pass
made-up values as environment variables for that one run, in the same PowerShell call as `aspire start`:
`${env:Parameters__signin-client-secret} = 'made-up'` (braces because of the dashes). Never use the dashboard's "Set
parameter" / `SaveToUserSecrets`: it writes the shared store, which the other session's app also reads.

**Why:** another session may run the main checkout's AppHost at the same time; isolation avoids port and state clashes,
and env vars keep a throwaway check out of the shared secret store.

**How to apply:** any local run or check from a worktree. Related: [[orchestrate-with-subagents]],
[[azure-grants-run-by-owner]].
