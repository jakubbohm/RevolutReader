---
name: factory-gets-full-version
description: Two quality bars — the app may take shortcuts for speed, software-factory work never; factory entries record the full, uncut version as the default
metadata:
  type: feedback
---

The user (2026-11-04, F0-1 testing session): "because of lack of real domain in this project, we may need to simplify some things, but still to the software factory should go the full uncut version."

The user (2026-11-08), after spotting that the speed-first rule clashed with the factory: "for the project, we can sometimes take shortcuts that will lead to faster delivery. But not in anything that is software factory related. That software factory must always be created using the best design, best practices, and how a very mature software architect would design it. Not any shortcut."

**Why:** the software factory must learn the approach that fits a real, long-lived project, not this 2-month tool's shortcuts; its answers become other projects' defaults.

**How to apply:** the rule and what counts as factory work live in CLAUDE.md § Working rules and `docs/conventions/workflow.md` § 10, The quality bar; follow them there. A project simplification gets a lesson that keeps the full version as default plus a divergence with its switch-back condition (e.g. R-12 in-process harness, R-19 UI levels (b) here vs (c) in the factory). A cut-down inside an inventory kit is named in the handover package README and never becomes the factory default. Related: [[decisions-one-by-one]].
