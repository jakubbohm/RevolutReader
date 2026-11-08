---
name: workflow-script-syntax-check
description: Syntax-check a saved Workflow script (.claude/workflows/*.js) by wrapping its body in an async function before node --check
metadata:
  type: feedback
---

A Workflow script's body runs inside an async function: it uses `await` and a top-level `return`, so `node --check` on the file as it is fails with "Illegal return statement" and proves nothing.

**Why:** found while adding `.claude/workflows/triage-review-verify.js` (2026-11-08); the wrapped check then passed.

**How to apply:** build a throwaway copy in the scratchpad: `async function body(args, agent, pipeline, parallel, phase, log) {` + the file with `export const meta` changed to `const meta` + `}`, then `node --check` that copy. A saved workflow shows up in the session's skill list under its `meta.name` as soon as the file exists, which confirms Claude Code found it.
