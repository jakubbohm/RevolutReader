# Deployment

> How the app gets to Azure (roadmap step C4): the deployed resources and their identifiers, what the deploy does, the first deployment, the guided task that puts the Enable Banking values into Key Vault, the transactions table and its one-time history import (C7b), read-only checks, rolling back and removing everything. The rules behind it are in [workflow.md § 4](../conventions/workflow.md#4-cicd) and [§ 5](../conventions/workflow.md#5-infrastructure); the hand-made setup it builds on is in [azure-prerequisites.md](azure-prerequisites.md). The reinstatement guide (D1) and decommissioning (M8) build on this file.
>
> Commands are PowerShell 7, run from the repository root with the owner's logins. **Every Azure command names the subscription explicitly** (the CLI's default subscription is an employer one). Nothing here prints a secret's value. Last updated: 2026-11-09 (C7b: the table `transactions`, the app's role on the storage account, the history import, the rollback that keeps the table).

## Identifiers (non-secret)

Everything below is in the resource group `rg-revolutreader` (Germany West Central) and managed by the deployment stack, except the package on GitHub.

| What | Value |
|---|---|
| Deployment stack | `revolutreader`; deletes what the Bicep no longer declares; no deny settings |
| Log Analytics workspace | `log-revolutreader` (30 days; 0.16 GB daily cap since C12, the free 5 GB a month ÷ 31, was 0.1 GB: [ADR-0009-application-telemetry](../adr/0009-application-telemetry.md)). The cap covers the Application Insights tables too, which live in the workspace and follow its retention |
| Application Insights | `appi-revolutreader` (C12), workspace-based on `log-revolutreader`, local authentication off: only an identity with Monitoring Metrics Publisher on it can write. The deployed app sends its logs and traces there, not its metrics; the resource keeps its own default cap. Its connection string reaches the app as `APPLICATIONINSIGHTS_CONNECTION_STRING` ([configuration.md § Telemetry settings](../conventions/configuration.md#telemetry-settings)) |
| Key Vault | `kv-revolutreader`, `https://kv-revolutreader.vault.azure.net/` (Azure roles, soft delete 90 days, no purge protection). Public network access stays on: the app reads its secrets at every deploy and every 30 minutes, and Container Apps is not one of the "trusted Microsoft services" allowed past a closed vault (Microsoft Learn, read 2026-11-07). Closing it would need the environment rebuilt with its own network and a private endpoint, which changes the app's address. Kept by the owner, 2026-11-07: only the app's identity and the owner have a role on it, and anyone with the owner's login could reopen it anyway |
| The app's identity | `id-revolutreader-app` (user-assigned), Key Vault Secrets User on the vault; since C12 Monitoring Metrics Publisher on Application Insights; from C6 also Storage Blob Data Contributor on the container `dataprotection` and Key Vault Crypto User on the key `dataprotection`; from C7b Storage Table Data Contributor on the storage account ([The transactions table](#the-transactions-table-c7b)); client ID `f24d2909-ecb2-45d2-a230-d9551f472ded` (reaches the app as `AZURE_CLIENT_ID`, for telemetry and, from C6, the cookie keys, from C7b the table), principal (object) ID `d4f00927-dcd1-4bc3-8b25-985f9d456fe0` |
| Storage account (C6) | `strevolutreader` (StorageV2, Standard_LRS, shared-key access off, no public blob access, TLS 1.2, public network on and guarded by roles), with the private container `dataprotection`. The login cookie's keys live in the blob `dataprotection/keys.xml` (the stack's output `keysBlobUri`), created by the app on its first start. Since C7b also the table `transactions`, which keeps the settled transactions, the days older than the bank's 90 among them once the history is imported. Its endpoint, `platform.bicep`'s output `tableEndpoint` (not a stack output), reaches the app as `ConnectionStrings__tables`. Removing the table from the Bicep deletes it with its rows ([Rolling back](#rolling-back)) |
| The cookie keys' key (C6) | the RSA key `dataprotection` in `kv-revolutreader` (wrap and unwrap only); the stack's output `keyVaultKeyUri` is its versionless address, so a rotated key version is picked up. The app reaches the blob and the key as its identity (the setting `AZURE_CLIENT_ID`, c007 design.md D7) |
| Container Apps environment | `cae-revolutreader` (workload profiles, Consumption only) |
| Container app | `tarjeta-papa` |
| The app's address | `https://tarjeta-papa.livelyground-53b2e5ad.germanywestcentral.azurecontainerapps.io` (the stack's output `appUrl`; plain HTTP is redirected to HTTPS). Azure generated the part after the app's name; a new environment gets a new one |
| Image | `ghcr.io/jakubbohm/revolutreader:<commit SHA>`, package [settings](https://github.com/users/jakubbohm/packages/container/revolutreader/settings) |
| Workflows | [deploy.yml](../../.github/workflows/deploy.yml) ("Deploy": jobs `image`, `deploy`); the PR check `image-and-infra` in [ci.yml](../../.github/workflows/ci.yml) |

## What the deploy does

On every merge to `main`, and when run by hand on `main` (Actions, Deploy, Run workflow):

1. **`image`** builds the image from the merge commit and pushes it to ghcr.io, tagged with the commit SHA. It has no Azure access.
2. **`deploy`** runs in the GitHub environment `production`:
   1. **Image check:** the image must be pullable without a login, as Container Apps pulls it. If not, the job stops before touching Azure and shows the package's settings link.
   2. **Azure login** as `id-revolutreader-deploy`, through its federated credential; no stored secret.
   3. **Stack:** `infra/main.bicep` with `infra/main.bicepparam`, the image tag set to the commit SHA.
   4. **Check after the deploy:** the latest revision is ready and runs this image, `/health` and `/` answer at the app's address within 3 minutes, and the revision is Running (Azure also reports RunningAtMaxScale).
   5. **Summary:** the image, the revision, the address and the time to the first answer, on the run's page.

Deploys run one at a time, in the order of the merges. When one is red, see [workflow.md § 4](../conventions/workflow.md#4-cicd) for what each failed step means, and [Rolling back](#rolling-back) below. A stack step that fails with `Unable to get value using Managed identity` while the four secrets are in the vault, none of them empty, most likely means the identity's role on the vault was created again in that run and has not taken effect yet (up to 10 minutes; see [The first deployment](#the-first-deployment), step 5): re-run the failed job after that.

## Previewing a change to the Bicep (read-only)

Before a PR that changes `infra/`, to see what the next deploy would create, change or delete. Neither command changes anything in Azure.

```powershell
$sub = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$rg  = 'rg-revolutreader'
$env:IMAGE_TAG = git rev-parse HEAD   # any tag: neither command pulls the image

az stack group validate --subscription $sub --resource-group $rg --name revolutreader `
    --template-file infra/main.bicep --parameters infra/main.bicepparam `
    --action-on-unmanage deleteResources --deny-settings-mode none --output none

az deployment group what-if --subscription $sub --resource-group $rg `
    --template-file infra/main.bicep --parameters infra/main.bicepparam
```

The what-if shows the deploy identity as unchanged ("Ignore"): the stack does not manage it. Stacks have no what-if of their own, so it previews the same template as an ordinary deployment; a resource that the Bicep no longer declares shows as unchanged there, but the stack deletes it.

## The first deployment

Done once, after the merge of the PR that added the deploy (2026-11-06: PR [#21](https://github.com/jakubbohm/RevolutReader/pull/21), deploy run [42302387813](https://github.com/jakubbohm/RevolutReader/actions/runs/42302387813)); again at a reinstatement (D1).

1. **The package.** The `image` job's push creates the package `revolutreader`, linked to the repository. On 2026-11-06 it came out public at once, and the image check passed; the owner changed nothing. GitHub Docs say a new package starts private. The likely reason, which no source confirms: a package that a workflow pushes and links to a public repository takes the repository's visibility.
2. **If the image check stops the run** (the package is private: e.g. one created again at a reinstatement, or GitHub changes this behaviour), the `deploy` job fails at its first step, before any Azure step, with the settings link. The owner makes the package public: open the [package settings](https://github.com/users/jakubbohm/packages/container/revolutreader/settings), then Danger Zone, Change visibility, Public. This cannot be undone, and nothing in the image is private ([ADR-0006 § Decision](../adr/0006-hosting-registry-and-job.md#decision), item 3).
3. **Then re-run the failed job:** on the run's page, Re-run jobs, Re-run failed jobs. The image check now passes.
4. **The first Azure login.** It succeeded on 2026-11-06 with the subject M3 set. If `azure/login` fails with `AADSTS700213`, the federated credential's subject is wrong: fix it as [azure-prerequisites.md § Checks](azure-prerequisites.md#checks) says, with the owner's go, and re-run the failed job.
5. **The stack** creates the workspace, the vault, the app's identity and its role, the environment and the container app: exactly these six on 2026-11-06. Since C12 it also creates Application Insights and the identity's second role, on it; the deploy identity may assign that role only once [azure-prerequisites.md](azure-prerequisites.md), item 5, lists it. Creating the environment takes a few minutes. On 2026-11-06 the role was created 2 min 22 s before the app (22:13:08 and 22:15:30 UTC). **At a reinstatement, since C5, this first run fails at the container app.** Its four Enable Banking settings are Key Vault references, and Container Apps reads each one when it creates or updates the app, failing the write if it cannot ([microsoft/azure-container-apps#1291](https://github.com/microsoft/azure-container-apps/issues/1291), read 2026-11-07). The new vault is still empty, and the identity's new role can take up to 10 minutes to take effect ([Microsoft Learn: Troubleshoot Azure RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/troubleshooting), read 2026-11-07). The stack step most likely shows `ContainerAppOperationError` with `Unable to get value using Managed identity … for secret enablebanking-…`, an error that does not name the cause ([Azure OSS Developer Support blog](https://azureossd.github.io/2024/08/27/Troubleshooting-general-secret-issues-on-Container-Apps), read 2026-11-07); the other five resources are created. Do steps 7 and 8 (the owner's new role, too, can take up to 10 minutes before the writes succeed), then on the run's page Re-run jobs, Re-run failed jobs: the stack should now create the app, and step 6 follows. On 2026-11-06 the app had no secrets yet, so this order was not exercised.
6. **The check after the deploy** passes, and the summary shows the app's address. Record the address and the identity's IDs in [Identifiers](#identifiers-non-secret). On 2026-11-06 the first run's check failed only at its last step, on the state `RunningAtMaxScale`, which the Azure references do not list; [#22](https://github.com/jakubbohm/RevolutReader/pull/22) accepts it, and its deploy, run [42305043086](https://github.com/jakubbohm/RevolutReader/actions/runs/42305043086), passed every step.
7. **The owner's access to the vault's secrets:** the hand-made role in [azure-prerequisites.md](azure-prerequisites.md), item 7, with the owner's go. Applied on 2026-11-06 (recorded there).
8. **The Enable Banking values** into Key Vault: the guided task below, with the owner's go. Done on 2026-11-06 (recorded there).

## Guided task: the Enable Banking values into Key Vault

Puts the four production values that C5's bank adapter reads into the vault (c005 design.md D15). Since C5 the container app reads them as Key Vault references (`infra/features.bicep` § The bank): Azure refuses to create or update the app while it cannot read one of them (e.g. one is missing). A new value reaches the app by itself: the references name no version and the values reach the app as environment variables, so Azure fetches the latest version within 30 minutes and restarts the app with it. There is nothing to restart by hand ([Microsoft Learn: Manage secrets in Azure Container Apps § Key Vault secret URI and secret rotation](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets#key-vault-secret-uri-and-secret-rotation), read 2026-11-07).

| Key Vault secret | Setting the app reads (C5) | Value, from the owner's machine |
|---|---|---|
| `EnableBanking--ApplicationId` | `EnableBanking__ApplicationId` | the application ID ([spikes/enable-banking/README.md § Identifiers](../../spikes/enable-banking/README.md#identifiers-non-secret)) |
| `EnableBanking--PrivateKey` | `EnableBanking__PrivateKey` | the text of `spikes/enable-banking/secrets/<application ID>.pem` |
| `EnableBanking--SessionId` | `EnableBanking__SessionId` | `session_id` in `spikes/enable-banking/secrets/session.json` |
| `EnableBanking--AccountId` | `EnableBanking__AccountId` | the one entry of `account_uids` in the same file |

**Needs:** the owner's Key Vault Secrets Officer role ([azure-prerequisites.md](azure-prerequisites.md)), and the checkout that holds `spikes/enable-banking/secrets/` (the main checkout on the owner's machine; the folder is gitignored). Run it with the owner's go, by the owner or by Claude. The key goes in from its file, so its text never appears on a command line; every write prints nothing, and the last command lists only the names.

```powershell
$sub     = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$vault   = 'kv-revolutreader'
$secrets = 'spikes/enable-banking/secrets'
$appId   = '469fb438-ada6-4831-9498-70a1890097d6'

$session = Get-Content -Raw "$secrets/session.json" | ConvertFrom-Json
$uids    = @($session.account_uids | Where-Object { $_ })
if ($uids.Count -ne 1) { throw "Expected exactly one account UID in session.json, found $($uids.Count)." }
if (-not $session.session_id) { throw 'No session_id in session.json.' }

az keyvault secret set --subscription $sub --vault-name $vault --name 'EnableBanking--ApplicationId' --value $appId --output none
az keyvault secret set --subscription $sub --vault-name $vault --name 'EnableBanking--PrivateKey' --file "$secrets/$appId.pem" --encoding utf-8 --output none
az keyvault secret set --subscription $sub --vault-name $vault --name 'EnableBanking--SessionId' --value $session.session_id --output none
az keyvault secret set --subscription $sub --vault-name $vault --name 'EnableBanking--AccountId' --value $uids[0] --output none

az keyvault secret list --subscription $sub --vault-name $vault --query '[].name' --output tsv
```

**Done on 2026-11-06** by the owner, in the owner's own PowerShell 7 window, together with the role it needs (Claude Code's permission check had blocked Claude's role assignment even with the owner's go). Read back: the vault holds exactly `EnableBanking--AccountId`, `EnableBanking--ApplicationId`, `EnableBanking--PrivateKey` and `EnableBanking--SessionId`.

**Replacing a value later** (a renewed session, a new key: [expiring-approvals.md](expiring-approvals.md)): run only its line again. Key Vault keeps the old value as an older version; the app follows the latest.

## The sign-in's values and settings (C6)

Since C6 the container app also reads two Key Vault references, `SignIn--ClientSecret` and `SignIn--AllowedEmails` (`infra/features.bicep` § Sign-in, as `SignIn__ClientSecret` and `SignIn__AllowedEmails`). **Both must exist before C6's merge:** a reference to a missing secret stops the new revision. They are written by the guided step in [entra-id.md § The client secret and the allowlist](entra-id.md#the-client-secret-and-the-allowlist-c6), together with the local and backup copies. The deploy also sets two plain settings from `platform.bicep`'s outputs, which `main.bicep` passes on: `DataProtection__KeysBlobUri` and `DataProtection__KeyVaultKeyUri`; the identity's client ID comes from the existing `AZURE_CLIENT_ID` (c007 design.md D7).

- **The deploy identity's sixth role (added 2026-11-08):** C6's Bicep grants Key Vault Crypto User on the key, so the deploy identity's condition must allow it first ([azure-prerequisites.md § Widening the condition](azure-prerequisites.md#widening-the-condition-c6-the-sixth-role)). Without it the stack step fails at that role assignment, and the old revision keeps running.
- **After the first deploy with C6** (c007 design.md § Migration plan, step 4):
  - the new revision starts, and the app's output of the last hour shows no `Data Protection` or sign-in error;
  - the blob `dataprotection/keys.xml` exists (`az storage blob list --subscription $sub --account-name strevolutreader --container-name dataprotection --auth-mode login --query '[].name' -o tsv`; reading it needs a data role, so this check may need the owner's own role; otherwise no `Data Protection` error in the app's output plus the successful sign-in below is enough, since at the app's log level Data Protection writes only its warnings and errors, never a line saying the key ring loaded);
  - signing in at the app's address in a desktop browser works, then the two iPhone checks in [tests/manual-scenarios.md](../../tests/manual-scenarios.md).
  - **Checked 2026-11-08,** after the deploy of #30 ([run 42484952039](https://github.com/jakubbohm/RevolutReader/actions/runs/42484952039)):
    - **The stack and the app:** the stack read `succeeded` with 14 resources, the storage account, its container and the key among them. The revision running the merge's image started cleanly, scaled to zero and woke cleanly.
    - **The settings:** the two sign-in values came from Key Vault (every sync succeeded), and both `DataProtection__*` addresses and `AZURE_CLIENT_ID` were set. The app identity holds Storage Blob Data Contributor on the container and Key Vault Crypto User on the key.
    - **Read-only probes:** `/api/me` answered 401 and an unknown `/api` address 404, both as problem descriptions; `/api/auth/login` redirected to the consumers sign-in with this app's `redirect_uri`, `form_post` and PKCE.
    - **The logs:** no warning or error in the app's output or in Application Insights.
    - **The owner's checks:** the desktop sign-in passed. After the owner restarted the container app, the same browser was still signed in, so the keys outlived the container (the blob itself wasn't read; that needs a data role). Both iPhone checks passed.
    - **Reading `AppRequests`:** the sign-in return shows as `POST /api/{**path}` with 302, because the request matches the `/api` fallback route before the sign-in handler answers it.
- **Looking into a failed sign-in:** the app logs one `SignInFailed` warning with only the failure's kind. The OpenID Connect handler's own lines are switched off (`Logging:LogLevel:Microsoft.AspNetCore.Authentication.OpenIdConnect` is `Critical`), because they carry exception text and whatever anyone posts to the return address. To tell a lost correlation cookie from an unreadable state (both log as `AuthenticationFailureException`), set the environment variable `Logging__LogLevel__Microsoft.AspNetCore.Authentication.OpenIdConnect` to `Warning` on the container app for a short, bounded window (a new revision; posted text may then reach the log), then remove it again.

## The transactions table (C7b)

Since C7b the app keeps the settled transactions in the table `transactions` of `strevolutreader` (c010 design.md D5, D11). The deploy creates the table and the app identity's Storage Table Data Contributor, and sets `ConnectionStrings__tables` on the container app to the account's table endpoint. The role is on the storage account, not on the one table ([ADR-0005 § Consequences](../adr/0005-data-storage.md#consequences) says why), so it reaches the account's tables and nothing else. The deploy identity may assign this role since M3 ([azure-prerequisites.md](azure-prerequisites.md), item 5), so nothing is done by hand before the merge.

**After the first deploy with C7b** (c010 design.md § Migration plan, step 6), in this order:

1. The stack lists the table and the new role (the stack query in [Checks](#checks)), the new revision starts, and the app's telemetry shows no storage error.
2. The first open at the app's address keeps the settled transactions of the last 89 days, since the table holds none yet (c010 design.md D3). Then the read-only check below.
3. [The history import](#the-history-import-c7b), once.
4. The list compared once with the Revolut app.

The import's counts and the file's deletion go into `pm/progress.md` through a small docs PR, since they come after the archive.

**Rows arrive after the first open (read-only).** Reading the rows needs a data role, which only the app holds (and the owner during the import); the storage account's metrics need none. The first command shows the table's requests per operation and outcome: after the first open, expect successful writes and reads (`Success`) and no `AuthorizationError`. A `CreateTable` with a client error is expected too: the app's create-if-missing, answered "already exists". The second shows the number of rows in the account's tables; Microsoft's reference lists it hourly but does not say how soon a change shows ([Monitoring data reference for Azure Table Storage](https://learn.microsoft.com/en-us/azure/storage/tables/monitor-table-storage-reference), updated 2025-07-02, read 2026-11-09), and the import below prints the exact count. Written from that reference before any row existed: if the operation names differ, adjust them here.

```powershell
$sub          = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$storage      = az storage account show --subscription $sub --resource-group rg-revolutreader --name strevolutreader --query id --output tsv
$tableService = "$storage/tableServices/default"

# The table service's requests of the last 6 hours, per hour, by operation and outcome
az monitor metrics list --subscription $sub --resource $tableService --metrics Transactions `
    --dimension ApiName ResponseType --aggregation Total --interval 1h --offset 6h --output table

# The rows in the account's tables, hourly, over the last day
az monitor metrics list --subscription $sub --resource $tableService --metrics TableEntityCount `
    --aggregation Average --interval 1h --offset 1d --output table
```

### The history import (C7b)

Once, after the first open (c010 design.md D9). The explicit check `HistoryImportCheck` reads the M1 history file, `spikes/enable-banking/secrets/transactions-2026-11-04.json` (gitignored, only in the main checkout on the owner's machine), through the app's own page reading and mapping, and keeps its settled transactions from 2026-08-09 through the app's Table adapter. It keeps only the days before the oldest day the table already holds: the live reads keep that day and every later one, since a day's order must come from one complete read. It writes by upserts, so a second run changes nothing, and it prints counts only. The owner runs it in the owner's own PowerShell 7 window, from the main checkout on `main` after C7b's merge.

1. **The owner's temporary role.** Owner of the subscription gives no access to table data, so the owner's account gets Storage Table Data Contributor on the storage account, removed again at step 4. On the account, like the app's, because the import goes through the same create-if-missing. The owner runs the grant (Claude Code's permission check blocks role assignments). The account's ID is looked up when the block runs, as in [azure-prerequisites.md](azure-prerequisites.md), item 7, and written nowhere. A new role can take up to 10 minutes to take effect ([The first deployment](#the-first-deployment), step 5).

   ```powershell
   $sub     = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
   $storage = az storage account show --subscription $sub --resource-group rg-revolutreader --name strevolutreader --query id --output tsv

   # The account running this, never written down
   $token   = az account get-access-token --subscription $sub --query accessToken --output tsv
   $payload = $token.Split('.')[1].Replace('-', '+').Replace('_', '/')
   $payload = $payload.PadRight($payload.Length + (4 - $payload.Length % 4) % 4, '=')
   $me      = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json).oid
   Remove-Variable token, payload
   $owners  = @(az role assignment list --subscription $sub --scope "/subscriptions/$sub" --role Owner `
       --query "[?principalType=='User'].principalId" --output tsv)
   if ($owners -notcontains $me) { throw 'The account running this is not an Owner of the subscription.' }

   az role assignment create --subscription $sub --assignee-object-id $me --assignee-principal-type User `
       --role 'Storage Table Data Contributor' --scope $storage --output none
   ```

   Claude then checks it read-only; no ID is printed. Expected: two rows, `ServicePrincipal` (the app) and `User` (the owner); after step 4 only `ServicePrincipal`.

   ```powershell
   az role assignment list --subscription $sub --scope $storage --role 'Storage Table Data Contributor' `
       --query "[].{role: roleDefinitionName, principalType: principalType}" --output table
   ```

2. **The import,** in the same window. If it fails with status 403, the role has not taken effect yet: wait, then run the last line again. Whole days kept before a failure stay kept, and the next run imports the days before them.

   ```powershell
   $env:HistoryImport__File          = (Resolve-Path 'spikes/enable-banking/secrets/transactions-2026-11-04.json').Path
   $env:HistoryImport__TableEndpoint = az storage account show --subscription $sub --resource-group rg-revolutreader `
       --name strevolutreader --query primaryEndpoints.table --output tsv
   $env:HistoryImport__Subscription  = $sub

   dotnet test --project tests/RevolutReader.IntegrationTests --treenode-filter "/*/*/HistoryImportCheck/*" --output Detailed
   ```

3. **The counts to compare,** from the check's output. The export's evidence ([2026-11-04-history-export.json](../../spikes/enable-banking/evidence/2026-11-04-history-export.json)) records 116 transactions in 3 pages, all settled; the spike's findings date them from 2026-08-10, so none is older than 2026-08-09 ([spikes/enable-banking/README.md § Findings](../../spikes/enable-banking/README.md#findings), step 5).

   | Line | Expected |
   |---|---|
   | Transactions read | 116 |
   | Settled | 116 |
   | Kept | fewer than 116: those on the days before the oldest day the first open kept |
   | Days skipped | the file's days from that oldest kept day on, which the live reads keep (the export's own day among them) |
   | Rows in the table | at least Kept: the first open's rows and the imported ones |

   A different read or settled count is a finding: bring it to Claude, and keep the file. Running the check once more is safe and shows the import is complete: it keeps 0 and counts every day of the file as skipped, since the table now holds the file's oldest day.

4. **The role removed,** in the same window (in a new one, run step 1's lines up to the `throw` first). Claude checks it with step 1's read-only command.

   ```powershell
   $mine = @(az role assignment list --subscription $sub --scope $storage --role 'Storage Table Data Contributor' `
       --query "[?principalId=='$me'].id" --output tsv)
   if ($mine.Count -ne 1) { throw "Expected one Storage Table Data Contributor of the account running this, found $($mine.Count)." }
   az role assignment delete --subscription $sub --ids $mine[0]

   Remove-Item Env:HistoryImport__File, Env:HistoryImport__TableEndpoint, Env:HistoryImport__Subscription -ErrorAction SilentlyContinue
   Remove-Variable me, owners, mine
   ```

5. **The file and its backup deleted,** once the counts are right: `Remove-Item spikes/enable-banking/secrets/transactions-2026-11-04.json` in the main checkout, and the backup of it (suggested on 2026-11-08). From then on, the days older than the bank's 90 exist only in the table, so a rollback must keep it ([Rolling back](#rolling-back)).

## Checks

Read-only:

```powershell
$sub = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$rg  = 'rg-revolutreader'

# The stack: its state, what it manages and its outputs (appName, appUrl, keyVaultName)
az stack group show --subscription $sub --resource-group $rg --name revolutreader `
    --query "{state: provisioningState, resources: resources[].id, outputs: outputs}" --output json

# The revisions: which one is active, its state, its copies and its image
az containerapp revision list --subscription $sub --resource-group $rg --name tarjeta-papa `
    --query "[].{name: name, active: properties.active, state: properties.runningState, replicas: properties.replicas, image: properties.template.containers[0].image}" --output table

# The app answers (wakes it from zero)
$url = az stack group show --subscription $sub --resource-group $rg --name revolutreader --query outputs.appUrl.value --output tsv
Invoke-RestMethod "$url/health"

# The app's own output of the last day, from the workspace (lines can take a few minutes to arrive)
$workspace = az monitor log-analytics workspace show --subscription $sub --resource-group $rg `
    --workspace-name log-revolutreader --query customerId --output tsv
az monitor log-analytics query --subscription $sub --workspace $workspace --output table `
    --analytics-query "ContainerAppConsoleLogs_CL | where TimeGenerated > ago(1d) | project TimeGenerated, RevisionName_s, Log_s | order by TimeGenerated desc | take 50"

# Since C12, the app's telemetry of the last day in Application Insights, from the same workspace: its log lines, then its requests
az monitor log-analytics query --subscription $sub --workspace $workspace --output table `
    --analytics-query "AppTraces | where TimeGenerated > ago(1d) | project TimeGenerated, SeverityLevel, Message | order by TimeGenerated desc | take 50"
az monitor log-analytics query --subscription $sub --workspace $workspace --output table `
    --analytics-query "AppRequests | where TimeGenerated > ago(1d) | project TimeGenerated, Name, ResultCode, DurationMs | order by TimeGenerated desc | take 50"

# The names in the vault, never the values
az keyvault secret list --subscription $sub --vault-name kv-revolutreader --query '[].name' --output tsv
```

The logs and the telemetry never hold secrets, bank data or account identifiers (CLAUDE.md). Request telemetry in Application Insights does hold the users' browser names, which is allowed there because only the owner's Azure access can read it ([ADR-0009-application-telemetry](../adr/0009-application-telemetry.md), Decision item 6); never copy such rows into an issue, a PR or any other public place. Claude reads them only to diagnose, read-only.

**First run, 2026-11-06,** after the first two deploys, from Claude's machine: the stack read `succeeded` with six resources, its outputs at the top level (`outputs.appUrl.value`, as above); `/health` answered `Healthy` (HTTP 200, 0.35 s), `/` returned the page, and plain HTTP was redirected to HTTPS (301). Within minutes the workspace held the platform's events (`ContainerAppSystemLogs_CL`) and the app's start lines (`ContainerAppConsoleLogs_CL`); the log query above worked as written.

### Bank reads that did not end as read (C12)

Every bank read writes one log line, whatever ends it: who triggered it, the outcome, the HTTP status, the Enable Banking error code (`none`, or `unrecognised` for a value not shaped like a code) and, for an unexpected end, the reason (c006 design.md D8). These two read-only queries find the reads that did not end as `read`: every one in a period, and the same counted by reason, to spot cases nothing handles yet. Set the period first: from the first day, up to but not including the last, in UTC.

```powershell
$sub = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$rg  = 'rg-revolutreader'
$workspace = az monitor log-analytics workspace show --subscription $sub --resource-group $rg `
    --workspace-name log-revolutreader --query customerId --output tsv

$from = '2026-11-01'; $to = '2026-11-09'
$bankReads = "AppTraces | where TimeGenerated >= datetime($from) and TimeGenerated < datetime($to) | extend Category = tostring(Properties.CategoryName), EventId = tostring(Properties.EventId), Outcome = tostring(Properties.Outcome) | where Category == 'RevolutReader.Api.Bank.EnableBankingClient' and EventId in ('1', '2') and Outcome != 'read'"

# Every bank read in the period that did not end as read, newest first
az monitor log-analytics query --subscription $sub --workspace $workspace --output table `
    --analytics-query "$bankReads | project TimeGenerated, Read = iff(EventId == '1', 'balance', 'transactions'), Who = tostring(Properties.Who), Outcome, Status = tostring(Properties.Status), ErrorCode = tostring(Properties.ErrorCode), Reason = tostring(Properties.Reason) | order by TimeGenerated desc"

# The same, counted by reason, the most frequent first
az monitor log-analytics query --subscription $sub --workspace $workspace --output table `
    --analytics-query "$bankReads | summarize Reads = count(), Last = max(TimeGenerated) by Reason = tostring(Properties.Reason), Outcome, ErrorCode = tostring(Properties.ErrorCode) | order by Reads desc"
```

- **Where the fields are:** a log entry lands in `AppTraces`, its text in `Message`, its level in `SeverityLevel`, and its fields (`Who`, `Outcome`, `Status`, `ErrorCode`, `Reason`, …) in the dynamic column `Properties` ([Microsoft Learn: Application Insights telemetry data model](https://learn.microsoft.com/en-us/azure/azure-monitor/app/data-model-complete), updated 2026-10-09; [AppTraces table reference](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/apptraces), updated 2026-07-28; both read 2026-11-08). The Azure Monitor exporter adds the logger's category as `CategoryName` and a non-zero event ID as `EventId` (balance reads are 1, transaction reads 2), and sends an entry that carries an exception to `AppExceptions` instead; the bank-read lines carry none ([the exporter's `LogsHelper.cs` at 1.10.0](https://github.com/Azure/azure-sdk-for-net/blob/Azure.Monitor.OpenTelemetry.Exporter_1.10.0/sdk/monitor/Azure.Monitor.OpenTelemetry.Exporter/src/Internals/LogsHelper.cs), read 2026-11-08).
- **Columns to be confirmed with C7's first bank lines:** written from those sources before any bank line reached Application Insights, since nothing calls the adapter before C7. If the queries come back empty although the app has read the bank, look at a raw row and adjust the names here: `AppTraces | where Message startswith 'Bank ' | project TimeGenerated, Message, Properties | take 5`.
- **Reasons:** `Reason` is `none` except for an unexpected end, where it is a fixed text that quotes no bank data, or another exception's type name. A new value there is a case the adapter does not handle yet.

### Bank retries (C11)

Since C11 the bank client retries a present user's request that failed in a way that reads as "bank unavailable", up to 3 times (c008 design.md D1–D8). The read's own line above stays one per read and does not count the attempts; each retry shows as a warning of the retry library (Polly, under Microsoft's resilience library), named after the bank client's retry pipeline, `bank-retries` (c008 design.md D9). These two read-only queries list the retries in a period and count them by what the failed attempt got, to see whether the bank degrades. Set the period as above.

```powershell
$sub = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$rg  = 'rg-revolutreader'
$workspace = az monitor log-analytics workspace show --subscription $sub --resource-group $rg `
    --workspace-name log-revolutreader --query customerId --output tsv

$from = '2026-11-01'; $to = '2026-11-09'
$bankRetries = "union AppTraces, AppExceptions | where TimeGenerated >= datetime($from) and TimeGenerated < datetime($to) | extend Category = tostring(Properties.CategoryName), EventName = tostring(Properties.EventName), Pipeline = tostring(Properties.PipelineName) | where Category == 'Polly' and EventName == 'OnRetry' and Pipeline == 'IBankAccount-bank-retries'"

# Every bank retry in the period, newest first: what the failed attempt got, and the request it belongs to
az monitor log-analytics query --subscription $sub --workspace $workspace --output table `
    --analytics-query "$bankRetries | project TimeGenerated, Failure = iff(Type == 'AppExceptions', 'network failure', 'error answer'), Result = tostring(Properties.Result), OperationId | order by TimeGenerated desc"

# The same, counted by what the failed attempt got, the most frequent first
az monitor log-analytics query --subscription $sub --workspace $workspace --output table `
    --analytics-query "$bankRetries | summarize Retries = count(), Last = max(TimeGenerated) by Failure = iff(Type == 'AppExceptions', 'network failure', 'error answer'), Result = tostring(Properties.Result) | order by Retries desc"
```

- **To be confirmed once the first real retry lines arrive:** written from the library's code and the exporter's before any retry reached Application Insights. If the queries come back empty although the bank read lines show a read that took several seconds, look at raw rows and adjust the names here: `union AppTraces, AppExceptions | where tostring(Properties.CategoryName) == 'Polly' | project TimeGenerated, Type, Message, Properties | take 5`.
- **Where the fields are:** the library logs under the category `Polly`; a retry is the warning "Resilience event occurred. EventName: 'OnRetry', Source: 'IBankAccount-bank-retries//Retry', …", whose fields `EventName`, `PipelineName`, `StrategyName` and `Result` land in `Properties` ([Polly telemetry](https://www.pollydocs.org/advanced/telemetry.html); the message template in Polly.Extensions 8.4.2, read 2026-11-08). The pipeline's name is the bank client's name followed by `bank-retries`. `Result` is the failed answer's HTTP status, or for a network failure the failure's message. A network failure's warning carries the exception, so the exporter sends it to `AppExceptions` rather than `AppTraces` (both tables have `Properties`: [AppTraces](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/apptraces), [AppExceptions](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/appexceptions), both updated 2026-07-28, read 2026-11-08; the exporter's handling as in § Bank reads above, [`LogsHelper.cs` at 1.10.0](https://github.com/Azure/azure-sdk-for-net/blob/Azure.Monitor.OpenTelemetry.Exporter_1.10.0/sdk/monitor/Azure.Monitor.OpenTelemetry.Exporter/src/Internals/LogsHelper.cs), read 2026-11-08: a field of the message wins over the event's own name, so `EventName` is `OnRetry`).
- **What else the library writes:** an "Execution attempt" warning for every attempt the retry rule would retry, the last of four included; the queries leave them out and count the retries themselves. Its lines for successful attempts are switched off (`Logging:LogLevel:Polly` is `Warning`), so a read answered at once writes nothing of the library.
- **The read behind a retry:** a retry and the read's own line share the request's `OperationId`, so `AppTraces | where OperationId == '<OperationId from the first query>'` shows how that read ended.
- Neither query shows an identifier or bank data: the library logs the pipeline's name, the status or the failure's message, never a request's address (checked by the telemetry guard, c008 design.md D9).

## Rolling back

- **A version that does not start or misbehaves:** revert its PR (the merged PR's page has a Revert button, which opens a new PR). Its merge deploys the previous code through the same pipeline; nothing is changed in Azure by hand.
- **Since C7b, a rollback keeps the table** (c010 design.md § Migration plan, step 7). A plain revert of C7b's PR would remove the table `transactions` from the stack, which deletes it with its rows; once the history file is deleted, the days older than the bank's 90 are gone for good. So the revert PR reverts the app's code but keeps, in `infra/platform.bicep`, the table service, the table and the app's Storage Table Data Contributor on the account. The transactions' endpoints and the list disappear, and the kept history waits for the fix.
- **A mistake in the Bicep:** fix it forward in a PR; the stack converges on what the Bicep declares. A resource deleted by mistake is created again empty. A deleted vault comes back with its secrets with `az keyvault recover --subscription $sub --name kv-revolutreader` within 90 days; recover it before the next deploy, which would otherwise fail on the name.

## Removing everything (M8)

In this order, with the owner's go. Then the hand-made parts, as [azure-prerequisites.md § Removing it](azure-prerequisites.md#removing-it-m8) says.

```powershell
$sub = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$rg  = 'rg-revolutreader'

# 1. The stack and every resource it manages, the vault and the stored data included
az stack group delete --subscription $sub --resource-group $rg --name revolutreader `
    --action-on-unmanage deleteResources --yes

# 2. The deleted vault, which Azure otherwise keeps with its secrets for 90 days
az keyvault purge --subscription $sub --name kv-revolutreader

# 3. The package on GitHub (the gh login needs the delete:packages scope once)
gh auth refresh --scopes delete:packages
gh api --method DELETE user/packages/container/revolutreader
```
