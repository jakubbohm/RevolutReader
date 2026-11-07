// The shared infrastructure (c005 design.md D1, D13): the log workspace, Key Vault, the app's
// identity with its one role, and the Container Apps environment. A feature PR changes this file
// only when it adds something shared, e.g. C6's storage account. Everything here is managed by the
// deployment stack: a resource deleted from this file is deleted from Azure on the next deploy.

@description('The Azure region of every resource.')
param location string

// Logs (D6): the Container Apps environment sends the app's console output and the platform's
// events about it here. 30 days are included in the price; the daily cap bounds the bill, and
// when it is reached collection stops until the workspace's daily reset (#17 checks the volume).
resource logs 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: 'log-revolutreader'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json('0.1')
    }
  }
}

// Key Vault: access by Azure roles only, no access policies. Purge protection stays off, so M8 can
// purge the vault at once; once on, it can never be turned off. Soft delete is always on, and a
// deleted vault stays recoverable for the 90 days below (Azure's default; fixed at creation). No
// secret is declared here: the values are put in by hand (docs/operations/deployment.md), and a
// stack cannot delete secrets anyway.
resource keyVault 'Microsoft.KeyVault/vaults@2026-05-15' = {
  name: 'kv-revolutreader'
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    softDeleteRetentionInDays: 90
    // The environment has no network of its own and reaches the vault over the internet; the
    // identity's role below is the guard.
    publicNetworkAccess: 'Enabled'
  }
}

// The app's identity: user-assigned, so it exists before the app does and the app's first
// version can already read Key Vault (a built-in identity appears only after the app is created).
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-revolutreader-app'
  location: location
}

// Key Vault Secrets User: reads secret values, nothing else. One of the four roles the deploy
// identity may assign (docs/operations/azure-prerequisites.md). The owner's own role on the vault
// is not here: it is granted once by hand, so the owner's ID is written nowhere (D17).
var keyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'

resource appReadsSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appIdentity.id, keyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUser)
    principalId: appIdentity.properties.principalId
    // Named, so a role assignment right after the identity's creation does not wait for it to
    // replicate.
    principalType: 'ServicePrincipal'
  }
}

// The Container Apps environment: Azure's default "workload profiles" type with only the
// Consumption profile, so there is no environment fee and the monthly free grant applies
// (ADR-0006-hosting-registry-and-job). The workspace's key is read here, inside the deployment,
// and never leaves Azure Resource Manager.
resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: 'cae-revolutreader'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: false
  }
}

@description('The Container Apps environment the app runs in.')
output environmentId string = environment.id

@description('The app\'s user-assigned identity, which reads Key Vault.')
output appIdentityId string = appIdentity.id

@description('The vault that holds the hand-provisioned secrets.')
output keyVaultName string = keyVault.name

@description('The address of that vault, ending in a slash, for the app\'s Key Vault references.')
output keyVaultUri string = keyVault.properties.vaultUri
