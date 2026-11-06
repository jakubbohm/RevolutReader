# Tasks

A tooling-only change (`skip_specs: true`, design.md D5): applied directly with `/opsx:apply`, not through `/tdd-apply`. Each group ends with one commit, `<type>(c005): [apply] <summary>`, typed by content (`ci`, `build`, `docs`). Groups 1–5 run on the branch `ci/c005-add-deployment-pipeline` (PR 1). Groups 6–7 run after PR 1's merge on a new branch off `main` (PR 2, design.md D4).

Nothing is pushed before group 5. From group 5 on, these need the owner's go, and one go may cover a list of steps shown together: every push, PR and merge; the ruleset; every write to Azure outside the deploy workflow, the Key Vault values included. A step that does not behave as written stops its group, and Claude reports it.

## 1. Image (D12)

- [x] 1.1 `.dockerignore`, as an allowlist: everything ignored except the paths D12 lists, and within `src/RevolutReader.Web/` never `node_modules/` or `dist/`. Verify: a temporary Dockerfile stage that lists the build context (removed again) shows only the allowlisted paths; nothing under `spikes/`, `.claude/`, `tests/`, `docs/` or any `bin/`, `obj/`, `node_modules/`.
- [x] 1.2 `Dockerfile` with D12's three stages and exact tags: `node:24-slim`, `mcr.microsoft.com/dotnet/sdk:11.0.100-rc.3-resolute`, `mcr.microsoft.com/dotnet/aspnet:11.0.0-rc.3-resolute-chiseled`. The publish runs in Release, without the native app launcher and with analyzers off; the frontend's `dist/` goes to `/app/wwwroot`. Verify: `docker build -t revolutreader:local .` from the repository root succeeds; `docker image ls revolutreader:local` shows the size (expected roughly 60–80 MB compressed on top of the base); `docker inspect` shows user 1654 and port 8080.
- [x] 1.3 A quick start of the local image, with the four `EnableBanking__*` stand-ins of D14 (made-up IDs, a key from `openssl`). Verify, against `http://localhost:8080`:
  - `/health` answers `Healthy`;
  - `/` and a made-up page address such as `/somewhere` return the page with `<div id="root">`;
  - `/api/nothing` returns a problem description with status 404 (spec `api-errors`);
  - `/assets/<a hashed file>` carries the year-long caching header and `/` carries `no-cache` (spec `app-delivery`, c003 D5);
  - the container's log shows no error at start.
- [x] 1.4 `CLAUDE.md` § Commands: rows for the local image build and the quick start, as 1.2 and 1.3 ran them (PowerShell 7 and Bash both). `docs/software-factory/creating-handover-package.md` inventory: a line for the `Dockerfile` and `.dockerignore`. Verify: the rows' commands run as written; the inventory link resolves.

## 2. Infrastructure (D1, D6, D10, D13)

- [x] 2.1 `infra/platform.bicep` (D13): the Log Analytics workspace (per GB, 30 days, 0.1 GB cap); Key Vault (standard, Azure roles, soft delete at the default, purge protection off); the identity `id-revolutreader-app` with Key Vault Secrets User on the vault (the only role assignment in the Bicep, D17); the Container Apps environment (workload profiles, Consumption only, logs to the workspace). Outputs for `main.bicep`. Verify: `az bicep build` and `az bicep lint` on the file report nothing.
- [x] 2.2 `infra/features.bicep` (D10, D13): the container app at the top, with D13's ingress, image, size, scale and probes, the identity, and no settings or secrets. Below it, one commented heading per later feature section (the bank C5, sign-in C6, the account detail C7, push C8). Verify: build and lint report nothing.
- [x] 2.3 `infra/main.bicep`, `infra/main.bicepparam` and `infra/bicepconfig.json` (D13):
  - `main.bicep` calls both modules and outputs `appName`, `appUrl` and `keyVaultName`;
  - the parameter file sets the region and reads `IMAGE_TAG` from the environment; no personal ID anywhere (D17);
  - the config raises the linter's rules to errors;
  - API versions are the newest stable ones the current Bicep knows.

  Verify: `az bicep build`, `az bicep lint` and `az bicep build-params` (with a made-up `IMAGE_TAG`) succeed with no finding. An unused parameter added for the test fails the lint, and is then removed.
