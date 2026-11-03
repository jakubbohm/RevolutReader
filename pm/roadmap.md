# RevolutReader — Roadmap

> The order of work for the whole project. The current status of each step is in [`pm/progress.md`](progress.md); the project brief is [`pm/kickoff.md`](kickoff.md). Questions "Q1–Q10" refer to the open questions in kickoff ch. 10.
>
> Created: 2026-11-04

---

## 1. How to use this roadmap

- **Every session starts** by reading `CLAUDE.md`, this file and `pm/progress.md`.
- **Picking the next step:** if the user names a step, do that one. Otherwise take the first step in the order (section 2) whose status is `todo` and whose dependencies are `done`. Manual steps may run in parallel with development steps.
- **One step = one session.** Steps are described briefly on purpose. The detail is worked out in the step itself; for OpenSpec changes in its proposal, design, specs and tasks.
- **Step types:**
  - **Phase 0:** knowledge base and architecture decisions, no product code. The agent presents options; the user decides.
  - **Manual:** the user does the work; Claude guides them step by step and says what to set up, where and how. Non-secret identifiers (resource names, client IDs, URLs) are recorded in the repository. Secrets go only to Key Vault, never into the repository; until Key Vault exists, they stay on the user's machine.
  - **OpenSpec change:** one change, taken from propose through apply to archive in a single session (`/opsx:propose`, `/opsx:apply`, `/opsx:archive`), using TDD and BDD as defined in the knowledge base. Change names in this roadmap are proposals.
- **Open questions:** a step decides only the questions assigned to it. The agent presents options; the user decides. Record the outcome in `pm/progress.md` (Decisions on open questions) and, for architecture decisions, also where the knowledge base says.
- **At the end of a step:** update `pm/progress.md` (status, date, link to the OpenSpec change, notes). Update `CLAUDE.md` if build, test or run commands or the project structure changed.
- **Changing the roadmap** (adding, removing, splitting or reordering steps) only with the user's approval; record every change in the roadmap change log in `pm/progress.md`. If a step turns out too big for one session, propose a split.

## 2. Overview

| # | ID | Type | Step | Depends on | Open questions |
|---|---|---|---|---|---|
| 1 | M1 | Manual | Enable Banking setup and verification of risks 5 and 6 | — (runs alongside F0-1) | verifies Q5, Q6 |
| 2 | F0-1 | Phase 0 | Knowledge base and best practices | — | — |
| 3 | F0-2 | Phase 0 | Architecture decisions | F0-1; M1 findings (recommended) | decides Q1, Q2, Q3, Q4; verifies Q9 |
| 4 | M2 | Manual | GitHub repository | — | — |
| 5 | C1 | OpenSpec | `backend-foundation` | F0-1, F0-2 | — |
| 6 | C2 | OpenSpec | `ci-pipeline` | C1, M2 | — |
| 7 | C3 | OpenSpec | `frontend-foundation` | C1, C2 | decides Q10 |
| 8 | M3 | Manual | Azure for v1 | F0-2, M1, M2 | — |
| 9 | C4 | OpenSpec | `deployment-pipeline` | C3, M3 | — |
| 10 | M4 | Manual | Entra ID | F0-2 | — |
| 11 | C5 | OpenSpec | `enable-banking-adapter` | C1, M1 | — |
| 12 | C6 | OpenSpec | `user-login` (UC1) | C3, M4 | — |
| 13 | C7 | OpenSpec | `account-detail` (UC2) | C5, C6; findings on Q6 | decides Q7 |
| ◆ | | Milestone | **v1: my daughter sees the balance and transactions** | C7 deployed via C4 | |
| 14 | M5 | Manual | Handover v1 | v1 | — |
| 15 | M6 | Manual | Azure for notifications | M3, F0-2 | — |
| 16 | C8 | OpenSpec | `push-subscriptions` (UC3, part 1) | C4, C6, M6 | — |
| 17 | C9 | OpenSpec | `account-change-notifications` (UC3, part 2) | C5, C8, M6; findings on Q5, Q6 | decides Q8 (and job hosting from Q4 if F0-2 deferred it) |
| ◆ | | Milestone | **v2: push notifications** | C9 deployed | |
| 18 | M7 | Manual | Handover v2 | v2 | — |
| — | C10 | OpenSpec (conditional) | `consent-renewal` | C5; findings on Q5 | — |
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
4. Record the findings and their impact on the steps in `pm/progress.md`.

