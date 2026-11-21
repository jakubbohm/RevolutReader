---
name: factory-gets-full-version
description: Since 2026-11-21 speed is no longer a priority, for the app either — precision and the best solution everywhere; the software factory always gets the perfect solution (until then: two bars, the app could take shortcuts for speed)
metadata:
  type: feedback
---

**Current rule (the user, 2026-11-21, after v2 was handed over and the initial development ended):** "The app is already released and working, so speed is not the highest priority now. Now we want precision and the best value for the software factory. ... Speed is not the priority anymore. Now we go for perfection." Said while choosing how to fix the `RangeAttribute` race from issue #68: Microsoft's options validation source generator for every settings class (a convention change) over a small hand-written attribute that Claude had recommended for speed.

**History, the two bars it replaces:**

The user (2026-11-04, F0-1 testing session): "because of lack of real domain in this project, we may need to simplify some things, but still to the software factory should go the full uncut version."

The user (2026-11-08), after spotting that the speed-first rule clashed with the factory: "for the project, we can sometimes take shortcuts that will lead to faster delivery. But not in anything that is software factory related. That software factory must always be created using the best design, best practices, and how a very mature software architect would design it. Not any shortcut."

The same day Claude still recommended handing cut-down kits over labelled, with the full version only described in the lesson, because "a full version that never ran here would be an unproven template". The user: "What haven't you understood on the requirement that now you are proposing 'factory only gets templates for the cheaper option'???" An unproven full version is a reason to build and prove it, never to hand the factory less; effort and cost are the user's to schedule (roadmap SF1).

The user (2026-11-08), on when: "the software factory must always have the perfect solution. But during the development of the project, we can only add notes that will later lead to that perfect solution. It does not necessarily need to be specified in detail at the time when we are deciding the project ... It can be made perfect when we are handing it over to the software factory repo."

**Why:** the software factory must learn the approach that fits a real, long-lived project, not this 2-month tool's shortcuts; its answers become other projects' defaults. With the app released and working, the reason for the app's speed bar (deliver within the operating window) is gone, so every fix and change is now also a chance to prove the factory's best version here.

**How to apply:**
- Recommend the most precise, best-designed option, the one a very mature software architect would choose, for the app as much as for factory work; never recommend an option because it is faster or smaller.
- Still show both sides of every simplicity-versus-maturity trade-off and let the user decide ([[simplicity-vs-maturity-is-users-call]]); one item at a time ([[decisions-one-by-one]]).
- The rule lives in CLAUDE.md § Working rules (and its opening paragraph) and `docs/conventions/workflow.md` § 10, The quality bar, both updated 2026-11-21 (with `openspec/config.yaml`'s context, lessons.md R-1 and divergences.md R-1, switched back); follow it there.
