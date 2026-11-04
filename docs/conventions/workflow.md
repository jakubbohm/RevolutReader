# RevolutReader — Workflow

**Status:** decided in F0-1 (2026-11-04), from a review of the DoseUp workflow; where this project deliberately differs, see [docs/software-factory.md](../software-factory.md).

## 1. Where knowledge lives

| What | Where |
|---|---|
| Why: goals, scope, use cases, open questions | `pm/kickoff.md` |
| Plan and status | `pm/roadmap.md`, `pm/progress.md` |
| Decisions with lasting effect | `docs/adr/` |
| How: conventions | `docs/conventions/` |
| Exactly what the system does | `openspec/specs/` (after a change is archived) |
| Keeping it running and bringing it back: expiring approvals and how to restore them, the reinstatement guide (roadmap D1) | `docs/operations/` |
| Evidence from experiments and verifications | `spikes/<topic>/` |
| Lessons for the future software factory | `docs/software-factory.md` |

- **Each fact has one home;** everything else links to it, never copies it.
- **CLAUDE.md stays thin:** working rules and pointers, no bulk content.
- **Cite documents by their full descriptive name:** `ADR-0001-bank-data-access`, `docs/conventions/configuration.md § Binding` — no opaque ids. Roadmap step ids (C5, M1), use cases (UC1–UC3) and open questions (Q1–Q10) are fine; `pm/` defines them.

## 2. Decisions

- **A decision with lasting, cross-cutting effect is an ADR** in `docs/adr/` (template in [docs/adr/README.md](../adr/README.md)): architecture, external services and their terms, data handling, anything later steps must respect. The research findings a decision rests on go into the ADR's Context, with sources and the date they were verified.
- **`pm/progress.md` keeps only the trail:** per open question, its status, a one-line outcome, the link to the ADR section, the date, and the impact on roadmap steps. The details live only in the ADR.
- A decision local to one change lives in that change's `design.md`; a convention lives in `docs/conventions/`.
- **Reversing a decision:** a new ADR that supersedes the old one (the old one is marked *Superseded by …*, never deleted), plus a software-factory entry (§ 10).
- The user makes every decision; Claude proposes (CLAUDE.md § Working rules).

## 3. Git

- **Trunk-based:** short-lived branches, typically one per OpenSpec change. Branch name `<type>/<change-id-or-topic>`, where `<type>` is the Conventional Commit type of the eventual PR title.
- **PRs always, even solo,** so every CI check runs. **Squash merge only;** the PR title is a Conventional Commit, linted in CI. A branch is never continued after its PR merges (with squash, git cannot see that it was merged).
- No automated releases or changelog.
- **Before the GitHub repository exists (M2) there are no PRs:** commit directly to `main` with Conventional Commit messages. From M2 on, the rules above apply.
- Claude commits or pushes only when the user asks.
- **In-repo memory (`.claude/memory/`) is versioned:** memory edits are part of the task's commit and branch, never left uncommitted.

## 4. CI/CD

- **Every CI check blocks the merge or is deleted** — no advisory checks.
- **PR CI builds and tests only:** it publishes nothing and holds no deployment credentials.
- **Artifacts are built once from the merge commit on `main`** (the container image, tagged with the commit SHA) and that exact artifact is deployed.
- **One environment, production;** every merge to `main` deploys.
- The concrete checks are added by C2 (build and tests), C3 (frontend) and C4 (deployment); test-related checks follow [testing.md](testing.md).

## 5. Infrastructure

