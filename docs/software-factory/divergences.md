# RevolutReader — Divergences from the Software Factory

**Status:** project documentation, kept for the whole project and after it · not part of the handover package ([creating-handover-package.md](creating-handover-package.md))

Where RevolutReader knowingly runs a cut-down version of what the software factory recommends for a real, long-lived project: the full version in [lessons.md](lessons.md) or in DoseUp's catalog (`D:\source\jakubbohm\DoseUp\docs\software-factory.md`). Each entry says what RevolutReader does instead, why, what it gives up, and when it would switch back.

Read it whenever the project's constraints change: it lives longer than planned, gets more screens or users, or is brought back after decommissioning (roadmap D1). Every entry whose *Switch back when* now holds is a candidate for a change.

## What goes in

- A decision gets an entry here when RevolutReader runs less than the full version. If the decision also teaches the factory something, it gets a lesson in [lessons.md](lessons.md) under the same id.
- Add the entry in the same change or session that makes the decision. The decision itself lives in its convention or ADR; an entry here links to it and never replaces it.

## Entry format

```markdown
**R-<n> · <what RevolutReader does differently, in a few words>**
Full version: <what the factory recommends> (<link to the lesson, or DoseUp F-<x>>).
Here (<link to the convention / ADR>, <date>): **<what RevolutReader does>** — <why: the constraint that allows it>.
Given up: <what it costs>.
*Switch back when:* <the condition, concrete for this project>.
```

