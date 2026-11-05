---
name: cleanup-branch
description: Clean up the dangling local feature branch left behind after its PR was squash-merged and the remote branch auto-deleted - in the main checkout switch to main, pull, git branch -D; from a Claude Code worktree remove the worktree and its branch, then ask the user whether to update main in the main checkout (another session may be working there). Strictly gated - if the situation is anything other than exactly one of those two scenarios it reports why and takes no action. Use when the user says a PR was merged and wants the local branch cleaned up, or invokes /cleanup-branch.
---

# cleanup-branch

This repo squash-merges PRs and deletes the remote branch on merge. That leaves the local
feature branch behind with a gone upstream, and because of squash merging git never considers
it merged, so it needs `git branch -D`. This skill performs exactly that cleanup and nothing else.
When the work was done in a git worktree (a Claude Code worktree session), the worktree is
left behind too, and the skill removes it together with its branch. It never updates `main`
in the main checkout on its own: another session, an IDE or a terminal may be working there,
and no git check can see that. It asks the user instead.

All decision-making lives inside pre-tested scripts: A for the main checkout, B for a
worktree, C for updating `main` after the user said yes. Your only job is to pick the
scenario, run its scripts, ask the one question below and relay the output. Do not analyze
the git state yourself, before or after.

## Procedure

Pick the scenario from where this session is working:

- **A. Main checkout:** the session's working directory is the repository's main checkout,
  not a worktree. Run script A.
- **B. Worktree:** the session is working in a linked git worktree (the environment says
  "This is a git worktree", usually under `.claude/worktrees/`). Do these steps in order:
  1. Note the worktree's path: the session's current primary working directory.
  2. Call **ExitWorktree with action `keep`**. Never `remove`: it skips this skill's checks,
     and it tracks the branch under the name the worktree was created with, which is wrong
     once the branch was renamed. If ExitWorktree reports that no worktree session is active
     (the session was started inside the worktree), stop and tell the user to run
     `/cleanup-branch` from a session in the main checkout.
  3. Run script B, changing only the placeholder `<worktree-path>` to the path from step 1
     (backslashes or forward slashes both work).
  4. If script B ends with `CLEANED-UP` and says main is more than 0 commits behind, ask the
     user with **AskUserQuestion** (single choice; the question must stand on its own):
     - question: "The merged worktree `<worktree>` and its branch `<branch>` are removed.
       Local main in the main checkout `<main checkout path>` is <N> commit(s) behind
       origin/main. Update it now? Only if no other session, IDE or terminal is working in
       that checkout."
     - header: "Update main"
     - options: "Update main now" (description: "Fast-forward main in the main checkout. The
       script still refuses if it finds uncommitted or untracked files, a merge or rebase in
       progress, or unpushed commits on main.") and "Leave it behind" (description: "Main
       stays N commits behind; update it yourself where you work in it.").

     Make no recommendation: the user knows what is going on in that checkout.
  5. Only if the user picks "Update main now": run script C. Anything else, including a
     free-text answer that is not a clear yes, means main stays as it is.
  6. Stop. The session now stands in the main checkout, which may belong to another session:
     do no further work there. If the user wants to continue in this session, start a new
     worktree (EnterWorktree) first.

  Why B leaves the worktree first: inside a worktree session, Claude Code refuses any git
  command that targets another checkout, and any command too complex to verify that it stays
  in the worktree (script A was refused that way). A worktree also cannot be removed from
  inside itself. Script B touches only git's shared data (remote refs, the worktree, the
  branch), never the main checkout's files; only script C, run after the user's yes, does.

Run each script **verbatim, as one single Bash tool call**. Do not translate it to
PowerShell, do not split it into separate commands, do not change branch names, flags, or
messages. It is safe to run in any situation: every check happens before any mutation, and
every refusal exits without changing anything.

### Script A - main checkout

