---
name: continue-announced-steps
description: After finishing one approved step, carry on with the next step already announced and agreed; don't stop to ask for a separate go
metadata:
  type: feedback
---

When the user has agreed to a sequence of steps (e.g. "measure, then update the ADRs"), finish one and go straight on to the next. Don't stop with "I'll bring it as a separate round". The user, 2026-11-06, after the phone-test PR merged and I stopped before the announced ADR update: "ok, let's continue. I don't know why you left it incomplete".

**Why:** the user had already made the decisions those steps record (issue #12). Pausing only cost a round trip. CLAUDE.md's gate ("propose, wait for an explicit go") is for new decisions, not for carrying out ones already made.

**How to apply:** stop only where a step needs a new decision, an outward-facing action not yet approved (e.g. a commit, push or merge the user hasn't asked for), or the user's own input. Otherwise continue and report at the end. Related: [[ask-done-before-commit]], [[decisions-one-by-one]].
