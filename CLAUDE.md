# RevolutReader

A read-only PWA in which the owner's daughter sees the balance and transactions of one Revolut account and gets a push notification when it changes ([pm/kickoff.md](pm/kickoff.md)). About 2 months of operation; **speed of delivery is the top priority**. No code yet — the solution arrives with C1 ([pm/roadmap.md](pm/roadmap.md)); add the Commands section then.

## Read before deciding anything

- [pm/roadmap.md](pm/roadmap.md) and [pm/progress.md](pm/progress.md) — the source of truth for driving development. **Every session reads both at the start, before doing anything else.**
- [pm/kickoff.md](pm/kickoff.md) — the original brief: why, scope, UC1–UC3, open questions Q1–Q10.
- [docs/adr/](docs/adr/) — decisions (e.g. ADR-0001-bank-data-access).
- [docs/conventions/](docs/conventions/) — **source of truth for conventions**: README.md (code), configuration.md, workflow.md (where knowledge and decisions live, Git, CI/CD, infrastructure, OpenSpec, spikes), testing.md. `.claude/rules/` and the tooling mirror them.
- `openspec/specs/` — exactly what the system does, once capabilities ship.
- [docs/operations/](docs/operations/) — every expiring approval and secret and how to restore it (update it whenever a step creates or renews one); later the reinstatement guide (D1).

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

## Language

- The user may write prompts in Czech or English.
- All output is always in English: chat replies, project documents (`pm/`, `docs/`), OpenSpec artifacts, code, comments, commit messages, PR descriptions.
- Exception: user-facing text in the app UI is Czech (see `pm/kickoff.md`, ch. 8).

## Project management

- Work items live in `pm/roadmap.md` and `pm/progress.md`; `pm/kickoff.md` is the brief the roadmap refers to.
- Update `pm/progress.md` when a step starts and when it ends. Decisions go into ADRs; `pm/progress.md` records only each open question's status, a one-line outcome, the link and the impact on steps ([workflow.md § 2](docs/conventions/workflow.md#2-decisions)).
- Roadmap changes only with the user's approval, logged in `pm/progress.md`.

## Workflow

- **Spec-driven development via OpenSpec** (`openspec/`, schema `spec-driven`). Behavior changes start with `/opsx:propose "<idea>"` (or `/opsx:explore` to think first), are implemented test-first with `/tdd-apply <change>` (never `/opsx:apply` directly — [testing.md § Test-first workflow](docs/conventions/testing.md#test-first-workflow)) and closed with `/opsx:archive`; trivial non-behavioral fixes may be direct. Change ids `cNNN-verb-topic`; project rules for artifacts live in `openspec/config.yaml`.
- **Git:** trunk-based, one branch per change, PRs always, squash merge, Conventional Commit PR titles. Until the GitHub repository exists (M2), commit directly to `main` with Conventional Commit messages. Commit or push only when the user asks; the one standing exception is `/tdd-apply`, which commits on the change branch at every handoff with step-tagged messages. Details: [workflow.md § 3](docs/conventions/workflow.md#3-git).
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
