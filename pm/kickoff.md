# RevolutReader — Project Kickoff

> **Purpose of this document:** the initial brief for the project. Based on it, a follow-up session creates `pm/roadmap.md` and `pm/progress.md`, which will drive all development. The document describes **what** and **why**. **How** is decided later, in the individual roadmap steps.
>
> **Legend:** **Decided** = settled. **Assumption** = default choice that needs to be confirmed. **Open** = to be decided later (see [ch. 10](#10-open-questions)).
>
> Date: 2026-11-03 (updated 2026-11-04)

---

## 1. Context

My daughter is abroad and, with my permission, pays with my card linked to one specific Revolut account. She needs to see how much money is left in the account and which payments have gone through.

The original plan was for her to install the Revolut app and sign in with my account. That didn't work: the app requires face verification, and she only tried it once she was abroad, where I'm not with her.

## 2. Goal

A simple web application (PWA) in which my daughter can see the **balance and transactions** of this one account, **read-only**, and receives a **push notification** when something changes in the account.

- **Operating period:** approx. 2 months.
- **The main priority is speed of delivery.** The application is intentionally minimal, with nothing extra.
- **Why a PWA:** for push notifications and installation on a phone.

## 3. Scope

**In scope**

- 3 use cases: **Sign-in**, **Account detail**, and **Push notifications about account changes**.
- A small fixed set of pre-approved users: me, my daughter, and test accounts.
- 1 Revolut account, connected via Enable Banking.

**Out of scope**

- Any write operations (payments, transfers, card management).
- Registration of new users and sign-in by anyone other than the pre-approved accounts.
- Sign-in with anything other than Microsoft accounts (e.g., Apple).
- Other accounts or banks.
- Anything beyond the three use cases above.

## 4. Users and access

| User | Role | Account type |
|---|---|---|
| Me (owner) | one-time setup, also a regular user | Microsoft account |
| Daughter | main user, read-only | Microsoft account |
| Test accounts | verification during development | Microsoft account |

- Sign-in via **Microsoft Entra ID** with a personal Microsoft account.
- Allowed accounts are **defined in advance**. The mechanism is open: either an allowlist of email addresses in the repository, or invitations in Entra ID (see [question 1](#10-open-questions)).
- My daughter gets a link, signs in, and can use the application right away. No further steps are required on her side (registration, waiting for approval).
- Anyone else is rejected. The application displays bank data, so access must be strictly limited to the allowed accounts.

## 5. Use cases

### UC1 — Sign-in

- A signed-out user signs in with their Microsoft account.
- Only a pre-approved account gets through.
- After sign-in, the Account detail is shown.

### UC2 — Account detail

- **Header:** current account balance.
- **Below it:** a scrollable list of transactions.
- Data is loaded from Revolut via Enable Banking. The backend acts as a proxy.

### UC3 — Push notifications about account changes

- The user enables notifications in the app.
- The backend periodically (e.g., once an hour) checks the account state.
- If anything has changed since the last check, it sends a push notification to the users who have enabled notifications.

## 6. Architecture

```
PWA (React) ──── sign-in ────▶ Entra ID
  │       ▲
  │ HTTPS │ Web Push
  │ token │ (via the browser's push service)
  ▼       │
Backend (.NET 11) ────▶ Enable Banking API ────▶ Revolut
  ├─ API: balance, transactions
  ├─ job (e.g., once an hour): check for changes → push notification
  ├──▶ Cosmos DB   (last known account state, notification subscriptions)
  └──▶ Key Vault   (secrets)
```

- **The backend has two parts:**
  - **Read API:** 1–2 endpoints (balance, transactions) that pass through data from Enable Banking.
  - **Notification job:** periodically loads the account state, compares it with the last stored one, and sends a Web Push on change.
- **Read-only:** the backend calls only read operations against the bank.
- **Connecting Enable Banking to my Revolut account** is something I do once, manually.
- **Database:** notifications require simple storage, so Cosmos DB on the free tier. Tentatively it will hold the last known account state (for change detection) and the push notification subscriptions.
- **Secrets** live exclusively in Azure Key Vault, never in the repository. This includes, e.g., access to Enable Banking and the private VAPID key for Web Push.
- **Configuration** normally lives in the repository (appsettings). If it ever needs to change at runtime, Azure App Configuration is used. **Key Vault is for secrets only.**
- **Deployment:** a single Docker container on Azure App Service.

## 7. Technology

| Area | Choice | Status |
|---|---|---|
| Frontend | React + Vite + TypeScript, PWA, Tailwind CSS, Radix Primitives | Decided |
| Backend | .NET 11 (ASP.NET Core) | Decided |
| Bank connectivity | [Enable Banking](https://enablebanking.com/) API → Revolut | Decided |
| Authentication | Microsoft Entra ID, pre-approved Microsoft accounts | Decided; allowlisting mechanism open |
| Notifications | Web Push (PWA) | Decided |
| Secrets | Azure Key Vault (secrets only) | Decided |
| Configuration | appsettings in the repository; dynamic configuration only if needed, via Azure App Configuration | Decided |
| Database | Cosmos DB (free tier), needed because of notifications | Assumption |
| Hosting | Azure App Service (Web App for Containers), Docker | Decided |
| Local development | .NET Aspire | Decided |
| Repository and CI/CD | GitHub, deployment to Azure via GitHub Actions | Decided |
| Tests | TDD + BDD; Testcontainers where needed (likely for the database) | Decided / Assumption |

## 8. Development approach

- **Spec-driven development** via OpenSpec, combined with **test-driven** and **behavior-driven development**.
- Development proceeds in **OpenSpec changes**. Each is sized so that **one session can complete it entirely**, from proposal through implementation to archiving.
- **Languages:** the app UI is in Czech. Everything else is in English: code, specifications, commits and project documents. I may write prompts to Claude in Czech; Claude's output is always in English (see `CLAUDE.md`).
- The rules (code style, workflow, TDD and BDD conventions) will be created in [Phase 0](#93-phase-0--knowledge-base-and-best-practices) as the project's knowledge base, before the first line of code.

## 9. Input for the roadmap

### 9.1 Outputs

- **`pm/roadmap.md`:** a list of steps (manual and development), their order and dependencies. Steps are **not specified in detail**. They only need to give each subsequent session a clear picture of its task.
- **`pm/progress.md`:** the ongoing status of the individual steps.

### 9.2 Step types

- **Manual steps** are done by me. Claude guides me through them step by step and tells me **what, where and how** to set up.
- **Development steps:** each corresponds to one OpenSpec change.

### 9.3 Phase 0 — Knowledge base and best practices

The first task for the agent, before any code.

- **Goal:** write the project's knowledge base and best practices: code style, workflow, TDD, BDD, etc.
- **The agent does not decide for me.** It prompts me for decisions, presents options, and lets me steer.
- **Sources I will point the agent to:**
  - another project of mine, where a large part of the best practices / "software factory" is already written down (I will provide the path),
  - a specific Claude session in which I worked on TDD and BDD and from which I want to carry over knowledge (I will provide the link).

### 9.4 Manual steps (preliminary)

| Area | What is needed |
|---|---|
| Enable Banking | create an account, register the application, one-time connection to my Revolut account |
| Azure | initial setup of resources (App Service, Key Vault, Cosmos DB, etc.), storing secrets |
| Entra ID | register the application, allow accounts (daughter, test accounts) according to the chosen mechanism |
| GitHub | create the repository on GitHub, connect GitHub Actions to Azure |
| Handover | send the link to my daughter, verify that she can sign in, sees the data and receives notifications |

### 9.5 OpenSpec changes (preliminary)

Rule: **project foundations first, then specific use cases and endpoints.**

1. **Backend: project setup.** Solution, Aspire, test infrastructure.
2. **Frontend: project setup.** Vite + React + TypeScript, Tailwind, Radix, PWA, test infrastructure.
3. **Enable Banking adapter.**
4. **API:** endpoints for balance and transactions, including authorization.
5. **Frontend:** sign-in and account detail.
6. **Deployment:** Docker image and GitHub Actions → Azure. *(Added: follows from the requirement to deploy via GitHub Actions. Could also be part of the foundations.)*
7. **Push notifications.** On the backend: periodic account check, change detection, storing the state and subscriptions (Cosmos DB), and sending Web Push. On the frontend: enabling notifications and receiving them in the service worker. *(Probably split into backend and frontend.)*

The session creating the roadmap may split or merge changes so that each one fits a single session.

**Recommended order:** notifications only after the basic version (balance and transactions) is deployed, so that my daughter sees the data as soon as possible.

**Dependencies on manual steps:**

- The adapter can be developed against mocks, but verification against the real API requires the Enable Banking setup to be complete.
- Sign-in requires the application registration in Entra ID.
- Deployment requires the Azure setup and the connection to GitHub.
- Notifications require the database and the VAPID keys stored in Key Vault.

### 9.6 Decommissioning *(proposal, added)*

After the two-month period ends:

- revoke the consent in Enable Banking,
- remove access for the allowed accounts,
- delete the Azure resources, including the database with the stored account data.

## 10. Open questions

To be decided in Phase 0 or in the relevant OpenSpec change.

1. **Account allowlisting mechanism:** an allowlist of email addresses in the repository, or invitations (guests) in Entra ID. Invitations were originally rejected, most likely because of the Apple sign-in that was being considered at the time and has since been dropped, so they are back on the table. With an allowlist, keep in mind that the email addresses are visible to anyone who can see the repository.
2. **Authentication flow:** SPA with MSAL and a bearer token, or BFF with a cookie.
3. **Frontend hosting:** the assumption is a single container in which the backend serves the frontend build. To be confirmed.
4. **Job hosting, registry and costs:** an hourly job inside App Service requires Always On, which is not available on the Free tier. An alternative is, e.g., Azure Functions with a timer trigger. Also open: GitHub Container Registry or Azure Container Registry, and the App Service tier.
5. **Enable Banking** *(risk)*: consent validity (will it last the full 2 months, or will it need to be renewed?) and the pricing plan for personal use. To be verified.
6. **Bank request limits** *(risk, may affect the notification design)*: PSD2 limits the number of requests made without the account holder present (typically 4 per day), whereas an hourly check means 24 requests per day. Verify how this applies to Revolut via Enable Banking, and adjust the check frequency or the handling of stored data (cache) accordingly.
7. **Transactions:** how much history to show, pagination or infinite scroll, which details to show for a transaction (date, amount, counterparty, description…).
8. **Notification content:** what exactly counts as a "change" (new transaction, balance change), what the notification contains (amounts and merchants will be visible on the lock screen too), and who it is sent to.
9. **Push on iOS** *(risk)*: if my daughter has an iPhone, Web Push only works for a PWA added to the home screen (iOS 16.4+). Verify which phone she has.
10. **PWA scope:** are installation on a phone and notifications enough, or is an offline mode also needed?