**Which steps use the findings:**

| Step | What the findings decide | Wait for them? |
|---|---|---|
| F0-2 | job hosting (Q4); whether Cosmos DB is needed already in v1 | recommended; if missing, F0-2 defers job hosting to C9 |
| M3 | whether Cosmos DB moves from M6 into M3 | yes, if F0-2 had them |
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
  - findings on Q5 and Q6, with their impact on the steps, in `pm/progress.md`;
  - Enable Banking account and registered application; the private key kept outside the repository until Key Vault exists (M3);
  - Revolut account linked; the identifiers the backend will need are recorded according to their sensitivity (secret → kept for Key Vault);
  - if anything cannot be verified from the documentation: a question sent to Enable Banking support, and the step stays `blocked` until the answer arrives.
- **Open questions:** verifies Q5, Q6.
- **Notes:** no product code yet. If linking requires API calls, use a throwaway script outside the repository.

### F0-1 — Knowledge base and best practices

- **Type:** Phase 0
- **Goal:** Write the project's knowledge base: code style (.NET, TypeScript/React), workflow (branches, commits, how OpenSpec is used), TDD and BDD conventions, test strategy. The agent proposes options based on the sources and the user decides.
- **Depends on:** —
- **Inputs:** kickoff ch. 7, 8, 9.3; the user's other project (the user gives the path at the start of the session); the Claude session about TDD and BDD (the user gives the link; if it cannot be read directly, ask for an export); `openspec/config.yaml`.
- **Outputs:** the knowledge base in the repository (location and structure decided in this step); `openspec/config.yaml` with `context` and `rules` that reflect it; `CLAUDE.md` pointing to the knowledge base.
- **Open questions:** none from ch. 10.

### F0-2 — Architecture decisions

- **Type:** Phase 0
- **Goal:** Decide the open questions that shape the manual Entra ID and Azure setup, so those steps can proceed alongside development. Record each decision with its rationale.
- **Depends on:** F0-1. Recommended: M1 findings on Q5 and Q6. If they are not available yet, decide what can be decided and defer job hosting (part of Q4) to C9.
- **Inputs:** kickoff ch. 4, 6, 7, 10; the knowledge base; M1 findings in `pm/progress.md`.
- **Outputs:** decisions on Q1–Q4 and the answer to Q9 in `pm/progress.md` and in the knowledge base; their impact on later steps noted (e.g., Cosmos DB already in M3).
- **Open questions:** decides Q1, Q2, Q3, Q4; verifies Q9 (ask the user which phone the daughter has). When deciding Q1, keep in mind that the daughter must not have to do any extra steps (kickoff ch. 4).

### M2 — GitHub repository

- **Type:** Manual
- **Goal:** Create the GitHub repository and push the existing history, so that CI can run.
- **Depends on:** —
- **Inputs:** kickoff ch. 7; `CLAUDE.md`.
- **Outputs:** GitHub repository (the user chooses its visibility, keeping Q1 in mind: an allowlist in the repository would expose email addresses); `origin` remote set; `main` pushed.
- **Open questions:** —
- **Notes:** short; can be done at the start of another session.

### C1 — `backend-foundation`

