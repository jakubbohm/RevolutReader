# RevolutReader

A read-only PWA in which the owner's daughter sees the balance and transactions of one Revolut account and gets a push notification when it changes ([pm/kickoff.md](pm/kickoff.md)). About 2 months of operation; **speed of delivery is the top priority**. Backend: .NET 11 (`RevolutReader.slnx`), API in `src/RevolutReader.Api` (ASP.NET Core + FastEndpoints), Aspire AppHost and ServiceDefaults, three test projects in `tests/` ([testing.md § Where tests live](docs/conventions/testing.md#where-tests-live)). Frontend: `src/RevolutReader.Web` (React + Vite + TypeScript 7, npm), tests next to the code.

## Commands

Run from the repository root; PowerShell 7 and Bash take them as written (each run once in C1, 2026-11-05; the frontend rows in C3, 2026-11-06).

| Purpose | Command |
|---|---|
| Build | `dotnet build` |
| Full suite (includes the traceability check) | `dotnet test` and `npm --prefix src/RevolutReader.Web test` |
| One test layer | `dotnet test --project tests/RevolutReader.<Layer>Tests` (`Acceptance`, `Unit`, `Integration`) |
| One class's tests (one group) | `dotnet test --project <project> --treenode-filter "/*/*/<Class>/*"` |
| One change's acceptance tests | see below (the filter contains a pipe) |
| All acceptance scenarios | `dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/*Scenarios/*"` |
| Traceability check alone | `dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/TraceabilityTests/*"` |
| Fix formatting / check it | `dotnet format whitespace RevolutReader.slnx` / add `--verify-no-changes` |
| Frontend install | `npm --prefix src/RevolutReader.Web ci` |
| Frontend tests / one file | `npm --prefix src/RevolutReader.Web test` / add `-- src/scenarios/<capability>.test.tsx` |
| Frontend checks | `npm --prefix src/RevolutReader.Web run lint` · `run typecheck` · `run format:check` (fix: `run format`) |
| Frontend build | `npm --prefix src/RevolutReader.Web run build` |
| App icons and launch images | `npm --prefix src/RevolutReader.Web run icons`: by hand, only when `public/app-icon.svg` or the launch-screen design changes; commit the PNGs and paste the launch tags it prints into `index.html` |
| Run the app | `aspire start` / `aspire stop` (Claude: through the aspire skills, never `dotnet run` on the AppHost). The app opens at the `web` resource's address (Vite, forwarding `/api` to the API); the API's own address serves no pages (C3) |

- One change's acceptance tests (scenario classes are named `<Capability>Scenarios`; the change's `.tdd-state.md` lists its tests): whole classes with `dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/(<Capability1>Scenarios)|(<Capability2>Scenarios)/*"`, chosen tests of one class with `--treenode-filter "/*/*/<Class>/(<Test1>)|(<Test2>)"`.
- TUnit runs on Microsoft.Testing.Platform: `dotnet test --filter` is not supported (it runs nothing); use `--treenode-filter`, whose segments are `/<assembly>/<namespace>/<class>/<test>`.
- Exit code 8 means zero tests ran: a layer run on an empty project (the unit and integration projects until C5) exits 8; the full `dotnet test` still exits 0 when another project ran tests.
- One change's frontend scenario tests: its `src/scenarios/<capability>.test.tsx` files, listed after `--`. Vitest exits 1 when it finds no test file.

## Read before deciding anything

- [pm/roadmap.md](pm/roadmap.md) and [pm/progress.md](pm/progress.md) — the source of truth for driving development. **Every session reads both at the start, before doing anything else.**
- [pm/kickoff.md](pm/kickoff.md) — the original brief: why, scope, UC1–UC3, open questions Q1–Q10.
- [docs/adr/](docs/adr/) — decisions (e.g. ADR-0001-bank-data-access).
- [docs/conventions/](docs/conventions/) — **source of truth for conventions**: README.md (code), configuration.md, workflow.md (where knowledge and decisions live, Git, CI/CD, infrastructure, OpenSpec, spikes, design), testing.md. `.claude/rules/` and the tooling mirror them.
- `openspec/specs/` — exactly what the system does, once capabilities ship.
- [docs/operations/](docs/operations/) — every expiring approval and secret and how to restore it (update it whenever a step creates or renews one); the hand-made Azure and GitHub setup (M3), the Entra app registration (M4) and the ruleset on `main` (C2), with their identifiers; later the reinstatement guide (D1).

Each fact has one home; link, never duplicate ([workflow.md § 1](docs/conventions/workflow.md#1-where-knowledge-lives)). [docs/software-factory/](docs/software-factory/) is what goes to the user's future software factory ([workflow.md § 10](docs/conventions/workflow.md#10-software-factory)): add a lesson whenever a decision diverges from DoseUp, reverses an earlier one, or answers something new; a divergence when the project runs a cut-down version; an inventory line when a step creates or substantially changes a reusable artifact. A handover package is built from it at the end of the project.

## Working rules

- **The user gates every stage and makes every decision.** Propose, summarize the state, wait for an explicit go. Never declare a step, phase or interview complete on your own.
- **Speed of delivery comes first.** Still think as a senior architect: say when "works" and "correct" differ, then recommend the fastest sound option. Nothing is adopted until the user understands and agrees.
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

## Workflow

- **Spec-driven development via OpenSpec** (`openspec/`, schema `spec-driven`). Behavior changes start with `/opsx:propose "<idea>"` (or `/opsx:explore` to think first), are implemented test-first with `/tdd-apply <change>` (never `/opsx:apply` directly — [testing.md § Test-first workflow](docs/conventions/testing.md#test-first-workflow)) and closed with `/opsx:archive`. The exception is a tooling-only change (`skip_specs: true`, e.g. CI): it has nothing to test first and is applied directly with `/opsx:apply` ([workflow.md § 6](docs/conventions/workflow.md#6-openspec)). Trivial non-behavioral fixes may be direct. Change ids `cNNN-verb-topic`; project rules for artifacts live in `openspec/config.yaml`.
- **Git:** trunk-based, one branch per change, PRs always, squash merge, Conventional Commit PR titles; the repository is public. Commit or push only when the user asks. There are two standing exceptions, both committing on the change branch with step-tagged messages and never pushing: `/tdd-apply` commits at every handoff, and the direct apply of a tooling-only change commits at the end of each task group. Details: [workflow.md § 3](docs/conventions/workflow.md#3-git).
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
