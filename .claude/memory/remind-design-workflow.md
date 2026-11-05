---
name: remind-design-workflow
description: When the user wants any visual change, remind them of the design workflow step by step; they expect to forget it
metadata:
  type: feedback
---

The user (2026-11-05): "I will probably forget the workflow in some time, so you may need to remind me when I want to do changes." Whenever the user asks for a visual change (a look, a component, a screen), or starts a UI step, walk them through the steps in docs/conventions/workflow.md § 8 before anything else, even if they don't ask. The user's own summary, which matches § 8:

1. The user says what should change; Claude Code writes the prompt for the design system (or, for a screen-only change, for the Screens design).
2. When the design system is done, the user gives it § 8's "list what you changed" prompt.
3. The user pastes that list into § 8's update prompt and sends it to the Screens design.
4. When the Screens design is done, the user gives Claude Code the same list; Claude Code reads the artifacts and applies it (or nothing yet, if the code has nothing of it).

**Why:** the workflow has several hops between three places, and the user changes the design only now and then.

**How to apply:** take the prompts from § 8 (its home; don't copy them here) and fill in the change. Say in plain words which step comes next and where to paste. Related: [[decisions-one-by-one]].