- [x] 2.4 The local preview (D7), read-only, with the owner's login:
  - `az stack group validate` with D13's options settles design.md's open question on the flags; record the exact command for 3.2;
  - `az deployment group what-if` on the same files.

  Verify: the what-if creates exactly the workspace, the vault, the identity, its role assignment, the environment and the container app, and changes or deletes nothing that exists (the deploy identity stays as it is).
- [x] 2.5 Docs:
  - `docs/conventions/workflow.md` § 5: the Bicep layout (D1, D10) and the resource table (the log workspace, the container app in `features.bicep`, the package's one-time visibility step);
  - ADR-0006: a dated amendment for the log destination (D6), the private first push with the image check (D3), and the measurement moved to #18 (D9);
  - `docs/software-factory/`: lessons R-46 and R-49, divergence R-46 (D16), and an inventory line for `infra/`.

  Verify: every new link resolves; the entries follow their files' formats. R-44 and R-45 stay free for C5, so R-46 is the next free id after them.

## 3. Pipelines (D3, D7, D8, D14)

- [x] 3.1 `.github/workflows/ci.yml`: the job `image-and-infra` (D14), with the same triggers and no path filters, `contents: read`, `timeout-minutes: 15`, and the header comment naming it as a required check. Verify locally, in Git Bash: the job's Bicep commands and its smoke-run script, run as written against the image from 1.2, pass. A broken image (a stage that deletes `wwwroot`) makes the smoke run fail and print the container's log. The workflow file parses as YAML. The run on GitHub is checked in 5.1.
- [x] 3.2 `.github/workflows/deploy.yml` (D14): the jobs `image` and `deploy`, the permissions, the concurrency group, the timeouts, and the five deploy steps, with the stack command from 2.4. Verify:
  - the file parses as YAML;
  - the image-check script, run locally, passes for a public ghcr.io image and fails, with D3's message and the package link, for a tag that does not exist;
  - the check after the deploy follows D8's three steps (its live proof is 6.2);
  - only M3's four variables and `GITHUB_TOKEN` are used, and nothing reads a secret.
- [x] 3.3 `docs/operations/main-ruleset.json`: `image-and-infra` added to the required checks with integration ID 15368. `main-ruleset.md`: C4's check listed. Verify: the file parses (`node -e` with `JSON.parse`) and lists four checks. It is applied in 5.2.
- [x] 3.4 Docs:
  - `docs/conventions/workflow.md` § 4: the deploy paragraph (what runs on a merge, the two checks, what to do when it is red) and the `image-and-infra` row;
  - lessons R-47 and R-48 (D16), with "confirmed in the first deployment" left for 6.4;
  - inventory lines for `deploy.yml`, and the `ci.yml` row updated.

  Verify: links resolve; formats followed.

## 4. Operations and project docs (D2, D9, D11, D15, D16)

- [x] 4.1 `docs/operations/deployment.md` (D16), in the shape of `azure-prerequisites.md`:
  - the identifiers, with the app's address marked "after the first deploy";
  - what the pipeline does;
  - the first deployment's steps;
  - the guided Key Vault task (D15);
  - read-only checks;
  - rolling back;
  - removing everything (M8).

  Verify: every command is PowerShell 7, and every `az` command names the subscription; no command prints a secret's value; every link resolves.
- [x] 4.2 Pointers to it:
  - `expiring-approvals.md`: § 2 step 4 and § 3 point to the guided task, and the list of what later steps add is brought up to date;
  - `azure-prerequisites.md`: the header points to the deployment page. D17's hand-made step is added as C4's addition to M3's setup: what and why, the command (it looks up the owner's ID when it runs, with the subscription named), the read-only check, and its removal at M8;
  - `CLAUDE.md`: the Bicep check command, the what-if as a pointer, and the `docs/operations/` line naming the deployment page.

  - `docs/conventions/workflow.md` § 5's resource table: a row for D17's hand-made role; `docs/software-factory/lessons.md` R-50 (D16).

  Verify: links resolve; the Bicep command runs as written; no file in the change holds the owner's ID (a search for it finds nothing).
