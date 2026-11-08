// The shared infrastructure (c005 design.md D1, D13): the log workspace with Application Insights on
// it, Key Vault, the app's identity with its two roles, and the Container Apps environment. A
// feature PR changes this file only when it adds something shared, e.g. C6's storage account.
// Everything here is managed by the deployment stack: a resource deleted from this file is deleted
// from Azure on the next deploy.

@description('The Azure region of every resource.')
param location string

// Logs (D6): the Container Apps environment sends the app's console output and the platform's
// events about it here, and Application Insights below keeps its tables here too. 30 days are
// included in the price; the daily cap bounds the bill, and when it is reached collection stops
// until the workspace's daily reset (#17 checks the volume). The cap matches the free 5 GB a month:
// 5 GB / 31 days, about 0.16 GB a day (c006 design.md D9).
resource logs 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: 'log-revolutreader'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json('0.16')
    }
  }
}

// Application Insights (c006 design.md D8 b): the app's traces and logs, sent by its in-app
// exporter (logs and traces only, D10), stored in the workspace above, so its cap and retention
// cover them (D9). Local authentication is off: the connection string's key cannot write, only an
// identity holding the role below can.
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-revolutreader'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    IngestionMode: 'LogAnalytics'
    DisableLocalAuth: true
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

// Monitoring Metrics Publisher: writes telemetry to Application Insights, nothing else; the
// identity Application Insights accepts once local authentication is off (c006 design.md D8 b). The
// fifth role the deploy identity may assign (docs/operations/azure-prerequisites.md).
var monitoringMetricsPublisher = '3913510d-42f4-4e42-8a64-420c390055eb'

resource appWritesTelemetry 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, appIdentity.id, monitoringMetricsPublisher)
  scope: appInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisher)
    principalId: appIdentity.properties.principalId
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

@description('The app\'s user-assigned identity, which reads Key Vault and writes to Application Insights.')
output appIdentityId string = appIdentity.id

@description('The vault that holds the hand-provisioned secrets.')
output keyVaultName string = keyVault.name

@description('The address of that vault, ending in a slash, for the app\'s Key Vault references.')
output keyVaultUri string = keyVault.properties.vaultUri
