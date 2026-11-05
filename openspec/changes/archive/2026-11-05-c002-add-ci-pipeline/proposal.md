# Proposal: c002-add-ci-pipeline

## TL;DR

- **What:** CI on GitHub Actions. Every pull request builds the solution, runs all tests and checks that its title is a Conventional Commit. A ruleset on `main` requires a pull request, both checks and an up-to-date branch, with no bypass, so a failing check blocks the merge.
- **Why now:** nothing protects `main` yet (M2 found the gap). C3 and C4 add their checks on top of this.
- **Process:** the first change with no app behaviour, so no specs (`skip_specs: true`). It is built directly, not through `/tdd-apply`, and a probe PR that breaks one check at a time proves the gate.
- **Out of scope:** deployment and images (C4), frontend checks (C3), CodeQL and dependency review, any secret or cloud credential in CI, runs on branches without a PR.
- **Riskiest assumption:** the solution builds and every test passes on GitHub's Linux runner. It has only ever been built on Windows.
- **Scenarios:** none added, modified or removed (no spec-level behaviour changes).

## Why

Roadmap step **C2** (`pm/roadmap.md`), with the addition from M2 (roadmap change log, 2026-11-05): no step had turned on `docs/conventions/workflow.md § 4` ("every CI check blocks the merge"). Today `main` has no ruleset and no branch protection, and no workflow exists, so a PR merges whatever its state. No use case directly: this protects the work on UC1–UC3.

## What Changes

- **A CI workflow** that builds the solution and runs all three test projects (the traceability check included) on every pull request: when it is opened or reopened and on every new push to it. Nothing runs for a branch without a pull request (design.md D2).
- **A PR title check:** the title must be a Conventional Commit, because squash merge makes it the commit title on `main` (`workflow.md § 3`).
- **A ruleset on `main`:** a pull request is required and the CI checks must pass before a merge, with the branch up to date and no bypass. Its contents, where it is kept and how it is applied: design.md D4 and D5.
- **Proof:** a throwaway probe PR breaks one check at a time and must be refused a real merge while a check is red; it is closed without merging (design.md D6).
- **Process for tooling-only changes** (design.md D1): this change has no specs and is applied directly, without the test-writer and implementer. `openspec/config.yaml` (apply guidance and task groups) and `CLAUDE.md` get the matching exception; `workflow.md § 6` describes it.
- **Docs:** `workflow.md § 4` lists the concrete checks; `docs/operations/` records the ruleset and how to restore it (for D1); a software-factory lesson, inventory entry and divergence entry (no CodeQL or dependency review, design.md D7); the roadmap change log records that C2 runs on pull requests only (its goal said "every push and pull request").

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. CI changes how the repository accepts code, not what the app does, so the change sets `skip_specs: true`.

## Non-goals

- **Deployment** (C4): no image build, no publishing, no Azure sign-in. PR CI holds no credentials and no secrets (`workflow.md § 4`).
- **Frontend build, lint and tests** (C3), and the TypeScript client drift check (C3, once the client exists).
- **A CI job against Enable Banking's hosted Mock ASPSP** (`docs/conventions/testing.md § Fake bank`).
- **Security scanning:** CodeQL and dependency review (design.md D7).
- **CI on branch pushes without a pull request, and on `main` after the merge** (design.md D2).
- **Automated releases or a changelog** (`workflow.md § 3`).
- **Moving to .NET 11 GA:** CI reads the SDK version from `global.json`, so the GA follow-up PR needs no CI change.

## Open questions

- Applies and decides none of Q1–Q10.

## Impact

- **New files:** `.github/workflows/` (CI and the title check); the ruleset's JSON definition and its page in `docs/operations/` (design.md D5).
- **GitHub settings:** a ruleset on `main` (a hand-made setting, recorded in `docs/operations/`). No other repository setting changes.
- **Process files:** `openspec/config.yaml`, `CLAUDE.md`, `docs/conventions/workflow.md` §§ 3, 4 and 6, `docs/conventions/testing.md`, `.claude/rules/testing.md`.
- **Docs:** `docs/operations/`, `docs/software-factory/` (lesson, inventory, divergence), `pm/progress.md`, roadmap change log.
- **No change to:** app code, tests, Azure, Entra, Enable Banking.