- **Manual only for what cannot be automated:** access to the Azure subscription; the Entra application registration; the identity GitHub Actions deploys with (OIDC federated credential and role assignment — CD cannot create its own trust); **shared resources and access to them** (e.g., the Cosmos DB free-tier account, which exists once per subscription and is therefore shared across the owner's projects); putting hand-provisioned secret values into Key Vault ([configuration.md § Hand-provisioned secrets](configuration.md#hand-provisioned-secrets)). Claude guides each manual step; non-secret identifiers are recorded in the repository.
- **Everything else is hand-authored Bicep in `infra/`,** deployed by CD as an **Azure Deployment Stack** with `--action-on-unmanage deleteResources`: a resource removed from the Bicep files is deleted from Azure on the next deployment. No portal or ad-hoc CLI changes to anything the stack manages.
- **Shared resources are referenced in Bicep as `existing`**, never managed by this project's stack, so the stack can never delete them. If the project needs its own child resource inside a shared one (e.g., a database in the shared Cosmos DB account), F0-2 decides it; verify in C4 how the stack treats such child resources before relying on it.
- Environment-specific values live in `.bicepparam`. GitHub Actions signs in to Azure via OIDC (no stored credential); the app uses a managed identity with the narrowest built-in roles, assigned in Bicep.
- **The Aspire AppHost models local orchestration only.** A change touching its resource graph includes an explicit "update Bicep" task.
- **Decommissioning** (M8): delete the stack (removes every project-owned resource), then the manual parts — access to shared resources and this project's data in them, the deploy identity, the Entra registration.
- Which resources exist and which of them are shared: F0-2 (Q3, Q4).

## 6. OpenSpec

- Behavior changes go through OpenSpec; trivial non-behavioral fixes may be direct.
- **Change ids: `cNNN-verb-topic`** (e.g., `c001-add-backend-foundation`). NNN is the next number across `openspec/changes/` and the archive, never reset; the leading letter satisfies the OpenSpec CLI's letter-first name rule. Change names in the roadmap are proposals; the number is assigned when the change is created.
- **Each change starts on its own branch** off the freshest `main`, created before any artifact is drafted (proposal rule in `openspec/config.yaml`).
- **Proposals cite** the use case (UC1–UC3, kickoff ch. 5), the roadmap step (e.g., C6) and every open question they apply or decide (Q1–Q10), and **include a Non-goals section.**
- **Tasks finish in one sitting** (~2 h at most), each ending with build and tests green.
- **Explicit tasks:** "regenerate TS client" when the API contract changes ([README.md § API contract](README.md#api-contract)); "update Bicep + `.bicepparam`" when the AppHost resource graph or Azure topology changes; declaring every new setting in `appsettings.json` ([configuration.md](configuration.md)); a guided manual task for every hand-provisioned secret.
- Cross-cutting decisions made inside a change become ADRs.
- The last tasks of a change update `pm/progress.md`, and `CLAUDE.md` if build, test or run commands changed.
- How TDD and BDD shape specs and tasks: [testing.md](testing.md).

## 7. Spikes

- **Throwaway proofs of concept and verification scripts live in `spikes/<topic>/`:** a `README.md` (the question, what was done, the verdict — GO / NO-GO or findings — and the date), the scripts, and an `evidence/` folder with captured outputs.
- Spikes stay outside the solution, the package set and CI; deleting `spikes/` changes nothing else.
- **Never commit secrets or bank data:** no private keys, tokens, account identifiers, balances or transactions. Redact evidence before committing. Key files are gitignored.
- Scripts the user runs are PowerShell 7 (CLAUDE.md § Working rules).
- Adopting anything from a spike into `src/` is a separate decision, made in an OpenSpec change.

## 8. Design

- **Only the account detail screen (C7) gets a Claude Design mockup** before implementation; the sign-in and other small UI are built directly.
- The repo owns the design tokens and components; a design handoff is translated onto them by the change, never committed verbatim. A genuinely new token or component is flagged in the change's design as a decision.

## 9. Project management

- Work items live in `pm/roadmap.md` and `pm/progress.md`, not in a tracker. CLAUDE.md § Project management says how sessions use them.
- Changing the roadmap needs the user's approval; every change is logged in `pm/progress.md` § Roadmap change log.

## 10. Software factory

- `docs/software-factory.md` collects, for the user's future software factory, only decisions where this project **diverges** from DoseUp, **reverses** one of its own decisions, or answers a question DoseUp never faced (**new**).
- Add the entry in the same change or session that makes the decision. The entry format and the handover to DoseUp at the end of the project (M8) are described in that file.
