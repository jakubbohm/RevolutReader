# Ruleset on `main`

> What roadmap step C2 set up by hand on GitHub so that a failing CI check blocks the merge. The definition is [main-ruleset.json](main-ruleset.json). This page says why it looks the way it does, how to create, update, check and remove it, and how it was proven. The reinstatement guide (D1) and decommissioning (M8) build on this file.
>
> Commands are PowerShell 7 and run with the owner's `gh` login, an admin of the repository. **Claude never changes, switches off or deletes this ruleset without the user's explicit go.** Last updated: 2026-11-06 (C3: `frontend` added and applied on the user's go).

## Identifiers (non-secret)

| What | Value |
|---|---|
| Repository | `jakubbohm/RevolutReader` |
| Ruleset | name `main`, id `26623567` (created 2026-11-05); applies to the default branch |
| Required checks | `build-and-test`, `frontend` and `image-and-infra` ([ci.yml](../../.github/workflows/ci.yml)), and `pr-title` ([pr-title.yml](../../.github/workflows/pr-title.yml)), each reported by the GitHub Actions app (id 15368). `frontend` added in C3: applied 2026-11-06 with the update command below, on the user's go, after its first run passed on [#16](https://github.com/jakubbohm/RevolutReader/pull/16); read back as `build-and-test`, `frontend`, `pr-title`, still active, strict, squash only, no bypass. `image-and-infra` added in C4 (the image and the Bicep the deploy uses, c005 design.md D7): in the file, not applied yet |

## What it enforces, and why

Decided in C2 (c002 design.md D4, D5). The checks themselves: [workflow.md § 4](../conventions/workflow.md#4-cicd).

1. **A pull request for every change to `main`.** No approval is required: the only person cannot approve their own PR. Squash merge only, as in the repository settings ([workflow.md § 3](../conventions/workflow.md#3-git)).
2. **Every required check must pass,** each pinned to the GitHub Actions app, so nothing else can satisfy it by reporting a result under the same name.
3. **The branch must be up to date with `main`** before merging. If `main` has moved since the PR went green, the PR page offers "Update branch" and CI runs again. With squash merge, `main` then holds exactly the files CI tested.
4. **No force-push to `main` and no deleting it.**
5. **No bypass for anyone,** the admin included. Claude works with the owner's GitHub login, so an admin bypass would let Claude merge past a red check too.

## Commands

From the repository root:

```powershell
$repo = 'jakubbohm/RevolutReader'
$file = 'docs/operations/main-ruleset.json'

# Create it (once: a second create makes a second ruleset)
gh api --method POST "repos/$repo/rulesets" --input $file --jq '.id'

# Update it after the file changes (C3 and C4 add their checks this way)
$id = gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main") | .id'
gh api --method PUT "repos/$repo/rulesets/$id" --input $file --jq '.id'
```

### Adding a check (C3 `frontend`, C4 `image-and-infra`)

1. Add the job to a workflow in `.github/workflows/`, with no path or branch filters. A required check that never runs stays "pending" and blocks every merge.
2. In the same PR, add `{ "context": "<job name>", "integration_id": 15368 }` to `required_status_checks` in the file.
3. Once the new job has run green on that PR, apply the update (Claude, on the user's go), then merge. Other open PRs must be updated from `main` anyway (rule 3), and that brings them the new workflow.

## Checks

Read-only:

```powershell
# The rules that apply to main right now, from every ruleset
gh api "repos/$repo/rules/branches/main"

# The ruleset as GitHub stores it, to compare with the file
gh api "repos/$repo/rulesets/$id" --jq '{name, enforcement, conditions, bypass_actors, rules}'

# Whether a PR can be merged, and why not
gh pr view <number> --repo $repo --json mergeStateStatus,statusCheckRollup
```

If the stored ruleset differs from the file, someone edited it on the settings page: decide which one is right, then fix the file or re-apply it.

On creation, GitHub filled in two `pull_request` parameters the first version of the file did not set; the file now carries them as stored. `require_extra_approval_for_unattributed_changes: true` asks for one more approval on a PR that Copilot opens without a human, and only when approvals are required, so with 0 approvals it has no effect ([REST API: rules](https://docs.github.com/en/rest/repos/rules), checked 2026-11-05). `required_reviewers: []` adds no reviewers.

### Proof (C2, 2026-11-05)

**First run on Linux:** on [#5](https://github.com/jakubbohm/RevolutReader/pull/5), the C2 PR itself, `build-and-test` passed in 38 s. `setup-dotnet` installed exactly the SDK `global.json` pins (11.0.100-rc.3.26522.148); the build had 0 warnings, and all 17 tests passed. `pr-title` passed.

**Probe:** [#6](https://github.com/jakubbohm/RevolutReader/pull/6), branched off #5 and closed without merging. At each step Claude read the merge state with `gh pr view --json mergeStateStatus`. While it read `BLOCKED`, Claude tried `gh pr merge --squash` with the owner's admin login.

| Step | Head commit | `build-and-test` | `pr-title` | Merge state | Merge attempt |
|---|---|---|---|---|---|
| 1. A deliberately failing test, valid title | `aaa3baf` | fail (18 tests, 1 failed) | pass | `BLOCKED` | refused: "the base branch policy prohibits the merge" |
| 2. Test removed, title `probe the merge gate` | `2caa6cd` | pass | fail: "The PR title is not a Conventional Commit." | `BLOCKED` | refused, same message |
| 3. Title `test: probe the merge gate (C2)` | `2caa6cd` | pass | pass | `CLEAN` | not tried; closed |

For the owner's login, the read-back of the ruleset reports `current_user_can_bypass: "never"`. A merge with `gh pr merge --admin` was not tried: had the rule been wrong, it would have put the probe on `main`.

## Escape hatch

If CI itself is broken (e.g. a GitHub outage) and a merge cannot wait, the owner switches the ruleset off, merges, and switches it back on. On the settings page: Settings → Rules → Rulesets → `main` → Enforcement status. Or:

```powershell
gh api --method PUT "repos/$repo/rulesets/$id" -f enforcement=disabled --jq '.enforcement'
# ... merge ...
gh api --method PUT "repos/$repo/rulesets/$id" -f enforcement=active --jq '.enforcement'
```

## Removing it (M8)

```powershell
gh api --method DELETE "repos/$repo/rulesets/$id"
```

Deleting the repository removes it as well.
