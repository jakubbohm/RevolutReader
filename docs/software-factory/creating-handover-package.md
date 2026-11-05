# Creating the Software-Factory Handover Package

**Status:** inventory kept current while the project runs · **Package:** not built yet

At the end of the project (roadmap step M8, Decommissioning, or earlier if the user asks), RevolutReader hands what it learned over to the user's software factory: to DoseUp's catalog now (`D:\source\jakubbohm\DoseUp\docs\software-factory.md`), to the factory's own repository later. The handover is a process, not a file copy ([lessons.md R-22](lessons.md)): this file says what goes into the package and how to build it. The receiving side takes the package in through its own process.

## What the package contains

- [lessons.md](lessons.md): every lesson, with RevolutReader's constraint set.
- The reusable artifacts listed in [§ Inventory](#inventory), as they are at handover time.
- A README for the package ([§ Building the package](#building-the-package), step 4).

Not included:

- [divergences.md](divergences.md): it stays with the project.
- Skills and commands installed by tools (OpenSpec, Aspire): the tools install them.
- Artifacts that only repeat DoseUp's (e.g. `.claude/skills/cleanup-branch/`).

## Inventory

Keep it current: a step that creates or substantially changes a reusable artifact adds or updates its line here in the same session.

| Kit | Artifact | What it is | Lessons |
|---|---|---|---|
| Test-first workflow | [docs/conventions/testing.md](../conventions/testing.md) | The testing conventions: test levels, acceptance tests as an internal DSL, the traceability check, the fake bank, the test-first workflow, the owner's reading routine | R-12 to R-20 |
| Test-first workflow | [.claude/rules/testing.md](../../.claude/rules/testing.md) | The testing conventions in the short form Claude loads | R-15 to R-18 |
| Test-first workflow | [.claude/skills/tdd-apply/](../../.claude/skills/tdd-apply/SKILL.md) | The orchestrator skill (`/tdd-apply <change>`) | R-16, R-21 |
| Test-first workflow | [.claude/agents/test-writer.md](../../.claude/agents/test-writer.md), [.claude/agents/implementer.md](../../.claude/agents/implementer.md) | The two subagents the orchestrator drives; the hook below restricts the implementer | R-16, R-17, R-18 |
| Test-first workflow | [.claude/hooks/deny-test-edits.mjs](../../.claude/hooks/deny-test-edits.mjs), registered in [.claude/settings.json](../../.claude/settings.json) | The hook that stops the implementer from editing tests; it runs for every session and blocks only the subagent whose `agent_type` is `implementer` | R-16, R-33 |
| Test-first workflow | [openspec/config.yaml](../../openspec/config.yaml) | The spec tool's rules: TL;DRs, scenario rules, design sections, task groups, apply and archive guidance, with the exception for tooling-only changes | R-15, R-20, R-34 |
| Test-first workflow | [docs/conventions/workflow.md § 3](../conventions/workflow.md#3-git), [§ 6](../conventions/workflow.md#6-openspec) | The commit tags per workflow step, including the one-time `[setup]` commit and the `[apply]` commits of a tooling-only change; how a tooling-only change is applied | R-21, R-29, R-34 |
| Test-first workflow | [tests/RevolutReader.AcceptanceTests/Traceability/](../../tests/RevolutReader.AcceptanceTests/Traceability/TraceabilityCheck.cs) | The traceability check: the specs with active deltas applied per requirement, compared with `[Scenario]` attributes and the manual list, every problem listed at once; with self-tests on made-up specs | R-15, R-29 |
| Test-first workflow | [tests/manual-scenarios.md](../../tests/manual-scenarios.md) | The list of scenarios checked by hand at handover, read by the traceability check | R-15, R-19 |
| Test-first workflow | [tests/RevolutReader.AcceptanceTests/Conventions/AnonymousEndpointsTests.cs](../../tests/RevolutReader.AcceptanceTests/Conventions/AnonymousEndpointsTests.cs) | The anonymous-endpoint check: the app's real endpoint list against an explicit allowlist, both ways | R-32 |
| Test-first workflow | [tests/RevolutReader.AcceptanceTests/Drivers/AcceptanceTest.cs](../../tests/RevolutReader.AcceptanceTests/Drivers/AcceptanceTest.cs), [ApiFactory.cs](../../tests/RevolutReader.AcceptanceTests/Drivers/ApiFactory.cs) | The acceptance-test harness base: one app copy per test in environment `Production` (TUnit.AspNetCore), DSL built on the test's own copy | R-12, R-15 |
| Build rules | [Directory.Build.props](../../Directory.Build.props), [Directory.Packages.props](../../Directory.Packages.props), [global.json](../../global.json), [BannedSymbols.txt](../../BannedSymbols.txt), [.editorconfig](../../.editorconfig), [nuget.config](../../nuget.config) | Analyzers as build errors, central package versions, the exact SDK pin, banned time APIs, style severities that really gate the build, one package source | R-31 |
| Merge gate | [.github/workflows/ci.yml](../../.github/workflows/ci.yml), [.github/workflows/pr-title.yml](../../.github/workflows/pr-title.yml) | PR CI: the build and all tests on Linux with the SDK from `global.json`; the Conventional Commit title check in a few lines of bash, safe from script injection | R-36 |
| Merge gate | [docs/operations/main-ruleset.json](../operations/main-ruleset.json), [main-ruleset.md](../operations/main-ruleset.md) | The ruleset on `main` as a file. The page has the commands to create, update, check and remove it, how to add a check, the escape hatch, and the probe's proof | R-36 |
| Merge gate | [docs/conventions/workflow.md § 4](../conventions/workflow.md#4-cicd) | The CI rules: pull requests only, the table of required checks, no filters on required workflows, no security scanning | R-35, R-36 |
| Backend | [src/RevolutReader.ServiceDefaults/ServiceDefaultsExtensions.cs](../../src/RevolutReader.ServiceDefaults/ServiceDefaultsExtensions.cs) | The Aspire ServiceDefaults without the template's default HTTP retries and health checks | R-30 |
| Personal bank access | [spikes/enable-banking/](../../spikes/enable-banking/README.md) | Scripts and README: linking the owner's own account in Enable Banking's restricted mode, the API session, the history download, the smoke test | R-9, R-11 |
| Personal bank access | [spikes/enable-banking-mock/](../../spikes/enable-banking-mock/README.md) | Scripts and README: a sandbox session against the Mock ASPSP and response captures | R-13 |
| Personal bank access | [docs/adr/0001-bank-data-access.md](../adr/0001-bank-data-access.md) | The findings, with sources, on consent validity, pricing and request limits, and the decision built on them | R-8, R-9, R-11 |
| Restore | [docs/operations/expiring-approvals.md](../operations/expiring-approvals.md) | The register of expiring approvals and secrets: expiry, how you notice, how to restore | R-10 |
| Sign-in bootstrap | [docs/operations/entra-id.md](../operations/entra-id.md) | The app registration for personal Microsoft accounts only, created through Microsoft Graph pinned to the right directory, with a check that the sign-in service accepts it | R-24, R-25 |
| Azure bootstrap | [docs/operations/azure-prerequisites.md](../operations/azure-prerequisites.md) | The one-time Azure and GitHub setup a deployment stack needs: providers, resource group, a keyless deploy identity with the narrowest roles, the GitHub environment; with commands and checks | R-28 |
| Design | [docs/conventions/workflow.md § 8](../conventions/workflow.md#8-design) | The design workflow: a design system before the first frontend code, one Screens canvas with its own copy of the design system, where each kind of change starts, Claude Code reading the artifacts by link | R-7 |
| Project management | [pm/roadmap.md § 1](../../pm/roadmap.md#1-how-to-use-this-roadmap), [pm/progress.md § How to update](../../pm/progress.md#how-to-update) | Plan and status in repository files: step types, one step per session, the decision trail | R-6 |
| Software factory | This file | How the handover package is built | R-22 |

## Building the package

1. **Check the inventory.** Every listed artifact still exists. Follow the links in [lessons.md](lessons.md) and add anything reusable that is missing from the list.
2. **Collect.** Copy lessons.md and the listed artifacts into a folder outside the repository (`revolutreader-handover-<date>/`), keeping their repository paths.
3. **Clean.** No secrets, keys or tokens, and no bank data (balances, amounts, counterparties, transaction texts, account identifiers): `secrets/` and `evidence/` folders never go in. Replace project-only values (resource names, client IDs, dates of this project's approvals) where they are not part of the lesson.
4. **Write the package README:** what is inside (one line per kit and the lessons it belongs to), the source repository and commit, the date, the target, and the suggested intake below.
5. **Hand it over** in a session in the target repository. Back here, set **Package** in this file's header and **Handover** in [lessons.md](lessons.md) to `done <date> → <target>`, and record it in `pm/progress.md`.

## Suggested intake

The receiving side decides, under its own rules. A starting point for DoseUp's catalog:

1. Add each lesson as a new F-entry with the next free number in the matching section, keeping the origin `*(from RevolutReader R-n)*`.
2. For each lesson that relates to an existing F-entry, add one sentence to that entry's *Generalizes* line pointing to the new entry.
3. Copy RevolutReader's constraint set next to DoseUp's own constraint note.
4. Store the kits where the factory keeps reusable artifacts, linked from their F-entries.
