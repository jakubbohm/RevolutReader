---
name: factory-gets-full-version
description: RevolutReader may simplify an approach, but software-factory entries record the full, uncut version as the factory default
metadata:
  type: feedback
---

The user (2026-11-04, F0-1 testing session): "because of lack of real domain in this project, we may need to simplify some things, but still to the software factory should go the full uncut version." A project-only simplification is recorded as an exception: the lesson in `docs/software-factory/lessons.md` keeps the full answer as the default, and `docs/software-factory/divergences.md` records what the project gives up and when it switches back, never as the factory's new default (e.g. R-12 in-process harness, R-19 UI levels (b) here vs (c) in the factory).

**Why:** the software factory must learn the approach that fits a real, long-lived project, not this 2-month tool's shortcuts.

**How to apply:** whenever a decision simplifies a convention for RevolutReader, write the factory entry with the full version as the default, the simplification as the exception, and the condition that reverses it. Split into the two files in roadmap step D2 (2026-11-04). Related: [[decisions-one-by-one]].