- **Type:** OpenSpec change
- **Goal:** Set up the backend: .NET 11 solution, ASP.NET Core API project, Aspire AppHost and ServiceDefaults, unit and BDD test projects as defined in the knowledge base. It ends with a running, empty API and passing tests.
- **Depends on:** F0-1, F0-2
- **Inputs:** kickoff ch. 6, 7, 8; the knowledge base; F0-2 decisions (Q3 affects the structure).
- **Outputs:** archived change; solution in `src/` and `tests/`; `CLAUDE.md` with build, test and run commands.
- **Open questions:** —

### C2 — `ci-pipeline`

- **Type:** OpenSpec change
- **Goal:** A GitHub Actions workflow that builds the solution and runs all tests on every push and pull request. From then on, every change extends CI for what it adds and keeps it passing.
- **Depends on:** C1, M2
- **Inputs:** the knowledge base (workflow); output of C1.
- **Outputs:** archived change; CI passing on GitHub.
- **Open questions:** —

### C3 — `frontend-foundation`

- **Type:** OpenSpec change
- **Goal:** Set up the frontend: Vite + React + TypeScript, Tailwind CSS, Radix Primitives, PWA basics (manifest, service worker, installability) and test infrastructure. Integrate it into Aspire and serve it from the backend if Q3 says so. Add the frontend build and tests to CI.
- **Depends on:** C1, C2
- **Inputs:** kickoff ch. 2, 6, 7, 10 (Q10); the knowledge base; F0-2 decisions (Q2, Q3, Q9).
- **Outputs:** archived change; a running PWA shell with the basis for the Czech UI; CI covering the frontend.
- **Open questions:** decides Q10.

### M3 — Azure for v1

- **Type:** Manual
- **Goal:** Create the Azure resources needed for v1 and connect GitHub Actions to Azure.
- **Depends on:** F0-2, M1, M2
- **Inputs:** kickoff ch. 6, 7, 9.4; F0-2 decisions (Q3, Q4: registry, App Service tier); M1 findings (if Q6 forces a cache in v1, create Cosmos DB here instead of in M6).
- **Outputs:** resource group, App Service (Web App for Containers), Key Vault holding the Enable Banking secrets, container registry, an identity for the app with access to Key Vault, GitHub Actions connected to Azure; non-secret identifiers recorded.
- **Open questions:** — (applies Q3, Q4)

### C4 — `deployment-pipeline`

- **Type:** OpenSpec change
- **Goal:** A Docker image (backend and frontend in one container, if Q3 confirms it) and a GitHub Actions pipeline that deploys it to App Service. It deploys the current skeleton, so every later change ships automatically.
- **Depends on:** C3, M3
- **Inputs:** kickoff ch. 6, 7; F0-2 decisions (Q3, Q4); identifiers from M3.
- **Outputs:** archived change; the skeleton running on Azure and reading its secrets from Key Vault.
- **Open questions:** —

### M4 — Entra ID

- **Type:** Manual
- **Goal:** Register the application in Entra ID and set up the allowed accounts (me, my daughter, test accounts) using the mechanism chosen in F0-2.
- **Depends on:** F0-2. The production redirect URI needs the App Service URL from M3; it can be added later.
- **Inputs:** kickoff ch. 4; F0-2 decisions (Q1, Q2).
- **Outputs:** application registration; allowed and test accounts; non-secret identifiers (tenant, client ID, redirect URIs) recorded; any secret stored in Key Vault.
- **Open questions:** — (applies Q1, Q2)

### C5 — `enable-banking-adapter`

- **Type:** OpenSpec change
- **Goal:** A backend adapter for the Enable Banking API that reads the balance and transactions of the linked account, read-only. It is developed against mocks and verified once against the real API.
- **Depends on:** C1, M1
- **Inputs:** kickoff ch. 6; M1 findings (Q5, Q6) and identifiers; Enable Banking API documentation; the knowledge base.
- **Outputs:** archived change; the adapter with tests, including handling of expired consent and rate-limit responses.
- **Open questions:** — (applies the findings on Q5, Q6)

### C6 — `user-login` (UC1)

