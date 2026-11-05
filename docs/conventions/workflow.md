# RevolutReader — Workflow

**Status:** decided in F0-1 (2026-11-04), from a review of the DoseUp workflow; where this project deliberately differs, see [docs/software-factory/divergences.md](../software-factory/divergences.md).

## 1. Where knowledge lives

| What | Where |
|---|---|
| Why: goals, scope, use cases, open questions | `pm/kickoff.md` |
| Plan and status | `pm/roadmap.md`, `pm/progress.md` |
| Decisions with lasting effect | `docs/adr/` |
| How: conventions | `docs/conventions/` |
| Exactly what the system does | `openspec/specs/` (after a change is archived) |
| Keeping it running and bringing it back: expiring approvals and how to restore them, the hand-made Azure and GitHub setup, the reinstatement guide (roadmap D1) | `docs/operations/` |
| Evidence from experiments and verifications | `spikes/<topic>/` |
| Lessons for the future software factory, this project's divergences from it, and the handover package | `docs/software-factory/` (§ 10) |

- **Each fact has one home;** everything else links to it, never copies it.
- **CLAUDE.md stays thin:** working rules and pointers, no bulk content.
- **Cite documents by their full descriptive name:** `ADR-0001-bank-data-access`, `docs/conventions/configuration.md § Binding` — no opaque ids. Roadmap step ids (C5, M1), use cases (UC1–UC3) and open questions (Q1–Q10) are fine; `pm/` defines them.

## 2. Decisions

- **A decision with lasting, cross-cutting effect is an ADR** in `docs/adr/` (template in [docs/adr/README.md](../adr/README.md)): architecture, external services and their terms, data handling, anything later steps must respect. The research findings a decision rests on go into the ADR's Context, with sources and the date they were verified.
- **`pm/progress.md` keeps only the trail:** per open question, its status, a one-line outcome, the link to the ADR section, the date, and the impact on roadmap steps. The details live only in the ADR.
- A decision local to one change lives in that change's `design.md`; a convention lives in `docs/conventions/`.
- **Reversing a decision:** a new ADR that supersedes the old one (the old one is marked *Superseded by …*, never deleted), plus a software-factory lesson (§ 10).
- The user makes every decision; Claude proposes (CLAUDE.md § Working rules).

## 3. Git

