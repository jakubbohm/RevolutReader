# Deployment

> How the app gets to Azure (roadmap step C4): the deployed resources and their identifiers, what the deploy does, the first deployment, the guided task that puts the Enable Banking values into Key Vault, read-only checks, rolling back and removing everything. The rules behind it are in [workflow.md § 4](../conventions/workflow.md#4-cicd) and [§ 5](../conventions/workflow.md#5-infrastructure); the hand-made setup it builds on is in [azure-prerequisites.md](azure-prerequisites.md). The reinstatement guide (D1) and decommissioning (M8) build on this file.
>
> Commands are PowerShell 7, run from the repository root with the owner's logins. **Every Azure command names the subscription explicitly** (the CLI's default subscription is an employer one). Nothing here prints a secret's value. Last updated: 2026-11-07 (since C5, a fresh deploy's first run fails at the app's secrets).

## Identifiers (non-secret)

Everything below is in the resource group `rg-revolutreader` (Germany West Central) and managed by the deployment stack, except the package on GitHub.

| What | Value |
|---|---|
| Deployment stack | `revolutreader`; deletes what the Bicep no longer declares; no deny settings |
| Log Analytics workspace | `log-revolutreader` (30 days, 0.1 GB daily cap) |
| Key Vault | `kv-revolutreader`, `https://kv-revolutreader.vault.azure.net/` (Azure roles, soft delete 90 days, no purge protection). Public network access stays on: the app reads its secrets at every deploy and every 30 minutes, and Container Apps is not one of the "trusted Microsoft services" allowed past a closed vault (Microsoft Learn, read 2026-11-07). Closing it would need the environment rebuilt with its own network and a private endpoint, which changes the app's address. Kept by the owner, 2026-11-07: only the app's identity and the owner have a role on it, and anyone with the owner's login could reopen it anyway |
| The app's identity | `id-revolutreader-app` (user-assigned), Key Vault Secrets User on the vault; client ID `f24d2909-ecb2-45d2-a230-d9551f472ded`, principal (object) ID `d4f00927-dcd1-4bc3-8b25-985f9d456fe0` |
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
5. **The stack** creates the workspace, the vault, the app's identity and its role, the environment and the container app: exactly these six on 2026-11-06. Creating the environment takes a few minutes. On 2026-11-06 the role was created 2 min 22 s before the app (22:13:08 and 22:15:30 UTC). **At a reinstatement, since C5, this first run fails at the container app.** Its four Enable Banking settings are Key Vault references, and Container Apps reads each one when it creates or updates the app, failing the write if it cannot ([microsoft/azure-container-apps#1291](https://github.com/microsoft/azure-container-apps/issues/1291), read 2026-11-07). The new vault is still empty, and the identity's new role can take up to 10 minutes to take effect ([Microsoft Learn: Troubleshoot Azure RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/troubleshooting), read 2026-11-07). The stack step most likely shows `ContainerAppOperationError` with `Unable to get value using Managed identity … for secret enablebanking-…`, an error that does not name the cause ([Azure OSS Developer Support blog](https://azureossd.github.io/2024/08/27/Troubleshooting-general-secret-issues-on-Container-Apps), read 2026-11-07); the other five resources are created. Do steps 7 and 8 (the owner's new role, too, can take up to 10 minutes before the writes succeed), then on the run's page Re-run jobs, Re-run failed jobs: the stack should now create the app, and step 6 follows. On 2026-11-06 the app had no secrets yet, so this order was not exercised.
6. **The check after the deploy** passes, and the summary shows the app's address. Record the address and the identity's IDs in [Identifiers](#identifiers-non-secret). On 2026-11-06 the first run's check failed only at its last step, on the state `RunningAtMaxScale`, which the Azure references do not list; [#22](https://github.com/jakubbohm/RevolutReader/pull/22) accepts it, and its deploy, run [42305043086](https://github.com/jakubbohm/RevolutReader/actions/runs/42305043086), passed every step.
7. **The owner's access to the vault's secrets:** the hand-made role in [azure-prerequisites.md](azure-prerequisites.md), item 7, with the owner's go. Applied on 2026-11-06 (recorded there).
8. **The Enable Banking values** into Key Vault: the guided task below, with the owner's go. Done on 2026-11-06 (recorded there).

## Guided task: the Enable Banking values into Key Vault

Puts the four production values that C5's bank adapter reads into the vault (c005 design.md D15). Since C5 the container app reads them as Key Vault references (`infra/features.bicep` § The bank): Azure refuses to create or update the app while it cannot read one of them (e.g. one is missing), and a new value reaches the app within 30 minutes, with a restart.

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

# The names in the vault, never the values
az keyvault secret list --subscription $sub --vault-name kv-revolutreader --query '[].name' --output tsv
```

The logs never hold bank data (CLAUDE.md); Claude reads them only to diagnose, read-only.

**First run, 2026-11-06,** after the first two deploys, from Claude's machine: the stack read `succeeded` with six resources, its outputs at the top level (`outputs.appUrl.value`, as above); `/health` answered `Healthy` (HTTP 200, 0.35 s), `/` returned the page, and plain HTTP was redirected to HTTPS (301). Within minutes the workspace held the platform's events (`ContainerAppSystemLogs_CL`) and the app's start lines (`ContainerAppConsoleLogs_CL`); the log query above worked as written.

## Rolling back

- **A version that does not start or misbehaves:** revert its PR (the merged PR's page has a Revert button, which opens a new PR). Its merge deploys the previous code through the same pipeline; nothing is changed in Azure by hand.
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
