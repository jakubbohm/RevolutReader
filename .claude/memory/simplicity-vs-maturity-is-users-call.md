---
name: simplicity-vs-maturity-is-users-call
description: Every simplicity-versus-maturity trade-off is the user's decision; show both sides explicitly, never pick or narrow the options on the user's behalf
metadata:
  type: feedback
---

Whenever options differ in how simple versus how mature, standard or production-ready they are, the choice is always the user's. The user, 2026-11-07 (c006 explore): "memorize that every decision, simplicity versus maturity, is always mine. Don't do these decisions on my behalf."

**Why:** in c006 explore, Claude recommended Application Insights through the Container Apps managed agent because it needed no code change, and presented it as simply "the recommendation". Only when the user asked for "the standard, mature, production-ready, well-designed way" did Claude show that the in-app Azure Monitor exporter is the more mature option (Entra-authenticated ingestion, metrics, no preview-era limits). Claude had weighed simplicity over maturity silently, on the user's behalf.

**How to apply:**
- When the options trade simplicity (less code, fewer parts, faster) against maturity (standard practice, production-readiness, robustness), name that axis and show where each option sits, including the mature option even when it costs more.
- A recommendation is still welcome (CLAUDE.md: for the app, speed first and the fastest sound option; software-factory work never takes a shortcut), but say which way it leans and why, and never drop the other side from the menu or decide it in an unattended run. If a run has to continue without the user, record the choice as open, not as decided on the user's behalf.
- Never filter the options down to the simple ones before presenting them.

Related: [[decisions-one-by-one]], [[factory-gets-full-version]].
