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
| M1 | Enable Banking setup and verification of risks 5 and 6 | in progress | — | 2026-11-04 | Research done; findings and the user's decision on Q5, Q6 recorded in [ADR-0001-bank-data-access](../docs/adr/0001-bank-data-access.md) (outcomes below). Deviation from roadmap ch. 3, item 3: the user decided not to contact Enable Banking support. Next: Enable Banking account, application, Revolut values via `GET /aspsps`, account linking (scripts in `spikes/enable-banking/`) |
| F0-1 | Knowledge base and best practices | in progress | — | 2026-11-04 | Knowledge base written from a review of 40 DoseUp decisions (`D:\source\jakubbohm\DoseUp`): `docs/conventions/`, `docs/adr/`, `docs/software-factory.md`, `.claude/rules/`, `openspec/config.yaml`, `CLAUDE.md`. Remaining: the TDD/BDD part (`docs/conventions/testing.md`) in a separate session |
| F0-2 | Architecture decisions | todo | — | — | |
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
- **Outcome:** —
- **Record:** —
- **Date:** —
- **Impact on the roadmap:** —

### Q5 — Enable Banking consent validity and pricing *(risk)*

- **Step:** M1
- **Status:** verified (Revolut's exact value in Enable Banking to be confirmed via `GET /aspsps` during setup)
- **Outcome:** Revolut gives EU providers 180 days of consent — enough for the ~2-month operation with ~4 months to spare; Enable Banking is free for personal use of linked accounts registered by the account holder.
- **Record:** [ADR-0001-bank-data-access § Context — Consent validity and pricing](../docs/adr/0001-bank-data-access.md#consent-validity-and-pricing-q5)
- **Date:** 2026-11-04
- **Impact on the roadmap:** C10 most likely not needed (confirm from the actual `valid_until` after linking). The timing of the linking does not matter. C5 handles `EXPIRED_SESSION` and `REVOKED_SESSION`; the fallback is repeating the M1 linking (needs the account holder for SCA).

### Q6 — Bank request limits *(risk)*

- **Step:** M1
- **Status:** verified; decided by the user
- **Outcome:** without the account holder present, Revolut allows 4 requests a day per account, endpoint and consent. Decision: user-triggered reads are live and forward the signed-in user's real PSU headers; the background job runs 4 times a day without them; a database holds the downloaded transactions and the time of the daughter's last view; a notification only for changes since that view.
- **Record:** [ADR-0001-bank-data-access § Decision](../docs/adr/0001-bank-data-access.md#decision) (findings in § Context — Request limits)
- **Date:** 2026-11-04
- **Impact on the roadmap:**
  - C5: forward PSU headers from the incoming request; take the required headers from `GET /aspsps`; handle 429, expired and revoked sessions.
  - C7: live reads, no cache needed for UC2. Whether v1 already stores fetched data (e.g., as a fallback when a live read fails) is decided in F0-2.
  - C9: 4 runs a day from 06:00; notify only on changes since the daughter's last view. The time zone of the start time and whether the last view is tracked per user are decided there (Q8).
  - F0-2 / M3 / M6: no change forced. The job is needed only for v2, so job hosting can still be deferred to C9, and Cosmos DB stays in M6 unless F0-2 moves it to v1.

### Q7 — Transactions

- **Step:** C7
- **Status:** open
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
