---
name: cleanup-branch
description: Clean up the dangling local feature branch left behind after its PR was squash-merged and the remote branch auto-deleted - switch to main, pull, git branch -D. Strictly gated - if the situation is anything other than exactly that scenario it reports why and takes no action. Use when the user says a PR was merged and wants the local branch cleaned up, or invokes /cleanup-branch.
---

# cleanup-branch

This repo squash-merges PRs and deletes the remote branch on merge. That leaves the local
feature branch behind with a gone upstream, and because of squash merging git never considers
it merged, so it needs `git branch -D`. This skill performs exactly that cleanup and nothing else.

All decision-making lives inside one pre-tested script. Your only job is to run it and relay
its output. Do not analyze the git state yourself, before or after.

## Procedure

Run the script below **verbatim, as one single Bash tool call**. Do not translate it to
PowerShell, do not split it into separate commands, do not change branch names, flags, or
messages. It is safe to run in any situation: every check happens before any mutation, and
every refusal exits without changing anything.

```sh
cleanup_branch() {
  refuse() { printf 'NOT-THIS-SCENARIO: %s\n' "$1"; exit 0; }

  git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || refuse "not inside a git worktree"

  [ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ] \
    || refuse "this is a linked worktree, not the main worktree"

  branch=$(git branch --show-current)
  [ -n "$branch" ] || refuse "HEAD is detached, not on a branch"
  [ "$branch" != "main" ] || refuse "already on main - there is no dangling feature branch checked out"

  [ -z "$(git status --porcelain --untracked-files=no)" ] \
    || refuse "tracked files have uncommitted changes - commit or stash before cleanup"

  [ "$(git config --get "branch.$branch.remote")" = "origin" ] \
    || refuse "branch '$branch' has no upstream on origin - it never tracked a remote branch"

  git fetch origin --prune --quiet \
    || refuse "git fetch origin --prune failed - check network/auth, then rerun the skill"

  [ "$(git for-each-ref --format='%(upstream:track)' "refs/heads/$branch")" = "[gone]" ] \
    || refuse "origin/$branch still exists - its PR has not been merged-and-deleted yet"

  if ! pr=$(gh pr view "$branch" --json state,headRefOid --jq '.state + " " + .headRefOid' 2>&1); then
    refuse "could not confirm a PR for '$branch' via gh: $pr"
  fi
  state=${pr%% *}
  pr_head=${pr#* }
  [ "$state" = "MERGED" ] || refuse "the PR for '$branch' has state $state, not MERGED"
  [ "$(git rev-parse HEAD)" = "$pr_head" ] \
    || refuse "local '$branch' tip does not match the merged PR head ($pr_head) - possible unpushed commits, refusing to delete"

  git show-ref --verify --quiet refs/heads/main \
    || refuse "no local 'main' branch exists to switch to"

  git switch main \
    || { printf 'ERROR: git switch main failed - resolve manually\n'; exit 1; }
  git pull --ff-only origin main \
    || { printf 'ERROR: git pull --ff-only origin main failed - local main has diverged, resolve manually (branch %s NOT deleted)\n' "$branch"; exit 1; }
  git branch -D "$branch" \
    || { printf 'ERROR: could not delete branch %s - resolve manually\n' "$branch"; exit 1; }
  printf 'CLEANED-UP: switched to main, pulled origin/main, deleted local branch %s\n' "$branch"
}
cleanup_branch
```

## Interpreting the output

The script always ends with exactly one of three sentinel lines:

- `NOT-THIS-SCENARIO: <reason>` (exit 0) - the current state is not the one this skill
  handles. Nothing was changed. Tell the user the reason verbatim and stop.
- `CLEANED-UP: ...` (exit 0) - success. Tell the user: main is checked out and up to date,
  and the named branch was deleted. Stop.
- `ERROR: <what failed>` (exit 1) - a step failed after the gates passed. Report exactly
  what the output says and stop. Do not retry, do not run recovery commands, do not
  improvise - the user decides what happens next.

## Hard rules

- Never run `git switch`, `git pull`, `git fetch`, `git branch -d`/`-D`, or `git push`
  yourself while this skill is active - the script is the only thing that touches git.
- Never modify the script, and never re-run it after an `ERROR:` result.
- If the user wants the branch deleted anyway despite a `NOT-THIS-SCENARIO` result, that is
  a manual decision outside this skill: relay the reason and let the user issue explicit
  instructions - do not act on your own.

## What the gates check (reference only - the script already does all of this)

1. Inside a git worktree, and it is the **main** worktree (not a linked one).
2. On a branch (not detached), and that branch is not `main`.
3. No uncommitted changes to tracked files (untracked files are allowed).
4. The branch has an upstream configured on `origin`.
5. After `git fetch origin --prune`, that upstream is `[gone]` (remote branch deleted).
6. `gh` finds a PR for the branch, its state is `MERGED`, and the local branch tip equals
   the merged PR's head commit (so `-D` cannot lose unpushed work).
7. A local `main` branch exists to switch to.
