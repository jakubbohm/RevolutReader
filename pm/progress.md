# RevolutReader — Progress

> Status of the steps in [`pm/roadmap.md`](roadmap.md) and outcomes of the open questions from [`pm/kickoff.md`](kickoff.md), ch. 10. Update when a step starts and when it ends.

## How to update

- **Status:** `todo`, `in progress`, `done`, `blocked`. For `blocked`, write in Notes what the step is waiting for.
- **Date:** the date of the last status change (YYYY-MM-DD).
- **OpenSpec change:** link to `openspec/changes/<name>/` while the change is in progress, and to `openspec/changes/archive/<date>-<name>/` after it is archived.
- **Notes:** short: what was done, deviations, follow-ups. Details belong in the OpenSpec change, an ADR or the conventions.
- **Open questions:** only the trail lives here — status, a one-line outcome, the link to the ADR that holds the findings, decision and rationale, the date, and the impact on roadmap steps ([docs/conventions/workflow.md § 2](../docs/conventions/workflow.md#2-decisions)).

## Step status

| ID | Step | Status | OpenSpec change | Date | Notes |
|---|---|---|---|---|---|
| M1 | Enable Banking setup and verification of risks 5 and 6 | done | — | 2026-11-04 | Research done; findings and the user's decision on Q5, Q6 recorded in [ADR-0001-bank-data-access](../docs/adr/0001-bank-data-access.md) (outcomes below). Deviation from roadmap ch. 3, item 3: the user decided not to contact Enable Banking support. Done: Enable Banking account, production application, Revolut account linked in the Control Panel (link expires 2026-12-04 → M9), Revolut values read via `GET /aspsps` (180 days; no required PSU headers). Decided: settled transactions kept from 2026-08-09 (ADR-0001 § Decision, item 6). API session authorised (valid until 2027-05-03) and history downloaded (116 settled transactions). Control Panel link still active next to the session (→ M9 needed). Smoke test passed: 6 balance reads with the owner's PSU headers, all HTTP 200 ([spikes/enable-banking/](../spikes/enable-banking/README.md), step 6). Expiring approvals and how to restore them: [docs/operations/expiring-approvals.md](../docs/operations/expiring-approvals.md). Closed by the user. Follow-ups: M9 by 2026-12-03; C5 confirms whether Revolut returns pending transactions and that the `ITAV` balance matches the Revolut app |
| F0-1 | Knowledge base and best practices | done | — | 2026-11-04 | Knowledge base written from a review of 40 DoseUp decisions (`D:\source\jakubbohm\DoseUp`): `docs/conventions/`, `docs/adr/`, `docs/software-factory.md`, `.claude/rules/`, `openspec/config.yaml`, `CLAUDE.md`. TDD/BDD part written from the user's 2026-10-22 design session and decided item by item: [testing.md](../docs/conventions/testing.md), `openspec/config.yaml` (TL;DRs, spec, design and task rules, apply/archive guidance), [workflow.md § 3, § 6](../docs/conventions/workflow.md#3-git), `.claude/skills/tdd-apply/`, `.claude/agents/`, `.claude/hooks/`, `.claude/rules/testing.md`, software-factory R-12 to R-21; Mock ASPSP spike [spikes/enable-banking-mock/](../spikes/enable-banking-mock/README.md). Closed by the user |
| D2 | Split the software-factory file | done | — | 2026-11-04 | `docs/software-factory.md` split into `docs/software-factory/`: [lessons.md](../docs/software-factory/lessons.md) (all entries R-1 … R-21, plus new R-22), [divergences.md](../docs/software-factory/divergences.md) (R-1, R-3, R-4, R-6, R-7, R-8, R-12, R-13, R-14, R-19: what the project gives up, when to switch back), [creating-handover-package.md](../docs/software-factory/creating-handover-package.md) (inventory of reusable artifacts + how to build the package). Deviation: the handover becomes a package, not a file copy (change log). References updated; R-4 lesson link corrected (it pointed at workflow.md; the decision is in configuration.md § Not adopted). After R-12, R-19 and R-14, the user delegated the placement of the remaining entries for this step only. Closed by the user |
| F0-2 | Architecture decisions | done | — | 2026-11-05 | Decided with the user, one by one, after background research (sources dated in each ADR): Q3 one container, one origin ([ADR-0002](../docs/adr/0002-frontend-hosting.md)); Q2 BFF login cookie + Q9 iPhone 13 Pro, Home Screen app ([ADR-0003](../docs/adr/0003-sign-in.md)); Q1 email allowlist, personal Microsoft accounts only, list in Key Vault ([ADR-0004](../docs/adr/0004-account-allowlist.md)); storage: Azure Table Storage in the app's own storage account, not the shared Cosmos DB (Neon also weighed) ([ADR-0005](../docs/adr/0005-data-storage.md)); Q4 Container Apps scaling to zero, ghcr.io public image, Logic App as the job's clock ([ADR-0006](../docs/adr/0006-hosting-registry-and-job.md)). Reversal: App Service Free accepted first, switched to Container Apps the same day (recorded in ADR-0006 and software-factory R-27). Deviation: Apple sign-in was considered and declined (stays out of scope); Key Vault widened to non-public values. Resource list (manual vs Bicep): [workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure); region Germany West Central. Roadmap updated (change log: M6 removed). Software factory: R-23 to R-27. Closed by the user |
| M2 | GitHub repository | done | — | 2026-11-05 | Public repository [jakubbohm/RevolutReader](https://github.com/jakubbohm/RevolutReader) (the allowlist stays in Key Vault, [ADR-0004](../docs/adr/0004-account-allowlist.md)). History checked before the first push: no secrets, keys, email addresses or bank data; the commit email is the GitHub noreply address. `origin` set, `main` pushed. Squash merge only, the squash commit takes the PR title and the branch's commit messages, branches deleted on merge ([workflow.md § 3](../docs/conventions/workflow.md#3-git)); this close-out PR is the first live check of the squash setting. Gap found: no step made CI checks required, so C2 adds the rule on `main` (change log). Closed by the user |
| C1 | `c001-add-backend-foundation` | done | [openspec/changes/archive/2026-11-05-c001-add-backend-foundation/](../openspec/changes/archive/2026-11-05-c001-add-backend-foundation/) | 2026-11-05 | Decided in explore: walking skeleton = health check + ProblemDetails 404; setup commit before `/tdd-apply`; C# 15 union types confirmed, the Result type moves to C5 (change log); .NET 11 RC3, GA in a follow-up PR; Aspire 13.6.4, TUnit 1.80.0; the template's default HTTP retries removed (ADR-0001). Implemented with the first `/tdd-apply` (`review=all`): `GET /health` (FastEndpoints, anonymous, `text/plain` `Healthy`), problem descriptions for body-less errors (404 first), the test foundation (harness in `Production`, traceability check with self-tests, manual list, anonymous-endpoint check), `CLAUDE.md` § Commands. Measured: first app copy ≈ 0.25 s, further copies tens of ms, acceptance project ≈ 0.9 s ([testing.md](../docs/conventions/testing.md#acceptance-test-harness-the-app-runs-inside-the-test-process)). Hook check: the implementer's frontmatter hook never ran; moved to `.claude/settings.json` with an `agent_type` check, probes confirm it (lesson R-33). Deviations (design.md, `.tdd-state.md`): FastEndpoints 9.0.0-beta.7 instead of 8.3.0, which maps an anonymous `_test_url_cache_` route; CA1515 off for tests and the API, classes stay public (T1 added); the api-errors requirement made precise (callers that accept JSON); an extra test that the harness runs in `Production`. Software factory: R-29 to R-33. Archived 2026-11-05: main specs `service-health`, `api-errors`. Closed by the user. Follow-ups: the PR `feat: add backend foundation (C1)` (review and squash merge); a follow-up PR to .NET 11 GA and FastEndpoints with it |
| C2 | `c002-add-ci-pipeline` | done | [openspec/changes/archive/2026-11-05-c002-add-ci-pipeline/](../openspec/changes/archive/2026-11-05-c002-add-ci-pipeline/) | 2026-11-05 | Decided in explore (design.md D1–D8): a tooling-only change (`skip_specs`, applied directly, commits tagged `[apply]`); CI on pull requests only; `build-and-test` and an inline `pr-title` check; a ruleset on `main` (PR, both checks, up to date, no bypass) kept as a file in `docs/operations/`; proven by a probe PR; CodeQL and dependency review left out (divergence). Applied directly (`/opsx:apply`, `[apply]` commits per group): the tooling-only exception in `openspec/config.yaml`, `CLAUDE.md`, testing.md and [workflow.md § 3, § 6](../docs/conventions/workflow.md#6-openspec); `ci.yml` (`build-and-test`) and `pr-title.yml` (`pr-title`), listed in [workflow.md § 4](../docs/conventions/workflow.md#4-cicd); ruleset 26623567 on `main` from [main-ruleset.json](../docs/operations/main-ruleset.json) with [its page](../docs/operations/main-ruleset.md), and the `CLAUDE.md` rule that Claude never changes it without the user's go. First Linux run on [#5](https://github.com/jakubbohm/RevolutReader/pull/5): green in 38 s. Probe [#6](https://github.com/jakubbohm/RevolutReader/pull/6): a failing test and an invalid title each blocked it and the merge was refused; with both fixed it was mergeable; closed without merging. Software factory: R-34 to R-36. Deviations: `checkout` keeps no token (`persist-credentials: false`); the ruleset file also carries two parameters GitHub fills in itself; `gh pr merge --admin` was not tried (the read-back reports that the owner cannot bypass). Archived 2026-11-05: no specs (`skip_specs`), traceability check green. Closed by the user. Follow-up: squash merge of [#5](https://github.com/jakubbohm/RevolutReader/pull/5), the first merge through the ruleset |
| C3 | `cNNN-add-frontend-foundation` | todo | — | — | |
| M3 | Azure prerequisites for v1 | done | — | 2026-11-05 | In the owner's personal subscription; identifiers, rationale, commands and checks: [docs/operations/azure-prerequisites.md](../docs/operations/azure-prerequisites.md). Registered the Key Vault and Logic Apps providers; resource group `rg-revolutreader` (Germany West Central); deploy identity = user-assigned managed identity `id-revolutreader-deploy` with a federated credential for the `production` environment (GitHub's immutable subject format for repositories created after 2026-07-15); Contributor + Role Based Access Control Administrator limited to four data roles, on the resource group only; GitHub environment `production` (deploys from `main` only) with the four Azure variables. Software factory R-28. Closed by the user. Follow-ups: C4's first deploy is the first real login (if it fails, fix the subject per azure-prerequisites.md § Checks); a role beyond the four needs a manual change to the condition |
| C4 | `cNNN-add-deployment-pipeline` | todo | — | — | |
| M4 | Entra ID | done | — | 2026-11-05 | App registration "Dad's Card 🙂" (the user's name) in the owner's personal directory, personal Microsoft accounts only, owner = the owner's account; identifiers, rationale, commands and checks: [docs/operations/entra-id.md](../docs/operations/entra-id.md). Local redirect URIs on `localhost` (any port); `openid`, `profile`, `email` + the optional `email` claim. Checked against the personal-account sign-in service: the registered URI on a random port opens the sign-in page, an unregistered path is rejected. Deviation: no client secret, C6 creates it (change log, ADR-0003 amended). Test accounts: the owner's account (allowed) and a second personal Microsoft account the owner already has (not allowed, for C6's rejection check); addresses stay off the repo, C6's guided task asks for the list. Software factory R-24, R-25. Closed by the user. Follow-ups: the production redirect URIs after C4 (entra-id.md § Adding the production redirect URIs); C6 confirms the one-time consent screen on the iPhone |
| C5 | `cNNN-add-enable-banking-adapter` | todo | — | — | |
| C6 | `cNNN-add-user-login` (UC1) | todo | — | — | |
| C7 | `cNNN-add-account-detail` (UC2) | todo | — | — | |
| M5 | Handover v1 | todo | — | — | |
| C8 | `cNNN-add-push-subscriptions` (UC3, part 1) | todo | — | — | |
| C9 | `cNNN-add-account-change-notifications` (UC3, part 2) | todo | — | — | |
| M7 | Handover v2 | todo | — | — | |
| C10 | `cNNN-add-consent-renewal` (conditional) | todo | — | — | Needed only if the Q5 findings require it |
| M9 | Renew the Enable Banking account link (conditional, dated) | todo | — | — | **Needed. Deadline 2026-12-03** (the link expires 2026-12-04), then every 30 days. M1: the link stayed active next to the API session, so whether API access depends on it is unknown. How: [docs/operations/expiring-approvals.md § 1](../docs/operations/expiring-approvals.md#1-enable-banking-account-link) |
| D1 | Reinstatement guide | todo | — | — | |
| M8 | Decommissioning | todo | — | — | |
| T1 | Explore making the API's FastEndpoints classes internal (tech debt, low priority) | todo | — | — | Added in C1 (change log) |

### Milestones

| Milestone | Status | Date |
|---|---|---|
| v1: my daughter sees the balance and transactions | todo | — |
| v2: push notifications | todo | — |

## Decisions on open questions

Question status: `open`, `decided` (decision questions) or `verified` (questions answered by a finding: Q5, Q6, Q9). Each entry: step · status · one-line outcome · record (the ADR section with the details) · date · impact on the roadmap.

### Q1 — Account allowlisting mechanism

- **Step:** F0-2
- **Status:** decided
- **Outcome:** app registration in the owner's existing directory, personal Microsoft accounts only; the backend checks an email allowlist at sign-in and on every request; the list lives in Key Vault (production) and user-secrets (local), never in the public repo. No invitations, no External ID, no Apple.
- **Record:** [ADR-0004-account-allowlist § Decision](../docs/adr/0004-account-allowlist.md#decision)
- **Date:** 2026-11-05
- **Impact on the roadmap:** M2 may make the repository public. M4 sets the audience to personal accounts only and prepares the test accounts. C6 builds the check and a guided task puts the list into Key Vault and user-secrets. D1 restores the list. Key Vault now also holds non-public values ([configuration.md](../docs/conventions/configuration.md#where-each-value-lives)).

### Q2 — Authentication flow

- **Step:** F0-2
- **Status:** decided
- **Outcome:** BFF: the backend signs the user in (authorization code flow, ASP.NET Core's own handlers) and keeps a persistent HttpOnly login cookie (30 days, sliding); the browser never holds a Microsoft token; a 12-month client secret.
- **Record:** [ADR-0003-sign-in § Decision](../docs/adr/0003-sign-in.md#decision)
- **Date:** 2026-11-05
- **Impact on the roadmap:** M4 registers web redirect URIs and creates the client secret (kept for Key Vault, added to `docs/operations/expiring-approvals.md`). C6 builds the sign-in, persists the cookie's Data Protection keys in Blob Storage ([ADR-0006](../docs/adr/0006-hosting-registry-and-job.md#decision)), and checks the sign-in on the owner's iPhone from the Home Screen app before M5 (fallbacks in the ADR). C3 needs no sign-in library. C7/C8 write requests need CSRF protection (C6 picks the mechanism).

### Q3 — Frontend hosting

- **Step:** F0-2
- **Status:** decided
- **Outcome:** one container: the backend serves the built frontend, so both share one origin (no CORS, a sign-in cookie stays possible on the iPhone, settings come from the backend at runtime).
- **Record:** [ADR-0002-frontend-hosting](../docs/adr/0002-frontend-hosting.md)
- **Date:** 2026-11-05
- **Impact on the roadmap:** C3 serves the frontend from the backend and runs the Vite dev server in the AppHost with `/api` forwarding. C4 builds one image (Node stage + .NET stage). No change to the steps themselves.

### Q4 — Job hosting, registry and costs

- **Step:** F0-2 (job hosting decided there too, not deferred to C9)
- **Status:** decided
- **Input (from F0-1 testing, 2026-11-04):** tests start the background check directly, so the check must be ordinary app code that the scheduler only calls ([docs/conventions/testing.md § Time and the background job](../docs/conventions/testing.md#time-and-the-background-job)).
- **Input (from D2, 2026-11-04):** hosting the job in its own process (outside the API) removes one reason for running acceptance tests inside the test process; weigh it against [divergences.md R-12](../docs/software-factory/divergences.md) before choosing.
- **Outcome:** Azure Container Apps (Consumption, scaling to zero, max 1 replica) within the free grant; Data Protection keys persisted in Blob Storage so a wake doesn't sign users out; ghcr.io with a public image; the job is a Logic App (Consumption) that calls a protected, retry-safe endpoint in the app 4 times a day, so the app stays one process (R-12 holds). Cost about €0 plus pennies. If the ~20 s cold start is too slow: one always-on replica at the idle rate (roughly $4–6/month), never a night-time scale rule (it bills the day at the active rate). App Service Free was accepted first and reversed the same day.
- **Record:** [ADR-0006-hosting-registry-and-job § Decision](../docs/adr/0006-hosting-registry-and-job.md#decision)
- **Date:** 2026-11-05
- **Impact on the roadmap:** M3 creates the resource group in Germany West Central. C4 deploys the Container Apps environment and app with the public ghcr.io image, picks the log destination and measures the cold start. C6 adds the storage account with the Data Protection keys. C9 adds the Logic App and the endpoint (auth, time zone, times). M6 removed (change log). No container registry resource.

### Q5 — Enable Banking consent validity and pricing *(risk)*

- **Step:** M1
- **Status:** verified
- **Outcome:** Revolut gives EU providers 180 days of consent (Enable Banking's maximum for Revolut; the API session authorised in M1 runs until 2027-05-03), enough for the operation (at least until the end of 2026). But the Control Panel account link that activates restricted mode lasts only 30 days (expires 2026-12-04). Enable Banking is free for personal use of linked accounts registered by the account holder.
- **Record:** [ADR-0001-bank-data-access § Context — Consent validity and pricing](../docs/adr/0001-bank-data-access.md#consent-validity-and-pricing-q5)
- **Date:** 2026-11-04
- **Impact on the roadmap:** C10 is not needed (the API session runs until 2027-05-03), but stays in the roadmap at the user's request (2026-11-04). M9 is needed: renew the account link by 2026-12-03 (it stayed active next to the API session, so dependence is unknown). Every expiring approval and how to restore it: [docs/operations/expiring-approvals.md](../docs/operations/expiring-approvals.md). C5 handles `EXPIRED_SESSION` and `REVOKED_SESSION`; the fallback is repeating the M1 linking (needs the account holder for SCA).

### Q6 — Bank request limits *(risk)*

- **Step:** M1
- **Status:** verified; decided by the user
- **Outcome:** without the account holder present, Revolut allows 4 requests a day per account, endpoint and consent; with the owner's PSU headers, 6 balance reads in a row all succeeded (M1 smoke test). Decision: user-triggered reads are live and forward the signed-in user's real PSU headers; the background job runs 4 times a day without them; a database holds the downloaded transactions and the time of the daughter's last view; a notification only for changes since that view.
- **Record:** [ADR-0001-bank-data-access § Decision](../docs/adr/0001-bank-data-access.md#decision) (findings in § Context — Request limits)
- **Date:** 2026-11-04
- **Impact on the roadmap:**
  - C5: forward PSU headers from the incoming request; take the required headers from `GET /aspsps`; handle 429, expired and revoked sessions.
  - C7: stored settled transactions plus a live read of the balance and the recent window (Decision, item 6), including the import of the M1 history file. C7 may need splitting, with the transaction store first (roadmap C7 notes): agree with the user when C7 is planned.
  - C9: 4 runs a day from 06:00; notify only on changes since the daughter's last view. The time zone of the start time and whether the last view is tracked per user are decided there (Q8).
  - F0-2 / M3: a database is needed already in v1 (Decision, item 6). F0-2 picks the storage; M3 prepares access to the shared Cosmos DB account if that is the choice. The job is needed only for v2, so job hosting can still be deferred to C9. → F0-2 (2026-11-05): Azure Table Storage in the app's own storage account, in Bicep; no shared Cosmos DB access needed ([ADR-0005-data-storage](../docs/adr/0005-data-storage.md)).

### Q7 — Transactions

- **Step:** C7
- **Status:** open
- **Input (from M1, 2026-11-04):** history from 2026-08-09, kept for the whole operation; settled transactions stored, pending ones read live ([ADR-0001-bank-data-access § Decision](../docs/adr/0001-bank-data-access.md#decision), item 6).
- **Outcome:** —
- **Record:** —
- **Date:** —
- **Impact on the roadmap:** —

### Q8 — Notification content

- **Step:** C9
- **Status:** open
- **Input (from Q6, 2026-11-04):** notify only if something changed since the daughter's last view ([ADR-0001-bank-data-access § Decision](../docs/adr/0001-bank-data-access.md#decision)).
- **Outcome:** —
- **Record:** —
- **Date:** —
- **Impact on the roadmap:** —

### Q9 — Push on iOS *(risk)*

- **Step:** F0-2
- **Status:** verified
- **Outcome:** the daughter has an iPhone 13 Pro (supports iOS 26; exact version confirmed at M5); the owner has an iPhone for testing. Web Push works only in the app added to the Home Screen (iOS 16.4+), so she uses it from there and sign-in must work there too.
- **Record:** [ADR-0003-sign-in § Context — The main user's phone](../docs/adr/0003-sign-in.md#the-main-users-phone-q9)
- **Date:** 2026-11-05
- **Impact on the roadmap:** C3 makes the PWA installable on iOS. C6 tests sign-in from the Home Screen app on the owner's iPhone. C8 subscribes to push from the Home Screen app. M5/M7 install the app to the Home Screen and confirm the iOS version.

### Q10 — PWA scope

- **Step:** C3
- **Status:** open
- **Outcome:** —
- **Record:** —
- **Date:** —
- **Impact on the roadmap:** —

## Roadmap change log

| Date | Change | Reason |
|---|---|---|
| 2026-11-04 | Roadmap created | Kickoff ch. 9 |
| 2026-11-04 | OpenSpec change names follow `cNNN-verb-topic` (e.g. `cNNN-add-backend-foundation`; the number is assigned at creation) | F0-1: convention adopted from DoseUp ([workflow.md § 6](../docs/conventions/workflow.md#6-openspec)) |
| 2026-11-04 | Manual Azure steps reduced to what cannot be automated: M3 → "Azure prerequisites for v1" (subscription, deploy identity, shared resources), M6 → "Azure prerequisites for notifications" (shared Cosmos DB account, VAPID keys). The app's own resources move into Bicep, deployed by CD as a deployment stack: C4 (app resources + guided Key Vault secret task), C8 (notification resources + VAPID secret task), C9 (job hosting resources). M4's redirect URI now comes from C4; M8 deletes the stack | F0-1: the user corrected the roadmap's misunderstanding — manual only for what must be manual ([workflow.md § 5](../docs/conventions/workflow.md#5-infrastructure)) |
| 2026-11-04 | M1 scripts go into `spikes/enable-banking/` instead of outside the repository | F0-1: spike convention adopted from DoseUp ([workflow.md § 7](../docs/conventions/workflow.md#7-spikes)) |
| 2026-11-04 | C7 starts with one Claude Design mockup of the account screen | F0-1 ([workflow.md § 8](../docs/conventions/workflow.md#8-design)) |
| 2026-11-04 | Decisions on open questions go into ADRs; `pm/progress.md` keeps one-line outcomes and links. Q5/Q6 details moved to ADR-0001-bank-data-access | F0-1 ([workflow.md § 2](../docs/conventions/workflow.md#2-decisions)) |
| 2026-11-04 | Smaller additions: C1 creates the build conventions and checks C# union support; C2 lints PR titles; C3 adds ESLint/Prettier, the Radix import rule and the generated API client; M2 sets squash-only merges with branch deletion; M8 hands the software-factory deposit over to DoseUp | F0-1: follow from the adopted conventions |
| 2026-11-04 | Added M9 "Renew the Enable Banking account link" (manual, conditional, deadline 2026-12-03, then every 30 days). Operating period: at least until the end of 2026 | M1: the Control Panel link is valid for only 30 days, with no option for longer; the user asked for the renewal step |
| 2026-11-04 | Added D1 "Reinstatement guide" (new step type: Documentation) before M8; M8 now depends on D1. Every step that creates, renews or changes an approval, a secret or a hand-made setting updates `docs/operations/expiring-approvals.md` (roadmap § 1). C10 stays although M1 found it not needed. M8 exports no stored transactions: a reinstated app downloads the history right after its new approval | M1: the user expects to reactivate the app after decommissioning and wants guidance for when every secret, approval and resource is gone |
| 2026-11-04 | M2 becomes a dependency of C1 (and sets the squash commit message to include the branch's commits); C1 also builds the test foundation (three test projects, in-process harness with a walking-skeleton scenario, traceability test) and is the first `/tdd-apply` run (`review=all`); C3 adds the frontend scenario tags to the traceability test; C5 tests against the local fake bank server, checks on demand against the Mock ASPSP and develops locally against it (`review=all`); OpenSpec changes are applied with `/tdd-apply` | F0-1 TDD/BDD part: decisions in [docs/conventions/testing.md](../docs/conventions/testing.md) and [workflow.md § 3](../docs/conventions/workflow.md#3-git); the user approved M2 before C1 with the commit-tag proposal |
| 2026-11-04 | Added D2 "Split the software-factory file" (Documentation) right after F0-1: one file for the lessons transferred to the software factory, one for this project's divergences from it. The Documentation step type now also covers restructuring documents | F0-1: the user asked for it while recording the in-process test harness as a project-only exception (software-factory R-12) |
| 2026-11-04 | D2 and M8: the handover to the software factory becomes a package built at the end (the lessons plus the reusable artifacts themselves) instead of copying the lessons file; D2 adds `docs/software-factory/creating-handover-package.md` with an inventory of reusable artifacts that every step keeps current (roadmap § 1) | D2: the user — the handover is a process; the reusable work lives in artifacts (e.g. the test-first workflow: testing.md, the `tdd-apply` skill, the agents, the hook), which the package includes instead of copies (software-factory R-22) |
| 2026-11-05 | F0-2 impact: **M6 removed** (no shared Cosmos DB access, no manual job part; C8's guided task generates and stores the VAPID keys; C8 and C9 no longer depend on M6). M3 creates the resource group in Germany West Central and drops the shared Cosmos DB access. C4: Azure Container Apps scaling to zero (App Service Free was accepted first and reversed the same day) and a public ghcr.io image instead of a container registry, plus the log destination and measuring the cold start. C6 adds the storage account with the Data Protection keys (Blob Storage) and ends with the iPhone Home Screen sign-in check. C7 adds the tables. C8 stores subscriptions in a table, tests on Azurite. M4's redirect URI comes from the app's URL (C4). C9: the Logic App clock and a protected endpoint; it no longer decides job hosting. M8: no shared resources to clean; purge the deleted Key Vault, delete the resource group and the app registration. Roadmap § 3 and § 5 tables updated | F0-2 decisions ([ADR-0002](../docs/adr/0002-frontend-hosting.md) … [ADR-0006](../docs/adr/0006-hosting-registry-and-job.md)); approved by the user |
| 2026-11-05 | C2 also adds a rule on `main` (a ruleset) that requires a pull request and makes every CI check required; later changes add their checks to it | M2: no step turned on [workflow.md § 4](../docs/conventions/workflow.md#4-cicd) ("every CI check blocks the merge"); possible because the repository is public on the free plan; approved by the user |
| 2026-11-05 | C5 builds the Result type for expected failures (a C# 15 union); C1 only verifies and records its shape and starts the case → status table | C1 planning: C# 15 union types confirmed for .NET 11 (Microsoft Learn, 2026-10-23); nothing in C1 returns an expected failure, so a test-first run has nothing to build the type from; approved by the user |
| 2026-11-05 | The Entra client secret moves from M4 to C6: C6's guided task creates it straight into Key Vault and the AppHost's user-secrets, together with the allowlist. M4 creates no secret | M4: the user chose it so the secret never sits in a file and its 12 months start when it is first needed ([ADR-0003-sign-in](../docs/adr/0003-sign-in.md) amended) |
| 2026-11-05 | Added T1 "Explore making the API's FastEndpoints classes internal" (new step type: Tech debt, low priority, before M8) | C1 group 2: CA1515 ("make classes internal") is switched off for the test projects and the API, because `internal` classes trip CA1812 where TUnit and FastEndpoints create them, and a public endpoint makes its handler and request/response classes public too; the user kept the exceptions for speed and asked for a low-priority exploration |
| 2026-11-05 | C2's CI runs on pull requests only (opened, reopened, every new push), not "on every push and pull request" | C2 planning (c002 design.md D2): a branch without a PR is work in progress, a run on `main` after the merge blocks nothing, and every commit on a PR branch would otherwise run twice; approved by the user |
| 2026-11-05 | Design for every screen instead of one mockup for C7: the design system "Tarjeta Papá" (made by the user in Claude Design, link in [workflow.md § 8](../docs/conventions/workflow.md#8-design)) is an input of C3; the Screens design (one canvas of 30 screens, made by the user, link in the same section) is an input of C6, C7 and C8. A visual change starts in the design, then the code follows | The user, while preparing C3; reverses F0-1's single mockup (software-factory [R-7](../docs/software-factory/lessons.md)) |