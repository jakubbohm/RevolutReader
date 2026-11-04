# Software Factory — Deposit from RevolutReader

**Status:** knowledge deposit, not project documentation · **Started:** 2026-11-04 · **Handover:** not yet (see § Handover)

This file is *not* used by RevolutReader itself. It collects seed material for the user's future "software factory" (a tool that interviews the owner of a new project and recommends answers from accumulated knowledge). The main catalog lives in DoseUp: `D:\source\jakubbohm\DoseUp\docs\software-factory.md`, entries F-1 … F-92 as of 2026-11-04. Everything is gathered here while the project runs, and handed over to DoseUp at the end.

## What goes in

Only three kinds of entries — everything else is already in the DoseUp catalog:

- **Divergence:** RevolutReader deliberately answered a question differently from DoseUp.
- **Reversal:** RevolutReader reversed one of its own earlier decisions (recording reversals is the factory's best training data — DoseUp F-23).
- **New:** a question DoseUp never faced (e.g., a regulated third-party API with request limits).

Add an entry in the same change or session that makes the decision. The project's own docs stay the authority (ADRs, conventions); an entry here links to them and never replaces them.

## RevolutReader's constraint set

Every answer below was reached under these constraints. An entry's *Generalizes* line names the constraint that decided it, so the factory can tell which constraint flips which answer:

solo developer · ~2-month operating period, then decommissioned · **speed of delivery is the top priority** · 3 use cases, essentially one screen · a handful of pre-approved users · read-only access to one real bank account through a regulated third-party API with request limits · Azure, with free-tier resources shared across the owner's projects · one deployed environment.

## Entry format

Same shape as the DoseUp catalog, so the handover is a copy, not a rewrite:

```markdown
**R-<n> · <Question, phrased for any project>?** *(<Divergence | Reversal | New> — relates to DoseUp F-<x>, if any)*
Options: <option> · <option> · … (with trade-offs, briefly).
DoseUp: <its answer, one line> — omit for New entries.
RevolutReader (<link to the ADR / convention / progress entry>, <date>): **<the answer>** — <why, briefly>.
*Generalizes:* <the reusable rule> — **and the constraint that would reverse it**.
```

- Ids are `R-1`, `R-2`, … in order of recording, never reused or renumbered.
- Ecosystem facts (versions, prices, limits, licenses) carry the date they were verified.
- Plain language; no RevolutReader-internal codenames without a link.

## Handover

At the end of the project — as part of roadmap step M8 (Decommissioning), or earlier if the user asks:

1. In a **DoseUp** session (following DoseUp's own rules: branch, PR), append every R-entry to DoseUp's `docs/software-factory.md` as new F-entries with the next free F-numbers, in the matching sections. Keep the origin on each: `*(from RevolutReader R-n)*`.
2. For each Divergence entry, add one sentence to the related DoseUp F-entry's *Generalizes* line: "RevolutReader answered differently under <constraint> — see F-<new>."
3. Copy RevolutReader's constraint set (above) into the DoseUp catalog next to DoseUp's own constraint note.
4. Back here, set **Handover** in the header to `done <date> → DoseUp F-<a> … F-<b>` and keep this file as history.

---

## Entries

**R-1 · How high is the architecture bar?** *(Divergence — relates to DoseUp F-42)*
Options: architecture first, even at the cost of speed · speed first, but flag works-vs-correct gaps · no explicit rule.
DoseUp: architectural quality is the project's highest priority.
RevolutReader (CLAUDE.md § Working rules, 2026-11-04): **speed of delivery first** — Claude still says when "works" and "correct" differ, then recommends the fastest sound option; the user decides.
*Generalizes:* the bar follows the project's "why" (DoseUp F-4): showcase/learning goals buy architecture-first, a short-lived tool buys speed-first. Reverses when the system must outlive its first purpose or others will maintain it.

**R-2 · How does the AI present decisions to the owner?** *(Divergence — relates to DoseUp F-38 and its "propose in prose" rule)*
Options: always a prose proposal · option menus · prose for big decisions, menus for quick ones.
DoseUp: always a prose proposal (solution, trade-offs, alternatives, recommendation); never clickable option menus.
RevolutReader (CLAUDE.md § Working rules, 2026-11-04): **prose for big decisions, menus acceptable for quick confirmations** — the owner asked for a menu-driven review of 40 decisions inherited from DoseUp, with a "more details" option on each.
*Generalizes:* menus are efficient for confirming inherited answers in bulk; new decisions still deserve prose. A picked option is only the closest match — the owner's free-text notes are the owner's words. Reverses toward prose-only when most decisions are new rather than inherited.

**R-3 · Automated releases and changelog?** *(Divergence — relates to DoseUp F-32)*
Options: automated changelog + semver releases · none.
DoseUp: automated changelog, semver tags and GitHub Releases.
RevolutReader (docs/conventions/workflow.md § 3, 2026-11-04): **none** — PRs, squash merge and Conventional Commit titles are kept.
*Generalizes:* release automation pays when someone consumes versions; a single-environment app nobody versions against doesn't need it. Reverses when there are consumers of versions (a library, an API with clients, several environments).

**R-4 · Feature flags for trunk-based delivery?** *(Divergence — relates to DoseUp F-33)*
Options: a flag library with a removal task per flag · none.
DoseUp: Microsoft.FeatureManagement; every flag ships with a removal task.
RevolutReader (docs/conventions/workflow.md, 2026-11-04): **none**.
*Generalizes:* trunk→prod needs flags only when incomplete work merges. When every change is sized to finish in one session, nothing merges half-done. Reverses when changes span several merges or when releases must be decoupled from deploys.

**R-5 · What stays manual when infrastructure is code?** *(Divergence and Reversal — relates to DoseUp F-53)*
Options: everything manual (guided portal steps) · everything in IaC · IaC with an explicit manual list.
DoseUp: hand-authored Bicep is the only definition of Azure; never portal or ad-hoc CLI.
RevolutReader (docs/conventions/workflow.md § 5, 2026-11-04): **Bicep + Azure Deployment Stacks (removed resources get deleted) for everything the project owns; manual only for what cannot be automated** — subscription access, the Entra application registration, the CD identity's trust (bootstrap), shared resources and access to them, and hand-provisioned secret values. Reversal: the first roadmap draft had made all Azure setup manual; the owner corrected it.
*Generalizes:* ask "which resources outlive or are shared beyond this project?" — e.g., a free tier that exists once per subscription (Cosmos DB) must be shared, so it cannot belong to one project's stack and is referenced as `existing`. Everything project-owned goes into the stack, which also makes decommissioning a single stack deletion. Reverses toward all-manual only for throwaway experiments.

**R-6 · Where do work items live?** *(Divergence — relates to DoseUp F-77, F-79, F-80)*
Options: GitHub issues/milestones/board · plan and status files in the repo.
DoseUp: GitHub issues, milestones and a project board; open decisions as `decision` issues.
RevolutReader (docs/conventions/workflow.md § 9, 2026-11-04): **`pm/roadmap.md` + `pm/progress.md` in the repo**; decisions in ADRs.
*Generalizes:* with a fixed plan of ~20 steps, one session per step and a short life, repo files beat a tracker. Reverses with a growing backlog, several contributors, or a need for a board view.

**R-7 · Design mockups before UI work?** *(Divergence — relates to DoseUp F-41)*
Options: a mockup + handoff for every UI-heavy change · only for key screens · none.
DoseUp: every UI-heavy change gets a Claude Design mockup + handoff.
RevolutReader (docs/conventions/workflow.md § 8, 2026-11-04): **one mockup, for the account screen only**.
*Generalizes:* the design loop pays per screen; with one real screen, one mockup is enough. Reverses as the number of screens grows.

**R-8 · How do you read a regulated bank API that limits unattended requests?** *(New)*
Options: unattended reads only, within the quota, served from a cache · live reads forwarding the present user's real context, plus a background job within the unattended quota · ask the provider for an exception.
RevolutReader ([ADR-0001-bank-data-access](adr/0001-bank-data-access.md), 2026-11-04): **live reads with the signed-in user's real PSU headers when the user opens or refreshes the view; a background job without PSU headers 4 times a day (the PSD2 limit for unattended requests); the provider is not asked** — the owner accepts the risk of being cut off and keeps it low with strict rules on when PSU headers are sent.
*Generalizes:* under PSD2 the quota applies only to requests made without the user present, so the "user present" signal must be honest — sent only on requests the user directly triggers, with the user's real values, never on background work. Reverses when the person using the app is not the one the bank considers the account user and the provider's terms forbid acting on their behalf. *(Verified 2026-11-04 for Revolut via Enable Banking; still being completed in M1.)*
