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
  | `[setup]` | once per stack, before its first `/tdd-apply`, so the loop starts from a green build: C1 the solution, projects and build rules; C3 the frontend project and its tools | `build` | Claude, after the user approves the artifacts |
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
- **CI runs on pull requests only** (the user, 2026-11-05): when a PR is opened or reopened, and on every new push to it. Nothing runs for a branch without a PR, and nothing runs on `main` after the merge.
- **The checks every PR must pass.** The ruleset on `main` requires them, with the branch up to date and no bypass ([docs/operations/main-ruleset.md](../operations/main-ruleset.md)):

  | Check | Workflow | What it does | Added by |
  |---|---|---|---|
  | `build-and-test` | [ci.yml](../../.github/workflows/ci.yml) | Builds the solution and runs all three test projects, the traceability check included. Analyzer and layout errors fail the build, so formatting needs no check of its own. | C2 |
  | `pr-title` | [pr-title.yml](../../.github/workflows/pr-title.yml) | The PR title is a Conventional Commit (§ 3). | C2 |

  C3 (frontend) and C4 (deployment) add theirs; test-related checks follow [testing.md](testing.md). A change that adds a check also adds it to the ruleset file and re-applies the ruleset, or the check would only be advisory.
- **No path or branch filters on a required workflow:** a required check that never runs stays "pending" and blocks the merge. To skip work, use a job-level `if:` (a job skipped that way reports success).
- **No security scanning** (CodeQL, dependency review), on purpose ([divergences.md R-35](../software-factory/divergences.md)).

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

Decided by the user on 2026-11-05, replacing F0-1's single mockup of the account screen ([lessons.md R-7](../software-factory/lessons.md)).

