# Architecture decision records

One file per decision with lasting, cross-cutting effect: `NNNN-slug.md`, numbered in order, never renumbered. Cite an ADR by its full name, e.g. `ADR-0001-bank-data-access` or `ADR-0001-bank-data-access § Decision`. When to write one and how it relates to `pm/progress.md`: [docs/conventions/workflow.md § 2](../conventions/workflow.md#2-decisions).

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-bank-data-access.md) | Bank data access — consent, request limits and PSU headers | Accepted | 2026-11-04 |

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
