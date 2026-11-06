# ADR-0006: Hosting, registry and the scheduled job — Container Apps scaling to zero, ghcr.io, a Logic App as the clock

**Status:** Accepted (the user's decision, 2026-11-05); Decision item 4 (the Logic App clock) superseded 2026-11-06 by [ADR-0008-phone-triggered-check](0008-phone-triggered-check.md): the owner's iPhone calls the endpoint; amended 2026-11-06 in C4: the package's visibility and the deploy's image check, corrected after the first deploy found the package public (Decision, item 3), the cold-start measurement moved to after v1 (Decision, item 5), the log destination (Consequences) · **Date:** 2026-11-05 · **Roadmap:** F0-2; applied in M3, C4, C6, C9 · **Questions:** Q4

> Findings verified on 2026-11-05 against the sources linked with each one. Unless noted, prices are Azure list prices for West Europe from the [Azure Retail Prices API](https://prices.azure.com/api/retail/prices).
>
> **Reversed the same day, before anything was committed:** the user first accepted App Service Free (F1). The user then switched to Container Apps. Both scale to zero at the same cold-start cost, and Container Apps leaves an affordable always-on fallback (one replica at the idle rate). App Service Free is kept below as an alternative.

## Context

- **Kickoff ch. 6–7:** the app runs as one Docker container on Azure App Service. Q4 asked for the tier, the registry and the job hosting: an in-app job needs a host that is always awake.
- **The job:** it runs 4 times a day without PSU headers, from 06:00 ([ADR-0001-bank-data-access § Decision](0001-bank-data-access.md#decision)); since [ADR-0008-phone-triggered-check](0008-phone-triggered-check.md), the owner's iPhone triggers it instead. The check is ordinary app code that a scheduler only triggers ([testing.md § Time and the background job](../conventions/testing.md#time-and-the-background-job)). The in-process test harness holds while the app is a single process ([divergences.md R-12](../software-factory/divergences.md)).
- **Constraints:**
  - The budget is free tiers only and the repository is public (the user, 2026-11-04).
  - The owner uses Container Apps for nothing else, so the free grant is all this app's (the user, 2026-11-05).
- **Sign-in** is a login cookie encrypted with ASP.NET Core Data Protection keys ([ADR-0003-sign-in](0003-sign-in.md)).

### Container Apps (Consumption plan)

- **Free grant:** each month, per subscription, the first 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests are free. A revision scaled to zero costs nothing ([Microsoft Learn: billing](https://learn.microsoft.com/azure/container-apps/billing), updated 2026-03-25).
- **Idle rate:** a replica is billed at the reduced idle rate only when:
  - the revision's minimum replica count is above zero;
  - the revision is scaled to that minimum;
  - the replica handles no requests, uses under 0.01 vCPU and receives under 1,000 bytes/s.

  Otherwise the active rate applies. The environment has no fee unless it uses Dedicated profiles (same source).
- **Rates:** East US list rates via the Retail Prices API ([devzero, 2026](https://www.devzero.io/blog/azure-container-apps-pricing)) are about $0.000024 per vCPU-second active and $0.000003 idle, and $0.000003 per GiB-second. Germany West Central's rates could not be read (the API rate-limited the request).
- **Scaling down:** after the last request, the app scales to zero after the KEDA cool-down. That is `cooldownPeriod`, 300 s by default and configurable ([Azure SDK reference](https://learn.microsoft.com/javascript/api/@azure/arm-appcontainers/scale)).
- **Time-based scaling:** cron scale rules exist, with time zone, start, end and replica count. But a replica they keep running sits above a minimum of 0, so it is billed at the active rate. One report says such rules never triggered ([Tech Community](https://techcommunity.microsoft.com/blog/appsonazureblog/configure-time-based-scaling-in-azure-container-apps/4398327)).
- **Cold start:** about 20 s in Microsoft's own demo ([Tech Community](https://techcommunity.microsoft.com/blog/AppsonAzureBlog/azure-container-apps-express-for-shipping-container-apps-fast/4531371), 2026-06-30); other reports range from 5 to 37 s. "Container Apps Express" wakes in about 1.5 s, but it has been in public preview only since 2026-06-30.

### App Service

- **Free (F1) runs Linux containers.** Per plan: 60 CPU-minutes a day (at most 3 per 5 minutes) and 1 GB of memory ([Azure subscription limits](https://learn.microsoft.com/azure/azure-resource-manager/management/azure-subscription-service-limits), updated 2026-09-29).
- **Past the CPU quota the app is stopped:** every request gets 403 until the quota resets at midnight UTC. Microsoft positions Free for dev/test ([Microsoft Learn: monitor](https://learn.microsoft.com/azure/app-service/web-sites-monitor)).
- **No Always On below Basic.** Without it, the app is unloaded after 20 minutes without requests ([Microsoft Learn: configure](https://learn.microsoft.com/azure/app-service/configure-common)).
- **Cold start:** about 20 s for the first request after a long idle ([gillius.org](https://gillius.org/blog/2025/10/cold-start-azure.html), 2025-10-22).
- **Free Linux plans per region:** apparently one per region per subscription.
- **B1** (always on): about €11.83 a month.

### Login cookies on a host that scales to zero

- By default, ASP.NET Core keeps its Data Protection keys inside the container. A new container (every wake from zero, every deployment) creates new keys. Cookies encrypted with the old keys can't be read, so every user is signed out.
- The keys must be persisted to shared storage. `Azure.Extensions.AspNetCore.DataProtection.Blobs` 1.5.5 (2026-10-21, [NuGet](https://www.nuget.org/packages/Azure.Extensions.AspNetCore.DataProtection.Blobs)) stores them in Azure Blob Storage.

### Registry

- **ACR Basic:** about €4.49 a month.
- **GitHub Container Registry:** storage and bandwidth are "currently free", with at least a month's notice before any change. Public images are pulled anonymously; a private one needs a classic personal access token ([GitHub Docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)).

### Job options

- **Logic Apps Consumption:**
  - the first 4,000 built-in actions a month are free ([pricing](https://learn.microsoft.com/azure/logic-apps/logic-apps-pricing));
  - the HTTP action can authenticate with a managed identity ([Microsoft Learn](https://learn.microsoft.com/azure/logic-apps/authenticate-with-managed-identity));
  - the Recurrence trigger takes a time zone, but runs may drift at daylight-saving changes ([Microsoft Learn](https://learn.microsoft.com/azure/connectors/connectors-native-recurrence)).
- **GitHub Actions schedules:** runs "can be delayed" and "some queued jobs may be dropped". In public repositories, schedules are disabled after 60 days without activity ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
- **Azure Functions Flex Consumption:** no container support and no `WEBSITE_TIME_ZONE` ([Microsoft Learn](https://learn.microsoft.com/azure/azure-functions/functions-scale)).
- **Container Apps jobs:** they reuse the app's image with a different command. Cron schedules run in UTC ([Microsoft Learn](https://learn.microsoft.com/azure/container-apps/jobs)).

## Decision

Decided by the user, 2026-11-05:

1. **Azure Container Apps on the Consumption plan, in Germany West Central.**
   - One container app in its own environment, with external HTTPS ingress.
   - Minimum 0 and maximum 1 replica, 0.25 vCPU and 0.5 GiB.
   - A managed identity; secrets come from Key Vault as Container Apps secrets, exposed as environment variables.
   - It wakes on any request and scales to zero after the cool-down. C4 may lengthen the cool-down from its 5-minute default.
2. **Data Protection keys persist in Blob Storage** in the app's own storage account, which therefore arrives with sign-in (C6). Without this, every wake from zero would sign every user out.
3. **Registry: ghcr.io, with a public image.**
   - It is built once per merge to `main` ([workflow.md § 4](../conventions/workflow.md#4-cicd)) and pushed with GitHub's built-in token.
   - Container Apps pulls it anonymously.
   - The image contains nothing private: secrets and the allowlist come from Key Vault at runtime.
   - *(Amended by the user, 2026-11-06, in C4: GitHub Docs say a new package starts private, and only its web page makes it public, irreversibly ([GitHub Docs: access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility), read 2026-11-06). So the deploy checks, before touching Azure, that the image it just pushed can be pulled without a login; if not, it stops with the link to the package's settings until the owner makes it public. Corrected after the first deploy the same day ([run 42302387813](https://github.com/jakubbohm/RevolutReader/actions/runs/42302387813)): the workflow's push created the package public, linked to the repository, and the check passed at once. The likely reason, which no source confirms: a package that a workflow pushes and links to a public repository takes the repository's visibility. The check stays, because it still stops a deploy whenever the package is private, e.g. one created again at reinstatement, or if GitHub changes this behaviour. A private image was weighed again and rejected: a classic token with access to all the owner's packages, and Azure's pulls counting against the Free plan's quota once ghcr.io charges (c005 design.md D3).)*
4. **The 4-a-day job: a Logic App (Consumption) acts as the clock.** On schedule it calls a protected endpoint in the app. The call wakes the app like any request, and the app runs the check as ordinary app code. The app stays a single process.
   - **The endpoint must be safe to call twice.** Logic Apps retries failed calls, and each bank call counts against the 4 unattended requests a day.
   - **C9 decides** how the Logic App proves who it is (its managed identity, or a random key in Key Vault), the time zone, and the exact times.

   *(Superseded by the user, 2026-11-05, after the phone test of 2026-11-06: [ADR-0008-phone-triggered-check](0008-phone-triggered-check.md). There is no Logic App. An iOS Shortcuts automation on the owner's iPhone calls the same protected endpoint whenever a Revolut notification arrives. The call still wakes the app like any request, and the app stays one process. The endpoint must still be safe to call twice, because one payment can bring several notifications and the Shortcut may retry. C9 decides how the Shortcut proves who it is.)*
5. **If the cold start is too slow:** set the minimum to 1 replica, around the clock. Its idle rate comes to roughly $4–6 a month after the free grant (East US rates, the owner's estimate is up to about $8). It stays on at night, because a time-based rule that turns it off at night would bill the daytime replica at the active rate and cost more. C4 measures the cold start first. *(Amended by the user, 2026-11-06, in C4: the measurement moved to after v1, [#18](https://github.com/jakubbohm/RevolutReader/issues/18), with its decision rule set in advance: a median up to about 20 s changes nothing; slower, and the owner chooses between a longer cool-down and one always-on replica. Until then the app runs with the settings above and the default cool-down, and each deploy's summary shows the time to its first answer (c005 design.md D8, D9).)*

## Alternatives considered

- **App Service Free (F1)** with the same Logic App. Accepted first, then reversed the same day by the user:
  - the cold start is the same;
  - but it has a hard 60-CPU-minute daily cap, after which every request fails until midnight UTC, and bots can trigger it;
  - it has no uptime guarantee;
  - its only always-on upgrade is B1 at about €11.83 a month.

  In its favour, it sleeps after 20 minutes instead of 5 and needs less Bicep.
- **App Service B1 with Always On and an in-app scheduler.** The simplest, with no sleeping app. Rejected: about €11.83 a month, over the free-tier budget.
- **Container Apps Express.** Wakes in about 1.5 s. Rejected for now: in preview since 2026-06-30, with no pricing in its announcement.
- **Scaling to zero overnight with a time-based rule.** Rejected: the daytime replica is billed at the active rate, so it costs more than one always-on idle replica (about $7–8 versus $4–6 a month), and the rules are reported as unreliable.
- **ACR Basic.** Rejected: about €4.49 a month, pointless for a public image.
- **A private ghcr.io image.** Rejected: a classic token, one more expiring secret, and nothing in the image is private.
- **A Container Apps job.** Rejected:
  - a second process, which reopens [R-12](../software-factory/divergences.md);
  - schedules in UTC only;
  - the bank and push secrets duplicated.
- **An Azure Functions timer.** Rejected:
  - Flex can't run containers, so it would be a second project with its own storage and duplicated secrets;
  - a second process;
  - UTC only.
- **A GitHub Actions schedule.** Rejected: runs may be delayed or dropped, it would be disabled after 60 days without repository activity, and GitHub would hold a credential to the app.

## Consequences

- **Running cost:** about €0 within the free grant, plus pennies for Table and Blob Storage and Key Vault.
  - A wake keeps 0.25 vCPU running through the 5-minute cool-down, about 75 vCPU-seconds. The grant covers about 2,400 wakes a month.
  - Bots that wake the app cost cents, not an outage.
- **Accepted:** after 5 minutes without use, the data takes about 20 s to arrive. The screen shows at once from the PWA's cache.
- **M3:** creates the resource group in Germany West Central. There is no Free-plan region check.
- **C4:**
  - the Container Apps environment and app in Bicep, pulling the ghcr.io image, with a managed identity and Key Vault-backed secrets;
  - making the GitHub package public, since GitHub may create it private on the first push *(not needed in the first deploy: Decision, item 3)*;
  - choosing where the environment's logs go: none, or a Log Analytics workspace. *(Amended by the user, 2026-11-06, in C4: a Log Analytics workspace, 30 days of retention and a daily cap of 0.1 GB. A copy that scaled to zero takes its output with it, and the live log stream shows only running copies. The first 5 GB a month are free, and the cap bounds even a runaway month; when it is reached, collection stops until the daily reset. [#17](https://github.com/jakubbohm/RevolutReader/issues/17) checks the real volume (c005 design.md D6).)*
  - measuring the cold start. *(Moved to after v1: Decision, item 5.)*
- **C6:** the storage account with a blob container for the Data Protection keys, accessed with the managed identity. [ADR-0005-data-storage](0005-data-storage.md) gets its tables in the same account later.
- **C9:**
  - the Logic App in Bicep;
  - the protected, retry-safe endpoint;
  - its authentication, the time zone and the times.

  *(Since ADR-0008: no Logic App, time zone or times. C9 builds the endpoint and decides how the Shortcut authenticates.)*
- **Maximum 1 replica:** one app copy at a time.
- **The app stays one process,** so the in-process test harness (R-12) stays valid.
- **Software factory:** [lessons.md R-27](../software-factory/lessons.md) (including the reversal), and the project's shortcut in [divergences.md R-27](../software-factory/divergences.md).