- [x] 4.3 `pm/roadmap.md` C4:
  - the wake-up measurement moved to #18 (D9);
  - the outputs say the app reads its secrets from Key Vault from C5's merge on (D2);
  - the line "updated" in its header.

  The roadmap change log in `pm/progress.md` gets the row for D9 (approved by the user, 2026-11-06). Verify: the row has the log's three columns; the roadmap's C4 text matches design.md D2 and D9.

## 5. PR 1 (D4, D7)

- [ ] 5.1 Push the branch and open PR 1, titled `ci: add deployment pipeline (C4)`. Verify: `gh pr checks` shows `build-and-test`, `frontend`, `pr-title` and `image-and-infra` passing; `image-and-infra`'s log shows the smoke run's two answers.
- [ ] 5.2 Re-apply the ruleset with the page's update command, then read it back (`gh api repos/jakubbohm/RevolutReader/rules/branches/main`). Record the date in `main-ruleset.md`, commit and push. Verify: the read-back lists four checks, strict, with no bypass; after the push all checks pass again and `gh pr view --json mergeStateStatus` reads `CLEAN`.
- [ ] 5.3 Squash merge PR 1. Verify: the PR reads `MERGED`, and the `Deploy` workflow has started on `main` (`gh run list --workflow deploy.yml`).

## 6. First deployment (D3, D8, D15)

Starts on a new branch off the freshest `main`, `docs/c005-first-deployment`, in this worktree. PR 1's branch is deleted locally then.

- [ ] 6.1 Run 1 stops at the image check (D3). Verify:
  - `image` is green, and the package `revolutreader` exists and is private;
  - `deploy` failed at the image check with the message and the link, before any Azure step: no login in its log, nothing new in `rg-revolutreader`.
- [ ] 6.2 The owner makes the package public, then re-runs the failed job. Verify:
  - the image check passes;
  - the login succeeds. If it fails, the subject is corrected with the owner's go (azure-prerequisites.md § Checks) and the job re-run;
  - the stack succeeds;
  - the check after the deploy passes, and the run's summary shows the image, the revision, the address and the time to the first answer.
- [ ] 6.3 Live checks, read-only, and records. Verify and record:
  - `az stack group show` lists the five resources and the app identity's role assignment;
  - the revision reads `Running`;
  - `/health` and `/` answer at the address from Claude's machine;
  - a log query finds the app's start lines in the workspace (they can take a few minutes);
  - whether the new revision started a replica during the deploy (D8's reading);
  - the address and the deployed names go into `deployment.md`, and the first login's result into `azure-prerequisites.md` § Checks.
- [ ] 6.4 The owner's role (D17), with the owner's go: the command from `azure-prerequisites.md`. Verify: its read-only check lists Key Vault Secrets Officer for a user on `rg-revolutreader`; the owner's ID was written to no file.
- [ ] 6.5 The guided task (D15), with the owner's go: the four Enable Banking values into the vault. Then R-47 and R-48 updated with what the runs showed (D3's check, D8's reading). Verify: `az keyvault secret list` shows the four names; no value appeared in any output; no placeholder is left in `deployment.md`.

## 7. Close

- [ ] 7.1 Final check:
  - `dotnet build`, `dotnet test` and the frontend checks pass locally;
  - `openspec validate c005-add-deployment-pipeline` passes;
  - PR 2 (`docs: record the first deployment (C4)`) is open, its checks pass and its state is `CLEAN`.

  Verify: the commands' output.
- [ ] 7.2 `pm/progress.md`, C4's notes:
  - what was done, and the deviations (D2: no secret read by C4's own app; D9);
  - the follow-ups #17 and #18;
  - the heads-ups for C5 (wire the four secrets, D15) and C6 (forwarded headers D5, the sign-in addresses D11, the app's address);
  - M5's iPhone checks, which now have their first chance (`tests/manual-scenarios.md`).

  The status `done`, the date and the archive link come with the archive commit, after the user confirms that C4 is done. Verify: the notes are there.

## Workflow follow-up

- `/opsx:archive c005-add-deployment-pipeline` once the user approves; the archive commit also sets C4 to `done` in `pm/progress.md`.
- Push PR 2 and merge it on the user's go.
- After the merge: `/cleanup-branch`.
