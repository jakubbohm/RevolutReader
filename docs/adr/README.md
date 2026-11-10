# Architecture decision records

One file per decision with lasting, cross-cutting effect: `NNNN-slug.md`, numbered in order, never renumbered. Cite an ADR by its full name, e.g. `ADR-0001-bank-data-access` or `ADR-0001-bank-data-access § Decision`. When to write one and how it relates to `pm/progress.md`: [docs/conventions/workflow.md § 2](../conventions/workflow.md#2-decisions).

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-bank-data-access.md) | Bank data access — consent, request limits, PSU headers and transaction history | Accepted; item 3 superseded by 0008 | 2026-11-04 |
| [0002](0002-frontend-hosting.md) | Frontend hosting — one container, one origin | Accepted | 2026-11-05 |
| [0003](0003-sign-in.md) | Sign-in — the backend signs users in and keeps a login cookie (BFF) | Accepted | 2026-11-05 |
| [0004](0004-account-allowlist.md) | Account allowlist — personal Microsoft accounts checked against an email list kept out of the repo | Accepted | 2026-11-05 |
| [0005](0005-data-storage.md) | Data storage — Azure Table Storage in the app's own storage account | Accepted | 2026-11-05 |
| [0006](0006-hosting-registry-and-job.md) | Hosting, registry and the scheduled job — Container Apps scaling to zero, ghcr.io, a Logic App as the clock | Accepted; item 4 superseded by 0008 | 2026-11-05 |
| [0007](0007-offline-balance.md) | Offline scope — the phone keeps the app's files and the last balance, never transactions | Accepted | 2026-11-06 |
| [0008](0008-phone-triggered-check.md) | The account check's trigger — a Revolut notification on the owner's iPhone, with the phone's PSU headers | Accepted | 2026-11-06 |
| [0009](0009-application-telemetry.md) | Application telemetry — Application Insights on the log workspace, fed by the app with its own identity | Accepted | 2026-11-08 |
| [0010](0010-web-push.md) | Web Push — Declarative Web Push from .NET with Lib.Net.Http.WebPush, allowlisted accounts only, and a hidden message endpoint | Accepted | 2026-11-10 |

## Template

```markdown
# ADR-NNNN: <title>

**Status:** Proposed | Accepted | Superseded by ADR-NNNN-<slug> · **Date:** YYYY-MM-DD · **Roadmap:** <step ids> · **Questions:** <Q ids, if any>

## Context

What forces the decision. Verified facts with their sources and the date they were checked.

## Decision

What was decided; who decided it when it is the user's call.

## Alternatives considered

Each alternative and why it lost.

## Consequences

What follows from the decision: accepted costs, and what later steps must respect.
```