- **Type:** OpenSpec change
- **Goal:** UC1 end to end. A user signs in with a Microsoft account; only allowed accounts get through and everyone else is rejected. After sign-in, the (still empty) account detail page is shown. Backend endpoints require a signed-in, allowed user.
- **Depends on:** C3, M4
- **Inputs:** kickoff ch. 4, 5 (UC1); F0-2 decisions (Q1, Q2); identifiers from M4.
- **Outputs:** archived change; sign-in working locally and, after deployment, on Azure; BDD scenarios for allowed and rejected users.
- **Open questions:** — (applies Q1, Q2)

### C7 — `account-detail` (UC2)

- **Type:** OpenSpec change
- **Goal:** UC2 end to end: API endpoints for the balance and transactions, accessible only to allowed users, and the account detail screen with the balance in the header and a scrollable list of transactions.
- **Depends on:** C5, C6; findings on Q6 (blocking: they decide live reads versus a cache).
- **Inputs:** kickoff ch. 5 (UC2), 6, 10 (Q6, Q7); findings and decisions in `pm/progress.md`.
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

### M6 — Azure for notifications

- **Type:** Manual
- **Goal:** Create what notifications need: Cosmos DB (free tier), VAPID keys stored in Key Vault, and the job hosting chosen in F0-2.
- **Depends on:** M3, F0-2
- **Inputs:** kickoff ch. 6, 9.5 (dependencies on manual steps); F0-2 decisions (Q4); M1 findings.
- **Outputs:** the resources; secrets in Key Vault; identifiers recorded.
- **Open questions:** —
- **Notes:** skip Cosmos DB if M3 already created it. If F0-2 deferred job hosting to C9, set up that part after C9's design.

### C8 — `push-subscriptions` (UC3, part 1)

- **Type:** OpenSpec change
- **Goal:** A signed-in user can enable notifications: the PWA asks for permission and subscribes, and the backend stores the subscription in Cosmos DB. The backend can send a Web Push and the service worker displays it. Database tests follow the knowledge base (most likely Testcontainers).
- **Depends on:** C4, C6, M6
- **Inputs:** kickoff ch. 5 (UC3), 6, 10 (Q9); the answer to Q9 from F0-2; the knowledge base.
- **Outputs:** archived change; a subscribed device receives a test notification.
- **Open questions:** — (applies Q9: on iOS, Web Push works only for a PWA added to the home screen)

### C9 — `account-change-notifications` (UC3, part 2)

- **Type:** OpenSpec change
- **Goal:** A periodic job reads the account state through the adapter, compares it with the last stored state and, when something has changed, sends a notification to the subscribed users.
- **Depends on:** C5, C8, M6; findings on Q5 and Q6 (blocking: they decide the check frequency).
- **Inputs:** kickoff ch. 5 (UC3), 6, 10 (Q4, Q6, Q8); findings and decisions in `pm/progress.md`.
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

### C10 — `consent-renewal` (conditional)

- **Type:** OpenSpec change, only if needed
- **Goal:** If the consent expires before the end of the operating period, and repeating the M1 linking procedure is not enough, add a simple way for me to renew the consent.
- **Depends on:** C5; findings on Q5. Deadline: before the consent expires.
- **Inputs:** findings on Q5 in `pm/progress.md`; output of C5.
- **Outputs:** archived change. If the step is not needed, mark it `done` with the note "Not needed" and the reason.
- **Open questions:** —

### M8 — Decommissioning

- **Type:** Manual
- **Goal:** After the operating period ends: revoke the consent in Enable Banking, remove access for the allowed accounts, and delete the Azure resources, including the database with the stored account data and the connection from GitHub Actions to Azure.
- **Depends on:** end of operation (approx. 2 months)
- **Inputs:** kickoff ch. 9.6; the identifiers recorded in M1, M3, M4 and M6.
- **Outputs:** everything revoked and deleted; `pm/progress.md` closed.
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