- Ids are shared with [lessons.md](lessons.md) ([§ Entry format](lessons.md#entry-format) there): never reused or renumbered; a new entry in either file takes the next free number.

---

## Entries

**R-1 · Speed of delivery comes before architecture**
Full version: architectural quality is the highest priority ([lessons.md R-1](lessons.md), DoseUp F-42).
Here ([CLAUDE.md § Working rules](../../CLAUDE.md#working-rules), 2026-11-04): **speed first** — a short-lived tool; Claude still says when "works" and "correct" differ and recommends the fastest sound option.
Given up: shortcuts a longer-lived system would pay for later; R-12, R-14 and R-19 follow from this one.
*Switch back when:* the app has to outlive its first purpose (operation well beyond the planned period), or someone else will maintain it.

**R-3 · No automated releases or changelog**
Full version: an automated changelog, semver tags and GitHub Releases ([lessons.md R-3](lessons.md), DoseUp F-32).
Here ([docs/conventions/workflow.md § 3](../conventions/workflow.md#3-git), 2026-11-04): **none** — PRs, squash merge and Conventional Commit titles stay; nobody consumes versions of a single-environment app.
Given up: no readable version history; the deployed version is known only by its commit SHA.
*Switch back when:* something consumes versions: a second environment, or clients of the API outside this app.

**R-4 · No feature flags**
Full version: a flag library, every flag shipped with a removal task ([lessons.md R-4](lessons.md), DoseUp F-33).
Here ([docs/conventions/configuration.md § Not adopted](../conventions/configuration.md#not-adopted), 2026-11-04): **none** — every change is sized to finish in one session, so nothing merges half-done.
Given up: work cannot be merged switched off and turned on later; a release cannot be decoupled from its deployment.
*Switch back when:* a change spans several merges, or a release has to wait for a date or a person (e.g. a handover to the daughter).

**R-6 · Plan and status in repository files, not a tracker**
Full version: GitHub issues, milestones and a project board, with open decisions as issues ([lessons.md R-6](lessons.md), DoseUp F-77, F-79, F-80).
Here ([docs/conventions/workflow.md § 9](../conventions/workflow.md#9-project-management), 2026-11-04): **`pm/roadmap.md` and `pm/progress.md`**, decisions in ADRs — a fixed plan of about 20 steps, one session each.
Given up: no board view, and no links between work items and commits or PRs.
*Switch back when:* the backlog outgrows the fixed plan, or a second contributor joins.

**R-7 · The design system ships no CSS file of its tokens**
Full version: the design system ships every file a canvas loads, a CSS file of its tokens included, so updating a canvas's copy carries every change ([lessons.md R-7](lessons.md)).
Here ([docs/conventions/workflow.md § 8](../conventions/workflow.md#8-design), 2026-11-05): **the Screens design keeps its own CSS copy of the tokens, and the update prompt asks it to bring that copy into line** — adding the file to the design system would take two more prompts, and one canvas with one update prompt per change covers it.
Given up: a colour change reaches the screens only through that prompt; a plain "update" misses it.
*Switch back when:* a second canvas uses the design system, or a colour change is ever missed on the screens.

Earlier, this id recorded a cut-down that was switched back on 2026-11-05: one mockup, for the account screen only (2026-11-04), replaced before any UI existed by the design system and one Screens design.

**R-8 · The signed-in user's PSU headers are sent without asking the provider**
Full version: when losing bank access would be costly, ask the provider first whether someone other than the account holder counts as present, or stay within the unattended quota with stored data ([lessons.md R-8](lessons.md)).
Here ([ADR-0001-bank-data-access § Decision](../adr/0001-bank-data-access.md#decision), 2026-11-04): **live reads forward the signed-in user's real PSU headers; Enable Banking is not asked** — in the owner's view the daughter reads on the account holder's behalf, and the owner prefers accepting the risk to asking.
Given up: no confirmation that this is allowed; Enable Banking may cut off the application (ADR-0001-bank-data-access, accepted risk).
*Switch back when:* the app runs well beyond its planned period or losing access becomes costly, or Enable Banking's terms explicitly exclude acting on the account holder's behalf.

**R-12 · Acceptance tests run the app inside the test process**
Full version: the real running app, started by the orchestrator (Aspire testing harness) ([lessons.md R-12](lessons.md), DoseUp F-26).
Here ([docs/conventions/testing.md § Acceptance-test harness](../conventions/testing.md#acceptance-test-harness-the-app-runs-inside-the-test-process), 2026-11-04): **in-process (TUnit.AspNetCore)** — the tests must control the bank, the clock and the sign-in key; in-process each is a one-line swap and no test needs a real secret. The app is a single API process.
Given up: the Aspire wiring and the hosting configuration are not under test; running locally and the first deployment cover them. Since C3 (2026-11-06) the built pages too: the tests serve a stand-in page folder instead of the frontend build (c003 design.md D6), and the frontend tests, the CI build, local checks against the API serving the build and the first deployment cover the build.
*Switch back when:* the app gets a second process (e.g. F0-2 or C9 moves the background job out of the API into a separate service, Q4), or a wiring bug reaches production.

**R-13 · No CI check against the provider's hosted mock bank**
Full version: once the system lives long enough for the provider's API to drift, an opt-in CI contract job against the hosted Mock ASPSP, with a stored sandbox session and key as low-risk CI secrets and data set up once ([lessons.md R-13](lessons.md)).
Here ([docs/conventions/testing.md § Fake bank](../conventions/testing.md#fake-bank-a-local-fake-server-in-front-of-our-real-enable-banking-client), 2026-11-04): **automated tests use only the local fake server; the real client is checked against the hosted mock on demand** — over about two months, drift in Enable Banking's API is unlikely.
Given up: a change in Enable Banking's API shows up only when someone runs the on-demand check, or in production.
*Switch back when:* the app runs well beyond its planned period, or an Enable Banking API change breaks it.

**R-14 · No mutation, architecture or browser end-to-end tests**
Full version: DoseUp's set — architecture tests (ArchUnitNET) enforcing the written dependency rules; browser end-to-end tests (Playwright) with a smoke subset on PRs and the full suite nightly; mutation testing nightly, never a PR gate ([lessons.md R-14](lessons.md), DoseUp F-27, F-28, F-29).
Here ([docs/conventions/testing.md § Defaults](../conventions/testing.md#defaults), 2026-11-04): **none of the three** — little domain logic, one API project with few layers, one screen, and Stryker.NET's TUnit support still in preview; the test-first close step runs mutation testing only if it is configured.
Given up: nothing checks automatically whether the tests would catch a broken implementation; structural rules are guarded only by banned-API analyzers and one ordinary test; no browser tests at all (R-19).
*Switch back when:* mutation testing — the rules get dense, or Stryker.NET's TUnit support leaves preview (preview as of 2026-11-04); architecture tests — the backend grows into several projects or a structural rule needs enforcing; browser tests — more screens or a longer life, starting with the cheapest step: one Playwright smoke test against the deployed app.

**R-19 · Each UI scenario is verified at one level, with no browser tests**
Full version: one test per scenario, run through an API driver or a browser driver (Playwright) against the real running app ([lessons.md R-19](lessons.md), option (c)).
Here ([docs/conventions/testing.md § Every scenario has exactly one test](../conventions/testing.md#every-scenario-has-exactly-one-test-the-traceability-check), 2026-11-04): **one level per scenario** — an API acceptance test by default, a frontend component test for rules only the browser shows, manual at handover for device-only behaviour. The full version would need browsers in CI, the app on a real port, the built frontend served and a test sign-in: too much for one screen and two months.
Given up: no automated proof that the frontend, the API and the sign-in work together in a browser; local runs, post-deployment checks and the handovers cover it.
*Switch back when:* the app gets more screens or a longer life, or an integration break between the frontend and the API actually happens.

**R-25 · Membership is an email allowlist, not accounts bound to their stable ID**
Full version: membership keyed by the stable account ID in the app's own store; the email is used once, to match an invitation ([lessons.md R-25](lessons.md), DoseUp F-51, F-87).
Here ([ADR-0004-account-allowlist](../adr/0004-account-allowlist.md), 2026-11-05): **the signed-in account's email is checked on every request against a list kept in Key Vault** — a fixed handful of users, all on personal Microsoft accounts, and the main user must not wait for approval.
Given up:
- Microsoft says the email claim is mutable and not for authorization;
- a changed address locks its owner out until the list is updated;
- changing the list needs a Key Vault edit and a restart.

*Switch back when:* there are more users or they change, a second account provider or directory appears, or the app runs well beyond its planned period.

**R-26 · A key–value table store instead of a relational database**
Full version: relational Postgres with migrations, unless something strong pulls away ([lessons.md R-26](lessons.md), DoseUp F-23).
Here ([ADR-0005-data-storage](../adr/0005-data-storage.md), 2026-11-05): **Azure Table Storage in the app's own storage account** — three kinds of records, a few hundred items in all, read by key; nothing manual, no secret, deleted with the stack.
Given up:
- no queries beyond keys, no joins, no schema;
- no migration discipline, because nothing enforces the shape of stored data.

*Switch back when:* the data gains relations or needs real queries, more features arrive, or the app runs well beyond its planned period.

**R-27 · The production app scales to zero, with a caller outside the app for the check**
Full version: an always-on host for anything real users depend on, with the job scheduled inside the app ([lessons.md R-27](lessons.md)).
Here ([ADR-0006-hosting-registry-and-job](../adr/0006-hosting-registry-and-job.md), 2026-11-05): **Container Apps scaling to zero within the free grant, plus a caller outside the app for a protected endpoint** — the budget is free tiers only, for three users. The caller was planned as a Logic App; since 2026-11-06 it is the owner's iPhone ([ADR-0008-phone-triggered-check](../adr/0008-phone-triggered-check.md), R-45).
Given up:
- about 20 s for the first response after 5 minutes without use;
- an extra internal endpoint and its caller to maintain;
- persisted Data Protection keys, needed only because containers come and go.

*Switch back when:* the wake-up time bothers the daughter → minimum 1 replica, always on (roughly $4–6 a month). The job may then move inside the app, if the operation runs well beyond the plan.

**R-35 · No security scanning on pull requests**
Full version: CodeQL and dependency review as blocking PR checks ([lessons.md R-35](lessons.md), DoseUp F-30).
Here ([workflow.md § 4](../conventions/workflow.md#4-cicd), 2026-11-05): **neither runs.** The app lives about two months, with one developer and few packages. GitHub's dependency graph sees no package file of this repository, so dependency review would pass without checking anything.
Given up:
- a known-vulnerable package is not flagged automatically;
- neither is a typical security bug in the code (e.g. an injection). Only secret scanning and push protection run.

*Switch back when:* the app runs well beyond its planned period, or gets more packages or contributors. Before turning on dependency review, make sure the dependency graph lists the packages.

**R-45 · The phone's automated reads carry the owner's PSU headers**
Full version: reads that no one starts by hand at that moment go without PSU headers, within the bank's unattended quota (4 a day under PSD2), unless the provider confirms otherwise ([lessons.md R-45](lessons.md), EBA Q&A 2018_4172).
Here ([ADR-0008-phone-triggered-check](../adr/0008-phone-triggered-check.md), 2026-11-06): **the check the owner's iPhone triggers on every Revolut notification forwards the phone's real PSU headers** — in the owner's view the phone acts on the owner's explicit request, and the owner accepts the risk. Within 4 reads a day, the check could not follow every notification.
Given up:
- no confirmation that this is allowed; Enable Banking may cut off the application (the risk accepted in ADR-0001, item 2, now covers these reads too);
- notifications depend on one phone: when it is off or offline, nothing triggers the check.

*Switch back when:* the app runs well beyond its planned period, losing bank access becomes costly, or Enable Banking or Revolut objects.

**R-46 · One deployment stack for the shared infrastructure and the features**
Full version: two stacks, the shared one behind an approval, the features' one on every merge ([lessons.md R-46](lessons.md)).
Here ([workflow.md § 5, Bicep layout](../conventions/workflow.md#bicep-layout-c4-2026-11-06), 2026-11-06): **one stack, applied on every merge, in three files** (an entry point, the shared platform, the features). The shared layer is small: a vault, a log workspace, the Container Apps environment and, from C6, one storage account. It changes twice (C4, C6). With two stacks, C6's storage account and its blob container would need a failed deploy or two PRs, because deploys run only from `main`.
Given up: a merge whose Bicep no longer declares the vault or the storage account deletes it. Only the owner's review guards against that; the vault stays recoverable for 90 days, and the stored transactions can be imported again from the M1 history file.

*Switch back when:* more features come onto the shared layer, a second environment or another contributor arrives, or the stack holds data that cannot be imported again.

**R-52 · The app's Key Vault is open to the internet, guarded by roles alone**
Full version: the app's environment in its own virtual network, a private endpoint for the vault, public network access off, decided together with the environment ([lessons.md R-52](lessons.md)).
Here ([deployment.md § Identifiers](../operations/deployment.md#identifiers-non-secret), kept by the owner 2026-11-07): **`kv-revolutreader` keeps public network access on.** Container Apps cannot pass a closed vault's firewall, and its environment was created without its own network, which cannot be added later. Only the app's identity and the owner have a role on the vault.
Given up: a second line of defence. A stolen credential with a role on the vault could read the four Enable Banking values from anywhere, and later the allowlist and the push keys too.

*Switch back when:* the app outlives its planned ~2 months, the vault holds more than the bank link's secrets and a few keys, or the environment is rebuilt anyway (a reinstatement, D1). Then create the environment with its own network and close the vault.
