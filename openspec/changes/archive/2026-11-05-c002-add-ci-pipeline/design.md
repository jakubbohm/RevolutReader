# Design: c002-add-ci-pipeline

## TL;DR

- **Tooling-only:** no specs, built directly, proven by a probe PR (D1), because CI changes how code is accepted, not what the app does.
- **When:** on pull requests only, when opened or reopened and on every new push (D2); a branch without a PR is work in progress.
- **Checks:** `build-and-test` (build, then all tests, on Linux) and `pr-title` (a short shell script: a Conventional Commit, the roadmap step not required) (D3, D8). No actions other than GitHub's own.
- **Ruleset on `main`:** PR required, squash only, both checks required from GitHub Actions, branch up to date, no force-push or deletion, no bypass (D4). A JSON file in `docs/operations/`, applied by Claude on the user's go (D5).
- **Proof:** this PR green, then the ruleset, then a probe that breaks one check at a time and must be refused a real merge (D6).
- **Left out:** CodeQL and dependency review, a recorded divergence (D7).
- **New public interfaces:** none in the app; the check names `build-and-test` and `pr-title` are what the ruleset requires.
- **Integration points:** GitHub Actions and the ruleset. No Azure, no secrets.
- **Hard to reverse:** nothing, but with no bypass a broken CI blocks every merge until the owner switches the ruleset off.

## Context

- See proposal.md § Why. State checked on 2026-11-05 (`gh api`):
  - No `.github/` folder; `main` has no ruleset and no branch protection.
  - Repository settings from M2: squash merge only, the squash commit takes the PR title and the branch's commit messages, head branches deleted on merge. Workflow token read-only by default. Fork PRs from first-time contributors need approval to run. Secret scanning and push protection are on.
