# Tasks

A tooling-only change (`skip_specs: true`, design.md D1): applied directly with `/opsx:apply`, not through `/tdd-apply`. Each group ends with one commit on the change branch, `<type>(c002): [apply] <summary>`, with the type by content (task 1.3). Nothing is pushed before group 4. In group 4, every push, every PR, applying the ruleset and every merge attempt need the user's go; one go may cover the whole group.

## 1. Process for tooling-only changes (D1)

- [x] 1.1 `openspec/config.yaml`:
  - The apply guidance applies a change whose `.openspec.yaml` sets `skip_specs: true` directly, task by task, each task checked as it states, and keeps `/tdd-apply` for every other change.
  - The tasks rules give such a change groups named after its work instead of the `[acceptance]` to `[wiring]` groups; its last group closes it.
  - The context line on test-first implementation names the exception.
  - The archive guidance notes that such a change has no acceptance tests.
  - Verify: `openspec validate c002-add-ci-pipeline` passes, and `openspec instructions apply --change c002-add-ci-pipeline --json` shows the new guidance.
- [x] 1.2 The same exception, one sentence each, where the apply rule is written: `CLAUDE.md § Workflow`, `docs/conventions/testing.md § Test-first workflow` and `.claude/rules/testing.md`. `docs/conventions/workflow.md § 6` describes tooling-only changes: when `skip_specs` fits (a change to how the repository accepts code, not to what the app does), how such a change is applied, and that anything with an effect outside the repository is proven live (here: the probe). Verify: a search for `/tdd-apply` in those files finds no apply rule without the exception; every new link resolves.
- [x] 1.3 `docs/conventions/workflow.md § 3`: the tag table gets `[apply]`: a tooling-only change applied directly, one commit per task group, the type by content (`ci`, `docs`, `chore`), committed by Claude at the end of each group. The standing commit exception covers it: never pushing, never committing on `main`. Verify: the new row has the table's four columns.
- [x] 1.4 `docs/software-factory/lessons.md` R-34 *(New)*: how a step with no app behaviour goes through a spec-driven, test-first workflow. The options: a made-up capability with manual rows · a plain PR · a change with `skip_specs`, applied directly and proven live. In the inventory of `creating-handover-package.md`, the `openspec/config.yaml` and `workflow.md § 3` rows get R-34. Verify: the entry follows the format, and R-34 is the next free id across `lessons.md` and `divergences.md`.

## 2. Workflows (D2, D3, D7, D8)

- [x] 2.1 `.github/workflows/ci.yml`:
  - The job `build-and-test` runs on `pull_request` (opened, synchronize, reopened), with no path or branch filters, on `ubuntu-latest`.
  - It has `permissions: contents: read` and `timeout-minutes: 15`.
  - One concurrency group per workflow and PR cancels the older run.
  - Steps: `actions/checkout@v7`; `actions/setup-dotnet@v6` with `global-json-file: global.json`; `dotnet build`; `dotnet test --no-build` as a separate step.
  - Verify locally: the same build and test commands pass from the repository root (`dotnet test` exits 0). The run on GitHub is checked in 4.1.
- [x] 2.2 `.github/workflows/pr-title.yml`:
  - The job `pr-title` runs on `pull_request` (opened, edited, synchronize, reopened), on `ubuntu-latest`, with no checkout.
  - It has `permissions: {}`, `timeout-minutes: 5` and the same concurrency rule.
  - The title reaches the script only through `env:`. A bash regular expression accepts `<type>(<scope>)!: <subject>` with D3's types, an optional non-empty scope, an optional `!` and a non-empty subject. On failure, the message shows the expected form and an example.
  - Verify locally, running the script in Git Bash with the title set:
    - it accepts the titles of PRs #1 to #4 (`gh pr list --state merged`), `ci: add CI pipeline (C2)` and `feat(c002)!: drop x`;
    - it rejects `Add CI`, `feat:add`, `feature: add`, `feat(): add` and `feat: `;
    - for a title containing `$(…)` or backticks, it only matches the text and runs nothing.
- [x] 2.3 `docs/conventions/workflow.md § 4`:
  - the concrete checks `build-and-test` and `pr-title`;
  - CI runs on pull requests only (D2);
  - a required workflow never gets path or branch filters (a skipped required check stays pending and blocks the merge);
  - security scanning is left out (link R-35).

  Verify: every new link resolves.
