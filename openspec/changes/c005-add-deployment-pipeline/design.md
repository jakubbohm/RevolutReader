# Design: c005-add-deployment-pipeline

## TL;DR

- **One deployment stack on every merge, Bicep in three files** (D1, D10): `main` calls `platform` (logs, Key Vault, the app's identity, the Container Apps environment) and `features` (the container app, then one section per feature). Simple ordering; a PR that drops a resource deletes it.
- **C4 merges before C5** (D2): C4's app needs no secret. A guided task puts the four Enable Banking values into Key Vault after the first deploy, and C5 wires them when it merges.
- **A public image on ghcr.io** (D3, D12), built once per merge on the small chiseled .NET runtime. The first deploy stops at a pull check until the owner makes the package public.
- **Tooling-only, two PRs** (D4, D5): PR 1's merge is the first deploy; PR 2 records the live part and archives.
- **Checks:** a required PR check `image-and-infra` (Bicep, image, a quick start) and a local what-if before PR 1 (D7); after each deploy, a check that the new version really started (D8).
- **Logs** to Log Analytics with a 0.1 GB daily cap (D6, #17). **Wake-up measurement** after v1 (D9, #18). **Sign-in addresses and forwarded headers:** C6 (D5, D11).
- **New interfaces:** the workflow `deploy.yml` (jobs `image`, `deploy`), the PR check `image-and-infra`, the stack `revolutreader` with outputs `appName`, `appUrl` and `keyVaultName` (D13, D14).
- **Integration points:** GitHub Actions, ghcr.io, Azure Resource Manager (deployment stacks), Container Apps, Key Vault, Log Analytics. No Entra ID or Enable Banking change.
- **By hand, outside the stack:** the owner's Key Vault role, granted once on the resource group, so the owner's ID is written nowhere (D17).
- **Hard to reverse:** the container app's name `tarjeta-papa` is its public address (on the daughter's phone, and registered in Entra ID by C6); making the package public cannot be undone; purge protection, once turned on, cannot be turned off, so it stays off (D13).

## Context

- See proposal.md § Why. State checked read-only on 2026-11-06:
  - **Azure (M3):** `rg-revolutreader` (Germany West Central) holds only the deploy identity `id-revolutreader-deploy`, with Contributor and Role Based Access Control Administrator limited to four data roles ([azure-prerequisites.md](../../../docs/operations/azure-prerequisites.md)). No deployment stack exists, and the subscription has no Log Analytics workspace. The Key Vault name `kv-revolutreader` is available (`checkNameAvailability`). The owner's account is Owner of the subscription, which gives no access to secret values in a vault that uses Azure roles (c004 design.md D6).
  - **GitHub (M3, C2, C3):** the environment `production` deploys from `main` only and holds `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `AZURE_RESOURCE_GROUP`. No package exists yet. The ruleset on `main` requires `build-and-test`, `frontend` and `pr-title`.
  - **The app:** the API serves the pages from its web root (`UseAppPages`, spec `app-delivery`); locally the web root is empty and Aspire's Vite server serves them. `GET /health` is anonymous. `appsettings.json` has no setting beyond logging (C5 adds the `EnableBanking` section). The frontend builds into `src/RevolutReader.Web/dist/` (`npm run build`); its page carries `<div id="root">`.
- **Facts the decisions rest on (read 2026-11-06):**
  - **.NET images** (MCR, read anonymously):
    - `mcr.microsoft.com/dotnet/sdk:11.0.100-rc.3-resolute` contains SDK `11.0.100-rc.3.26522.148`, exactly the version `global.json` pins (`rollForward: disable`).
    - `mcr.microsoft.com/dotnet/aspnet:11.0.0-rc.3-resolute-chiseled` is about 59 MB compressed (amd64), against about 112 MB for `-resolute`. It runs as the non-root user 1654, listens on port 8080 (`ASPNETCORE_HTTP_PORTS`), turns globalization invariant mode on, and has no shell and no time-zone data. "resolute" is Ubuntu 26.04.
  - **Node:** `.node-version` says 24; `node:24-slim` is 24.22.2 on Docker Hub.
  - **Actions,** latest releases: `docker/setup-buildx-action` v4.4.1 (2026-09-16), `docker/login-action` v4.8.0 (2026-11-05), `docker/build-push-action` v7.4.0 (2026-09-15), `azure/login` v3.1.0 (2026-09-10). `actions/checkout` v7 as in `ci.yml`. The Azure CLI is preinstalled on GitHub's Ubuntu runners and installs Bicep on demand. Bicep's latest release is 0.48.1.
  - **Azure API versions** (provider listing): `Microsoft.App/containerApps` 2026-07-01, `Microsoft.KeyVault/vaults` 2026-05-15, `Microsoft.OperationalInsights/workspaces` 2026-03-01.
  - **Container Apps billing** ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/billing), updated 2026-03-25):
    - the default environment type is "workload profiles";
    - apps on the Consumption profile are billed on the Consumption plan, with the monthly free grant per subscription;
    - there is no management fee without a Dedicated profile;
    - health-probe requests are not billable.
  - **Key Vault references in Container Apps** ([Microsoft Learn: manage secrets](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets), updated 2026-09-11):
    - a system-assigned identity "can't be used with the create command because it's not available until after the container app is created", so the identity must exist first;
    - a reference without a version follows the latest version, refreshed within 30 minutes, and the revisions using it restart on their own.
  - **Deployment stacks** ([CLI reference](https://learn.microsoft.com/en-us/cli/azure/stack/group), updated 2026-08-04; [known issues](https://docs.azure.cn/en-us/azure-resource-manager/bicep/deployment-stacks-known-issues)):
    - `az stack group create` takes `--action-on-unmanage deleteResources`, `--deny-settings-mode none` and `--parameters`, with a file first and `KEY=VALUE` overrides after it;
    - `az stack group validate` exists; stacks have no what-if of their own, so `az deployment group what-if` previews the same template;
    - a stack cannot delete Key Vault secrets. The Bicep creates none.

## Goals / Non-Goals

**Goals:**

- Every merge to `main` puts that commit's code on Azure, with no manual step after the first deployment, and a deploy that leaves a broken app turns red.
- PR CI still holds no credentials and publishes nothing; the deploy holds no stored secret.
- Everything in Azure except M3's setup is in the stack, so a deleted line in the Bicep deletes the resource, and M8 removes everything by deleting the stack.

**Non-Goals** (design level; scope in proposal.md § Non-goals):

- Making the first deployment pass without any manual step (D3 accepts one click and one re-run).
- Any app setting or secret on the container app in C4 (D2), and any change to the app's code (D5).
- Tuning the wake-up (D9).

## Decisions

> Started in `/opsx:explore` (2026-11-06): D1–D11 were each recorded right after the user's yes. D12–D16 were proposed in `/opsx:propose` (2026-11-06) and are for the owner's review; the user's changes to them are marked where they were made. D17 was decided with the user during the review.

### D1 — One deployment stack, three Bicep files

Decided with the user (2026-11-06, explore).

- **One deployment stack, applied on every merge to `main`** (docs/conventions/workflow.md § 5, unchanged). One deployment creates everything, so a change that adds a shared resource and the feature part that uses it lands in one run, in the right order.
- **Three files in `infra/`:**
  - `main.bicep`: the orchestrator and the stack's entry point. It calls the other two and passes names and IDs between them.
  - `platform.bicep`: the shared infrastructure: Key Vault, the log destination, the Container Apps environment, the app's identity and its roles; later the storage account (C6).
  - `features.bicep`: what belongs to one feature, e.g. C6's blob container and C7's tables.
  - The container app itself goes in `features.bicep` (D10).
- **Checked first (2026-11-06):** neither this project nor DoseUp had decided how to split the Bicep. Both assume one stack applied on every merge (workflow.md § 5; DoseUp's ADR-0004-delivery-and-process § CD). DoseUp's `infra/` is still empty, so it was never tried.
- **Rejected for this project: two stacks,** the shared infrastructure in its own stack applied by a manually triggered workflow and the feature resources in a second stack applied on every merge (the user's model for larger projects). It keeps the resources that hold data out of reach of ordinary merges, but here:
  - deploys run only from `main` (GitHub environment `production`, [azure-prerequisites.md](../../../docs/operations/azure-prerequisites.md)). A change touching both layers would deploy its feature part before its shared part could be applied, e.g. C6 with the storage account and its blob container: a failed deploy or two PRs for every such change;
  - the feature layer would hold only the container app, a blob container and tables, and the shared layer changes twice (C4, C6).
- **Accepted risk:** a PR that removes Key Vault or the storage account from the Bicep deletes them on merge (`--action-on-unmanage deleteResources`); the owner's review is the guard. A deleted Key Vault stays recoverable for its soft-delete retention period; the transaction history can be imported again from the M1 file.
- **Software factory (the user, 2026-11-06):** the two-stack model becomes the default in `docs/software-factory/lessons.md` for projects with several features on shared infrastructure, with two open points:
  1. **The ordering.** A fix: the shared stack's job runs in the same workflow before the feature job, only when shared files changed, behind a GitHub environment with the owner as required reviewer (free on public repositories; [GitHub Docs: deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), read 2026-11-06). It needs a second environment and a second federated credential.
  2. **Child resources across stacks.** How a stack treats a child resource it deploys inside a parent that another stack manages (e.g. a Service Bus topic in a shared namespace) is undocumented (workflow.md § 5; searched again 2026-11-06). It needs a test before the factory relies on it.

  RevolutReader's single stack goes into `docs/software-factory/divergences.md`. Lesson numbers: D2.

### D2 — C4 merges before C5; the Enable Banking secrets

Decided with the user (2026-11-06, explore), on the C5 session's proposal relayed by the user.

- **The dependency:** C5 (`c004-add-enable-banking-adapter`, in its own worktree) adds four required settings; once it is merged, the app refuses to start without them. Agreed between the sessions: whichever change merges second wires them into the Bicep as Key Vault references on the container app, exposed as the environment variables `EnableBanking__ApplicationId`, `EnableBanking__PrivateKey`, `EnableBanking__SessionId` and `EnableBanking__AccountId`.
- **C4 merges first; C5 waits if it finishes earlier** (the user). Nothing needs C5 on `main` before C7.
- **Consequences:**
  - C4's first deployment needs no secrets; Key Vault starts empty.
  - A guided task at the end of C4, after the first deployment, puts the four production values into Key Vault, so they are there before C5 merges. The values are on the owner's machine (c004 design.md D6).
  - C5 wires the four references into the Bicep when it merges.
  - Key Vault secret names: `EnableBanking--ApplicationId` and so on, since Key Vault names allow only letters, digits and dashes. Settled in D15, with the names on the container app.
- **Lesson numbers:** `main` ends at R-43 and C5 takes R-44 and R-45; C4 starts at R-46, so neither change renumbers.
- **C5 informed** by the user (2026-11-06): the merge order, the wiring, the proposed secret names, and the stand-in values in the PR check's smoke run (D7).

### D3 — A public image on ghcr.io, with a check in the deploy workflow

Decided with the user (2026-11-06, explore). [ADR-0006-hosting-registry-and-job § Decision](../../../docs/adr/0006-hosting-registry-and-job.md#decision), item 3, stands: a public image, pulled anonymously.

- **A private image rejected again** (the user asked; [GitHub Docs: Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) and [billing for GitHub Packages](https://docs.github.com/en/billing/concepts/product-billing/github-packages), read 2026-11-06):
  - Container Apps would pull with a classic personal access token with `read:packages`, the only token type the registry accepts. Its scope covers all the owner's packages, and it adds a secret to Key Vault and an expiring approval.
  - Container storage and bandwidth on ghcr.io are free today, with at least a month's notice before that changes. Then a private package counts against the Free plan's 500 MB of storage (shared with Actions artifacts) and 1 GB of downloads a month. Azure's pulls count (only downloads by Actions with its own `GITHUB_TOKEN` are exempt), and a wake from zero can pull the whole image again.
  - Public packages are free, with no quota.
  - No free private option without a secret: Azure Container Registry with the app's managed identity costs about €4.49 a month (ADR-0006).
  - The image holds only what the public repository shows: the compiled app, the frontend, and `appsettings.json` with `"<secret>"` markers.
- **The first push creates the package private** ([GitHub Docs: access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility), read 2026-11-06: "the default visibility is private"). It does not take the repository's visibility, only the web UI changes it, and making it public cannot be undone.
- **A check in the deploy job, before Azure is touched:** the image just pushed must be pullable without a login. On the first run it is not, so the job stops and shows the link to the package settings; the owner makes the package public and re-runs the failed jobs. Every later run passes the check in about a second. It catches the same at reinstatement (roadmap step D1), when a new package starts private again.
- **Rejected: pushing a placeholder image by hand before the merge** (the user's idea), which lets the first deploy pass at once. It needs four manual steps and does not help at reinstatement:
  1. `write:packages` added to the owner's `gh` login;
  2. a local build carrying the `org.opencontainers.image.source` label. Without that link, the workflow's `GITHUB_TOKEN` cannot push to a name already pushed (GitHub Docs);
  3. making the package public;
  4. checking the repository's Write access in the package settings (the docs do not name the role a linked repository gets).

  A package the workflow creates itself is linked to the repository automatically.

### D4 — One change, two PRs

Decided with the user (2026-11-06, explore).

- **No split into two roadmap steps** (the roadmap's C4 notes allowed one). With C4 merging first (D2) and the image check (D3), the first deployment has no ordering problem left. The first Azure login (the M3 follow-up) can fail in any plan; if it does, the federated credential's subject is corrected with the owner's go ([azure-prerequisites.md § Checks](../../../docs/operations/azure-prerequisites.md#checks)) and the job re-run.
- **Two PRs, because only `main` may deploy:**
  1. **PR 1 ships:** the Dockerfile, `infra/` (D1), the deploy workflow, the PR check, the docs. Its merge is the first deployment.
  2. **Live, after the merge:** the image made public and the job re-run (D3); the first login checked; the guided task for the Enable Banking values (D2); the app's address read. The wake-from-zero measurement moved out (D9).
  3. **PR 2 closes,** on a new branch off `main` (workflow.md § 3: a branch is never continued after its PR merges): what the live part found, the address in the docs, `pm/progress.md`, the archive.
- C3 archived before its merge and left its live checks as follow-ups. Here the live part is the change's purpose, so the change is archived only after it is proven.
- **Deviation from the roadmap** (C4 Outputs: "the skeleton running on Azure and reading its secrets from Key Vault"): C4's own app reads no secret; that starts when C5 merges (D2). Recorded in `pm/progress.md` at the close.

### D5 — A tooling-only change

Decided with the user (2026-11-06, explore).

- **C4 changes how the repository ships code, not what the app does:** the Dockerfile, the Bicep, the deploy workflow, the PR check and the docs. It is therefore a tooling-only change (docs/conventions/workflow.md § 6), the second after C2:
  - `skip_specs: true` in `.openspec.yaml`, so no specs and no scenarios;
  - applied directly with `/opsx:apply`, task by task, with an `[apply]` commit at the end of each group;
  - groups named after the work, each landing its own docs;
  - its effect outside the repository proven live (D4's after-merge part).
- **The app's code stays as it is.** The container listens on .NET's default container port, the Container Apps ingress terminates HTTPS, and `GET /health` already exists (spec `service-health`).
- **Left to C6: the forwarded headers.** Behind the Container Apps ingress the app sees neither the user's address (`X-Forwarded-For`) nor that the request came over HTTPS (`X-Forwarded-Proto`) until forwarded-header handling is switched on. That changes the app's behaviour, so it does not belong in a tooling-only change.
  - C6 needs it first: sign-in builds its redirect address from the request's scheme and host.
  - C7 needs the user's address for the bank's PSU header (c004 design.md D2).
  - A heads-up for C6, recorded in `pm/progress.md` at the close.

### D6 — Logs go to a Log Analytics workspace with a daily cap

Decided with the user (2026-11-06, explore). [ADR-0006 § Consequences](../../../docs/adr/0006-hosting-registry-and-job.md#consequences) left the choice to C4: none, or a Log Analytics workspace.

- **A Log Analytics workspace in `platform.bicep`,** the Container Apps environment's log destination. It receives the app's console output (`ContainerAppConsoleLogs`) and the platform's events about it (`ContainerAppSystemLogs`). Retention 30 days; daily cap 0.1 GB.
- **Why not "none":** the app scales to zero, and a copy that stopped takes its output with it; the live log stream shows only running copies ([Microsoft Learn: log options](https://learn.microsoft.com/en-us/azure/container-apps/log-options), updated 2026-08-21). The first time this matters is C5's merge (a missing secret stops the app at start), then C6's sign-in errors and C7's bank errors.
- **Cost, about €0:**
  - the first 5 GB a month per billing account are free, with 31 days of retention included ([Azure Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/), read 2026-11-06);
  - the subscription had no workspace (checked read-only, 2026-11-06);
  - the app logs little: ASP.NET Core's request lines are filtered at `Warning`, and C5 adds one line per bank read;
  - the cap keeps even a runaway month under 3 GB. When it is reached, collection stops until the workspace's daily reset, and some overshoot is possible ([Microsoft Learn: daily cap](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap)).
- **Follow-up: [#17](https://github.com/jakubbohm/RevolutReader/issues/17)** checks the actual ingestion and cost once the app runs, about a week after the first deployment and again after C7. The owner has seen another system where the system logs of running containers alone cost several dollars a day; the cap bounds the bill, but a reached cap stops logging until the reset.
- **Logs never carry bank data** (CLAUDE.md); C5 keeps account identifiers out of logs and traces (c004 design.md D5). Claude reads the workspace read-only when diagnosing.
- **Not in C4:** Application Insights (request timings, traces), which would use the same workspace; it can come later if C7 needs it. Routing through Azure Monitor diagnostic settings: more setup, nothing gained.

### D7 — One more required PR check, `image-and-infra`, and a local what-if before PR 1

Decided with the user (2026-11-06, explore). docs/conventions/workflow.md § 4: C4 adds its own check; PR CI builds and tests only and holds no Azure access.

- **A job `image-and-infra` in `ci.yml`,** required by the ruleset on `main`, with three steps:
  1. **Bicep:** `infra/` compiled and linted. Lint warnings fail the check, since there are no advisory checks (workflow.md § 4).
  2. **Image:** built from the deploy's Dockerfile and not pushed. The image built from the merge commit on `main` is the one deployed (workflow.md § 4).
  3. **Smoke run:** the image started on the runner. `/health` answers `Healthy`, and `/` returns the app's page. The run passes stand-in values for the four `EnableBanking__*` settings (D2), with a throwaway key generated in the step. Before C5 the app ignores them; after C5 they let it start, unless C5 validates them more strictly at start.
- **Cost:** about 3–4 minutes at first, less with caching, in parallel with `build-and-test` and `frontend`.
- **Ruleset and docs:** the job goes into `docs/operations/main-ruleset.json`. Re-applying the ruleset needs the owner's go (CLAUDE.md). workflow.md § 4 gets its row.
- **What a PR cannot check:** before PR 1, Claude runs Azure's what-if preview of the Bicep with the owner's login. It changes nothing in Azure (a read-only operation, CLAUDE.md § Working rules) and shows what the first deployment would create.
- **Rejected:**
  - a what-if in PR CI: it needs Azure credentials on PR runners (workflow.md § 4);
  - no image check in PRs: a broken Dockerfile would show only after the merge, on `main`.

### D8 — A check after each deploy

Decided with the user (2026-11-06, explore).

- **Why:** in single revision mode, a new revision takes the traffic once it has scaled to the previous revision's replica count and its replicas have passed their startup and readiness probes; if an update fails, the traffic stays on the old revision ([Microsoft Learn: revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions), updated 2026-02-26).
  - The app usually sleeps at deploy time, with 0 replicas. So the new revision may count as ready with none started and take the traffic untested. This is our reading of the docs; the first deployments confirm it.
  - A stack deployment can therefore succeed while the app cannot start, and a broken version would go unnoticed until someone opens the app.
- **The deploy job's last steps:**
  1. wait until the container app's latest revision is its latest ready revision, running the image just built;
  2. request `/health` (expect `Healthy`) and `/` (expect the app's page) at the app's address, retrying for up to about 3 minutes; the request wakes the app;
  3. confirm that the revision's running state is `Running`, not `Degraded`, `Failed` or `Activation failed`.
- **On failure:** the job fails, and GitHub emails the owner about the failed run on `main`. The fix is a revert PR, whose merge deploys the previous code.
- **The time to the first answer** goes into the job summary, a first data point for the wake-up measurement (D9).
- **Rejected: automatic rollback** (multiple revision mode with traffic labels): more moving parts than the app needs.

### D9 — The wake-from-zero measurement moves out, to after v1

Decided by the user (2026-11-06, explore). A roadmap change: roadmap C4 includes "a measurement of how long the app takes to wake from zero (fallback in ADR-0006: one always-on replica)".

- **Moved to [#18](https://github.com/jakubbohm/RevolutReader/issues/18),** done after v1 ships (C7 deployed), e.g. alongside M5. The issue holds the plan proposed here:
  - a read-only script in `spikes/cold-start/` that times `GET /health` after five full idle periods, plus a few requests while the app is awake;
  - the results in a dated note in ADR-0006;
  - a decision rule set in advance: a median up to about 20 s (what ADR-0006 accepted) changes nothing; slower, and the owner chooses between a longer cool-down and one copy always running.
- **Until then:** C4 deploys with ADR-0006's settings (minimum 0, maximum 1 replica, the default 300 s cool-down). D8's job summary gives a first impression on every deploy.
- **Recorded at the close:** the roadmap's C4 text and a change-log entry in `pm/progress.md` (roadmap § 1: roadmap changes only with the user's approval, logged there). C4's notes in `pm/progress.md` list #17 and #18 as follow-ups.
- **Not affected:** the Dockerfile's base image. A smaller image downloads faster on every wake, so the choice stays in this change (proposed in this design during `/opsx:propose`).

### D10 — The container app lives in `features.bicep`

Decided with the user (2026-11-06, explore).

- **The container app** (its image, settings and secret references) **goes at the top of `features.bicep`.** Each feature adds settings to it: C5 the four `EnableBanking__*` secrets (D2), C6 the sign-in settings and where the sign-in keys are stored, C8 the push keys. A feature's settings then sit next to the resources they point to.
- **`platform.bicep` stays the stable foundation:** Key Vault, the log workspace, the Container Apps environment, the app's identity. A feature PR touches it only when it adds something shared, e.g. C6's storage account.
- **Inside `features.bicep`, one short section per feature:** the bank (C5), sign-in (C6), the account detail (C7), push (C8).
- **The name stays `features.bicep`** (the user), although the file also holds the app. `app.bicep` was offered.
- **Rejected: the container app in `platform.bicep`,** next to its environment. Every feature would then edit both files, and `features.bicep` would start empty.

### D11 — The production sign-in addresses come with C6

Decided with the user (2026-11-06, explore).

- **The open point:** M4 registered only the local redirect URIs and left the production ones for after C4, which gives the app its address ([entra-id.md § Adding the production redirect URIs](../../../docs/operations/entra-id.md#adding-the-production-redirect-uris); M4's follow-ups in `pm/progress.md`).
- **C6 registers them,** with the owner's go (an Entra ID change). C6 builds the sign-in and chooses its return paths; entra-id.md assumes ASP.NET Core's defaults, `/signin-oidc` and `/signout-callback-oidc`. C6 then checks the sign-in on the owner's iPhone straight away.
- **C4 records the app's address** in the operations docs, so C6 starts from it. A heads-up for C6, recorded in `pm/progress.md` at the close together with the forwarded headers (D5).
- **Rejected: registering them in C4's live part.** It would fix C6's paths before C6 has decided them.

### D12 — The image: one Dockerfile, the chiseled runtime

Proposed (2026-11-06, propose). Applies [ADR-0002 § Consequences](../../../docs/adr/0002-frontend-hosting.md#consequences): a Node stage and a .NET stage, one image.

- **A multi-stage `Dockerfile` at the repository root,** whose build context is the root (the build rules live there):
  1. **`web`** on `node:24-slim`, the major version `.node-version` pins: `npm ci`, then `npm run build` in `src/RevolutReader.Web/`, giving `dist/`.
  2. **`build`** on `mcr.microsoft.com/dotnet/sdk:11.0.100-rc.3-resolute`, which holds exactly the SDK `global.json` pins: restore, then `dotnet publish src/RevolutReader.Api -c Release`.
     - Without the native app launcher, since the image starts the app with `dotnet`.
     - With analyzers off: `build-and-test` already enforces them on every PR, and turning them off keeps the image build short.
  3. **final** on `mcr.microsoft.com/dotnet/aspnet:11.0.0-rc.3-resolute-chiseled`: the published app in `/app`, and the frontend's `dist/` as its web root `/app/wwwroot`, which `UseAppPages` serves. It starts with `dotnet RevolutReader.Api.dll`.
- **Why chiseled:** about 59 MB compressed against about 112 MB for the full runtime image (Context), so a wake from zero downloads half as much when the image is not cached. It also runs as a non-root user, and has no shell or package manager to attack.
  - **Accepted:** globalization invariant mode and no time-zone data. The backend formats nothing for people; the frontend does the Czech formats.
  - A later change that needs culture data or a named time zone switches to the `-extra` variant, one line. The PR check's smoke run catches a start-up failure from it.
- **An allowlist `.dockerignore`:** everything is ignored except what the stages copy (`src/RevolutReader.Api/`, `src/RevolutReader.ServiceDefaults/`, `src/RevolutReader.Web/` without `node_modules/` and `dist/`, and the root build files: `global.json`, `nuget.config`, `Directory.Build.props`, `Directory.Packages.props`, `BannedSymbols.txt`, `.editorconfig`). The private keys in `spikes/**/secrets/` and the local `.claude/` can never enter a local build's context.
- **linux/amd64 only;** no `latest` tag. The commit SHA is the only tag (workflow.md § 4: build once, deploy that artifact).
- **.NET 11 GA:** the SDK tag must match `global.json` exactly. C1's follow-up PR to GA changes `global.json` and the two .NET image tags together.
- **Rejected:**
  - the full `-resolute` runtime image: twice the download, with a shell;
  - the SDK's built-in container publishing (`dotnet publish -t:PublishContainer`): ADR-0002 asks for a Node stage, and the SDK cannot build the frontend;
  - Alpine images: musl instead of glibc, for a few megabytes less than chiseled.

### D13 — The Azure resources and their settings

Proposed (2026-11-06, propose). Everything in `rg-revolutreader`, Germany West Central, managed by the stack `revolutreader`.

- **Names** (Azure's usual abbreviations; the container app's is its public address):

  | Resource | Name | File |
  |---|---|---|
  | Log Analytics workspace | `log-revolutreader` | `platform.bicep` |
  | Key Vault | `kv-revolutreader` (globally unique; available on 2026-11-06) | `platform.bicep` |
  | The app's identity (user-assigned) | `id-revolutreader-app` | `platform.bicep` |
  | Container Apps environment | `cae-revolutreader` | `platform.bicep` |
  | Container app | `tarjeta-papa`, so the address is `https://tarjeta-papa.<environment id>.germanywestcentral.azurecontainerapps.io` | `features.bicep` |

  - **The address carries the app's name, "Tarjeta Papá"** (the user, 2026-11-06). The container app's name is the address's first part; the environment ID after it is generated by Azure and cannot be chosen. Azure names allow no accents, so `tarjeta-papa`.
  - **Rejected: a free alias.** Container Apps gives no second address on its own domain. A custom domain gets a free certificate, but needs a domain the owner owns (paid), or a third-party free subdomain service, one more account to keep alive.
  - **The name is hard to change later:** a new name is a new app with a new address, on the daughter's Home Screen and in Entra ID (C6). The other resources keep the project's name; nobody sees them.
- **Log Analytics** (D6): pricing tier per GB (`PerGB2018`), retention 30 days, daily cap 0.1 GB. The environment sends its logs there with the workspace's ID and key, which Bicep reads from the workspace in the same deployment, so the key never leaves Azure Resource Manager.
- **Key Vault:**
  - **standard tier, access by Azure roles** (no access policies);
  - **soft delete at Azure's default of 90 days:** a deleted vault and its secrets stay recoverable for that long;
  - **purge protection off,** so decommissioning (M8) can purge the vault at once. Once turned on, it can never be turned off;
  - **public network access on:** a Consumption environment without its own network reaches it over the internet, with the identity's role as the guard;
  - **no secret in the Bicep:** the values are hand-provisioned (D15), and a stack could not delete them anyway (Context).
- **The app's identity is user-assigned** (`id-revolutreader-app`), not the built-in kind. The built-in kind does not exist until the app is created, so the app's first version could not read Key Vault (Context). It gets **Key Vault Secrets User** on the vault; C6 adds its storage roles.
- **The owner's access to the vault's secrets is not in the Bicep:** it is granted once by hand on the resource group (D17), so the owner's ID is written nowhere. The Bicep's only role assignment is the app's, one of the four M3's condition lets the deploy identity assign.
- **Container Apps environment:** the workload-profiles type (Azure's default) with only the Consumption profile, so there is no fee and the free grant applies (Context). No zone redundancy, no own network.
- **Container app** (`features.bicep`):
  - single revision mode, with the identity above;
  - external HTTPS ingress on port 8080; plain HTTP is redirected to HTTPS;
  - the image `ghcr.io/jakubbohm/revolutreader:<commit SHA>`, pulled anonymously, with no registry credentials (D3);
  - 0.25 vCPU and 0.5 GiB; minimum 0 and maximum 1 replica, with the default HTTP scale rule and cool-down (D9);
  - startup and readiness probes on `GET /health`, port 8080, which costs nothing (spec `service-health`: no bank or storage call; probe requests are not billed). Liveness keeps the platform's default;
  - no settings and no secrets in C4. C5 adds the four Enable Banking references (D15).
- **`main.bicep`'s outputs:** `appName`, `appUrl` (`https://` plus the ingress address) and `keyVaultName`, for the deploy check (D8), the docs and the guided task.
- **`main.bicepparam`:** the region, and the image tag read from the environment variable `IMAGE_TAG`, which the deploy workflow sets. So the workflow passes only the image tag and the parameter file (configuration.md § Where each value lives).
- **`bicepconfig.json`** raises the linter's rules to errors, so a lint finding fails the PR check (D7). API versions are the newest stable ones the current Bicep knows.
- **Stack options:** `--action-on-unmanage deleteResources` (workflow.md § 5); `--deny-settings-mode none`, since Contributor cannot manage deny settings ([azure-prerequisites.md](../../../docs/operations/azure-prerequisites.md)).

### D14 — The deploy workflow and the PR check job

Proposed (2026-11-06, propose). Action versions: Context.

- **`.github/workflows/deploy.yml`** runs on every push to `main`, and by hand (`workflow_dispatch`, e.g. to redeploy after a reinstatement, roadmap D1). The environment `production` admits only `main`. Deploys queue in one concurrency group and never cancel each other mid-stack.
  - **Job `image`:** no environment and no Azure access; `contents: read` and `packages: write`.
    - It checks out without keeping the token, then logs in to ghcr.io with `GITHUB_TOKEN`.
    - It builds and pushes `ghcr.io/jakubbohm/revolutreader:${{ github.sha }}`, using the GitHub Actions build cache. A push from the workflow links the package to the repository.
    - Without a provenance attestation, so the tag points at one plain linux/amd64 image.
  - **Job `deploy`:** needs `image`, runs in the environment `production`, with `id-token: write` and `contents: read`. Its steps:
    1. **the image check (D3):** an anonymous pull token from ghcr.io, then the image's manifest. If either is refused, the job fails with the link to the package's settings and the instruction "make it public, then Re-run failed jobs";
    2. **`azure/login`** with the environment's three IDs and no secret, using the federated credential from M3;
    3. **`az stack group create`** with `IMAGE_TAG` set to the commit SHA and D13's options;
    4. **the check after the deploy (D8),** reading the app's name and address from the stack's outputs;
    5. **a summary:** the image, the revision, the address and the time to the first answer.
  - Timeouts: 20 minutes for `image`, 30 for `deploy` (creating the environment the first time takes minutes). No other secret or variable than M3's four.
- **The job `image-and-infra` in `ci.yml`** (D7): `contents: read`, no credentials, `timeout-minutes: 15`, the same triggers as the other jobs, with no path filters.
  1. **Bicep:** `az bicep build` and `az bicep lint` on `infra/main.bicep`, and `az bicep build-params` on `main.bicepparam`, with a made-up `IMAGE_TAG`.
  2. **Image:** built with the same Dockerfile and loaded into the runner's Docker, not pushed. It reads the build cache that `main` writes.
  3. **Smoke run:** the container started with the four `EnableBanking__*` stand-ins (made-up IDs, and an RSA key generated with `openssl` in the step). `/health` must answer `Healthy` within 30 seconds, and `/` must contain `<div id="root">`. On failure the step prints the container's log.
- **Rejected:**
  - one workflow file for PR CI and the deploy: the deploy needs `id-token: write` and the environment, and PR CI must never have them (workflow.md § 4);
  - Azure's `azure/container-apps-deploy-action`: it would deploy the image outside the stack, and Bicep must author the app (configuration.md).

### D15 — The Enable Banking values in Key Vault: names and the guided task

Proposed (2026-11-06, propose). D2's consequences, made concrete.

- **Names along the way.** Container Apps secret names allow lowercase letters, digits, `-` and `.`; Key Vault names allow letters, digits and `-`.

  | Setting (environment variable, C5) | Key Vault secret | Container Apps secret (C5 adds it) | Value from the owner's machine |
  |---|---|---|---|
  | `EnableBanking__ApplicationId` | `EnableBanking--ApplicationId` | `enablebanking-applicationid` | the application ID ([spikes/enable-banking/README.md § Identifiers](../../../spikes/enable-banking/README.md#identifiers-non-secret)) |
  | `EnableBanking__PrivateKey` | `EnableBanking--PrivateKey` | `enablebanking-privatekey` | the text of the `.pem` file in `spikes/enable-banking/secrets/` |
  | `EnableBanking__SessionId` | `EnableBanking--SessionId` | `enablebanking-sessionid` | `spikes/enable-banking/secrets/session.json` |
  | `EnableBanking__AccountId` | `EnableBanking--AccountId` | `enablebanking-accountid` | `spikes/enable-banking/secrets/session.json` |

  C5 references each secret by its address without a version, so a new value (a renewed session) reaches the app within 30 minutes, with a restart (Context).
- **The guided task,** after the first deployment (D4):
  - A PowerShell 7 block in `docs/operations/deployment.md`. It reads the four values from those files and writes each with `az keyvault secret set` (`--subscription` named, `--output none`), then lists the secret names, never the values.
  - It is run with the owner's go, by the owner or by Claude. Nothing prints a value.
  - It needs the owner's Secrets Officer role from D17.
- **Recorded:**
  - `docs/operations/deployment.md` holds the task;
  - `docs/operations/expiring-approvals.md` § 2 step 4 and § 3 point to it for replacing a value;
  - `docs/conventions/configuration.md` § Hand-provisioned secrets gets its four rows from C5, as c004 design.md D6 plans, naming this task and its date. C4 leaves the table alone, so the two branches do not collide.

### D16 — Docs and the software factory

Proposed (2026-11-06, propose).

- **Conventions:**
  - `workflow.md` § 4 gets a paragraph on the deploy (what runs on a merge, the two checks, what to do when it is red) and the `image-and-infra` row;
  - § 5 gets the Bicep layout (D1, D10) and the updated resource table: the log workspace, and the package's one-time visibility step with the image check.
- **ADR-0006 gets a dated amendment** (2026-11-06, C4): the log destination (D6), the first push's private package and the image check (D3), and the measurement moved to #18 (D9).
- **`docs/operations/deployment.md`** (new):
  - the identifiers, including the app's address after the first deploy;
  - what the pipeline does and its two checks;
  - the first deployment's steps (make the package public, a failed login);
  - the guided task (D15);
  - read-only checks: the stack, the revisions, a log query;
  - how to roll back (a revert PR);
  - how to remove everything (M8): delete the stack, purge the vault, delete the package.
- **`azure-prerequisites.md`** gets D17's hand-made step, and its § Checks records the first login. **`expiring-approvals.md`** points to the guided task (D15) and updates its list of what later steps add.
- **The ruleset** file and page get `image-and-infra`.
- **`CLAUDE.md`:**
  - the commands for a local image build with a quick start, and for the Bicep check;
  - the local what-if, as a pointer to the operations page;
  - the `docs/operations/` line names the deployment page.
- **Software factory:**

  | Id | Kind | Question | From |
  |---|---|---|---|
  | R-46 | New, relates to DoseUp F-53 | How is the infrastructure code split into deployment stacks and files? Default: shared infrastructure in its own stack behind an approval, features in a second stack; the ordering fix and the child-resource test as open points. Plus a `divergences.md` entry: one stack here | D1 |
  | R-47 | New | How is a public image on ghcr.io deployed the first time, and why not a private one? | D3 |
  | R-48 | New | How does a deploy prove that a scale-to-zero app really started? | D8 |
  | R-49 | New | Where do a scale-to-zero app's logs go, and how is their cost bounded? | D6 |
  | R-50 | New | In a public repository, where does a person's access to secret values come from? | D17 |

  Inventory lines: the Dockerfile and `.dockerignore`; `infra/`; `deploy.yml`; the `ci.yml` row updated for `image-and-infra`; `deployment.md`.
- **The roadmap's C4 text and a change-log row** (D9); C4's notes in `pm/progress.md`, with the follow-ups #17 and #18, the heads-ups for C5 (wire the four secrets) and C6 (forwarded headers, sign-in addresses, the app's address), and the first chance for M5's iPhone checks (`tests/manual-scenarios.md`).

### D17 — The owner's access to the vault's secrets: granted once by hand, on the resource group

Decided with the user (2026-11-06, propose).

- **Why it is needed:** the guided tasks (D15; later C6 and C8) and every renewal write secrets. Owner of the subscription gives no access to secret values in a vault that uses Azure roles (c004 design.md D6).
- **Why not in the Bicep:** D13 first proposed the owner's account ID as a parameter in `main.bicepparam`. The user did not want it written in the public repository.
- **How:** `Key Vault Secrets Officer` for the owner's account on `rg-revolutreader`, assigned once by hand with the owner's go.
  - The command looks up the owner's ID when it runs, from the subscription's Owner role assignment, with the subscription named (the login's default subscription is an employer one). So the ID is written nowhere: not in the repository, not in GitHub.
  - The role is inherited by every vault in the resource group: today the one vault, and also one the stack re-creates. It goes with the resource group at M8.
- **Recorded in `docs/operations/azure-prerequisites.md`** as C4's addition to M3's hand-made setup: what it is and why, the command, the read-only check, and its removal. The reinstatement guide (D1) rebuilds it from there.
- **A deviation from workflow.md § 5** ("manual only for what cannot be automated"): this could be Bicep, but only with the owner's ID in the repository. It gets lesson R-50 and a row in § 5's resource table.
- **Rejected:**
  - the parameter in `.bicepparam` (the first proposal): the owner's ID in the public repository;
  - a GitHub environment variable read by the parameter file: against configuration.md (GitHub variables hold only what the workflow needs before Bicep can run). It is unversioned and unreviewed, and in a public repository it would show in the logs if ever printed.
- **Left as it is:** M3's condition still lets the deploy identity assign Key Vault Secrets Officer, which the Bicep no longer uses. Narrowing it is an Azure change with nothing to gain now.

## Not applicable to a tooling-only change

- **Public API sketch:** none. No domain type, handler, endpoint or acceptance DSL method changes. The interfaces this change adds are D14's workflow and check names and D13's stack outputs.
- **Rule ownership:** none; there are no specs (D5).
- **Error model:** no new operation in the app. The workflows fail their job on any error, and the deploy's checks fail it on purpose (D3, D8).
- **Ports and contracts:** none.
- **Verification:** no scenarios. Each task states its own check, and the live part is proven on Azure and GitHub (D4).
- **TS client:** not touched. **AppHost:** unchanged; it models local orchestration only, and this change is the Bicep (workflow.md § 5). **Shared resources:** none; everything is in the stack.

## Risks / Trade-offs

- **[The first login fails]** because the federated credential's subject differs from what GitHub sends → the error shows the subject; correct the credential with the owner's go (azure-prerequisites.md § Checks) and re-run.
- **[The deploy identity lacks a right the stack needs]**, e.g. the app identity's role assignment under M3's condition, or reading the workspace's key → the what-if runs as the owner and cannot show it, so the first run will. Fix it with the owner's go, by widening M3's setup or changing the Bicep.
- **[A new revision counts as ready without starting]** (D8) → the check after each deploy.
- **[The image check misreads ghcr.io's anonymous answers]** → tested in apply against a public image and a missing tag; the first run confirms it on the private package.
- **[Bicep knows older API versions than Azure]** → D13 picks the newest the current Bicep knows; the PR check's lint shows a mismatch.
- **[The chiseled image lacks culture or time-zone data that a later change needs]** → the PR check's smoke run fails at start; switch to `-extra` (D12).
- **[`kv-revolutreader` is taken before the first deploy]** → another name in `platform.bicep`.
- **[C5 merges before C4 by mistake]** → D2's problem returns (the vault would not exist when the app first needs it); the owner merges in the agreed order.
- **[A broken `image-and-infra` blocks every merge]** → fix it in a PR, or use the ruleset's escape hatch with the owner's go (main-ruleset.md).
- **[A PR that removes a data resource deletes it]** (D1) → the owner's review; the vault stays recoverable for 90 days.
- **[C4 and C5 edit the same docs]** (workflow.md, lessons.md, expiring-approvals.md) → C5 rebases after C4; lesson numbers are agreed (D2).
- **[Bots wake the public app]** → cents (ADR-0006); logs capped (D6, #17).
- **[ghcr.io or the Actions cache is down]** → the deploy fails before Azure; re-run later.

## Migration Plan

The first deployment (D4):

1. **Before PR 1** (Claude, read-only): the Bicep built and linted; `az stack group validate` and `az deployment group what-if` with the owner's login (D7); the image built and started locally.
2. **PR 1** pushed and opened; all checks green, `image-and-infra` included; the ruleset re-applied with `image-and-infra` (the owner's go); squash merge (the owner's go).
3. **Deploy run 1:** `image` pushes the image, so the package exists, private; `deploy` stops at the image check with the link.
4. **The owner makes the package public** and re-runs the failed job: the first login, then the stack creates the workspace, the vault, the identity, its role assignment, the environment and the app, then the check after the deploy.
5. **The owner's role on the resource group** (D17), then **the guided task** puts the four Enable Banking values into the vault (the owner's go for both).
6. **The findings and the address are recorded;** PR 2 archives the change.

Rolling back:

- **A broken version:** a revert PR, whose merge deploys the previous code.
- **A Bicep mistake:** fixed forward in a PR; the stack converges on what the Bicep declares.
- **Removing everything** (M8, or abandoning the deployment): `az stack group delete --action-on-unmanage deleteResources`, then purge the vault, then delete the package on GitHub.

## Open Questions

- **The stack's exact flags:** whether `az stack group create` takes `--parameters infra/main.bicepparam` together with `--template-file`, or reads the template from the parameter file's `using` line. Settled in apply with `az stack group validate`; it changes no decision.
- **Whether a new revision starts a replica at deploy time** when the old one sits at zero (D8). The first deployments show it, and the check covers both cases.