- Facts the decisions rest on (verified 2026-11-05):
  - Rulesets are available for public repositories on GitHub Free ([managing rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets)).
  - A required check from a workflow skipped by path or branch filters stays "Pending" and blocks the merge; a job skipped by an `if` condition reports success ([troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)). A required check can be pinned to the app that must report it; GitHub Actions is app id 15368.
  - `actions/checkout` v7.0.1 (2026-07-20); `actions/setup-dotnet` v6.1.0 (2026-11-03), v6.0.0 (2026-07-16). setup-dotnet's `global-json-file` installs the exact prerelease SDK that `global.json` pins ([setup-dotnet](https://github.com/actions/setup-dotnet)), so the .NET 11 GA follow-up changes only `global.json`.
  - TUnit writes a test summary to the GitHub run page on its own when it runs in GitHub Actions ([TUnit CI/CD reporting](https://tunit.dev/docs/execution/ci-cd-reporting)).
  - A `${{ }}` expression inside a `run:` script is pasted into the script text before it runs, so a crafted PR title can run commands ([script injections](https://docs.github.com/en/actions/concepts/security/script-injections)); GitHub's mitigation is an intermediate environment variable ([secure use § Use an intermediate environment variable](https://docs.github.com/en/actions/reference/security/secure-use)).
  - With "Always suggest updating pull request branches" off (as here), the PR page offers "Update branch" only when the base branch requires branches to be up to date and the PR is behind ([managing suggestions to update pull request branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-suggestions-to-update-pull-request-branches)).
  - A ruleset can be created from a JSON file on the repository's settings page, as well as through the API ([managing rulesets for a repository § Importing a ruleset](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository)).
  - Dependency review needs GitHub's dependency graph ([about dependency review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review)). For this repository the graph lists no package file (GraphQL `dependencyGraphManifests`: 0). GitHub's NuGet entry names project files and `packages.config`; it does not mention `Directory.Packages.props`, where this repository keeps its versions ([supported package ecosystems](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems)). Dependabot alerts and security updates are off; CodeQL's default setup is not configured.
  - `amannn/action-semantic-pull-request` v6.1.2 was published on 2026-11-05. Its README's example runs on `pull_request_target`, passes `GITHUB_TOKEN` and asks for `pull-requests: read` ([README](https://github.com/amannn/action-semantic-pull-request)).
- The solution has only been built on Windows. Read for Linux: `.gitattributes` forces CRLF for `*.cs` (the build's layout check expects it); the traceability check normalizes line endings and finds the repository root by its `openspec/` folder. No test needs Docker or a secret.

## Goals / Non-Goals

**Goals:**

- A failing build, test or PR title blocks the merge, with no way around it short of changing the ruleset.
- CI holds no credentials and publishes nothing.

**Non-Goals** (design level; scope in proposal.md § Non-goals):

- No caching, matrix builds or test sharding: the suite runs in about a second locally.

## Decisions

### D1. A tooling-only change: no specs, built directly, proven by a probe

CI changes how the repository accepts code, not what the app does. So there is no scenario to specify and no failing test to write first.

- **Chosen (the user, 2026-11-05):** an OpenSpec change with `skip_specs: true` (OpenSpec's documented opt-out for tooling changes). Proposal, design and tasks are reviewed before anything is built, and the change is archived as usual. Claude builds it directly; the test-writer and implementer have nothing to do. A probe PR whose CI fails must be blocked; that is the proof the roadmap asks for ("checked by a PR whose CI fails and cannot be merged").
- **Consequences:** `openspec/config.yaml` (apply guidance: "only through /tdd-apply"; task groups that start with acceptance tests) and `CLAUDE.md` get an exception for `skip_specs` changes, and `workflow.md § 6` describes it. Settled with tasks.md (the user, 2026-11-05): such a change's `tasks.md` has groups named after its work instead of the test-first groups, and Claude commits at the end of each group on the change branch with the tag `[apply]` and the type by content, under the same standing exception as `/tdd-apply` (never pushing, never committing on `main`).
- **Rejected:** a made-up capability (e.g. `merge-gate`) with scenarios claimed as manual rows. It fits the traceability machinery, but `openspec/specs/` would then hold repository rules instead of app behaviour, the check would track them forever, and manual rows belong to the handover steps (M5, M7).
- **Rejected:** a plain PR without OpenSpec. Fastest, but there is no review before building and no record of the change, and C2's step type in the roadmap would change.
- **Software factory:** a lesson (new): how a step with no app behaviour goes through a spec-driven, test-first workflow.

### D2. CI runs on pull requests only

- **Chosen (the user, 2026-11-05):** the workflow runs when a pull request is opened or reopened and on every new push to it. Nothing runs for a branch without a pull request, and nothing runs on `main` after the merge.
- **Why:** a branch without a PR is work in progress, and `/tdd-apply` commits locally and never pushes. A run on `main` after the merge could block nothing, and `workflow.md § 4` says every check either blocks or is deleted.
- **Rejected:** also on pushes to `main`. It would catch two PRs that pass alone but break together, but only after the merge, as a red `main` that blocks nothing (advisory until C4 could use it to stop a deploy). Whether `main` must hold exactly the files CI tested is settled by the ruleset (D4).
- **Rejected:** on every push to every branch plus pull requests (the roadmap's wording). Every commit on a PR branch would run twice.
- **Roadmap:** C2's goal says "on every push and pull request"; the roadmap change log records the narrower trigger.

### D3. The PR title is checked by a short script in its own workflow

- **Chosen (the user, 2026-11-05):** a workflow of its own with one job and no third-party action. A few lines of shell match the title against `<type>(<scope>)!: <subject>`. The type is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert` (the usual Conventional Commits list); the scope in parentheses and the `!` are optional; the subject is not empty. On failure, the message shows the expected form and an example.
- **When it runs:** when a pull request is opened, reopened or edited, and on every new push to it. `edited` re-runs only this check when the title is fixed, not the build. Every new push needs it too, because a required check must report on the PR's latest commit.
- **Safety:** the title reaches the script through an environment variable and is never pasted into the script text (GitHub's mitigation for script injection, § Context).
- **Not required:** the roadmap step in the title (e.g. "(C1)"), because some PRs have none, e.g. the .NET 11 GA update. Every PR title merged so far passes.
- **Rejected:** `amannn/action-semantic-pull-request`, the common choice. It has friendlier messages and more options, but it puts outside code into every PR's pipeline, so it would have to be pinned to an exact commit and kept updated (its latest release came out the day this was decided). It reads the PR through the API with a token, and its README's example uses `pull_request_target`, a trigger that runs with the base repository's rights.

### D4. What the ruleset on `main` enforces

- **Chosen (the user, 2026-11-05):** one active ruleset on the default branch (`main`):
  - **A pull request for every change.** No approval is required: the only person cannot approve their own PR. Squash merge only, as in the repository settings.
  - **Required checks:** the build and tests, and the PR title (check names fixed with the workflow details). Each is pinned to GitHub Actions, so nothing else can satisfy it by reporting a result under the same name.
  - **The branch is up to date with `main` before merging.** If `main` has moved since the PR went green, the PR page offers "Update branch" (§ Context) and CI runs again. With squash merge, `main` then always holds exactly the files CI tested, so two PRs that pass alone but break together cannot both land (the point D2 left open).
  - **No force-push to `main` and no deleting it.**
  - **No bypass for anyone,** the admin included. Claude works with the owner's GitHub login, so an admin bypass would let Claude merge past a red check too.
- **Escape hatch:** if CI itself is broken (e.g. a GitHub outage), the owner switches the ruleset off for that merge and back on: deliberate and visible.
- **Consequence:** Claude never changes or switches off the ruleset without the user's explicit go; `CLAUDE.md` gets that rule.
- **Rejected:** no up-to-date requirement. Fewer re-runs, but `main` could receive a combination CI never tested.
- **Rejected:** an admin bypass. A quicker way out in an emergency, but also a quiet way to merge a red PR, for Claude as well.

### D5. The ruleset is kept as a file and applied by command

- **Chosen (the user, 2026-11-05):** the ruleset's definition is a JSON file in `docs/operations/`, with a page beside it in the shape of `azure-prerequisites.md`: what the ruleset is, the PowerShell command that creates or updates it, a read-only check and how to remove it. Claude applies it with one `gh api` call, only after the user's explicit go at that moment, and reads it back to check it. C3 and C4 edit the file to add their checks and re-apply it the same way. The page's commands serve the owner and, later, the reinstatement guide (D1).
- **Not in `.github/`:** GitHub never reads rulesets from the repository, so a file there would look as if it applied itself.
- **Drift:** an edit on GitHub's settings page leaves the file out of date; the page's check shows the live ruleset to compare.
- **Rejected:** set up by hand on the settings page and described in prose, like the M2 repository settings in `workflow.md § 3`. There is no file, but C3 and C4 would each click again, restoring it would mean re-clicking about ten options, and a missed box goes unnoticed.
- **Rejected:** the user runs the command. Same result, more work for the user.

### D6. The proof: this PR green, then the ruleset, then a step-by-step probe

- **Chosen (the user, 2026-11-05):**
  1. This change's PR is opened and its CI must go green, which is also the first Linux build. The checks then exist under their real names, so the ruleset names them exactly.
  2. Claude applies the ruleset (D5).
  3. A probe PR, branched off this change's branch, breaks one thing at a time: a deliberately failing test with a valid title, then a passing test with an invalid title, then both fixed. The first two must leave it blocked; the last must make it mergeable, which shows the ruleset does not simply block everything. At each step Claude reads the PR's merge state from GitHub. While it reads blocked, Claude also tries a real merge, which GitHub must refuse: the roadmap's "cannot be merged" taken literally. If the state reads anything but blocked while a check is red, Claude stops without trying.
  4. The probe is closed without merging and its branch deleted. The closed PR stays on GitHub as evidence; its link and each step's result go into the ruleset page in `docs/operations/`.
  5. The change is archived, then this PR is merged: the first merge through the ruleset.
- **Cost:** about four extra CI runs of a few minutes each. Each push and PR still needs the user's go; one go may cover the whole sequence.
- **Rejected:** one probe with both failures at once. Quicker, but it does not show that each check blocks on its own.
- **Rejected:** merge this change first, then apply the ruleset and probe from `main`. Simpler branching, but this change itself would merge unchecked.

### D7. No security scanning in CI: CodeQL and dependency review stay out

- **Chosen (the user, 2026-11-05):** neither CodeQL nor dependency review runs on pull requests. DoseUp's other PR checks are covered elsewhere: build and tests here; frontend lint, types and TypeScript client drift in C3; Bicep lint with the Bicep in C4; browser end-to-end tests left out on purpose (divergence R-14). Formatting needs no check of its own, because layout errors already fail the build (IDE0055).
- **Why:** about two months, one developer and few packages. Dependency review would check nothing today, because GitHub's dependency graph sees no package file of this repository (§ Context). CodeQL would add a run of a few minutes to every PR, and under `workflow.md § 4` it would have to block. Whether it already understands C# 15 was not checked.
- **Rejected:** CodeQL alone as a required check. It would catch some security bugs, at the cost of minutes per PR and the risk of blocking every PR on syntax it does not know.
- **Software factory:** a divergence entry (the full version is DoseUp's PR gate 6). Given up: a known-vulnerable package or a typical security bug is not flagged automatically. Switch back when the app lives longer than planned, or gets more packages or contributors.

### D8. Workflow details

- **Chosen (the user, 2026-11-05):**
  - **Names:** `.github/workflows/ci.yml` with the job `build-and-test`, and `.github/workflows/pr-title.yml` with the job `pr-title`. The ruleset requires checks by these exact names; C3 adds its own.
  - **Steps of `build-and-test`:** check out, install the SDK that `global.json` pins, build, test, as separate steps so the run page shows whether the build or the tests failed.
  - **Runner:** GitHub's standard Linux runner (`ubuntu-latest`); a Windows runner is the fallback (§ Risks).
  - **No manual trigger:** the PR page's re-run button covers a re-run, and D2 says CI never runs without a PR.
  - **A newer push cancels the older run** of the same workflow on the same PR: only the result for the latest commit counts.
  - **Time limits:** 15 minutes for `build-and-test`, 5 for `pr-title`; GitHub's default is 6 hours.
  - **Token rights, written into each workflow:** `build-and-test` may only read the repository's contents; `pr-title` gets no rights at all. A later change to the repository default cannot widen them.
  - **Actions:** only GitHub's own `actions/checkout@v7` and `actions/setup-dotnet@v6`, referenced by major version; no third-party actions (D3).
  - **Test report:** TUnit's automatic summary on the run page; nothing is uploaded.

## Software factory

- **Lessons:** how a step with no app behaviour goes through the spec-driven, test-first workflow (D1); the merge gate as a whole (D3–D6), which DoseUp has not built yet (its ADR-0004 records only the squash-only ruleset and "title lint in CI"): an inline title check, required checks pinned to GitHub Actions, up to date before merging, no bypass, the ruleset kept as a file and applied by command, and a probe that breaks one check at a time.
- **Divergence (a lesson and a divergence entry under one id):** no CodeQL or dependency review (D7).
- **Inventory:** the two workflows, and the ruleset file with its page.

## Not applicable

The project's design rules ask for a public API sketch, a rule-ownership table, an error model, ports and contracts, and how each scenario is verified. None applies: the change adds no specs and no app code.

## Risks / Trade-offs

- [The first Linux build fails, e.g. on file-name casing or line endings] → fix it within this change. If Linux itself is the problem, fall back to a Windows runner.
- [A wrong ruleset lets the probe's merge attempt through, and a failing test lands on `main`] → the attempt is made only while GitHub reports the PR as blocked; if it lands anyway, a revert PR follows at once and the ruleset is fixed before anything else merges.