- [x] 2.4 `pm/roadmap.md` C2 goal: "on every pull request" instead of "on every push and pull request". The roadmap change log in `pm/progress.md` gets a row (D2, approved by the user 2026-11-05). Verify: the row has the log's three columns.
- [x] 2.5 `docs/software-factory/`: `lessons.md` R-35 *(Divergence, relates to DoseUp's ADR-0004 PR gate 6)*: security scanning on pull requests. `divergences.md` R-35: what is given up and when to switch back (D7). Verify: both entries follow their file's format and share the id.

## 3. The ruleset (D4, D5)

- [x] 3.1 `docs/operations/main-ruleset.json`:
  - a name, `target: branch`, `enforcement: active`, the condition `~DEFAULT_BRANCH` and `bypass_actors: []`;
  - the rules:
    - `deletion` and `non_fast_forward`;
    - `pull_request`: 0 approvals, the review options off, `allowed_merge_methods: ["squash"]`;
    - `required_status_checks`: strict, with `build-and-test` and `pr-title`, each with `integration_id` 15368.

  Verify: the file parses (`node -e` with `JSON.parse`), and every rule in D4 maps to one entry.
- [x] 3.2 `docs/operations/main-ruleset.md`, in the shape of `azure-prerequisites.md`. It holds:
  - what the ruleset enforces and why (link D4);
  - its identifiers (the ruleset id, filled in by 4.2);
  - PowerShell 7 commands that create it, update it after the file changes, check it read-only and remove it;
  - the escape hatch: switch it off, merge, switch it back on;
  - how C3 and C4 add their checks;
  - the rule that Claude never changes or switches it off without the user's explicit go.

  Verify: the commands are PowerShell 7 and read the file by its path from the repository root.
- [x] 3.3 `CLAUDE.md`: the rule that Claude never changes or switches off the ruleset on `main` without the user's explicit go, and the `docs/operations/` line names the ruleset. Verify: every new link resolves.

## 4. Proof on GitHub (D6)

A step that does not behave as written stops the group, and Claude reports it.

- [x] 4.1 Push the branch and open this change's PR (title `ci: add CI pipeline (C2)`). Verify: `gh pr checks` shows `build-and-test` and `pr-title` passing on the Linux runner. A Linux failure is fixed within this change (design.md § Risks).
- [x] 4.2 Apply the ruleset with the page's create command and record its id in the page. Read it back with `gh api repos/jakubbohm/RevolutReader/rules/branches/main` and compare it with the file. Verify: the read-back shows the four rules, both checks reported by app 15368, strict on, and no bypass actors.
- [x] 4.3 Probe step 1: create the branch `test/c002-probe` off this change's branch, add one deliberately failing test, and open a PR to `main` with a valid title.
  - Verify, once both checks have finished: `build-and-test` fails, `pr-title` passes and `gh pr view --json mergeStateStatus` reads `BLOCKED`.
  - Only then try `gh pr merge --squash`; GitHub must refuse it.
- [x] 4.4 Probe step 2: remove the failing test and change the title to an invalid one. Verify: `build-and-test` passes, `pr-title` fails, the state reads `BLOCKED` and the merge attempt is refused.
- [x] 4.5 Probe step 3: restore a valid title. Verify: both checks pass and the state reads `CLEAN`. Do not merge.
- [x] 4.6 Close the probe without merging and delete its branch, locally and on GitHub. Verify: `gh pr view <n> --json state` reads `CLOSED`, and `git ls-remote --heads origin test/c002-probe` prints nothing.
- [x] 4.7 Record the proof in `docs/operations/main-ruleset.md § Checks`: the probe PR's link, the date, and for each step the check results, the merge state and GitHub's refusal message. Verify: all three steps are there.
- [x] 4.8 Record the merge gate:
  - `docs/software-factory/lessons.md` R-36 *(New)*: how to build and prove a merge gate on a solo public repository (D3 to D6).
  - Inventory lines for `.github/workflows/ci.yml`, `.github/workflows/pr-title.yml` and `docs/operations/main-ruleset.json` with its page.

  Then push this group's commit. Verify: the entry follows the format, the inventory links resolve, and the PR's checks pass again after the push.

## 5. Close

- [x] 5.1 Final check: `dotnet build` and `dotnet test` pass locally, `openspec validate c002-add-ci-pipeline` passes, and the PR's checks pass with its state `CLEAN`. Verify: the commands' output.
- [x] 5.2 `pm/progress.md`, C2's notes: what was done, the probe PR's link and any deviations. The status `done`, the date and the archive link come with the archive commit, after the user confirms that C2 is done. Verify: the notes are there.

## Workflow follow-up

- `/opsx:archive c002-add-ci-pipeline` once the user approves. The archive commit also sets C2 to `done` in `pm/progress.md`.
- Push. The PR is merged through the ruleset on the user's go: the first merge it gates (D6, step 5).
- After the merge: `/cleanup-branch`.
