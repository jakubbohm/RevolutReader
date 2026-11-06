# Proposal: c005-add-deployment-pipeline

## TL;DR

- **What:** every merge to `main` builds one image (frontend and backend together), publishes it on ghcr.io and deploys it to Azure Container Apps through one deployment stack, together with Key Vault and a log workspace. A new PR check builds the image and the Bicep and starts the image once; a check after each deploy proves that the new version started.
- **Why now:** roadmap C4. Nothing runs on Azure yet, so no change reaches the daughter. From here on every merge ships, C5 first.
- **Process:** tooling-only (`skip_specs`), applied directly, in two PRs. The first PR's merge is the first deployment; the second records what the live part found and archives the change.
- **Out of scope:** the wake-from-zero measurement (#18, after v1); the forwarded headers and the production sign-in addresses (C6); the Enable Banking settings on the container app (C5); Application Insights; a custom domain.
- **Riskiest assumption:** the deploy identity's first login (GitHub's new subject format) and its narrow rights from M3 are enough for the whole stack, the app identity's role assignment included, on the first run.
- **Scenarios:** none added, modified or removed.

## Why

Roadmap step **C4** (`pm/roadmap.md`). M3 prepared the resource group, the deploy identity and the GitHub environment `production`, but nothing uses them yet, and nothing of the app runs on Azure. Until it does, no change reaches the daughter, and the iPhone checks that C3 left for M5 (`tests/manual-scenarios.md`) cannot start. C5, in flight, is the first change that needs production secrets; C4 merges first and prepares the vault for them (design.md D2).

No use case directly: C4 delivers UC1–UC3 to the phone. It applies Q3 (one container serving the API and the frontend, [ADR-0002-frontend-hosting](../../../docs/adr/0002-frontend-hosting.md)) and Q4 (Container Apps scaling to zero, a public ghcr.io image, [ADR-0006-hosting-registry-and-job](../../../docs/adr/0006-hosting-registry-and-job.md)).

## What Changes

- **One image** (a Dockerfile at the repository root): the frontend built in a Node stage, the backend published with the .NET SDK that `global.json` pins, the frontend copied into the backend's web root, on Microsoft's small "chiseled" ASP.NET Core runtime. An allowlist `.dockerignore` keeps secrets and local files out of the build (design.md D12).
- **Bicep in `infra/`** (D1, D10, D13): `main.bicep` calls `platform.bicep` (the log workspace, Key Vault, the app's identity and its roles, the Container Apps environment) and `features.bicep` (the container app, with one section per feature later). `main.bicepparam` holds the production values.
- **A deploy workflow** on every push to `main`, and by hand on `main` (D14):
  - build and push the image, tagged with the commit SHA;
  - check that it can be pulled without a login (D3);
  - log in to Azure as the deploy identity, with no stored secret;
  - apply the stack, which deletes whatever the Bicep no longer declares;
  - check that the new version started and answers (D8).
- **A PR check `image-and-infra`** (D7): the Bicep compiled and linted, the image built and started once. The ruleset on `main` requires it.
- **The live part after the first merge** (D4): the image made public, the first login confirmed, the four Enable Banking production values put into Key Vault by a guided task (D2, D15), the app's address recorded.
- **Docs** (D16):
  - `docs/conventions/workflow.md` §§ 4–5;
  - a new operations page for the deployment, plus `expiring-approvals.md` and `azure-prerequisites.md`;
  - an amendment to ADR-0006;
  - `CLAUDE.md` commands;
  - the ruleset file and its page;
  - software-factory lessons from R-46 on, with a divergence and inventory lines;
  - roadmap C4's text and a change-log entry (D9), and `pm/progress.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Deploying changes how the code ships, not what the app does, so the change sets `skip_specs: true` (design.md D5). The deployed app must meet the existing specs (`app-delivery`, `app-installation`, `app-shell`, `service-health`, `api-errors`), which this change leaves as they are.

## Non-goals

- **Measuring the wake from zero,** and the always-on fallback it may lead to: [#18](https://github.com/jakubbohm/RevolutReader/issues/18), after v1 (D9).
- **Forwarded headers** and the **production sign-in redirect addresses:** C6 (D5, D11).
- **The Enable Banking settings on the container app:** C5 wires them when it merges (D2). No app code changes here.
- **The storage account and the Data Protection keys** (C6), the tables (C7), the push keys (C8).
- **Application Insights,** OpenTelemetry export and alerts (D6).
- **A custom domain, a staging environment, automatic rollback** (D8), **deny settings on the stack.**
- **A private image or a container registry** (D3).
- **Two stacks with manually applied shared infrastructure:** the software factory's default, not used here (D1).
- **Moving to .NET 11 GA:** the follow-up PR from C1 changes `global.json` and the two image tags together (D12).

## Open questions

- Applies Q3 and Q4; decides none of Q1–Q10.

## Impact

- **New files:** `Dockerfile`, `.dockerignore`, `infra/main.bicep`, `infra/platform.bicep`, `infra/features.bicep`, `infra/main.bicepparam`, `infra/bicepconfig.json`, `.github/workflows/deploy.yml`, `docs/operations/deployment.md`. Changed: `.github/workflows/ci.yml` (one job).
- **Azure,** through the stack after the merge: `rg-revolutreader` gets the log workspace, the vault, the app's identity with its role on the vault, the Container Apps environment and the container app `tarjeta-papa`. By hand, with the owner's go: the owner's Key Vault role on the resource group, so the owner's ID is written nowhere (design.md D17), and the four Key Vault values (guided task).
- **GitHub:**
  - the package `ghcr.io/jakubbohm/revolutreader`, made public once;
  - the ruleset on `main` re-applied with `image-and-infra` (the owner's go);
  - the `production` environment used for the first time.
- **Cost:** about €0. The app stays within Container Apps' monthly free grant, logs within the 5 GB a month that Log Analytics gives free, and Key Vault costs pennies (ADR-0006, D6).
- **Unchanged:** app code, tests, Entra ID, Enable Banking.