- **Trunk-based:** short-lived branches, typically one per OpenSpec change. Branch name `<type>/<change-id-or-topic>`, where `<type>` is the Conventional Commit type of the eventual PR title.
- **PRs always, even solo,** so every CI check runs. **Squash merge only;** the PR title is a Conventional Commit, linted in CI. A branch is never continued after its PR merges (with squash, git cannot see that it was merged).
- No automated releases or changelog.
- **The repository is public:** [github.com/jakubbohm/RevolutReader](https://github.com/jakubbohm/RevolutReader), created in M2 (2026-11-05), so non-public values never go into it ([configuration.md § Where each value lives](configuration.md#where-each-value-lives)). Settings: squash merge only (merge commits and rebase merging off), head branches deleted on merge, and the squash commit takes the PR title plus the branch's commit messages (UI: "Pull request title and commit details"; API: `squash_merge_commit_title=PR_TITLE`, `squash_merge_commit_message=COMMIT_MESSAGES`; verified 2026-11-05). The "Default" option is not enough: for a one-commit PR it takes the commit's title instead of the linted PR title. Until M2, commits went directly to `main`.
- **Claude commits or pushes only when the user asks,** with two standing exceptions. During `/tdd-apply`, the orchestrator commits on the change branch at every handoff below (the user, 2026-11-04). During the direct apply of a tooling-only change (§ 6), Claude commits on the change branch at the end of each task group (the user, 2026-11-05). Neither pushes, commits on `main` or opens a PR.
- **Commits inside a change are tagged with the workflow step:** `<type>(cNNN): [<step>] <summary>`, e.g. `test(c005): [red] Balance mapping`. The type says what the commit contains, the scope is the change number, the tag says the step. Squash merge collapses them on `main`; M2 sets the squash commit message to include the branch's commit list, so the trail survives there too.

  | Step | Commit | Type | Committed by |
  |---|---|---|---|
  | `[plan]` | change artifacts created or changed (propose, new, continue, ff; a spec or design fix after a dispute) | `docs` | Claude, when the user approves the artifacts |
  | `[setup]` | one-time (C1): the solution, projects and build rules before the first `/tdd-apply`, so it starts from a green build | `build` | Claude, after the user approves the artifacts |
  | `[accept]` | the change's acceptance tests, failing | `test` | orchestrator, after the user's review |
  | `[red]` | one group's failing tests by the test-writer (also its fixes after a dispute) | `test` | orchestrator |
  | `[green]` | the implementer made that group pass | `feat` / `fix` | orchestrator |
  | `[wire]` | plumbing: endpoints, DI, drivers, adapter edge-case tests | `feat` | orchestrator |
  | `[close]` | all acceptance tests of the change pass; close-out docs | `feat` / `test` | orchestrator |
  | `[apply]` | one task group of a tooling-only change, applied directly (§ 6) | by content: `ci`, `docs`, `chore` | Claude, at the end of each group |
  | `[archive]` | delta specs merged, change moved to the archive | `docs` | Claude, when the user approves the archive |

  A commit at every handoff between the test-writer and the implementer is what lets the orchestrator check that a green step changed no tests ([testing.md § Test-first workflow](testing.md#test-first-workflow)).
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
- **Shared resources are referenced in Bicep as `existing`**, never managed by this project's stack, so the stack can never delete them. If a project ever needs its own child resource inside a shared one, verify how the stack treats such child resources before relying on it (undocumented as of 2026-11-05). F0-2 chose no shared resources for this app ([ADR-0005-data-storage](../adr/0005-data-storage.md)).
- Environment-specific values live in `.bicepparam`. GitHub Actions signs in to Azure via OIDC (no stored credential); the app uses a managed identity with the narrowest built-in roles, assigned in Bicep.
- **The Aspire AppHost models local orchestration only.** A change touching its resource graph includes an explicit "update Bicep" task.
- **Decommissioning** (M8): delete the stack (removes every project-owned resource), then the manual parts — purging the deleted Key Vault, the resource group (the deploy identity lives in it), the Entra registration.

### Resources (decided in F0-2, 2026-11-05)

Region: **Germany West Central**. Why each one: ADR-0002 to ADR-0006 in [docs/adr/](../adr/README.md). The hand-made part, with identifiers and commands: [docs/operations/azure-prerequisites.md](../operations/azure-prerequisites.md).

| Resource | Who creates it | When |
|---|---|---|
| Resource providers the deploy identity cannot register (Key Vault, Logic Apps) | by hand | M3 |
| Resource group (the stack's scope) | by hand | M3 |
| Deploy identity: user-assigned managed identity in the resource group, federated credential for GitHub Actions, Contributor + role assignments limited to the app's data roles, on the resource group | by hand | M3 |
| GitHub environment `production` (deploys from `main` only) with the values the workflow needs before Bicep runs | by hand | M3 |
| Entra app registration (personal Microsoft accounts only, web redirect URIs; [entra-id.md](../operations/entra-id.md)) + 12-month client secret | by hand | M4; the secret in C6 |
| Hand-provisioned Key Vault values: Enable Banking key and session, the client secret, the account allowlist, the VAPID keys | by hand, guided | C4, C6, C8 |
| Public container package on ghcr.io (made public once) | CD pushes; by hand once | C4 |
| Container Apps environment (Consumption) + container app (min 0, max 1 replica, 0.25 vCPU / 0.5 GiB, external HTTPS ingress), with a managed identity and Key Vault-backed secrets | Bicep | C4 |
| Key Vault (RBAC), the app reads secrets | Bicep | C4 |
| Storage account (shared-key access off): a blob container for the Data Protection keys (C6), then tables (C7 or its first slice) | Bicep | C6 |
| Logic App (Consumption), the job's clock | Bicep | C9 |

No container registry, no Cosmos DB, nothing shared with other projects. Monitoring (Application Insights) is not in v1; C4 may propose it.

## 6. OpenSpec

- Behavior changes go through OpenSpec; trivial non-behavioral fixes may be direct.
- **Change ids: `cNNN-verb-topic`** (e.g., `c001-add-backend-foundation`). NNN is the next number across `openspec/changes/` and the archive, never reset; the leading letter satisfies the OpenSpec CLI's letter-first name rule. Change names in the roadmap are proposals; the number is assigned when the change is created.
- **Each change starts on its own branch** off the freshest `main`, created before any artifact is drafted (proposal rule in `openspec/config.yaml`).
- **Proposals cite** the use case (UC1–UC3, kickoff ch. 5), the roadmap step (e.g., C6) and every open question they apply or decide (Q1–Q10), and **include a Non-goals section.**
- **Apply is test-first through `/tdd-apply <change>`,** not `/opsx:apply` ([testing.md § Test-first workflow](testing.md#test-first-workflow)); `openspec/config.yaml` shapes `tasks.md` into the task groups it expects.
- **Tooling-only changes** (the user, 2026-11-05; the first is C2, `c002-add-ci-pipeline` design.md D1) change how the repository accepts or ships code (CI, the ruleset on `main`, process files), not what the app does. A change that touches the app's behaviour is never tooling-only.
  - It sets `skip_specs: true` in its `.openspec.yaml` and has no specs and no scenarios.
  - Proposal, design and tasks are reviewed before anything is built, as for any change.
  - It is applied directly with `/opsx:apply`, task by task, each task checked as it states, with an `[apply]` commit at the end of each group (§ 3).
  - Its task groups are named after the work, and each group writes its own docs. Anything with an effect outside the repository (GitHub settings, Azure) is proven live, as C2's probe PR had to be refused a merge.
  - It is archived as usual.
- **Tasks finish in one sitting** (~2 h at most), each ending with the build and all tests green, **except the change's own acceptance tests:** they are written first and stay red until the change's `[close]` group.
- **Explicit tasks:** "regenerate TS client" when the API contract changes ([README.md § API contract](README.md#api-contract)); "update Bicep + `.bicepparam`" when the AppHost resource graph or Azure topology changes; declaring every new setting in `appsettings.json` ([configuration.md](configuration.md)); a guided manual task for every hand-provisioned secret.
- Cross-cutting decisions made inside a change become ADRs.
- The last tasks of a change update `pm/progress.md`, and `CLAUDE.md` if build, test or run commands changed.
- How TDD and BDD shape specs, design and tasks, and the owner's reading routine after propose: [testing.md](testing.md).

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

`docs/software-factory/` holds what this project gives the user's future software factory, and where it does less than the factory recommends:

- [`lessons.md`](../software-factory/lessons.md): only decisions where this project **diverges** from DoseUp, **reverses** one of its own decisions, or answers a question DoseUp never faced (**new**). The full version, the one that fits a real, long-lived project, is always the default.
- [`divergences.md`](../software-factory/divergences.md): where this project runs a cut-down version of that full version, what it gives up and when it would switch back. It stays with the project.
- [`creating-handover-package.md`](../software-factory/creating-handover-package.md): the inventory of reusable artifacts, and how to build the handover package at the end of the project (M8).
- Add the lesson, and the divergence if there is one, in the same change or session that makes the decision. A step that creates or substantially changes a reusable artifact updates the inventory. Entry formats are in the files.
