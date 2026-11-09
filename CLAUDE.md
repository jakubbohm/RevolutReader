# RevolutReader

A read-only PWA in which the owner's daughter sees the balance and transactions of one Revolut account and gets a push notification when it changes ([pm/kickoff.md](pm/kickoff.md)). About 2 months of operation; **speed of delivery is the top priority for the app, never for the software-factory work it feeds** ([§ Working rules](#working-rules)). Backend: .NET 11 (`RevolutReader.slnx`), API in `src/RevolutReader.Api` (ASP.NET Core + FastEndpoints), Aspire AppHost and ServiceDefaults, three test projects in `tests/` ([testing.md § Where tests live](docs/conventions/testing.md#where-tests-live)). Frontend: `src/RevolutReader.Web` (React + Vite + TypeScript 7, npm), tests next to the code.

## Commands

Run from the repository root; PowerShell 7 and Bash take them as written (each run once in C1, 2026-11-05; the frontend rows in C3, 2026-11-06; the image rows in C4, 2026-11-06; the bank check rows in C5, 2026-11-07; the history import row in C7b, 2026-11-09, against a throwaway Azurite).

| Purpose | Command |
|---|---|
| Build | `dotnet build` |
| Full suite (includes the traceability check) | `dotnet test` and `npm --prefix src/RevolutReader.Web test` (`dotnet test` needs Docker running since C7b: the acceptance and integration tests use Azurite in a container, [testing.md § Storage](docs/conventions/testing.md#storage-the-real-adapter-on-azurite)) |
| One test layer | `dotnet test --project tests/RevolutReader.<Layer>Tests` (`Acceptance`, `Unit`, `Integration`) |
| One class's tests (one group) | `dotnet test --project <project> --treenode-filter "/*/*/<Class>/*"` |
| One change's acceptance tests | see below (the filter contains a pipe) |
| All acceptance scenarios | `dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/*Scenarios/*"` |
| Traceability check alone | `dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/TraceabilityTests/*"` |
| Check 1: the bank adapter against Enable Banking's Mock ASPSP (explicit, never in the default run; needs the local secrets, [local-secrets.md](docs/operations/local-secrets.md)) | `dotnet test --project tests/RevolutReader.IntegrationTests --treenode-filter "/*/*/MockAspspCheck/*" --output Detailed` |
| Check 2: the bank adapter against the real account, once (explicit; needs the `RealAccountCheck:*` secrets; makes 1 of Revolut's 4 unattended reads a day, never retried; the same filter also runs the continuation-key probe, 3 more present-user requests, none unattended, retried only if one fails (c008 design.md D11); writes counts-only files to `spikes/enable-banking/evidence/`) | `dotnet test --project tests/RevolutReader.IntegrationTests --treenode-filter "/*/*/RealAccountCheck/*" --output Detailed` |
| The history import: the M1 history file into the deployed table, once (explicit, never in the default run; run by the owner after C7b's deploy, with a temporary table role: [deployment.md § The history import](docs/operations/deployment.md#the-history-import-c7b); its settings and the local check below) | `dotnet test --project tests/RevolutReader.IntegrationTests --treenode-filter "/*/*/HistoryImportCheck/*" --output Detailed` |
| Fix formatting / check it | `dotnet format whitespace RevolutReader.slnx` / add `--verify-no-changes` |
| Frontend install | `npm --prefix src/RevolutReader.Web ci` |
| Frontend tests / one file | `npm --prefix src/RevolutReader.Web test` / add `-- src/scenarios/<capability>.test.tsx` |
| Frontend checks | `npm --prefix src/RevolutReader.Web run lint` · `run typecheck` · `run format:check` (fix: `run format`) |
| Frontend build | `npm --prefix src/RevolutReader.Web run build` |
| Regenerate the API client (after changing an endpoint's contract; once per machine first `npm --prefix tools/api-client ci`) | `npm --prefix tools/api-client run regenerate`: the export check writes `src/RevolutReader.Api/openapi.json`, then the TypeScript types `src/RevolutReader.Web/src/api/schema.d.ts`; commit both (CI fails when either is stale). Run in C6, 2026-11-08 |
| App icons and launch images | `npm --prefix src/RevolutReader.Web run icons`: by hand, only when `public/app-icon.svg` or the launch-screen design changes; commit the PNGs and paste the launch tags it prints into `index.html` |
| Run the app | `aspire start` / `aspire stop` (Claude: through the aspire skills, never `dotnet run` on the AppHost). The app opens at the `web` resource's HTTPS address (Vite, forwarding `/api` and, since C7a, `/health` to the API; HTTPS since C6, for the `__Host-` login cookie); the API's own address serves no pages (C3). The API waits for its secret parameters, the four `enablebanking-*` and the two `signin-*` ([local-secrets.md](docs/operations/local-secrets.md)), and since C7b for Azurite, the storage emulator, which needs Docker running. From a git worktree add `--isolated` (run in C6, 2026-11-08) |
| Image, local build | `docker build -t revolutreader:local .` (Docker running; the same Dockerfile the deploy builds) |
| Image, quick start | see below (setting the throwaway key differs per shell) |
| Bicep check | `az bicep lint --file infra/main.bicep` (lints the modules too; a warning counts as a finding: the PR check `image-and-infra` fails on it) |
| Preview the next deploy (read-only, needs the owner's Azure login) | [docs/operations/deployment.md § Previewing a change to the Bicep](docs/operations/deployment.md#previewing-a-change-to-the-bicep-read-only) |

- One change's acceptance tests (scenario classes are named `<Capability>Scenarios`; the change's `.tdd-state.md` lists its tests): whole classes with `dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/(<Capability1>Scenarios)|(<Capability2>Scenarios)/*"`, chosen tests of one class with `--treenode-filter "/*/*/<Class>/(<Test1>)|(<Test2>)"`.
- TUnit runs on Microsoft.Testing.Platform: `dotnet test --filter` is not supported (it runs nothing); use `--treenode-filter`, whose segments are `/<assembly>/<namespace>/<class>/<test>`.
- Exit code 8 means zero tests ran, e.g. a `--treenode-filter` that matches nothing. Every test project has tests since C5; the explicit checks (the bank checks, and since C7b the history import) run only when a filter selects them alone.
- One change's frontend scenario tests: its `src/scenarios/<capability>.test.tsx` files, listed after `--`. Vitest exits 1 when it finds no test file.
- The history import's settings are environment variables only, none of them a secret (`HistoryImportCheck`, c010 design.md D9): `HistoryImport__File`, the history file's full path, and either `HistoryImport__TableEndpoint`, the deployed table endpoint, with `HistoryImport__Subscription`, the subscription the owner's Azure CLI login takes its token for, or, for a local check, `HistoryImport__TableConnectionString` instead. Locally, never with the real file: a made-up file of the same shape (as `tests/RevolutReader.IntegrationTests/HistoryImport/MadeUpHistory.cs` builds them, saved outside the repository) and a throwaway Azurite, `docker run -d --rm --name azurite-history -p 10002:10002 mcr.microsoft.com/azure-storage/azurite:3.37.0 azurite-table --tableHost 0.0.0.0`, with `HistoryImport__TableConnectionString` set to `UseDevelopmentStorage=true` (in PowerShell 7 `$env:HistoryImport__TableConnectionString = 'UseDevelopmentStorage=true'`, in Bash `export HistoryImport__TableConnectionString=UseDevelopmentStorage=true`); `docker stop azurite-history` removes it. It prints counts only: transactions read, settled, kept, days skipped and the rows in the table; a second run keeps 0.
- Image quick start, with made-up Enable Banking values (c005 design.md D14): first a throwaway key, in Bash `export EnableBanking__PrivateKey="$(openssl genpkey -quiet -algorithm RSA -pkeyopt rsa_keygen_bits:2048)"`, in PowerShell 7 `$env:EnableBanking__PrivateKey = [System.Security.Cryptography.RSA]::Create(2048).ExportPkcs8PrivateKeyPem()`; then, in either shell, `docker run -d --rm --name revolutreader-local -p 8080:8080 -e EnableBanking__ApplicationId=00000000-0000-0000-0000-000000000000 -e EnableBanking__PrivateKey -e EnableBanking__SessionId=00000000-0000-0000-0000-000000000000 -e EnableBanking__AccountId=00000000-0000-0000-0000-000000000000 -e SignIn__ClientSecret=made-up -e SignIn__AllowedEmails=someone@example.com -e ConnectionStrings__tables=UseDevelopmentStorage=true revolutreader:local` (the two sign-in values since C6, made up too: the app refuses to start on the `"<secret>"` placeholders; signing in needs the real ones; the tables connection since C7b, Azurite's shorthand for its local account, which is never reached: the app refuses to start without the setting, but reads a table only for a signed-in user). The pages and the API answer at `http://localhost:8080`; `docker logs revolutreader-local` shows the app's output, `docker stop revolutreader-local` removes it.

## Read before deciding anything

- [pm/roadmap.md](pm/roadmap.md) and [pm/progress.md](pm/progress.md) — the source of truth for driving development. **Every session reads both at the start, before doing anything else.**
- [pm/kickoff.md](pm/kickoff.md) — the original brief: why, scope, UC1–UC3, open questions Q1–Q10.
- [docs/adr/](docs/adr/) — decisions (e.g. ADR-0001-bank-data-access).
- [docs/conventions/](docs/conventions/) — **source of truth for conventions**: README.md (code), configuration.md, workflow.md (where knowledge and decisions live, Git, CI/CD, infrastructure, OpenSpec, spikes, design), testing.md. `.claude/rules/` and the tooling mirror them.
- `openspec/specs/` — exactly what the system does, once capabilities ship.
- [docs/operations/](docs/operations/) — every expiring approval and secret and how to restore it (update it whenever a step creates or renews one); the hand-made Azure and GitHub setup (M3), the Entra app registration (M4), the ruleset on `main` (C2) and the deployment (C4: the deployed resources, the first deploy, the Key Vault task, checks, rolling back), with their identifiers; later the reinstatement guide (D1).

Each fact has one home; link, never duplicate ([workflow.md § 1](docs/conventions/workflow.md#1-where-knowledge-lives)). [docs/software-factory/](docs/software-factory/) is what goes to the user's future software factory ([workflow.md § 10](docs/conventions/workflow.md#10-software-factory)): add a lesson whenever a decision diverges from DoseUp, reverses an earlier one, or answers something new; a divergence when the project runs a cut-down version; an inventory line when a step creates or substantially changes a reusable artifact. A handover package is built from it at the end of the project.

## Working rules

- **The user gates every stage and makes every decision.** Propose, summarize the state, wait for an explicit go. Never declare a step, phase or interview complete on your own.
- **Two quality bars: speed for the app, no shortcuts for the software factory.** For the app, speed of delivery comes first: still think as a senior architect, say when "works" and "correct" differ, then recommend the fastest sound option. The software factory always gets the best solution, never a shortcut, not even for speed. During the project, notes that lead to it are enough; it is made complete at the handover ([workflow.md § 10 — The quality bar](docs/conventions/workflow.md#the-quality-bar-2026-11-08)). Nothing is adopted until the user understands and agrees.
- **Research before recommending:** verify versions, licenses, prices, limits and compatibility against current sources, and date such claims. Model memory is stale by default.
- **Short, plain replies:** overview first, then small rounds. Never use repo jargon or codenames without explaining them in plain words.
- **Big decisions** (architecture, tooling, process, scope) come as a prose proposal — solution, trade-offs, alternatives, recommendation — that the user answers freely. **Quick confirmations may use option menus.** A picked option is only the closest match; the user's free-text notes are the user's own words — re-confirm when it matters.
- **When a step's inputs say the user provides something** (a path, a link, an export), ask for it — never guess.
- **Commands and scripts the user copies and runs are PowerShell 7** (backtick or splatting for line continuation, `$env:NAME = 'value'`), never bash. Claude's own tool calls are unaffected.
- **Never log or commit bank data** (balances, amounts, counterparties, transaction texts, account identifiers) **or secrets.**
- **Never change, switch off or delete the ruleset on `main` without the user's explicit go** ([docs/operations/main-ruleset.md](docs/operations/main-ruleset.md)). Claude works with the owner's admin login, so it could otherwise switch off the one thing that blocks a merge past a red check.
- **Azure, Entra ID and databases: Claude reads freely and changes only on the user's explicit go.** Claude works with the owner's own login, which is Owner of the subscription. Read-only operations need no confirmation. Before any operation that creates, changes, deletes or grants anything — in Azure (resources, role assignments, Key Vault secrets, deployments Claude starts itself), in Entra ID (Microsoft Graph), or by a command sent directly to a database, local or deployed (creating or dropping a table, writing or deleting data) — Claude shows the exact commands and what they change, then waits for the user's explicit go. A go covers only the commands shown. Not covered: data that tests and the app write through the code; Claude never writes to a database directly.

## Language

- The user may write prompts in Czech or English.
- All output is always in English: chat replies, project documents (`pm/`, `docs/`), OpenSpec artifacts, code, comments, commit messages, PR descriptions.
- Exception: user-facing text in the app UI is Czech (see `pm/kickoff.md`, ch. 8).

## Project management

- Work items live in `pm/roadmap.md` and `pm/progress.md`; `pm/kickoff.md` is the brief the roadmap refers to.
- Update `pm/progress.md` when a step starts and when it ends. Decisions go into ADRs; `pm/progress.md` records only each open question's status, a one-line outcome, the link and the impact on steps ([workflow.md § 2](docs/conventions/workflow.md#2-decisions)).
- Roadmap changes only with the user's approval, logged in `pm/progress.md`.
- Every piece of planned work also gets a GitHub issue, linked both ways with its roadmap entry and closed by the PR that finishes it, unless the user says otherwise for that item ([workflow.md § 9](docs/conventions/workflow.md#9-project-management)).

## Workflow

- **Spec-driven development via OpenSpec** (`openspec/`, schema `spec-driven`). Behavior changes start with `/opsx:propose "<idea>"` (or `/opsx:explore` to think first), are implemented test-first with `/tdd-apply <change>` (never `/opsx:apply` directly — [testing.md § Test-first workflow](docs/conventions/testing.md#test-first-workflow)) and closed with `/opsx:archive`. The whole path: propose, `/tdd-apply`, a draft PR on the owner's go, `/code-review` and `/triage-review`, `/opsx:archive`, then the PR marked ready and squash-merged ([workflow.md § 6](docs/conventions/workflow.md#6-openspec)). The exception is a tooling-only change (`skip_specs: true`, e.g. CI): it has nothing to test first and is applied directly with `/opsx:apply` ([workflow.md § 6](docs/conventions/workflow.md#6-openspec)). Trivial non-behavioral fixes may be direct. Change ids `cNNN-verb-topic`; project rules for artifacts live in `openspec/config.yaml`.
- **Code review before the merge:** the owner runs `/code-review` on the change's PR (xhigh, with `--comment`, so every finding is a thread on the PR). `/triage-review <PR>` then works through the findings: every one verified read-only by a saved workflow, the confirmed local ones fixed test-first through the test-writer and implementer, the refuted ones declined in their threads with evidence, the rest brought to the owner one at a time ([testing.md § Code review after the apply](docs/conventions/testing.md#code-review-after-the-apply)). Never the review's own `--fix`.
- **Git:** trunk-based, one branch per change, PRs always, squash merge, Conventional Commit PR titles; the repository is public. Commit or push only when the user asks. There are three standing exceptions, all committing on the change branch with step-tagged messages and never pushing: `/tdd-apply` commits at every handoff, the direct apply of a tooling-only change commits at the end of each task group, and `/triage-review` commits at every handoff of its fix round. Details: [workflow.md § 3](docs/conventions/workflow.md#3-git).
- **Spikes and verification scripts** go in `spikes/<topic>/` with a README and evidence, never with secrets or bank data ([workflow.md § 7](docs/conventions/workflow.md#7-spikes)).
- **Run the app** (once the AppHost exists) through the aspire skills — `aspire start` / `aspire stop` — never `dotnet run` on the AppHost.

## Claude memory

Auto-memory lives **in-repo** at `.claude/memory/` (committed). Per machine, `.claude/settings.local.json` (gitignored) must contain:

```json
{ "autoMemoryDirectory": "<absolute-repo-path>/.claude/memory" }
```

A canary MEMORY.md sits at the default global location — if its line ever appears in loaded memories, the redirect is not applied; fix the local setting before writing memories.

Memory is versioned: memory edits are part of the task's commit and branch, never left uncommitted.

## Code navigation

- The repo is indexed in codebase-memory-mcp as project `D-source-jakubbohm-RevolutReader`. Prefer its graph tools (`search_graph`, `trace_path`, `get_code_snippet`) for code exploration; re-run `index_repository` after significant changes.
