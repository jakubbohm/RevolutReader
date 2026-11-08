// The deployment stack's entry point (c005 design.md D1, D13): every merge to main applies this
// file to rg-revolutreader as the stack "revolutreader", which deletes whatever the Bicep no longer
// declares (docs/conventions/workflow.md § 5). The shared infrastructure is in platform.bicep, the
// app and its features in features.bicep; this file only passes names and IDs between them.
// Production values: main.bicepparam. Deploy and checks: docs/operations/deployment.md.

targetScope = 'resourceGroup'

@description('The Azure region of every resource.')
param location string

@description('The image tag to deploy: the commit SHA the deploy workflow built and pushed.')
param imageTag string

module platform 'platform.bicep' = {
  params: {
    location: location
  }
}

module features 'features.bicep' = {
  params: {
    location: location
    image: 'ghcr.io/jakubbohm/revolutreader:${imageTag}'
    environmentId: platform.outputs.environmentId
    appIdentityId: platform.outputs.appIdentityId
    // Taking platform's outputs makes this module wait for the whole platform module, the identity's
    // Key Vault role included. That orders the creation only: a new role can take up to 10 minutes
    // to take effect, and a new vault starts empty, so a fresh deploy's first run can fail at the
    // app on its secrets (docs/operations/deployment.md § The first deployment).
    keyVaultUri: platform.outputs.keyVaultUri
    keysBlobUri: platform.outputs.keysBlobUri
    keyVaultKeyUri: platform.outputs.keyVaultKeyUri
  }
}

@description('The container app\'s name, for the check after the deploy.')
output appName string = features.outputs.appName

@description('The app\'s public address.')
output appUrl string = 'https://${features.outputs.fqdn}'

@description('The vault that holds the hand-provisioned secrets.')
output keyVaultName string = platform.outputs.keyVaultName
