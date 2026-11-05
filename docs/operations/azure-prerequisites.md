# Azure prerequisites

> What roadmap step M3 set up by hand in Azure and GitHub so that the deployment pipeline (C4) can run: the identifiers, why each part looks the way it does, the commands to rebuild it, and how to check it. Everything else in Azure is Bicep ([workflow.md § 5](../conventions/workflow.md#5-infrastructure)). The reinstatement guide (D1) and decommissioning (M8) build on this file.
>
> Commands are PowerShell 7. **Every Azure command names the subscription explicitly:** the owner's Azure CLI login also sees employer subscriptions in other directories, and the CLI's default subscription is one of them. Last updated: 2026-11-05 (M3).

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

None of these is a credential: knowing them gives no access. They are public, here and in the CI logs.

## What was set up and why

1. **Resource providers** `Microsoft.KeyVault` (C4) and `Microsoft.Logic` (C9) registered on the subscription. The others the app needs were already registered (`Microsoft.App`, `Microsoft.Storage`, `Microsoft.ManagedIdentity`, `Microsoft.OperationalInsights`). Registering is a subscription-level action, which the deploy identity cannot do: its rights end at the resource group.
2. **Resource group** `rg-revolutreader`.
3. **Deploy identity as a user-assigned managed identity,** not an Entra app registration. It can never hold a password, and it is deleted with the resource group. The deployment stack leaves it alone: a stack deletes only the resources it manages ([Microsoft Learn: deployment stacks](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deployment-stacks), 2026-06-18).
4. **Federated credential** trusting only jobs that run in this repository's `production` environment.
   - **GitHub's subject format changed:** repositories created after 2026-07-15 use an immutable format with the owner and repository IDs, `repo:OWNER@OWNER-ID/REPO@REPO-ID:…` ([GitHub Docs: OIDC reference](https://docs.github.com/en/actions/reference/security/oidc), 2026-11-05). Older guides show `repo:OWNER/REPO:…`, which does not match.
   - This repository's prefix comes from `gh api repos/jakubbohm/RevolutReader/actions/oidc/customization/sub` (`use_immutable_subject: true`, `sub_claim_prefix`, read 2026-11-05). The `:environment:production` suffix follows GitHub's documented pattern; GitHub shows immutable examples only for branches, so the first login in C4 is the real check (see [Checks](#checks)).
5. **Roles on `rg-revolutreader` only:**
   - **Contributor:** creates and changes resources, including the deployment stack. It cannot manage a stack's deny settings, which the project does not use.
   - **Role Based Access Control Administrator, with a condition** allowing it to create and delete role assignments for four roles only. These are the roles Bicep grants in C4, C6 and C7. The pipeline cannot grant Owner or widen its own rights.

     | Role | ID |
     |---|---|
     | Key Vault Secrets User | `4633458b-17de-408a-b874-0445c86b69e6` |
     | Key Vault Secrets Officer | `b86a8fe4-44ce-4948-aee5-eccb2c155cd7` |
     | Storage Blob Data Contributor | `ba92f5b4-2d11-453d-a403-e96b0029c9fe` |
     | Storage Table Data Contributor | `0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3` |

     A change that needs another role widens the condition by hand: delete this assignment and create it again with the new ID added to `$roles` (step 5 below).
6. **GitHub environment `production`** with a deployment branch policy allowing only `main`, so a job on any other branch never gets a token Azure accepts. Workflows triggered by pull requests from forks get no OIDC token at all.

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

$roles = '4633458b-17de-408a-b874-0445c86b69e6, b86a8fe4-44ce-4948-aee5-eccb2c155cd7, ba92f5b4-2d11-453d-a403-e96b0029c9fe, 0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
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

The condition string in step 5 was checked on 2026-11-05: it equals the condition Azure stored, and it reaches the CLI unchanged through `az.cmd` in PowerShell 7.

## Checks

```powershell
az role assignment list --subscription $sub --scope $scope `
    --query "[].{role:roleDefinitionName, principal:principalId, hasCondition:condition!=null}" -o table
az identity federated-credential list --subscription $sub --resource-group $rg `
    --identity-name id-revolutreader-deploy --query "[].{name:name, subject:subject}" -o table
gh variable list --repo $repo --env production
```

**The first real login is C4's first deploy.** If `azure/login` fails with `AADSTS700213` ("No matching federated identity record found"), the error message shows the subject GitHub sent: put exactly that into the federated credential (`az identity federated-credential update … --subject <subject>`) and record it in the table above.

## Removing it (M8)

Delete the stack first, then the resource group; the deploy identity, its federated credential and its role assignments go with the group. The GitHub environment can stay or be deleted with `gh api -X DELETE "repos/$repo/environments/production"`. The two resource providers can stay registered: they cost nothing.