```sh
cleanup_branch() {
  # "$*" on purpose: Claude Code replaces a dollar sign followed by a digit in a skill with the skill's arguments.
  refuse() { printf 'NOT-THIS-SCENARIO: %s\n' "$*"; exit 0; }

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

### Script B - worktree (run from the main checkout, after ExitWorktree `keep`)

```sh
cleanup_worktree() {
  # "$*" on purpose: Claude Code replaces a dollar sign followed by a digit in a skill with the skill's arguments.
  refuse() { printf 'NOT-THIS-SCENARIO: %s\n' "$*"; exit 0; }
  fail() { printf 'ERROR: %s\n' "$*"; exit 1; }

  wt='<worktree-path>'

  git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || refuse "not inside a git worktree"

  [ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ] \
    || refuse "the session is still inside a linked worktree - call ExitWorktree with action keep first"
  main_top=$(git rev-parse --show-toplevel)

  [ -d "$wt" ] || refuse "'$wt' is not a directory - fill in the path of the worktree the session left"
  wt_top=$(git -C "$wt" rev-parse --show-toplevel 2>/dev/null) \
    || refuse "'$wt' is not inside a git worktree"
  [ "$(git -C "$wt_top" rev-parse --path-format=absolute --git-common-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ] \
    || refuse "'$wt_top' belongs to a different repository"
  [ "$wt_top" != "$main_top" ] || refuse "'$wt_top' is the main checkout, not a linked worktree"

  branch=$(git -C "$wt_top" branch --show-current)
  [ -n "$branch" ] || refuse "the worktree's HEAD is detached, not on a branch"
  [ "$branch" != "main" ] || refuse "the worktree is on main - there is no feature branch to clean up"

  [ -z "$(git -C "$wt_top" status --porcelain)" ] \
    || refuse "the worktree has uncommitted or untracked files - they would be lost with it"

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
  [ "$(git rev-parse "refs/heads/$branch")" = "$pr_head" ] \
    || refuse "local '$branch' tip does not match the merged PR head ($pr_head) - possible unpushed commits, refusing to delete"

  git worktree remove "$wt_top" \
    || fail "git worktree remove failed - resolve manually (branch $branch NOT deleted)"
  git branch -D "$branch" \
    || fail "removed worktree $wt_top, but could not delete branch $branch - resolve manually"
  done_msg="removed worktree $wt_top and deleted local branch $branch"

  # Never touch the main checkout's files here: another session may be working in it unseen.
  git show-ref --verify --quiet refs/heads/main \
    || { printf 'CLEANED-UP: %s; there is no local main branch\n' "$done_msg"; exit 0; }
  printf 'CLEANED-UP: %s; main is %s commit(s) behind origin/main\n' "$done_msg" "$(git rev-list --count main..origin/main)"
}
cleanup_worktree
```

### Script C - update main (only after the user said yes)

```sh
update_main() {
  # "$*" on purpose: Claude Code replaces a dollar sign followed by a digit in a skill with the skill's arguments.
  refuse() { printf 'MAIN-NOT-UPDATED: %s\n' "$*"; exit 0; }

  git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || refuse "not inside a git worktree"
  [ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ] \
    || refuse "this is a linked worktree, not the main checkout"

  current=$(git branch --show-current)
  [ "$current" = "main" ] \
    || refuse "the main checkout is on '${current:-a detached HEAD}', not main"
  for marker in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD REBASE_HEAD BISECT_LOG rebase-merge rebase-apply; do
    [ ! -e "$(git rev-parse --git-path "$marker")" ] \
      || refuse "a merge, rebase, cherry-pick, revert or bisect is in progress in the main checkout"
  done
  [ -z "$(git status --porcelain)" ] \
    || refuse "the main checkout has uncommitted or untracked changes"

  git fetch origin --prune --quiet \
    || refuse "git fetch origin --prune failed - check network/auth"
  ahead=$(git rev-list --count origin/main..main)
  [ "$ahead" -eq 0 ] \
    || refuse "local main has $ahead commit(s) that are not on origin/main"
  behind=$(git rev-list --count main..origin/main)
  [ "$behind" -gt 0 ] \
    || { printf 'MAIN-UP-TO-DATE: main already matches origin/main\n'; exit 0; }

  git merge --ff-only --quiet origin/main \
    || { printf 'ERROR: git merge --ff-only origin/main failed - main NOT updated, resolve manually\n'; exit 1; }
  printf 'MAIN-UPDATED: fast-forwarded main by %s commit(s) to origin/main\n' "$behind"
}
update_main
```

## Interpreting the output

Scripts A and B always end with exactly one of three sentinel lines:

- `NOT-THIS-SCENARIO: <reason>` (exit 0) - the current state is not the one this skill
  handles. Nothing was changed. Tell the user the reason verbatim and stop. In scenario B the
  session is now in the main checkout and the worktree is still on disk; say so.
- `CLEANED-UP: ...` (exit 0) - success.
  - Script A: tell the user main is checked out and up to date, and the named branch was
    deleted. Stop.
  - Script B: the named worktree and branch were removed. If main is more than 0 commits
    behind, continue with step 4 (the question); otherwise tell the user and stop.
- `ERROR: <what failed>` (exit 1) - a step failed after the gates passed. Report exactly
  what the output says and stop. Do not retry, do not run recovery commands, do not
  improvise - the user decides what happens next.

Script C always ends with exactly one of these lines:

- `MAIN-UPDATED: ...` or `MAIN-UP-TO-DATE: ...` (exit 0) - tell the user and stop.
- `MAIN-NOT-UPDATED: <reason>` (exit 0) - nothing was changed. Tell the user the reason
  verbatim, that main is still behind, and stop.
- `ERROR: <what failed>` (exit 1) - as above: report it exactly and stop.

## Hard rules

- Never run `git switch`, `git pull`, `git fetch`, `git merge`, `git worktree remove`,
  `git branch -d`/`-D`, or `git push` yourself while this skill is active - the scripts are
  the only things that touch git.
- Never call ExitWorktree with action `remove` for this skill; scenario B uses `keep` and
  lets script B remove the worktree after its checks.
- Never run script C without the user's explicit "Update main now" in this run of the skill,
  and never ask again or retry after a `MAIN-NOT-UPDATED` result.
- After scenario B, do no further work in the main checkout.
- Never modify a script (in script B, only the `<worktree-path>` placeholder is filled in),
  and never re-run a script after an `ERROR:` result.
- If the user wants the branch or worktree deleted anyway despite a `NOT-THIS-SCENARIO`
  result, that is a manual decision outside this skill: relay the reason and let the user
  issue explicit instructions - do not act on your own.

## What the gates check (reference only - the scripts already do all of this)

Script A (main checkout):

1. Inside a git worktree, and it is the **main** worktree (not a linked one).
2. On a branch (not detached), and that branch is not `main`.
3. No uncommitted changes to tracked files (untracked files are allowed).
4. The branch has an upstream configured on `origin`.
5. After `git fetch origin --prune`, that upstream is `[gone]` (remote branch deleted).
6. `gh` finds a PR for the branch, its state is `MERGED`, and the local branch tip equals
   the merged PR's head commit (so `-D` cannot lose unpushed work).
7. A local `main` branch exists to switch to.

Script B (worktree):

1. Run from the **main** worktree (the session has left the linked one).
2. The given path is a linked worktree of the same repository, not the main checkout.
3. The worktree is on a branch that is not `main`.
4. The worktree has no uncommitted changes and no untracked files (gitignored files, such as
   build output, are removed with it).
5. Gates 4-6 of script A for the worktree's branch: upstream on `origin`, `[gone]` after the
   fetch, PR `MERGED`, local tip equals the merged PR head.
6. Then it removes the worktree and deletes the branch, and reports how far `main` is
   behind `origin/main`. It never changes the main checkout's files.

Script C (update main, after the user's yes):

1. Run from the **main** worktree, which is on `main`.
2. No merge, rebase, cherry-pick, revert or bisect in progress there, and no uncommitted or
   untracked changes.
3. After a fresh `git fetch origin --prune`, local `main` has no commits missing from
   `origin/main`.
4. Then it fast-forwards `main` to `origin/main`. The checks cannot see another session
   that has not changed anything yet; that is why the user is asked first.