- **The app's look lives in two Claude Design artifacts in the owner's Claude account.** Claude Design now runs inside Claude as artifacts; the standalone claude.ai/design closes on 2026-12-14. The links open only for the owner, so they are safe in this public repository.

  | Artifact | What it holds | Link |
  |---|---|---|
  | Design system "Tarjeta Papá" | Colour, type, spacing, radius and motion tokens for light and dark, with a Tailwind v4 theme file; the components with their states and accessibility notes; the app icon; the Czech copy, number and date formats | [claude.ai/artifact/5pHJrprsxkXFyJD6ie6pXn](https://claude.ai/artifact/5pHJrprsxkXFyJD6ie6pXn) |
  | Screens "Tarjeta Papá – app screens" | Every screen and state, 30 artboards on one canvas, built from the design system's own components. Each artboard is its own file, `project/<name>.dc.html`, titled `<Flow> / <Screen> / <State>` in the index `project/canvas.json`; the invented sample data is `project/sample-data.js` | [claude.ai/artifact/BbFPxcBjrd8jUbcPZi3Yq7](https://claude.ai/artifact/BbFPxcBjrd8jUbcPZi3Yq7) |

- **The Screens design keeps its own copy of the design system,** pinned to the version it was made from, and the copy never updates by itself (the Design type's own documentation, checked 2026-11-05).
- **A plain "update" is not enough.** It replaces only the copied files in `project/ds/tarjeta/` (the components, their styles, `tokens.json`). What the canvas made itself stays as it was (checked in its files, 2026-11-05):
  - text typed straight into an artboard, e.g. the app name on the sign-in, install and Home Screen boards;
  - `project/tarjeta-tokens.css` and `tarjeta-tokens-dark.css`, the canvas's own CSS copy of the tokens, which every artboard takes its colours from. The design system ships no CSS file of its tokens, so a changed colour would not reach the screens ([divergences.md R-7](../software-factory/divergences.md)).

  So every design-system change ends with two prompts, and the list then goes to Claude Code. The design-system session knows what really changed, including the owner's steering; the Screens design knows its own canvas.

  1. In the design system, at the end of the change:

     ```text
     List what you changed, so a screens design can apply it: every changed token, component, text and name, old → new. Only the list.
     ```

  2. In the Screens design, with that list (when the change spanned several sessions, ask each for its list and paste them all):

     ```text
     Update the design system to its latest version. These are its changes:
     <paste the list>
     Then bring everything this canvas made itself into line with them: tarjeta-tokens.css, tarjeta-tokens-dark.css, and any text, colour or layout written directly in an artboard. Change nothing else, then list what you changed.
     ```

  3. In Claude Code, once the design is finished: the same list, e.g. "The design system changed: <paste the list>. Apply it." Claude Code reads the current artifacts and compares them with the code, so it also catches a difference the list missed. When the code has nothing of it yet, there is nothing to do now: the step that builds the screen reads the design. A change to a screen alone skips steps 1 and 2: the owner tells Claude Code which artboards changed.
- **One canvas, not one artifact per screen:** the screens share one design-system copy and one set of sample data, and one update refreshes them all. To change one screen, select its artboard and ask; the others stay as they are.
- **Where a change starts:**

  | The owner wants | First, in Claude | Then, in the repository |
  |---|---|---|
  | A different look: a colour, a size, a spacing, the icon | the design system, then the two update prompts above | a small direct PR that applies it (not behaviour, so no OpenSpec change) |
  | A new component | the design system, usually asked for together with the screen that needs it | the change that builds that screen |
  | A changed component that shows something new, e.g. day totals in the day header | the design system, including any of its guidelines the change overrides; then the two update prompts above, and a check that the change shows on the screens that use it | nothing extra if the screen is not built yet; otherwise an OpenSpec change for the feature, whose spec holds the rules a picture cannot show (what counts, currencies) |
  | A new or changed screen | the Screens design | the OpenSpec change for the feature, naming the artboards it implements |
  | A text, a behaviour or a bug fix with no visual change | — | as usual |

  Another Design artifact is made only for something that is not this app's UI.
- **The owner edits the artifacts in Claude; Claude Code only reads them,** by the links above with its Artifact tool, signed in as the owner. Only the files the app ships are copied into the repository (the next bullet). A step that builds UI from the design as it is reads the design system and its artboards before proposing or coding; nothing changes in Claude. In `/tdd-apply`, the implementer subagent cannot open artifacts, so the orchestrator reads the files into the session's scratchpad and hands it their paths. When the owner asks Claude Code for a visual change, Claude Code points to the design system first, so the code and later screen designs do not drift apart, and walks the owner through the steps above, writing the prompt for the change itself.
- **For the look, the design wins; for behaviour, the specs win.** A change translates the design into the repo's own Tailwind theme and components ([README.md § Frontend](README.md#frontend)). The design system's reference components are a model, never committed as they are. A genuinely new token or component is flagged in the change's design as a decision.
- **Three kinds of design files** (decided in C3, [c003 design.md D10](../../openspec/changes/c003-add-frontend-foundation/design.md), 2026-11-06):
  - **Copied and committed as they are:** the files the app ships, such as the app icon, images and logos. The icon is `src/RevolutReader.Web/public/app-icon.svg`, byte for byte the design system's asset. The PNG sizes the phone needs are made from it by `npm run icons` and committed as well; the build never runs that tool.
  - **Translated, not copied:** the tokens (into the app's Tailwind theme), the components (rebuilt with Tailwind utilities), the number and date formats.
  - **Never copied:** the reference components' code, the screens, the sample data, the guidelines.
  - A changed asset arrives through the loop above like any other design change; Claude Code copies the new file and regenerates the PNGs.

## 9. Project management

- Work items live in `pm/roadmap.md` and `pm/progress.md`, not in a tracker. CLAUDE.md § Project management says how sessions use them.
- Changing the roadmap needs the user's approval; every change is logged in `pm/progress.md` § Roadmap change log.

## 10. Software factory

`docs/software-factory/` holds what this project gives the user's future software factory, and where it does less than the factory recommends:

- [`lessons.md`](../software-factory/lessons.md): only decisions where this project **diverges** from DoseUp, **reverses** one of its own decisions, or answers a question DoseUp never faced (**new**). The full version, the one that fits a real, long-lived project, is always the default.
- [`divergences.md`](../software-factory/divergences.md): where this project runs a cut-down version of that full version, what it gives up and when it would switch back. It stays with the project.
- [`creating-handover-package.md`](../software-factory/creating-handover-package.md): the inventory of reusable artifacts, and how to build the handover package at the end of the project (M8).
- Add the lesson, and the divergence if there is one, in the same change or session that makes the decision. A step that creates or substantially changes a reusable artifact updates the inventory. Entry formats are in the files.
