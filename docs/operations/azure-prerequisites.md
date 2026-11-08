# Azure prerequisites

> What roadmap step M3 set up by hand in Azure and GitHub so that the deployment pipeline (C4) can run, C4's one addition (item 7) and C12's widened role condition (item 5): the identifiers, why each part looks the way it does, the commands to rebuild it, and how to check it. Everything else in Azure is Bicep ([workflow.md § 5](../conventions/workflow.md#5-infrastructure)), deployed as described in [deployment.md](deployment.md). The reinstatement guide (D1) and decommissioning (M8) build on this file.
>
> Commands are PowerShell 7. **Every Azure command names the subscription explicitly:** the owner's Azure CLI login also sees employer subscriptions in other directories, and the CLI's default subscription is one of them. Last updated: 2026-11-08 (C12: the deploy identity may assign a fifth role).

## Identifiers (non-secret)

| What | Value |
|---|---|
| Subscription | *Jakub's Azure subscription*, `7811bd13-d9ae-46bb-9355-3e3d885e544e` (the owner's personal Microsoft account) |
| Directory (tenant) | `9c9d69e9-f137-467c-8672-d3f091ec4894` |
| Region | Germany West Central (`germanywestcentral`) |
| Resource group (the deployment stack's scope) | `rg-revolutreader` |
| Deploy identity | user-assigned managed identity `id-revolutreader-deploy` in `rg-revolutreader`; client ID `9715a72e-26a5-473a-9db5-6f6b9b8e6f63`, principal (object) ID `ea62a45c-aed6-4ee4-aebd-ada94cd1b3f0` |
| Federated credential | `github-production`: issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, subject `repo:jakubbohm@17472513/RevolutReader@1446365733:environment:production` |
| GitHub environment | `production`, deployments from `main` only; variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP` holding the values above |
| The owner's Key Vault role (C4) | Key Vault Secrets Officer for the owner's account on `rg-revolutreader`. The account's ID is looked up when the command runs and written nowhere |

None of these is a credential: knowing them gives no access. They are public, here and in the CI logs.

## What was set up and why

1. **Resource providers** `Microsoft.KeyVault` (C4) and `Microsoft.Logic` (C9) registered on the subscription. `Microsoft.Logic` is unused since [ADR-0008-phone-triggered-check](../adr/0008-phone-triggered-check.md) (2026-11-06) dropped the Logic App; it stays registered, which costs nothing, and a reinstatement can skip it. The others the app needs were already registered (`Microsoft.App`, `Microsoft.Storage`, `Microsoft.ManagedIdentity`, `Microsoft.OperationalInsights`). Registering is a subscription-level action, which the deploy identity cannot do: its rights end at the resource group.
2. **Resource group** `rg-revolutreader`.
3. **Deploy identity as a user-assigned managed identity,** not an Entra app registration. It can never hold a password, and it is deleted with the resource group. The deployment stack leaves it alone: a stack deletes only the resources it manages ([Microsoft Learn: deployment stacks](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deployment-stacks), 2026-06-18).
4. **Federated credential** trusting only jobs that run in this repository's `production` environment.
   - **GitHub's subject format changed:** repositories created after 2026-07-15 use an immutable format with the owner and repository IDs, `repo:OWNER@OWNER-ID/REPO@REPO-ID:…` ([GitHub Docs: OIDC reference](https://docs.github.com/en/actions/reference/security/oidc), 2026-11-05). Older guides show `repo:OWNER/REPO:…`, which does not match.
   - This repository's prefix comes from `gh api repos/jakubbohm/RevolutReader/actions/oidc/customization/sub` (`use_immutable_subject: true`, `sub_claim_prefix`, read 2026-11-05). The `:environment:production` suffix follows GitHub's documented pattern; GitHub shows immutable examples only for branches, so the first login in C4 was the real check, and it passed (see [Checks](#checks)).
5. **Roles on `rg-revolutreader` only:**
   - **Contributor:** creates and changes resources, including the deployment stack. It cannot manage a stack's deny settings, which the project does not use.
   - **Role Based Access Control Administrator, with a condition** allowing it to create and delete role assignments for five roles only. These are the roles Bicep grants in C4, C6, C7 and C12. The pipeline cannot grant Owner or widen its own rights.

     | Role | ID | Added |
     |---|---|---|
     | Key Vault Secrets User | `4633458b-17de-408a-b874-0445c86b69e6` | M3 |
     | Key Vault Secrets Officer | `b86a8fe4-44ce-4948-aee5-eccb2c155cd7` | M3 |
     | Storage Blob Data Contributor | `ba92f5b4-2d11-453d-a403-e96b0029c9fe` | M3 |
     | Storage Table Data Contributor | `0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3` | M3 |
     | Monitoring Metrics Publisher: lets the app's identity write its telemetry to Application Insights ([ADR-0009-application-telemetry](../adr/0009-application-telemetry.md)) | `3913510d-42f4-4e42-8a64-420c390055eb` ([Microsoft Learn: built-in roles for Monitor](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/monitor#monitoring-metrics-publisher), updated 2026-07-01, read 2026-11-08) | C12 |

     A change that needs another role widens the condition by hand: delete this assignment and create it again with the new ID added to `$roles` (step 5 below). **Widened on 2026-11-08 (C12)** from four roles to five, before the merge whose deploy grants Monitoring Metrics Publisher; without it, that deploy fails at the new role assignment. The command: [Commands](#commands), "Widening step 5's condition"; Claude read the condition back with step 5's check ([Checks](#checks)).
6. **GitHub environment `production`** with a deployment branch policy allowing only `main`, so a job on any other branch never gets a token Azure accepts. Workflows triggered by pull requests from forks get no OIDC token at all.
7. **The owner's access to secret values (C4,** c005 design.md D17). Owner of the subscription gives no access to the values in a vault that uses Azure roles, and the guided tasks (Enable Banking in C4, later C6 and C8) and every renewal write secrets. So the owner's account gets **Key Vault Secrets Officer on `rg-revolutreader`**, inherited by every vault in the group, including one the stack creates again.
   - **Why by hand and not in the Bicep:** the Bicep would need the owner's account ID in the public repository. As a GitHub variable it would be unversioned, unreviewed and against [configuration.md](../conventions/configuration.md) (GitHub variables hold only what the workflow needs before Bicep runs). This is the one exception to "manual only for what cannot be automated" ([workflow.md § 5](../conventions/workflow.md#5-infrastructure), [lessons.md R-50](../software-factory/lessons.md)).
   - **The ID is looked up when the command runs:** the object ID in an Azure access token for this subscription, so it is the account running the command, in the subscription's own directory. The command refuses unless that account holds Owner on the subscription. On 2026-11-06 the subscription had two user accounts with Owner, both from its creation, so the Owner list alone cannot pick the owner.
   - It goes with the resource group at M8.

## Commands

The full setup, in order. Re-running a step that already exists either updates it in place or fails with "already exists"; check before re-running.

```powershell
$sub   = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$rg    = 'rg-revolutreader'
$scope = "/subscriptions/$sub/resourceGroups/$rg"
$repo  = 'jakubbohm/RevolutReader'

# 1. Resource providers
'Microsoft.KeyVault', 'Microsoft.Logic' | ForEach-Object {
    az provider register --subscription $sub --namespace $_ --wait
}

# 2-3. Resource group and deploy identity
az group create --subscription $sub --name $rg --location germanywestcentral
az identity create --subscription $sub --resource-group $rg --name id-revolutreader-deploy --location germanywestcentral
$principalId = az identity show --subscription $sub --resource-group $rg --name id-revolutreader-deploy --query principalId -o tsv
$clientId    = az identity show --subscription $sub --resource-group $rg --name id-revolutreader-deploy --query clientId -o tsv

# 4. Federated credential: read the prefix, it changes if the repository is ever recreated
$prefix = gh api "repos/$repo/actions/oidc/customization/sub" --jq .sub_claim_prefix
az identity federated-credential create --subscription $sub --resource-group $rg `
    --identity-name id-revolutreader-deploy --name github-production `
    --issuer https://token.actions.githubusercontent.com `
    --subject "${prefix}:environment:production" `
    --audiences api://AzureADTokenExchange

# 5. Roles on the resource group
az role assignment create --subscription $sub --assignee-object-id $principalId `
    --assignee-principal-type ServicePrincipal --role Contributor --scope $scope

$publisher = az role definition list --subscription $sub --name 'Monitoring Metrics Publisher' --query '[0].name' --output tsv
$roles = "4633458b-17de-408a-b874-0445c86b69e6, b86a8fe4-44ce-4948-aee5-eccb2c155cd7, ba92f5b4-2d11-453d-a403-e96b0029c9fe, 0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3, $publisher"
$condition = "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$roles})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$roles}))"
az role assignment create --subscription $sub --assignee-object-id $principalId `
    --assignee-principal-type ServicePrincipal --role 'Role Based Access Control Administrator' `
    --scope $scope --condition $condition --condition-version 2.0

# 6. GitHub environment, deployments from main only, and its variables
gh api -X PUT "repos/$repo/environments/production" `
    -F 'deployment_branch_policy[protected_branches]=false' `
    -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST "repos/$repo/environments/production/deployment-branch-policies" -f name=main -f type=branch
gh variable set AZURE_CLIENT_ID       --repo $repo --env production --body $clientId
gh variable set AZURE_TENANT_ID       --repo $repo --env production --body (az account show --subscription $sub --query tenantId -o tsv)
gh variable set AZURE_SUBSCRIPTION_ID --repo $repo --env production --body $sub
gh variable set AZURE_RESOURCE_GROUP  --repo $repo --env production --body $rg
```

The condition string in step 5 was checked on 2026-11-05, with the four roles of M3: it equals the condition Azure stored, and it reaches the CLI unchanged through `az.cmd` in PowerShell 7. Since C12, `$roles` holds a fifth ID, looked up by the role's name.

**Widening step 5's condition (C12),** run once by the owner in the owner's own PowerShell 7 window, while no deploy runs, before the merge of C12 (Claude Code's permission check blocks a role assignment by Claude even with the owner's go). It looks up the new role's ID by name, then deletes the deploy identity's Role Based Access Control Administrator assignment and creates it again with the same condition, now listing five IDs. When it ran: item 5 above; read back with step 5's check below.

```powershell
$sub   = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$rg    = 'rg-revolutreader'
$scope = "/subscriptions/$sub/resourceGroups/$rg"
$principalId = az identity show --subscription $sub --resource-group $rg --name id-revolutreader-deploy --query principalId -o tsv

# The fifth role's ID, looked up by its name
$publisher = az role definition list --subscription $sub --name 'Monitoring Metrics Publisher' --query '[0].name' --output tsv
if ($publisher -notmatch '^[0-9a-f-]{36}$') { throw 'The role Monitoring Metrics Publisher was not found.' }

# Step 5's condition, with the fifth ID
$roles = "4633458b-17de-408a-b874-0445c86b69e6, b86a8fe4-44ce-4948-aee5-eccb2c155cd7, ba92f5b4-2d11-453d-a403-e96b0029c9fe, 0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3, $publisher"
$condition = "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$roles})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$roles}))"

# Delete the current assignment (none left if an earlier run stopped after the delete), then create it with the wider condition
$current = @(az role assignment list --subscription $sub --scope $scope --role 'Role Based Access Control Administrator' `
    --query "[?principalId=='$principalId'].id" --output tsv)
if ($current.Count -gt 1) { throw "Expected at most one Role Based Access Control Administrator assignment, found $($current.Count)." }
if ($current.Count -eq 1) { az role assignment delete --subscription $sub --ids $current[0] }
az role assignment create --subscription $sub --assignee-object-id $principalId `
    --assignee-principal-type ServicePrincipal --role 'Role Based Access Control Administrator' `
    --scope $scope --condition $condition --condition-version 2.0 --output none
```

Step 7 (C4), run once by the owner in the owner's own PowerShell 7 window, after the first deployment created the vault ([deployment.md § The first deployment](deployment.md#the-first-deployment)). Claude Code's permission check blocks a role assignment by Claude even with the owner's go (2026-11-06). It prints nothing. **Applied on 2026-11-06** by the owner; read back with step 7's check below: one user holds Key Vault Secrets Officer on `rg-revolutreader`. The owner's ID is in no file (searched).

```powershell
$sub   = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$scope = "/subscriptions/$sub/resourceGroups/rg-revolutreader"

# 7. The owner's access to secret values: the ID of the account running this, never written down
$token   = az account get-access-token --subscription $sub --query accessToken --output tsv
$payload = $token.Split('.')[1].Replace('-', '+').Replace('_', '/')
$payload = $payload.PadRight($payload.Length + (4 - $payload.Length % 4) % 4, '=')
$me      = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json).oid
$owners  = @(az role assignment list --subscription $sub --scope "/subscriptions/$sub" --role Owner `
    --query "[?principalType=='User'].principalId" --output tsv)
if ($owners -notcontains $me) { throw 'The account running this is not an Owner of the subscription.' }
az role assignment create --subscription $sub --assignee-object-id $me --assignee-principal-type User `
    --role 'Key Vault Secrets Officer' --scope $scope --output none
Remove-Variable token, payload, me, owners
```

## Checks

```powershell
az role assignment list --subscription $sub --scope $scope `
    --query "[].{role:roleDefinitionName, principal:principalId, hasCondition:condition!=null}" -o table
az identity federated-credential list --subscription $sub --resource-group $rg `
    --identity-name id-revolutreader-deploy --query "[].{name:name, subject:subject}" -o table
gh variable list --repo $repo --env production

# Step 5 (since C12): the deploy identity's condition lists five role IDs, the fifth 3913510d-42f4-4e42-8a64-420c390055eb
az role assignment list --subscription $sub --scope $scope --role 'Role Based Access Control Administrator' `
    --query "[].condition" --output tsv

# Step 7 (C4): one user holds Key Vault Secrets Officer on the resource group; no ID is printed
az role assignment list --subscription $sub --scope $scope --role 'Key Vault Secrets Officer' `
    --query "[].{role: roleDefinitionName, principalType: principalType, scope: scope}" --output table
```

**The first real login succeeded on 2026-11-06,** in C4's first deploy (run [42302387813](https://github.com/jakubbohm/RevolutReader/actions/runs/42302387813)), with the subject in the table above, exactly as M3 set it. **At a reinstatement,** if `azure/login` fails with `AADSTS700213` ("No matching federated identity record found"), the error message shows the subject GitHub sent: put exactly that into the federated credential (`az identity federated-credential update … --subject <subject>`) and record it in the table above.

## Removing it (M8)

Delete the stack first ([deployment.md § Removing everything](deployment.md#removing-everything-m8)), then the resource group; the deploy identity, its federated credential and its role assignments go with the group, and so does the owner's Key Vault role (step 7). The GitHub environment can stay or be deleted with `gh api -X DELETE "repos/$repo/environments/production"`. The two resource providers can stay registered: they cost nothing.
