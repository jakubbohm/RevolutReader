# RevolutReader — Roadmap

> The order of work for the whole project. The current status of each step is in [`pm/progress.md`](progress.md); the project brief is [`pm/kickoff.md`](kickoff.md). Questions "Q1–Q10" refer to the open questions in kickoff ch. 10.
>
> Created: 2026-11-04 · Updated: 2026-11-05 (F0-1, M1, D2, F0-2, M2, C1, M4, the design workflow, C9's phone trigger; 2026-11-06: C3 planning, C9's phone test and ADR-0008, C4's wake-up measurement moved to after v1; 2026-11-07: M8's handover target, C12 added (first numbered C11); 2026-11-08: C11 bank-read retries, C12 renumbered, C9's one-check-at-a-time design, SF1 full versions of the cut-down kits, C11's goal set to the decided retry policy, C7 split into C13 groundwork, C7a balance and C7b transactions, C9 notifies without the daughter's view time — see the change log in `pm/progress.md`)

---

## 1. How to use this roadmap

- **Every session starts** by reading `CLAUDE.md`, this file and `pm/progress.md`.
- **Picking the next step:** if the user names a step, do that one. Otherwise take the first step in the order (section 2) whose status is `todo` and whose dependencies are `done`. Manual steps may run in parallel with development steps.
- **One step = one session.** Steps are described briefly on purpose. The detail is worked out in the step itself; for OpenSpec changes in its proposal, design, specs and tasks.
- **Step types:**
  - **Phase 0:** knowledge base and architecture decisions, no product code. The agent presents options; the user decides.
  - **Manual:** only what cannot be automated ([docs/conventions/workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure)): access to the Azure subscription, the Entra application registration, the identity GitHub Actions deploys with, shared resources and access to them, and secret values only a human can produce. Everything else in Azure is Bicep, deployed by CD inside the OpenSpec changes. The user does the manual work; Claude guides them step by step and says what to set up, where and how. Commands for the user are PowerShell 7. Non-secret identifiers (resource names, client IDs, URLs) are recorded in the repository. Secrets go only to Key Vault, never into the repository; until Key Vault exists, they stay on the user's machine. Scripts and evidence go in `spikes/<topic>/` ([workflow.md § 7](../docs/conventions/workflow.md#7-spikes)).
  - **Documentation:** a document Claude writes or restructures from what the repository records; the user reviews it. No product code.
  - **OpenSpec change:** one change, taken from propose through apply to archive in a single session (`/opsx:propose`, `/tdd-apply`, `/opsx:archive`), test-first as defined in [docs/conventions/testing.md](../docs/conventions/testing.md). Change names in this roadmap are proposals; the `cNNN` prefix is the next free number, assigned when the change is created ([workflow.md § 6](../docs/conventions/workflow.md#6-openspec)).
  - **Direct PR:** product code that shows nothing to a user, so it has no OpenSpec scenario of its own, e.g. groundwork shared by two changes that run in parallel. Unit tests are written first, the scenarios that reach the code come with the changes that use it, and the user reviews the PR. Added 2026-11-08 with C13 (change log).
  - **Tech debt (low priority):** knowledge building, or paying back a shortcut taken on purpose. Picked up only when no other step is waiting, and before M8, so its findings reach the software-factory handover. Findings go into a spike ([workflow.md § 7](../docs/conventions/workflow.md#7-spikes)); a code change that follows is a small PR (an OpenSpec change if it changes behaviour).
  - **Software factory:** work the factory needs and the app does not, built to the factory's quality bar ([workflow.md § 10 — The quality bar](../docs/conventions/workflow.md#the-quality-bar-2026-11-08)): the best design, no shortcuts, and every artifact proven to work before it is handed over. Planned item by item with the user, and split into smaller steps when it does not fit one session.
- **Open questions:** a step decides only the questions assigned to it. The agent presents options; the user decides. The decision itself (with findings, rationale and alternatives) goes into an ADR in `docs/adr/`; `pm/progress.md` records only the status, a one-line outcome, the link and the impact on steps ([workflow.md § 2](../docs/conventions/workflow.md#2-decisions)).
- **At the end of a step:** update `pm/progress.md` (status, date, link to the OpenSpec change, notes); the step's PR closes its GitHub issue. Update `CLAUDE.md` if build, test or run commands or the project structure changed. If the step created, renewed or changed an approval, a secret or a hand-made setting, update [`docs/operations/expiring-approvals.md`](../docs/operations/expiring-approvals.md): what it is, when it expires, how to restore it. D1 builds on that file. If the step created or substantially changed a reusable artifact (a convention, skill, agent, hook or script worth handing to the software factory), update the inventory in [`docs/software-factory/creating-handover-package.md`](../docs/software-factory/creating-handover-package.md#inventory).
- **Changing the roadmap** (adding, removing, splitting or reordering steps) only with the user's approval; record every change in the roadmap change log in `pm/progress.md`. If a step turns out too big for one session, propose a split. A new step gets its GitHub issue, unless the user says otherwise for it ([workflow.md § 9](../docs/conventions/workflow.md#9-project-management)).

## 2. Overview

| # | ID | Type | Step | Depends on | Open questions |
|---|---|---|---|---|---|
| 1 | M1 | Manual | Enable Banking setup and verification of risks 5 and 6 | — (runs alongside F0-1) | verifies Q5, Q6 |
| 2 | F0-1 | Phase 0 | Knowledge base and best practices | — | — |
| 3 | D2 | Documentation | Split the software-factory file | F0-1 | — |
| 4 | F0-2 | Phase 0 | Architecture decisions | F0-1; M1 findings (recommended) | decides Q1, Q2, Q3, Q4; verifies Q9 |
| 5 | M2 | Manual | GitHub repository | — | — |
| 6 | C1 | OpenSpec | `cNNN-add-backend-foundation` | F0-1, F0-2, M2 | — |
| 7 | C2 | OpenSpec | `cNNN-add-ci-pipeline` | C1, M2 | — |
| 8 | C3 | OpenSpec | `cNNN-add-frontend-foundation` | C1, C2 | decides Q10 |
| 9 | M3 | Manual | Azure prerequisites for v1 | F0-2, M1, M2 | — |
| 10 | C4 | OpenSpec | `cNNN-add-deployment-pipeline` | C3, M3 | — |
| 11 | M4 | Manual | Entra ID | F0-2 | — |
| 12 | C5 | OpenSpec | `cNNN-add-enable-banking-adapter` | C1, M1 | — |
| 13 | C12 | OpenSpec | `c006-harden-bank-adapter` (runs alongside C6) | C5 | — |
| 14 | C6 | OpenSpec | `cNNN-add-user-login` (UC1) | C3, M4 | — |
| 15 | C11 | OpenSpec | `cNNN-add-bank-read-retries` | C5, C12 | — |
| 16 | C13 | Direct PR | Backend groundwork for the account reads | C5, C12, C6 | — |
| 17 | C7a | OpenSpec | `cNNN-add-account-balance` (UC2, part 1; alongside C7b, merges first) | C13; findings on Q6 | — |
| 18 | C7b | OpenSpec | `cNNN-add-account-transactions` (UC2, part 2; alongside C7a) | C13; its last task group C7a; findings on Q6 | decides Q7 |
| ◆ | | Milestone | **v1: my daughter sees the balance and transactions** | C7a and C7b deployed via C4 | |
| 19 | M5 | Manual | Handover v1 | v1 | — |
| 20 | C8 | OpenSpec | `cNNN-add-push-subscriptions` (UC3, part 1) | C4, C6 | — |
| 21 | C9 | OpenSpec | `cNNN-add-account-change-notifications` (UC3, part 2) | C5, C8; findings on Q5, Q6 | decides Q8 |
| ◆ | | Milestone | **v2: push notifications** | C9 deployed | |
| 22 | M7 | Manual | Handover v2 | v2 | — |
| — | C10 | OpenSpec (conditional) | `cNNN-add-consent-renewal` | C5; findings on Q5 | — |
| — | M9 | Manual (conditional, dated) | Renew the Enable Banking account link | M1; **deadline 2026-12-03**, then every 30 days | — |
| 23 | D1 | Documentation | Reinstatement guide | M7 (C10 if it was done) | — |
| 24 | SF1 | Software factory | Full versions of the cut-down kits | M7; before M8 | — |
| 25 | M8 | Manual | Decommissioning | end of operation; D1; SF1 | — |
| — | T1 | Tech debt (low priority) | Explore making the API's FastEndpoints classes internal | C1; before M8 | — |

M6 ("Azure prerequisites for notifications") was removed in F0-2: no shared Cosmos DB and no manual job part remain, and C8 generates the VAPID keys in its guided task (change log in `pm/progress.md`).

**Two tracks.** Manual steps (M1–M4) mostly unblock development and should be done as soon as their dependencies allow, so that development steps never wait for them. The main development path is F0-1 → F0-2 → C1 → C2 → C3 → C4 → C5 → C6 → C11 → C13 → C7a and C7b side by side (v1) → C8 → C9 (v2); C12 runs alongside C6 and is done before C11 and C7.

## 3. Risks 5 and 6: where and how early they are verified

**What is at stake.** Q5: whether the Enable Banking consent lasts the whole operating period, and what Enable Banking costs for personal use. Q6: how many requests the bank allows without the account holder being present (PSD2 typically allows 4 per day), versus 24 per day for an hourly check.

**Why first.** These risks are not only about notifications. When my daughter opens the app, the backend queries the bank without the account holder (me) being present. The request limit can therefore force a cache even for UC2, and with it a database already in v1. The consent validity decides whether a renewal step (C10) is needed. Verifying the risks needs no code.

**Where:** in step M1, the very first step, alongside F0-1.

**How:**

1. Research the Enable Banking documentation and pricing. Find what they say about Revolut: maximum consent validity, request limits, and how requests with and without the account holder present are told apart.
2. After linking the real Revolut account, read the actual consent validity. Linking starts the consent clock; take that into account when deciding the timing.
3. Do **not** test the request limit by exhausting it on the real account; that could block bank access for the rest of the day. Whatever the documentation does not answer, ask Enable Banking support. While waiting for the reply, M1 is `blocked`, but only C7 and C9 wait for it.
4. Record the findings and the resulting decisions in an ADR (`docs/adr/`), and their one-line outcomes and impact on the steps in `pm/progress.md`.

**Which steps use the findings:**

| Step | What the findings decide | Wait for them? |
|---|---|---|
| F0-2 | job hosting (Q4); whether a database is needed already in v1 | done: both decided in F0-2 with the M1 findings ([ADR-0005-data-storage](../docs/adr/0005-data-storage.md), [ADR-0006-hosting-registry-and-job](../docs/adr/0006-hosting-registry-and-job.md)) |
| C5 | handling of expired consent and rate-limit responses | recommended |
| C7a, C7b | live reads from the bank or a cache | **blocking** |
| C9 | check frequency and the use of stored state | **blocking** |
| C10 | whether the step is needed and its deadline | **blocking** |
| M9 | whether the account link must be renewed, and by when | **blocking** |
| M8 | what has to be revoked | — |

**During development:** keep requests to the real account to a minimum. Develop against mocks or the Enable Banking sandbox and use the real API only for final verification.

## 4. Steps

### M1 — Enable Banking setup and verification of risks 5 and 6

- **Type:** Manual (with research by Claude)
- **Goal:** Verify risks 5 and 6 and end up with a working Enable Banking application linked to my Revolut account. This is the biggest risk of the project and decides parts of the UC2 and UC3 design.
- **Depends on:** —
- **Inputs:** kickoff ch. 3, 6, 9.4, 10 (Q5, Q6); section 3 of this roadmap; Enable Banking documentation and pricing (web).
- **Outputs:**
  - findings on Q5 and Q6 and the resulting decisions in ADR-0001-bank-data-access; one-line outcomes and the impact on the steps in `pm/progress.md`;
  - Enable Banking account and registered application; the private key kept outside the repository until Key Vault exists (C4);
  - Revolut account linked; the identifiers the backend will need are recorded according to their sensitivity (secret → kept for Key Vault);
  - if anything cannot be verified from the documentation: a question sent to Enable Banking support, and the step stays `blocked` until the answer arrives.
- **Open questions:** verifies Q5, Q6.
- **Notes:** no product code yet. If linking requires API calls, use a throwaway script in `spikes/enable-banking/` (README + redacted evidence; never keys, tokens or bank data — [workflow.md § 7](../docs/conventions/workflow.md#7-spikes)).

### F0-1 — Knowledge base and best practices

- **Type:** Phase 0
- **Goal:** Write the project's knowledge base: code style (.NET, TypeScript/React), workflow (branches, commits, how OpenSpec is used), TDD and BDD conventions, test strategy. The agent proposes options based on the sources and the user decides.
- **Depends on:** —
- **Inputs:** kickoff ch. 7, 8, 9.3; the user's other project (the user gives the path at the start of the session); the Claude session about TDD and BDD (the user gives the link; if it cannot be read directly, ask for an export); `openspec/config.yaml`.
- **Outputs:** the knowledge base in the repository: `docs/conventions/` (conventions), `docs/adr/` (decisions), `docs/software-factory.md` (lessons for the software factory; split by D2 into `docs/software-factory/`); `openspec/config.yaml` with `context` and `rules` that reflect it; `CLAUDE.md` pointing to the knowledge base. The TDD/BDD part (`docs/conventions/testing.md`) runs in a separate session.
- **Open questions:** none from ch. 10.

### D2 — Split the software-factory file

- **Type:** Documentation
- **Goal:** Split `docs/software-factory.md` into two files with different purposes:
  - **lessons for the software factory:** what gets transferred to the factory's catalog (today DoseUp's `docs/software-factory.md`, later the factory's own repository);
  - **this project's divergences from the software factory:** where and why RevolutReader deliberately does it differently (project-only exceptions such as R-12). It stays with the project and is not transferred;
  - **the handover package:** what goes to the factory at the end of the project and how the package is built.
- **Depends on:** F0-1, so the split covers all its entries.
- **Inputs:** `docs/software-factory.md` (entries R-1 onwards); [workflow.md § 10](../docs/conventions/workflow.md#10-software-factory). The user decides where each entry goes. One entry can feed both files: its reusable lesson into the first, the project's exception into the second.
- **Outputs:** in `docs/software-factory/`: `lessons.md` and `divergences.md`, each stating its purpose and entry format; `creating-handover-package.md` with the inventory of reusable artifacts (kept current by every step, section 1) and how to build the handover package at the end of the project, naming its target (DoseUp now, the factory's own repository later). The package carries the lessons and the listed artifacts, not `divergences.md`. Every reference updated (`CLAUDE.md`, workflow.md §§ 1, 10 and its status line, the other conventions, `openspec/config.yaml`, this roadmap's F0-1 and M8).
- **Open questions:** —
- **Notes:** short. The handover is a process, not a file copy (the user, 2026-11-04): the package includes the artifacts themselves, e.g. the test-first workflow's testing.md, `tdd-apply` skill, agents and hook.

### F0-2 — Architecture decisions

- **Type:** Phase 0
- **Goal:** Decide the open questions that shape the manual Entra ID and Azure setup, so those steps can proceed alongside development. Record each decision with its rationale.
- **Depends on:** F0-1. Recommended: M1 findings on Q5 and Q6. If they are not available yet, decide what can be decided and defer job hosting (part of Q4) to C9.
- **Inputs:** kickoff ch. 4, 6, 7, 10; the knowledge base; ADR-0001-bank-data-access and the outcomes in `pm/progress.md`; DoseUp's architecture lessons, deliberately not carried over as conventions in F0-1 (`D:\source\jakubbohm\DoseUp\docs\software-factory.md`, e.g. what a scheduled job or a health probe wakes up and what that costs — F-47, F-52).
- **Outputs:** decisions on Q1–Q4 and the answer to Q9 as ADRs, with one-line outcomes in `pm/progress.md`; the list of Azure resources, split into shared or otherwise manual ones and those that go into Bicep; their impact on later steps noted (e.g., Cosmos DB already in v1).
- **Open questions:** decides Q1, Q2, Q3, Q4; verifies Q9 (ask the user which phone the daughter has). When deciding Q1, keep in mind that the daughter must not have to do any extra steps (kickoff ch. 4).

### M2 — GitHub repository

- **Type:** Manual
- **Goal:** Create the GitHub repository and push the existing history, so that CI can run.
- **Depends on:** —
- **Inputs:** kickoff ch. 7; `CLAUDE.md`; [workflow.md § 3](../docs/conventions/workflow.md#3-git).
- **Outputs:** GitHub repository (the user chooses its visibility, keeping Q1 in mind: an allowlist in the repository would expose email addresses); `origin` remote set; `main` pushed; squash merge as the only merge method, with the default squash commit message including the branch's commit list (so the step-tagged commits of [workflow.md § 3](../docs/conventions/workflow.md#3-git) survive on `main`; check the setting's current name), and branches deleted on merge. From then on, PRs always.
- **Open questions:** —
- **Notes:** short; can be done at the start of another session. Must be done before C1, so the first change already has a PR.

### C1 — `cNNN-add-backend-foundation`

- **Type:** OpenSpec change
- **Goal:** Set up the backend: .NET 11 solution, ASP.NET Core API project with FastEndpoints, Aspire AppHost and ServiceDefaults, the build conventions (`Directory.Build.props`, `Directory.Packages.props`, `global.json`, `BannedSymbols.txt` — [docs/conventions/README.md](../docs/conventions/README.md)), and the test foundation from [docs/conventions/testing.md](../docs/conventions/testing.md): the three test projects (§ Where tests live), the in-process acceptance harness with one walking-skeleton scenario green end to end (§ Acceptance tests), and the traceability test with the .NET attribute and `tests/manual-scenarios.md` (§ Every scenario has exactly one test). It ends with a running, empty API and passing tests.
- **Depends on:** F0-1, F0-2, M2
- **Inputs:** kickoff ch. 6, 7, 8; the knowledge base; F0-2 decisions (Q3 affects the structure).
- **Outputs:** archived change; solution in `src/` and `tests/`; `CLAUDE.md` with build, test and run commands, including the commands `/tdd-apply` needs (one group's tests, one change's acceptance tests, the traceability test, the full suite).
- **Open questions:** —
- **Notes:** before fixing the Result shape, verify whether C# union types ship in .NET 11 GA ([README.md § Backend code](../docs/conventions/README.md#backend-code)). The first change through `/tdd-apply`: run it with `review=all`, measure the cost of one app copy per test, and confirm that the implementer's hook fires (accept the workspace trust prompt first). Verify that FastEndpoints works with TUnit.AspNetCore (FastEndpoints' own testing package is believed to be xUnit-based). Issue: [#44](https://github.com/jakubbohm/RevolutReader/issues/44).

### C2 — `cNNN-add-ci-pipeline`

- **Type:** OpenSpec change
- **Goal:** A GitHub Actions workflow that builds the solution and runs all tests on every pull request (when it is opened or reopened and on every new push to it), and lints the PR title as a Conventional Commit. A rule on `main` (a ruleset) requires a pull request and makes every CI check required, so a failing check blocks the merge ([workflow.md § 4](../docs/conventions/workflow.md#4-cicd); possible on a free public repository). From then on, every change extends CI for what it adds, adds its new checks to the rule, and keeps it passing.
- **Depends on:** C1, M2
- **Inputs:** the knowledge base (workflow); output of C1.
- **Outputs:** archived change; CI passing on GitHub; the rule on `main` in place, checked by a PR whose CI fails and cannot be merged.
- **Open questions:** —
- **Notes:** issue [#45](https://github.com/jakubbohm/RevolutReader/issues/45).

### C3 — `c003-add-frontend-foundation`

- **Type:** OpenSpec change
- **Goal:** Set up the frontend: Vite + React + TypeScript 7, Tailwind CSS, the oxlint rule that keeps Radix Primitives behind the app's own components, oxlint + Prettier (not ESLint, change log 2026-11-06), PWA basics (manifest, service worker, installability, the install hint in an iPhone browser tab) and test infrastructure (Vitest, with the `scenario(...)` helper and the traceability test reading it — [testing.md § Every scenario has exactly one test](../docs/conventions/testing.md#every-scenario-has-exactly-one-test-the-traceability-check)). Integrate it into Aspire (Vite dev server with `/api` forwarding) and serve it from the backend ([ADR-0002-frontend-hosting](../docs/adr/0002-frontend-hosting.md)); no sign-in library ([ADR-0003-sign-in](../docs/adr/0003-sign-in.md)). Add the frontend build, checks and tests to CI. The generated API client moved to C6 (change log 2026-11-06). The look comes from the design system ([workflow.md § 8](../docs/conventions/workflow.md#8-design)): the Tailwind theme from its tokens, the app shell and the app icon; later changes build the components their screens need.
- **Depends on:** C1, C2
- **Inputs:** kickoff ch. 2, 6, 7, 10 (Q10); the knowledge base; F0-2 decisions (Q2, Q3, Q9); the design system ([workflow.md § 8](../docs/conventions/workflow.md#8-design)).
- **Outputs:** archived change; a running PWA shell with the basis for the Czech UI; CI covering the frontend.
- **Open questions:** decides Q10.
- **Notes:** issue [#46](https://github.com/jakubbohm/RevolutReader/issues/46).

### M3 — Azure prerequisites for v1

- **Type:** Manual
- **Goal:** Set up what v1 needs in Azure that cannot be automated: access to the subscription; the resource group the deployment stack is scoped to, in **Germany West Central**; the identity GitHub Actions deploys with (OIDC federated credential and the narrowest roles on the resource group that let the stack create the resources and their role assignments). Everything else is created by Bicep (C4, C6, C7b, C9). Resource list: [workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure).
- **Depends on:** F0-2, M1, M2
- **Inputs:** kickoff ch. 6, 7, 9.4; [workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure); F0-2 decisions ([ADR-0006-hosting-registry-and-job](../docs/adr/0006-hosting-registry-and-job.md) and the resource list); M1 findings.
- **Outputs:** the deploy identity and its federated credential; the values the workflow needs before Bicep can run (subscription, resource group, client ID) on the GitHub Environment; non-secret identifiers recorded.
- **Open questions:** — (applies Q3, Q4)

### C4 — `c005-add-deployment-pipeline`

- **Type:** OpenSpec change
- **Goal:** Bicep in `infra/` for the app's own Azure resources as decided in F0-2: a Container Apps environment (Consumption) and the container app (scaling to zero, maximum 1 replica), Key Vault, the app's managed identity and its role assignments. A Docker image with backend and frontend in one container ([ADR-0002-frontend-hosting](../docs/adr/0002-frontend-hosting.md)), published as a public image on ghcr.io ([ADR-0006-hosting-registry-and-job](../docs/adr/0006-hosting-registry-and-job.md)). A GitHub Actions pipeline that on every merge to `main` builds the image once, applies the Bicep as an Azure Deployment Stack (removed resources get deleted) and deploys the image. It deploys the current skeleton, so every later change ships automatically. Includes a guided manual task to put the Enable Banking secrets into Key Vault, and the choice of where the environment's logs go. The measurement of how long the app takes to wake from zero (fallback in ADR-0006: one always-on replica) moved to after v1, [#18](https://github.com/jakubbohm/RevolutReader/issues/18) (change log 2026-11-06).
- **Depends on:** C3, M3
- **Inputs:** kickoff ch. 6, 7; F0-2 decisions (Q3, Q4); identifiers from M3; [workflow.md §§ 4–5](../docs/conventions/workflow.md#4-cicd).
- **Outputs:** archived change; the skeleton running on Azure; the Enable Banking values in Key Vault, which the app reads from C5's merge on, when C5 wires them into the Bicep (c005 design.md D2); C5 lists them in `docs/conventions/configuration.md` § Hand-provisioned secrets.
- **Open questions:** —
- **Notes:** if it is too big for one session, propose a split (e.g., infrastructure first, then the pipeline). Issue: [#47](https://github.com/jakubbohm/RevolutReader/issues/47).

### M4 — Entra ID

- **Type:** Manual
- **Goal:** Register the application in Entra ID and set up the allowed accounts (me, my daughter, test accounts) using the mechanism chosen in F0-2.
- **Depends on:** F0-2. The production redirect URI needs the app's URL from C4; it can be added later.
- **Inputs:** kickoff ch. 4; F0-2 decisions (Q1, Q2).
- **Outputs:** application registration; allowed and test accounts; non-secret identifiers (tenant, client ID, redirect URIs) recorded. No secret: C6 creates the client secret ([ADR-0003-sign-in § Decision](../docs/adr/0003-sign-in.md#decision), item 4).
- **Open questions:** — (applies Q1, Q2)

### C5 — `cNNN-add-enable-banking-adapter`

- **Type:** OpenSpec change
- **Goal:** A backend adapter for the Enable Banking API that reads the balance and transactions of the linked account, read-only. Its expected failures (expired or revoked consent, rate limit) are the first Result values, so C5 also builds the Result type (a C# 15 union, shape in [README.md § Backend code](../docs/conventions/README.md#backend-code)). Its tests run against the local fake bank server with responses copied from Enable Banking's Mock ASPSP; it is checked on demand against the Mock ASPSP through the sandbox application and verified once against the real API. Local development reads the Mock ASPSP, never the real account ([testing.md § Fake bank](../docs/conventions/testing.md#fake-bank-a-local-fake-server-in-front-of-our-real-enable-banking-client)).
- **Depends on:** C1, M1
- **Inputs:** kickoff ch. 6; ADR-0001-bank-data-access and the M1 identifiers; Enable Banking API documentation; the knowledge base; [spikes/enable-banking-mock/](../spikes/enable-banking-mock/README.md) (sandbox application, captured responses). Run `/tdd-apply` with `review=all`.
- **Outputs:** archived change; the adapter with tests, including handling of expired consent and rate-limit responses.
- **Open questions:** — (applies the findings on Q5, Q6)
- **Notes:** issue [#48](https://github.com/jakubbohm/RevolutReader/issues/48).

### C12 — `c006-harden-bank-adapter`

- **Type:** OpenSpec change
- **Goal:** Fix what a code review (2026-11-07) and its assessment found in C5's adapter before C7 builds on it: paging capped at 20 pages, a negative amount is an error, a gateway's error page reads as "bank unavailable", the browser name cleaned before it is sent, the present user checked, a log line with a reason for every read, error values quoted only when shaped like a code. Make every failed bank read easy to find: Application Insights fed by the app with its own identity, and ready queries.
- **Depends on:** C5. Runs alongside C6 in its own worktree; done before C7.
- **Inputs:** the review's findings and their assessment ([openspec/changes/archive/2026-11-08-c006-harden-bank-adapter/design.md](../openspec/changes/archive/2026-11-08-c006-harden-bank-adapter/design.md) D1–D8, decided in explore); c004 and c005 design.md; ADR-0001-bank-data-access.
- **Outputs:** archived change; the `bank-reads` spec updated; Application Insights in the deployment; the deploy identity's role condition widened by hand (guided task).
- **Open questions:** — (applies Q6 through ADR-0001)
- **Notes:** added 2026-11-07 with the user's approval (change log in `pm/progress.md`). The review's ten minor findings are fixed directly on `fix/review-findings`; this branch is rebased after that merges, before `/tdd-apply`. Issue: [#49](https://github.com/jakubbohm/RevolutReader/issues/49).

### C6 — `cNNN-add-user-login` (UC1)

- **Type:** OpenSpec change
- **Goal:** UC1 end to end. A user signs in with a Microsoft account; only allowed accounts get through and everyone else is rejected. After sign-in, the (still empty) account detail page is shown. Backend endpoints require a signed-in, allowed user. Sign-in is the backend's login cookie ([ADR-0003-sign-in](../docs/adr/0003-sign-in.md)) checked against the email allowlist ([ADR-0004-account-allowlist](../docs/adr/0004-account-allowlist.md)). It brings the generated API client, moved here from C3 (change log 2026-11-06): the FastEndpoints OpenAPI export, openapi-typescript (run with its own TypeScript 5, because the frontend is on TypeScript 7) and openapi-fetch, with the CI drift check ([README.md § API contract](../docs/conventions/README.md#api-contract)). The change also adds the app's storage account with a blob container for the cookie's Data Protection keys, so a wake from zero does not sign users out ([ADR-0006-hosting-registry-and-job](../docs/adr/0006-hosting-registry-and-job.md)). A guided task creates the 12-month client secret on the M4 app registration, straight into Key Vault and the AppHost's user-secrets, together with the allowlist. It ends with the manual check of signing in from the Home Screen app on the owner's iPhone.
- **Depends on:** C3, M4
- **Inputs:** kickoff ch. 4, 5 (UC1); F0-2 decisions (Q1, Q2); identifiers from M4; the Screens design ([workflow.md § 8](../docs/conventions/workflow.md#8-design)).
- **Outputs:** archived change; sign-in working locally and, after deployment, on Azure; BDD scenarios for allowed and rejected users.
- **Open questions:** — (applies Q1, Q2)
- **Notes:** issue [#50](https://github.com/jakubbohm/RevolutReader/issues/50).

### C11 — `cNNN-add-bank-read-retries`

- **Type:** OpenSpec change
- **Goal:** The bank adapter retries a present user's failed request up to 3 times, waiting about 0.8, 1.6 and 3.2 s with a random spread (the Azure SDK's numbers), so that a one-off network failure does not end as "bank unavailable" ([#27](https://github.com/jakubbohm/RevolutReader/issues/27)). It retries what reads as bank unavailable (network failures, a connection that breaks while the answer comes in, the bank's own errors: `ASPSP_ERROR`, `ASPSP_TIMEOUT`, a 5xx or 408 without an Enable Banking code), each HTTP request on its own (a failed transactions page retries that page only). The 15 s request timeout covers a request with all its retries. It never retries a request that ran into that timeout, an unattended read, rate limited (429), access expired or any other error. A read is "bank unavailable" only after its last attempt fails (c008 design.md D1–D5; the goal's first sketch said "a few times within about 2 s", change log).
- **Depends on:** C5 and C12: the hardened adapter decides which error answers count as the bank's own errors (c006 design.md D3), which is what this step retries. Placed before C7, so that C7 and C9 build on it.
- **Inputs:** issue #27 (the proposal and what to decide); the `bank-reads` spec; c004 design.md D4 and c001 design.md D5 (archived with their changes); [README.md § Backend code](../docs/conventions/README.md#backend-code); [ADR-0001-bank-data-access](../docs/adr/0001-bank-data-access.md).
- **Outputs:** archived change; `bank-reads` with the changed "Bank unavailable" requirement and retry scenarios ("Rate limited, never retried" unchanged); README.md § Backend code narrowed from "the bank client never retries" to the policy this change decides (no other client gets retries by default); a dated note in ADR-0001; software-factory lesson R-30 updated.
- **Open questions:** — (applies Q6: no retry may use up the 4 unattended reads a day)
- **Notes:** small. Decided with the user (c008 design.md D1–D11, 2026-11-08): our own 15 s timeout is final and covers a request with its retries (no time budget per read); unattended reads are never retried (a C9 fallback check decides for itself); Microsoft's resilience library (`Microsoft.Extensions.Http.Resilience`) on the bank client alone, not a loop of our own; a `Retry-After` is followed only while its wait ends within the timeout. Added 2026-11-08 (change log).

UC2 (kickoff ch. 5) is built as two changes, split by the data each shows, after a small groundwork PR (the user, 2026-11-08, change log in `pm/progress.md`): C13 the shared backend pieces, then C7a the balance and C7b the transactions. One C7 would have been larger than C5 or C6, whose sessions each reached about half a million tokens of context. Each half is a slice the user can see, with its own spec, scenarios and design boards; only C7b brings the database and decides Q7.

**Working in parallel.** Agreed with the user (2026-11-08), so that C7a and C7b run at once, each in its own worktree, after C13:

1. **Two endpoints:** `GET /api/balance` (C7a) and `GET /api/transactions` (C7b), never one combined answer, so neither change edits the other's endpoint. The adapter already reads the two separately, so this adds no bank call; the screen sends both requests at once and shows a failure of each part on its own.
2. **The shared backend pieces come first, in C13:** the "a user is present" code, the rules that turn a failed bank read into an API answer, and the koruna rate. Neither half waits for the other on the backend.
3. **C7a owns the account screen:** its layout, its refresh (`Obnovit`, return to the app), its single error banner (the Screens design draws one banner over the balance and the list), and a place for the list. C7b builds the list as its own component, with its own request, and puts it on today's empty account screen in its own branch, so that its tests run through the whole app.
4. **C7a merges first.** C7b then rebases on it and, as its last task group: moves the list into C7a's place, joins C7a's refresh and banner, and adds the koruna line to its rows (the design system's `TransactionRow`).
5. **Merged by hand at the rebase:** the generated API files (`openapi.json`, `schema.d.ts`: regenerated, not merged line by line) and the rows in `pm/progress.md`.

### C13 — Backend groundwork for the account reads

- **Type:** Direct PR, not an OpenSpec change (the user, 2026-11-08): it shows nothing to a user, so it has no scenario of its own; the scenarios that reach these pieces come with C7a's and C7b's endpoints. Unit tests are written first, and the user reviews the PR.
- **Goal:** The backend pieces both C7a and C7b need, built once, so that the two never wait for each other:
  - the code that turns the incoming request into "a user is present" (`PresentUser` in [ReadTrigger.cs](../src/RevolutReader.Api/Bank/ReadTrigger.cs): the signed-in user's IP address and browser), including IPv4 addresses that arrive in IPv6 form (c004 design.md D2; forwarded headers, c007 design.md D10);
  - the rules that turn a failed bank read into the API's answer, a problem description like the API's other errors, for the three cases of c004 design.md D4: access expired, rate limited, bank unavailable;
  - the EUR→CZK rate as a constant, 24.3 CZK per euro (the user, 2026-11-08), until it is sourced from an outside service once a day ([#39](https://github.com/jakubbohm/RevolutReader/issues/39)).
- **Depends on:** C5, C12, C6.
- **Inputs:** [ReadTrigger.cs](../src/RevolutReader.Api/Bank/ReadTrigger.cs) and `BankResult<T>`; c004 design.md D2 and D4 (archived with C5); c007 design.md D10 (archived with C6); the `api-errors` spec.
- **Outputs:** the merged PR; the three pieces with their unit tests; no endpoint, nothing a user sees.
- **Open questions:** —
- **Notes:** small. Added 2026-11-08 with C7's split ([#40](https://github.com/jakubbohm/RevolutReader/issues/40), change log). The first app code outside OpenSpec (software-factory R-58).

### C7a — `cNNN-add-account-balance` (UC2, part 1)

- **Type:** OpenSpec change
- **Goal:** The balance end to end, and the app's waiting and offline states:
  - `GET /api/balance`, allowed users only, which reads the balance live and forwards the signed-in user's IP address and browser to the bank ([ADR-0001-bank-data-access § Decision](../docs/adr/0001-bank-data-access.md#decision), item 1);
  - the account screen (working in parallel, item 3): its header with the balance, its CZK equivalent (C13's rate) and the time it was read; a refresh on `Obnovit` and on return to the app; a place for C7b's list;
  - the balance kept on the phone ([ADR-0007-offline-balance](../docs/adr/0007-offline-balance.md)): written after every successful read, shown at once while the server wakes and when offline, deleted on sign-out;
  - the waiting screen (normal and slow) on the app's first request, `GET /api/me`, whatever the sign-in state, and the offline screens;
  - the bank's error states (bank unavailable, too many requests, bank link expired) and their single banner, which C7b's list joins;
  - what the screen says when sign-out fails, whether a sign-out that fails offline still deletes the stored balance, and a busy state ([c007 design.md D5](../openspec/changes/archive/2026-11-08-c007-add-user-login/design.md), [#33](https://github.com/jakubbohm/RevolutReader/issues/33) finding 7).

  The screens and their states come from the Screens design ([workflow.md § 8](../docs/conventions/workflow.md#8-design)).
- **Depends on:** C13 (and through it C5, C12, C6); findings on Q6. Runs alongside C7b in its own worktree and merges first.
- **Inputs:** kickoff ch. 5 (UC2), 6; ADR-0001-bank-data-access, ADR-0007-offline-balance and the outcomes in `pm/progress.md`; C13's pieces; c007 design.md D5; the Screens design: the balance header and the screen-wide states of the `Account / Detail / *` boards, `Shell / Offline / *`, `Sign-in / Waiting / *`.
- **Outputs:** archived change; the balance and the waiting and offline states working locally and, after deployment, on Azure; C12's ready queries checked against the first real bank lines; the balance compared once with the Revolut app (C5 follow-up).
- **Open questions:** — (applies Q6, Q10)
- **Notes:** no database and no new Azure resource. [#41](https://github.com/jakubbohm/RevolutReader/issues/41).

### C7b — `cNNN-add-account-transactions` (UC2, part 2)

- **Type:** OpenSpec change
- **Goal:** The transactions end to end:
  - the settled transactions stored from 2026-08-09 ([ADR-0001-bank-data-access § Decision](../docs/adr/0001-bank-data-access.md#decision), item 6): the first table in the storage account C6 created, with its role assignment (Storage Table Data Contributor is already among the roles the deploy identity may grant, [azure-prerequisites.md](../docs/operations/azure-prerequisites.md)); Azurite locally and in tests ([ADR-0005-data-storage](../docs/adr/0005-data-storage.md));
  - the one-time import of the M1 history file, which is then deleted;
  - `GET /api/transactions`, allowed users only, which returns the stored settled transactions together with a live read of the last 31 days (c004 design.md D7): newly settled ones are stored, pending ones shown but never stored;
  - the account screen's scrollable list, grouped by day, and the transaction sheet; after the rebase on C7a, the list in C7a's place, joined to its refresh and banner, with the koruna line on each row (working in parallel, items 3 and 4).

  The screens and their states come from the Screens design ([workflow.md § 8](../docs/conventions/workflow.md#8-design)).
- **Depends on:** C13 (and through it C5, C12, C6); findings on Q6. Runs alongside C7a in its own worktree; its last task group waits for C7a's merge.
- **Inputs:** kickoff ch. 5 (UC2), 6, 10 (Q6, Q7); ADR-0001-bank-data-access, ADR-0005-data-storage and the outcomes in `pm/progress.md`; C13's pieces; c004 design.md D3 (time of day, refunds, the CZK equivalent, showing the payment details) and D7 (the 31-day window); the M1 history file on the owner's machine; the Screens design: the list on the `Account / Detail / *` boards (`Scrolled` and `Empty` in particular) and `Account / Transaction sheet / *`.
- **Outputs:** archived change; the history imported and its file deleted; with C7a, v1 complete and deployed through C4.
- **Open questions:** decides Q7.
- **Notes:** the history file ends on 2026-11-04 and the live read covers 31 days. If C7b goes live after about 2026-12-05, its first read reaches further back (the bank serves 90 days) to close the gap. The transaction store is the app's view of the history, never C9's record of what was notified (C9, item 3). [#42](https://github.com/jakubbohm/RevolutReader/issues/42).

### ◆ Milestone v1 — my daughter sees the balance and transactions

### M5 — Handover v1

- **Type:** Manual
- **Goal:** Send my daughter the link and confirm that she can sign in on her phone and sees the balance and transactions.
- **Depends on:** v1
- **Inputs:** kickoff ch. 4, 9.4; F0-2 (Q9: her phone, installation instructions).
- **Outputs:** v1 confirmed working for my daughter; any problems found are proposed as new steps.
- **Open questions:** —

### C8 — `cNNN-add-push-subscriptions` (UC3, part 1)

- **Type:** OpenSpec change
- **Goal:** A signed-in user can enable notifications: the PWA (from the iPhone's Home Screen, Q9) asks for permission and subscribes, and the backend stores the subscription in a table in the app's storage account ([ADR-0005-data-storage](../docs/adr/0005-data-storage.md)). The backend can send a Web Push and the service worker displays it. A guided task generates the VAPID keys on my machine and stores them in Key Vault (and in the AppHost's user-secrets for local development). Database tests run against Azurite ([testing.md § Decided later](../docs/conventions/testing.md#decided-later)).
- **Depends on:** C4, C6
- **Inputs:** kickoff ch. 5 (UC3), 6, 10 (Q9); the answer to Q9 from F0-2; the knowledge base; the Screens design ([workflow.md § 8](../docs/conventions/workflow.md#8-design)).
- **Outputs:** archived change; a subscribed device receives a test notification.
- **Open questions:** — (applies Q9: on iOS, Web Push works only for a PWA added to the home screen)
- **Notes:** issue [#51](https://github.com/jakubbohm/RevolutReader/issues/51).

### C9 — `cNNN-add-account-change-notifications` (UC3, part 2)

- **Type:** OpenSpec change
- **Goal:** When the Revolut app on my iPhone shows a notification, an iOS 27 Shortcuts automation on the phone calls a protected, retry-safe endpoint in the app. The endpoint reads the account state through the adapter, compares it with the last stored state and, when something has changed, sends a notification to the subscribed users. This replaces the 4 scheduled runs a day and the Logic App clock of [ADR-0006-hosting-registry-and-job](../docs/adr/0006-hosting-registry-and-job.md) ([ADR-0008-phone-triggered-check](../docs/adr/0008-phone-triggered-check.md), [issue #12](https://github.com/jakubbohm/RevolutReader/issues/12)). Reads triggered from the phone forward the phone's real PSU headers (my decision; I accept the risk). C9 decides how the Shortcut authenticates and whether a fallback check is kept for when the phone is off or offline.
- **One check at a time, one merged notification** (the owner, 2026-11-08; the starting design for C9's explore). Revolut often sends an offer right after the payment notification, and each one fires the Shortcut. While the app wakes up, both calls arrive together, read the same new state, compare it with the same old stored state and would both notify. This is how C9 meets ADR-0008's "at most one notification" constraint:
  1. **Three steps per trigger, one trigger at a time:** read the bank and compare with the stored state; store the new state if it changed; notify. A trigger waits until the previous one has finished. An in-process queue is enough, because the app runs at most one copy ([ADR-0006-hosting-registry-and-job](../docs/adr/0006-hosting-registry-and-job.md)).
  2. **At most one check waits:** a trigger arriving while a check is already waiting joins that check and gets its answer, so a burst of any size costs at most two bank reads.
  3. **Two stored markers:** *last seen*, the state from the latest successful read, updated by every check; and *last notified*, the state as of the last notification sent. The notification is the difference between them. Nothing depends on when the daughter opens the app: no view time is stored (the user, 2026-11-08, [ADR-0001-bank-data-access § Decision](../docs/adr/0001-bank-data-access.md#decision), items 4–5 amended). Two notes from C7's split (2026-11-08):
     - **A state, not a time, and not the last transaction's ID alone.** A pending payment, the one the shop's notification is about, has no stable ID until it settles ([ADR-0001 § Context — Transaction history](../docs/adr/0001-bank-data-access.md#transaction-history)), and how Revolut dates a payment when it settles is not known yet. So the marker probably holds the balance and the pending transactions as well; C9's explore decides.
     - **The markers are C9's own, never C7b's transaction store.** An open of the app stores newly settled transactions (C7b); a check that compared against the store would find nothing new after the daughter's open and send nothing.
  4. **Only the last check in a burst notifies:** a check with another check waiting behind it skips the notification and leaves its changes to the last one, which covers everything since the last notification.
  5. **The notification comes from the stored state, not the live read:** a last check whose bank read fails still sends what earlier checks found, and a stop between storing and notifying (scale to zero, a deploy) is caught up by the next trigger. *Last notified* is written only after the push has gone out: at worst one notification repeats, none is lost.
  6. **Optional backstop:** a conditional update (ETag) on the stored state, so two app copies during a deploy cannot send the same changes.
  - **Not chosen:** waiting for a quiet period (debounce) before checking. It delays every notification, needs a timer that outlives the phone's request, and buys nothing: the payment is already readable when its notification arrives ([M1 spike, step 7](../spikes/enable-banking/README.md)). Accepted cost: two real payments a few seconds apart can still bring two notifications.
  - **C9 decides:** whether the Shortcut waits for the answer (a queued call answers after the wake-up plus under 1 s per read; iOS Shortcuts' request timeout is not known yet) or the endpoint answers at once (202) and checks in the background; the content of a merged notification (Q8, e.g. "2 new payments" plus the balance, which the push carries, [ADR-0007-offline-balance](../docs/adr/0007-offline-balance.md)). *(2026-11-08: "how *last notified* relates to the daughter's last view" is gone from this list; there is no view time, item 3.)*
- **Depends on:** C5, C8; findings on Q5 and Q6; the phone test in issue #12 (done 2026-11-06: the automation runs on its own, also while the phone is locked).
- **Inputs:** kickoff ch. 5 (UC3), 6, 10 (Q6, Q8); issue #12 (findings, decision, phone test); ADR-0001-bank-data-access, ADR-0006-hosting-registry-and-job, ADR-0008-phone-triggered-check and the outcomes in `pm/progress.md`.
- **Outputs:** archived change; v2 complete and deployed; the Shortcut and its secret recorded in [docs/operations/](../docs/operations/) with how to restore them (ADR-0008 § Consequences).
- **Open questions:** decides Q8.
- **Notes:** the phone test needs no server (issue #12, "Prerequisite"). Enable Banking has no webhooks for account data, and Revolut has no API and no emails for personal accounts, so the phone is the only near-real-time trigger found (issue #12, "Findings"). Issue: [#52](https://github.com/jakubbohm/RevolutReader/issues/52).

### ◆ Milestone v2 — push notifications

### M7 — Handover v2

- **Type:** Manual
- **Goal:** Help my daughter enable notifications on her phone (on iOS, including adding the PWA to the home screen) and confirm that a real change on the account produces a notification.
- **Depends on:** v2
- **Inputs:** F0-2 (Q9); outputs of C8 and C9.
- **Outputs:** notifications confirmed working on her phone.
- **Open questions:** —

### C10 — `cNNN-add-consent-renewal` (conditional)

- **Type:** OpenSpec change, only if needed
- **Goal:** If the consent expires before the end of the operating period, and repeating the M1 linking procedure is not enough, add a simple way for me to renew the consent.
- **Depends on:** C5; findings on Q5. Deadline: before the consent expires.
- **Inputs:** ADR-0001-bank-data-access and the Q5 outcome in `pm/progress.md`; output of C5.
- **Outputs:** archived change. If the step is not needed, mark it `done` with the note "Not needed" and the reason.
- **Open questions:** —
- **Notes:** issue [#53](https://github.com/jakubbohm/RevolutReader/issues/53).

### M9 — Renew the Enable Banking account link (conditional, dated)

- **Type:** Manual, only if needed; dated rather than ordered.
- **Goal:** Keep bank access until the end of operation (at least the end of 2026). The account link in the Enable Banking Control Panel, which activates restricted mode, is valid for only 30 days, and the Control Panel offers no longer period. The first link expires on 2026-12-04. Renew it by linking the account again in the Control Panel ("Link accounts", then approve in the Revolut app) before it expires. Repeat every 30 days while operation continues.
- **Depends on:** M1. **Deadline:** 2026-12-03, one day before the first link expires; then before each new expiry.
- **Inputs:** the link's expiry date and the M1 finding on whether API access depends on the link (`spikes/enable-banking/README.md`, ADR-0001-bank-data-access § Context); how to renew: [`docs/operations/expiring-approvals.md` § 1](../docs/operations/expiring-approvals.md#1-enable-banking-account-link).
- **Outputs:** the new expiry date recorded in `spikes/enable-banking/README.md`; the API access still working. If M1 shows that API access does not depend on the link, mark the step `done` with the note "Not needed" and the reason.
- **Open questions:** —
- **Notes:** needs the account holder for SCA in the Revolut app, about 5 minutes. No code. If renewing breaks the API session, repeat the M1 API authorisation (step 5 of the spike).

### D1 — Reinstatement guide

- **Type:** Documentation
- **Goal:** A guide to bring the app back from the repository after decommissioning, assuming every secret, approval and Azure resource is gone. Reactivation later is likely. The guide gives, in order and with PowerShell 7 commands:
  - the accounts needed: Enable Banking Control Panel, Revolut, Azure subscription, GitHub, Microsoft accounts for sign-in;
  - the Enable Banking application, the account link and the API session (spike scripts);
  - the Azure prerequisites, the Entra registration, the deploy identity and the deployment through CD;
  - the secrets in Key Vault, the VAPID keys and the push subscriptions;
  - the allowed users;
  - the history import and the checks that the app works.
- **Depends on:** M7 (C10 if it was done), so that everything that exists is covered.
- **Inputs:** [`docs/operations/expiring-approvals.md`](../docs/operations/expiring-approvals.md), kept current by every step (section 1); ADRs; [workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure); [configuration.md § Hand-provisioned secrets](../docs/conventions/configuration.md#hand-provisioned-secrets); the identifiers recorded in M1, M3 and M4; the spike READMEs; the Bicep templates.
- **Outputs:** `docs/operations/reinstatement.md`, reviewed by the user as a walk-through; no actual rebuild.
- **Open questions:** —
- **Notes:** M8 does not export the stored transactions (the user, 2026-11-04). A reinstated app downloads the history in the 5 minutes after its new API approval, as in M1, with `create-session.ps1 -HistoryStart <first day>`. It gets only as far back as Revolut then serves.

### SF1 — Full versions of the cut-down kits

- **Type:** Software factory
- **Goal:** The handover package gives the factory the full version of every reusable kit, never a cut-down. For each kit in the inventory that carries a project cut-down (its Lessons column names an entry of `divergences.md`), build the full version its lesson describes, to the factory's quality bar, and prove that it works. On 2026-11-08 that is 14 lessons: R-1, R-6, R-7, R-12, R-13, R-14, R-19, R-25, R-27, R-35, R-45, R-46, R-52, R-53. The list is taken again from the inventory when the step starts, because later changes may add to it.
- **Depends on:** M7, so the kits no longer change with the app. Before M8, while the Azure setup still exists to prove the full versions against.
- **Inputs:** [creating-handover-package.md § Inventory](../docs/software-factory/creating-handover-package.md#inventory); [divergences.md](../docs/software-factory/divergences.md) (what each cut-down gives up); [lessons.md](../docs/software-factory/lessons.md) (each full version, its options and its research); [workflow.md § 10 — The quality bar](../docs/conventions/workflow.md#the-quality-bar-2026-11-08).
- **Outputs:** every listed kit's full version built, proven, and listed in the inventory as the kit's template for the default answer; the cut-down that ran here stays listed for the cheaper option it answers; each lesson's *Setup produces* names both; the proof for each full version recorded, so the package README can name it ([creating-handover-package.md § Building the package](../docs/software-factory/creating-handover-package.md#building-the-package), step 5).
- **Open questions:** —
- **Notes:** until SF1 the project keeps only notes: each lesson and each `divergences.md` entry names the full version, and the detail is worked out here ([workflow.md § 10 — The quality bar](../docs/conventions/workflow.md#the-quality-bar-2026-11-08)). SF1 starts with a plan made with the user, one kit at a time: what the full version is, where it lives (the app switched over to it, or a separate template next to the cut-down), how it is proven (the app's own tests and CI, a deployment removed again afterwards, or tests of its own), and what it costs. Some full versions are rules or decisions rather than code (e.g. R-1, R-45); they become the template's rule or ADR. When the plan does not fit one session, it is split into SF1a, SF1b, … with the user's approval. Added 2026-11-08 (change log in `pm/progress.md`).

### M8 — Decommissioning

- **Type:** Manual
- **Goal:** After the operating period ends: revoke the consent in Enable Banking; delete the deployment stack, which deletes every project-owned Azure resource, including the stored account data (the app uses no shared resources, F0-2); purge the deleted Key Vault, which Azure otherwise keeps with its secrets for the retention period; delete the resource group and the identity GitHub Actions deploys with; delete the Entra app registration; remove access for the allowed accounts. Then build the software-factory handover package for the standalone Software Factory ([creating-handover-package.md § The target](../docs/software-factory/creating-handover-package.md#the-target)).
- **Depends on:** end of operation (approx. 2 months; at least until the end of 2026); D1; SF1, so the package carries the full versions.
- **Inputs:** kickoff ch. 9.6; [workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure); the identifiers recorded in M1, M3 and M4; [`docs/operations/`](../docs/operations/) (expiring approvals and the D1 reinstatement guide, kept for a later rebuild); [`docs/software-factory/creating-handover-package.md`](../docs/software-factory/creating-handover-package.md).
- **Outputs:** everything revoked and deleted; the software-factory handover package built and handed over: to the factory's consolidation if the factory does not exist yet, otherwise to the factory; `pm/progress.md` closed.
- **Open questions:** —

### T1 — Explore making the API's FastEndpoints classes internal

- **Type:** Tech debt (low priority)
- **Goal:** Find out whether the API's classes can be `internal` instead of `public`: whether FastEndpoints 9 finds and runs `internal` endpoints, what that means for their handlers and request/response classes, and which analyzer rules then need narrow per-file exceptions (CA1812, "class is never created", for classes a framework creates) instead of the API-wide exception of CA1515 ("make classes internal") that C1 added. The same question for the test projects: TUnit already runs `internal` test classes, and only the acceptance tests' `ApiFactory` trips CA1812. Knowledge building for the software factory; a cleanup only if the answer is cheap.
- **Depends on:** C1. Low priority: only when no other step is waiting; before M8.
- **Inputs:** `.editorconfig` (the CA1515 exceptions for `tests/**` and `src/RevolutReader.Api/**` and their comments); c001's design.md D1 (archived with the change); DoseUp, which turns CA1515 off for the whole repository and keeps its endpoints, handlers and responses public.
- **Outputs:** a spike in `spikes/fastendpoints-internal/` (README and evidence: which rules fire, whether FastEndpoints finds internal endpoints, what unit tests then need, e.g. `InternalsVisibleTo`); a software-factory lesson; if the user decides so, a small PR applying it.
- **Open questions:** —
- **Notes:** added in C1 (2026-11-05): the user kept both exceptions for speed and asked for this step.

## 5. Open questions overview

| Q | Topic | Decided / verified in | Affects |
|---|---|---|---|
| 1 | Account allowlisting mechanism | F0-2 | M2, M4, C6 |
| 2 | Authentication flow | F0-2 | M4, C3, C6 |
| 3 | Frontend hosting (one container) | F0-2 | C1, C3, C4 |
| 4 | Job hosting, registry, costs | F0-2 | M3, C4, C9 |
| 5 | Enable Banking consent validity and pricing *(risk)* | M1 (verify) | C5, C9, C10, M9, M8 |
| 6 | Bank request limits *(risk)* | M1 (verify) | F0-2, M3, C5, C11, C7a, C7b, C9 |
| 7 | Transactions (history, paging, details) | C7b | — |
| 8 | Notification content | C9 | — |
| 9 | Push on iOS *(risk)* | F0-2 (verify: which phone) | C3, C8, M5, M7 |
| 10 | PWA scope (offline mode?) | C3 | — |
