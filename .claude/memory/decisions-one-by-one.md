---
name: decisions-one-by-one
description: The user prefers to decide a bundle of proposals one item at a time, each persisted right after the yes
metadata:
  type: feedback
---

When a round contains several proposals, the user asks to go through them one by one ("let's go one by one", 2026-11-04, F0-1 testing session). Present one item, wait for the yes, write it into the docs right away, then present the next. When the user asks "tell me again why", restate the original options and the reasoning (look it up in the transcript or docs rather than reconstructing it).

**Why:** keeps each decision understood before it is adopted (CLAUDE.md: nothing is adopted until the user understands and agrees), and nothing decided is lost if the session is compacted.

**How to apply:** for multi-item rounds, number the items, lead with the first, and persist each decision before moving on. Related: [[factory-gets-full-version]].
