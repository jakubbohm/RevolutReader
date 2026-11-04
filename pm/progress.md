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
| F0-2 | Architecture decisions | todo | — | — | Input from M1: a database is needed already in v1 ([ADR-0001-bank-data-access § Decision](../docs/adr/0001-bank-data-access.md#decision), item 6) |
| M2 | GitHub repository | todo | — | — | |
| C1 | `cNNN-add-backend-foundation` | todo | — | — | |
| C2 | `cNNN-add-ci-pipeline` | todo | — | — | |
| C3 | `cNNN-add-frontend-foundation` | todo | — | — | |
| M3 | Azure prerequisites for v1 | todo | — | — | |
| C4 | `cNNN-add-deployment-pipeline` | todo | — | — | |
| M4 | Entra ID | todo | — | — | |
| C5 | `cNNN-add-enable-banking-adapter` | todo | — | — | |
| C6 | `cNNN-add-user-login` (UC1) | todo | — | — | |
| C7 | `cNNN-add-account-detail` (UC2) | todo | — | — | |
| M5 | Handover v1 | todo | — | — | |
| M6 | Azure prerequisites for notifications | todo | — | — | |
| C8 | `cNNN-add-push-subscriptions` (UC3, part 1) | todo | — | — | |
| C9 | `cNNN-add-account-change-notifications` (UC3, part 2) | todo | — | — | |
| M7 | Handover v2 | todo | — | — | |
| C10 | `cNNN-add-consent-renewal` (conditional) | todo | — | — | Needed only if the Q5 findings require it |
| M9 | Renew the Enable Banking account link (conditional, dated) | todo | — | — | **Needed. Deadline 2026-12-03** (the link expires 2026-12-04), then every 30 days. M1: the link stayed active next to the API session, so whether API access depends on it is unknown. How: [docs/operations/expiring-approvals.md § 1](../docs/operations/expiring-approvals.md#1-enable-banking-account-link) |
| D1 | Reinstatement guide | todo | — | — | |
| M8 | Decommissioning | todo | — | — | |

### Milestones

| Milestone | Status | Date |
|---|---|---|
| v1: my daughter sees the balance and transactions | todo | — |
| v2: push notifications | todo | — |

## Decisions on open questions

Question status: `open`, `decided` (decision questions) or `verified` (questions answered by a finding: Q5, Q6, Q9). Each entry: step · status · one-line outcome · record (the ADR section with the details) · date · impact on the roadmap.

### Q1 — Account allowlisting mechanism

- **Step:** F0-2
- **Status:** open
- **Outcome:** —
- **Record:** —
- **Date:** —
- **Impact on the roadmap:** —

### Q2 — Authentication flow

- **Step:** F0-2
- **Status:** open
- **Outcome:** —
- **Record:** —
- **Date:** —
- **Impact on the roadmap:** —

### Q3 — Frontend hosting

- **Step:** F0-2
- **Status:** open
- **Outcome:** —
- **Record:** —
- **Date:** —
- **Impact on the roadmap:** —

### Q4 — Job hosting, registry and costs

- **Step:** F0-2 (job hosting may move to C9)
- **Status:** open
- **Input (from F0-1 testing, 2026-11-04):** tests start the background check directly, so the check must be ordinary app code that the scheduler only calls ([docs/conventions/testing.md § Time and the background job](../docs/conventions/testing.md#time-and-the-background-job)).
- **Input (from D2, 2026-11-04):** hosting the job in its own process (outside the API) removes one reason for running acceptance tests inside the test process; weigh it against [divergences.md R-12](../docs/software-factory/divergences.md) before choosing.
- **Outcome:** —
- **Record:** —
- **Date:** —
- **Impact on the roadmap:** —

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
  - F0-2 / M3: a database is needed already in v1 (Decision, item 6). F0-2 picks the storage; M3 prepares access to the shared Cosmos DB account if that is the choice. The job is needed only for v2, so job hosting can still be deferred to C9.

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
- **Status:** open
- **Outcome:** —
- **Record:** —
- **Date:** —
- **Impact on the roadmap:** —

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
