# RevolutReader — Roadmap

> The order of work for the whole project. The current status of each step is in [`pm/progress.md`](progress.md); the project brief is [`pm/kickoff.md`](kickoff.md). Questions "Q1–Q10" refer to the open questions in kickoff ch. 10.
>
> Created: 2026-11-04 · Updated: 2026-11-04 (F0-1 — see the change log in `pm/progress.md`)

---

## 1. How to use this roadmap

- **Every session starts** by reading `CLAUDE.md`, this file and `pm/progress.md`.
- **Picking the next step:** if the user names a step, do that one. Otherwise take the first step in the order (section 2) whose status is `todo` and whose dependencies are `done`. Manual steps may run in parallel with development steps.
- **One step = one session.** Steps are described briefly on purpose. The detail is worked out in the step itself; for OpenSpec changes in its proposal, design, specs and tasks.
- **Step types:**
  - **Phase 0:** knowledge base and architecture decisions, no product code. The agent presents options; the user decides.
  - **Manual:** only what cannot be automated ([docs/conventions/workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure)): access to the Azure subscription, the Entra application registration, the identity GitHub Actions deploys with, shared resources and access to them, and secret values only a human can produce. Everything else in Azure is Bicep, deployed by CD inside the OpenSpec changes. The user does the manual work; Claude guides them step by step and says what to set up, where and how. Commands for the user are PowerShell 7. Non-secret identifiers (resource names, client IDs, URLs) are recorded in the repository. Secrets go only to Key Vault, never into the repository; until Key Vault exists, they stay on the user's machine. Scripts and evidence go in `spikes/<topic>/` ([workflow.md § 7](../docs/conventions/workflow.md#7-spikes)).
  - **OpenSpec change:** one change, taken from propose through apply to archive in a single session (`/opsx:propose`, `/opsx:apply`, `/opsx:archive`), using TDD and BDD as defined in the knowledge base. Change names in this roadmap are proposals; the `cNNN` prefix is the next free number, assigned when the change is created ([workflow.md § 6](../docs/conventions/workflow.md#6-openspec)).
- **Open questions:** a step decides only the questions assigned to it. The agent presents options; the user decides. The decision itself (with findings, rationale and alternatives) goes into an ADR in `docs/adr/`; `pm/progress.md` records only the status, a one-line outcome, the link and the impact on steps ([workflow.md § 2](../docs/conventions/workflow.md#2-decisions)).
- **At the end of a step:** update `pm/progress.md` (status, date, link to the OpenSpec change, notes). Update `CLAUDE.md` if build, test or run commands or the project structure changed.
- **Changing the roadmap** (adding, removing, splitting or reordering steps) only with the user's approval; record every change in the roadmap change log in `pm/progress.md`. If a step turns out too big for one session, propose a split.

## 2. Overview

| # | ID | Type | Step | Depends on | Open questions |
|---|---|---|---|---|---|
| 1 | M1 | Manual | Enable Banking setup and verification of risks 5 and 6 | — (runs alongside F0-1) | verifies Q5, Q6 |
| 2 | F0-1 | Phase 0 | Knowledge base and best practices | — | — |
| 3 | F0-2 | Phase 0 | Architecture decisions | F0-1; M1 findings (recommended) | decides Q1, Q2, Q3, Q4; verifies Q9 |
| 4 | M2 | Manual | GitHub repository | — | — |
| 5 | C1 | OpenSpec | `cNNN-add-backend-foundation` | F0-1, F0-2 | — |
| 6 | C2 | OpenSpec | `cNNN-add-ci-pipeline` | C1, M2 | — |
| 7 | C3 | OpenSpec | `cNNN-add-frontend-foundation` | C1, C2 | decides Q10 |
| 8 | M3 | Manual | Azure prerequisites for v1 | F0-2, M1, M2 | — |
| 9 | C4 | OpenSpec | `cNNN-add-deployment-pipeline` | C3, M3 | — |
| 10 | M4 | Manual | Entra ID | F0-2 | — |
| 11 | C5 | OpenSpec | `cNNN-add-enable-banking-adapter` | C1, M1 | — |
| 12 | C6 | OpenSpec | `cNNN-add-user-login` (UC1) | C3, M4 | — |
| 13 | C7 | OpenSpec | `cNNN-add-account-detail` (UC2) | C5, C6; findings on Q6 | decides Q7 |
| ◆ | | Milestone | **v1: my daughter sees the balance and transactions** | C7 deployed via C4 | |
| 14 | M5 | Manual | Handover v1 | v1 | — |
| 15 | M6 | Manual | Azure prerequisites for notifications | M3, F0-2 | — |
| 16 | C8 | OpenSpec | `cNNN-add-push-subscriptions` (UC3, part 1) | C4, C6, M6 | — |
| 17 | C9 | OpenSpec | `cNNN-add-account-change-notifications` (UC3, part 2) | C5, C8, M6; findings on Q5, Q6 | decides Q8 (and job hosting from Q4 if F0-2 deferred it) |
| ◆ | | Milestone | **v2: push notifications** | C9 deployed | |
| 18 | M7 | Manual | Handover v2 | v2 | — |
| — | C10 | OpenSpec (conditional) | `cNNN-add-consent-renewal` | C5; findings on Q5 | — |
| 19 | M8 | Manual | Decommissioning | end of operation | — |

**Two tracks.** Manual steps (M1–M4, M6) mostly unblock development and should be done as soon as their dependencies allow, so that development steps never wait for them. The main development path is F0-1 → F0-2 → C1 → C2 → C3 → C4 → C5 → C6 → C7 (v1) → C8 → C9 (v2).

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
| F0-2 | job hosting (Q4); whether Cosmos DB is needed already in v1 | recommended; if missing, F0-2 defers job hosting to C9 |
| M3 | whether access to the shared Cosmos DB account moves from M6 into M3 | yes, if F0-2 had them |
| C5 | handling of expired consent and rate-limit responses | recommended |
| C7 | live reads from the bank or a cache | **blocking** |
| C9 | check frequency and the use of stored state | **blocking** |
| C10 | whether the step is needed and its deadline | **blocking** |
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
- **Outputs:** the knowledge base in the repository: `docs/conventions/` (conventions), `docs/adr/` (decisions), `docs/software-factory.md` (lessons for the software factory); `openspec/config.yaml` with `context` and `rules` that reflect it; `CLAUDE.md` pointing to the knowledge base. The TDD/BDD part (`docs/conventions/testing.md`) runs in a separate session.
- **Open questions:** none from ch. 10.

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
- **Outputs:** GitHub repository (the user chooses its visibility, keeping Q1 in mind: an allowlist in the repository would expose email addresses); `origin` remote set; `main` pushed; squash merge as the only merge method and branches deleted on merge. From then on, PRs always.
- **Open questions:** —
- **Notes:** short; can be done at the start of another session.

### C1 — `cNNN-add-backend-foundation`

- **Type:** OpenSpec change
- **Goal:** Set up the backend: .NET 11 solution, ASP.NET Core API project with FastEndpoints, Aspire AppHost and ServiceDefaults, unit and BDD test projects as defined in the knowledge base, and the build conventions (`Directory.Build.props`, `Directory.Packages.props`, `global.json`, `BannedSymbols.txt` — [docs/conventions/README.md](../docs/conventions/README.md)). It ends with a running, empty API and passing tests.
- **Depends on:** F0-1, F0-2
- **Inputs:** kickoff ch. 6, 7, 8; the knowledge base; F0-2 decisions (Q3 affects the structure).
- **Outputs:** archived change; solution in `src/` and `tests/`; `CLAUDE.md` with build, test and run commands.
- **Open questions:** —
- **Notes:** before fixing the Result shape, verify whether C# union types ship in .NET 11 GA ([README.md § Backend code](../docs/conventions/README.md#backend-code)).

### C2 — `cNNN-add-ci-pipeline`

- **Type:** OpenSpec change
- **Goal:** A GitHub Actions workflow that builds the solution and runs all tests on every push and pull request, and lints the PR title as a Conventional Commit. From then on, every change extends CI for what it adds and keeps it passing.
- **Depends on:** C1, M2
- **Inputs:** the knowledge base (workflow); output of C1.
- **Outputs:** archived change; CI passing on GitHub.
- **Open questions:** —

### C3 — `cNNN-add-frontend-foundation`

- **Type:** OpenSpec change
- **Goal:** Set up the frontend: Vite + React + TypeScript, Tailwind CSS, Radix Primitives behind the app's own components, ESLint + Prettier, the generated API client (openapi-typescript + openapi-fetch), PWA basics (manifest, service worker, installability) and test infrastructure. Integrate it into Aspire and serve it from the backend if Q3 says so. Add the frontend build, checks and tests to CI.
- **Depends on:** C1, C2
- **Inputs:** kickoff ch. 2, 6, 7, 10 (Q10); the knowledge base; F0-2 decisions (Q2, Q3, Q9).
- **Outputs:** archived change; a running PWA shell with the basis for the Czech UI; CI covering the frontend.
- **Open questions:** decides Q10.

### M3 — Azure prerequisites for v1

- **Type:** Manual
- **Goal:** Set up what v1 needs in Azure that cannot be automated: access to the subscription, the resource group if F0-2 scopes the deployment stack to one, the identity GitHub Actions deploys with (OIDC federated credential and role assignment), and — if F0-2 puts Cosmos DB into v1 — access to the shared Cosmos DB account. Everything else is created by Bicep in C4.
- **Depends on:** F0-2, M1, M2
- **Inputs:** kickoff ch. 6, 7, 9.4; [workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure); F0-2 decisions (Q3, Q4: which resources exist and which are shared); M1 findings.
- **Outputs:** the deploy identity and its federated credential; the values the workflow needs before Bicep can run (subscription, resource group, client ID) on the GitHub Environment; non-secret identifiers recorded.
- **Open questions:** — (applies Q3, Q4)

### C4 — `cNNN-add-deployment-pipeline`

- **Type:** OpenSpec change
- **Goal:** Bicep in `infra/` for the app's own Azure resources as decided in F0-2 (e.g., App Service plan and Web App for Containers, Key Vault, container registry, the app's managed identity and its role assignments), a Docker image (backend and frontend in one container, if Q3 confirms it), and a GitHub Actions pipeline that on every merge to `main` builds the image once, applies the Bicep as an Azure Deployment Stack (removed resources get deleted) and deploys the image. It deploys the current skeleton, so every later change ships automatically. Includes a guided manual task to put the Enable Banking secrets into Key Vault.
- **Depends on:** C3, M3
- **Inputs:** kickoff ch. 6, 7; F0-2 decisions (Q3, Q4); identifiers from M3; [workflow.md §§ 4–5](../docs/conventions/workflow.md#4-cicd).
- **Outputs:** archived change; the skeleton running on Azure and reading its secrets from Key Vault; the secrets listed in `docs/conventions/configuration.md` § Hand-provisioned secrets.
- **Open questions:** —
- **Notes:** if it is too big for one session, propose a split (e.g., infrastructure first, then the pipeline).

### M4 — Entra ID

- **Type:** Manual
- **Goal:** Register the application in Entra ID and set up the allowed accounts (me, my daughter, test accounts) using the mechanism chosen in F0-2.
- **Depends on:** F0-2. The production redirect URI needs the App Service URL from C4; it can be added later.
- **Inputs:** kickoff ch. 4; F0-2 decisions (Q1, Q2).
- **Outputs:** application registration; allowed and test accounts; non-secret identifiers (tenant, client ID, redirect URIs) recorded; any secret stored in Key Vault.
- **Open questions:** — (applies Q1, Q2)

### C5 — `cNNN-add-enable-banking-adapter`

- **Type:** OpenSpec change
- **Goal:** A backend adapter for the Enable Banking API that reads the balance and transactions of the linked account, read-only. It is developed against mocks and verified once against the real API.
- **Depends on:** C1, M1
- **Inputs:** kickoff ch. 6; ADR-0001-bank-data-access and the M1 identifiers; Enable Banking API documentation; the knowledge base.
- **Outputs:** archived change; the adapter with tests, including handling of expired consent and rate-limit responses.
- **Open questions:** — (applies the findings on Q5, Q6)

### C6 — `cNNN-add-user-login` (UC1)

- **Type:** OpenSpec change
- **Goal:** UC1 end to end. A user signs in with a Microsoft account; only allowed accounts get through and everyone else is rejected. After sign-in, the (still empty) account detail page is shown. Backend endpoints require a signed-in, allowed user.
- **Depends on:** C3, M4
- **Inputs:** kickoff ch. 4, 5 (UC1); F0-2 decisions (Q1, Q2); identifiers from M4.
- **Outputs:** archived change; sign-in working locally and, after deployment, on Azure; BDD scenarios for allowed and rejected users.
- **Open questions:** — (applies Q1, Q2)

### C7 — `cNNN-add-account-detail` (UC2)

- **Type:** OpenSpec change
- **Goal:** UC2 end to end: API endpoints for the balance and transactions, accessible only to allowed users, and the account detail screen with the balance in the header and a scrollable list of transactions. The screen is designed first as one Claude Design mockup ([workflow.md § 8](../docs/conventions/workflow.md#8-design)).
- **Depends on:** C5, C6; findings on Q6 (blocking: they decide live reads versus a cache).
- **Inputs:** kickoff ch. 5 (UC2), 6, 10 (Q6, Q7); ADR-0001-bank-data-access and the outcomes in `pm/progress.md`.
- **Outputs:** archived change; v1 complete and deployed through C4.
- **Open questions:** decides Q7.
- **Notes:** if the Q6 findings force a cache for UC2, the step will probably need to be split (e.g., periodic fetching and storage first). Agree on it with the user and log it.

### ◆ Milestone v1 — my daughter sees the balance and transactions

### M5 — Handover v1

- **Type:** Manual
- **Goal:** Send my daughter the link and confirm that she can sign in on her phone and sees the balance and transactions.
- **Depends on:** v1
- **Inputs:** kickoff ch. 4, 9.4; F0-2 (Q9: her phone, installation instructions).
- **Outputs:** v1 confirmed working for my daughter; any problems found are proposed as new steps.
- **Open questions:** —

### M6 — Azure prerequisites for notifications

- **Type:** Manual
- **Goal:** Set up what notifications need that cannot be automated: access to the shared Cosmos DB free-tier account (create the account first if the subscription has none yet — only one free-tier account per subscription), the VAPID keys generated on my machine (stored in Key Vault by a guided task in C8), and any manual part of the job hosting chosen in F0-2. The database inside the shared account and the job hosting resources are Bicep, in C8 and C9.
- **Depends on:** M3, F0-2
- **Inputs:** kickoff ch. 6, 9.5 (dependencies on manual steps); F0-2 decisions (Q4); M1 findings; [workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure).
- **Outputs:** access to the shared resources; VAPID keys kept for Key Vault; identifiers recorded.
- **Open questions:** —
- **Notes:** skip whatever M3 already did. If F0-2 deferred job hosting to C9, set up that part after C9's design.

### C8 — `cNNN-add-push-subscriptions` (UC3, part 1)

- **Type:** OpenSpec change
- **Goal:** A signed-in user can enable notifications: the PWA asks for permission and subscribes, and the backend stores the subscription in Cosmos DB. The backend can send a Web Push and the service worker displays it. Bicep for the notification resources (e.g., the database in the shared Cosmos DB account, which is referenced as `existing`); a guided task storing the VAPID keys in Key Vault. Database tests follow the knowledge base (most likely Testcontainers).
- **Depends on:** C4, C6, M6
- **Inputs:** kickoff ch. 5 (UC3), 6, 10 (Q9); the answer to Q9 from F0-2; the knowledge base.
- **Outputs:** archived change; a subscribed device receives a test notification.
- **Open questions:** — (applies Q9: on iOS, Web Push works only for a PWA added to the home screen)

### C9 — `cNNN-add-account-change-notifications` (UC3, part 2)

- **Type:** OpenSpec change
- **Goal:** A periodic job reads the account state through the adapter, compares it with the last stored state and, when something has changed, sends a notification to the subscribed users. Bicep for the job hosting resources, if it needs any.
- **Depends on:** C5, C8, M6; findings on Q5 and Q6 (blocking: they decide the check frequency).
- **Inputs:** kickoff ch. 5 (UC3), 6, 10 (Q4, Q6, Q8); ADR-0001-bank-data-access and the outcomes in `pm/progress.md`.
- **Outputs:** archived change; v2 complete and deployed.
- **Open questions:** decides Q8; decides job hosting (part of Q4) if F0-2 deferred it.

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

### M8 — Decommissioning

- **Type:** Manual
- **Goal:** After the operating period ends: revoke the consent in Enable Banking; delete the deployment stack, which deletes every project-owned Azure resource, including stored account data; remove this project's data and access in the shared resources; delete the identity GitHub Actions deploys with; remove access for the allowed accounts. Then hand the software-factory deposit over to DoseUp.
- **Depends on:** end of operation (approx. 2 months)
- **Inputs:** kickoff ch. 9.6; [workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure); the identifiers recorded in M1, M3, M4 and M6; `docs/software-factory.md` § Handover.
- **Outputs:** everything revoked and deleted; the software-factory entries handed over to DoseUp; `pm/progress.md` closed.
- **Open questions:** —

## 5. Open questions overview

| Q | Topic | Decided / verified in | Affects |
|---|---|---|---|
| 1 | Account allowlisting mechanism | F0-2 | M2, M4, C6 |
| 2 | Authentication flow | F0-2 | M4, C3, C6 |
| 3 | Frontend hosting (one container) | F0-2 | C1, C3, C4 |
| 4 | Job hosting, registry, costs | F0-2 (job hosting may move to C9) | M3, M6, C4, C9 |
| 5 | Enable Banking consent validity and pricing *(risk)* | M1 (verify) | C5, C9, C10, M8 |
| 6 | Bank request limits *(risk)* | M1 (verify) | F0-2, M3, C5, C7, C9 |
| 7 | Transactions (history, paging, details) | C7 | — |
| 8 | Notification content | C9 | — |
| 9 | Push on iOS *(risk)* | F0-2 (verify: which phone) | C3, C8, M5, M7 |
| 10 | PWA scope (offline mode?) | C3 | — |
