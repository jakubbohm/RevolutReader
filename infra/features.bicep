// What belongs to the features (c005 design.md D1, D10): the container app at the top, then one
// section per feature, holding that feature's resources and the settings it adds to the app.
// A section declares its secrets and settings as variables, and the app below lists them, so a
// feature's settings sit next to the resources they point to. Secrets reach the app as Container
// Apps secrets that reference Key Vault, read with the app's identity, and appear to it as
// environment variables (docs/conventions/configuration.md).

@description('The Azure region of every resource.')
param location string

@description('The image the app runs: ghcr.io/jakubbohm/revolutreader:<commit SHA>.')
param image string

@description('The Container Apps environment the app runs in (platform.bicep).')
param environmentId string

@description('The app\'s user-assigned identity (platform.bicep), which reads Key Vault.')
param appIdentityId string

@description('The address of the vault that holds the hand-provisioned secrets (platform.bicep), ending in a slash.')
param keyVaultUri string

// The app: one container serving the API and the pages (ADR-0002-frontend-hosting). Its name is
// the first part of its public address, on the daughter's Home Screen and, from C6, in Entra ID:
// renaming it makes a new app with a new address.
resource app 'Microsoft.App/containerApps@2026-07-01' = {
  name: 'tarjeta-papa'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      // One revision at a time: a new one takes the traffic once its probes pass (D8).
      activeRevisionsMode: 'Single'
      // HTTPS from the internet to port 8080, the .NET image's port; plain HTTP is redirected.
      ingress: {
        external: true
        targetPort: 8080
        allowInsecure: false
      }
      // No registry credentials: the image on ghcr.io is public and pulled anonymously (D3).
      // Each feature's secrets, from its section below.
      secrets: bankSecrets
    }
    template: {
      containers: [
        {
          name: 'app'
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          // Each feature's settings, from its section below.
          env: concat(bankSettings, telemetrySettings)
          // GET /health touches neither the bank nor storage (spec service-health), and probe
          // requests are not billed. Short periods, because a wake from zero waits for both
          // probes; the startup probe still gives the app about 20 s. Liveness keeps the
          // platform's default.
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 1
              periodSeconds: 2
              timeoutSeconds: 2
              failureThreshold: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 1
              periodSeconds: 2
              timeoutSeconds: 2
              failureThreshold: 3
            }
          ]
        }
      ]
      // Scales to zero when idle and never runs more than one copy (ADR-0006). The default HTTP
      // scale rule and cool-down (300 s) apply; the wake-up is measured after v1 (#18).
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

// ---- The bank (C5) ----
// The four Enable Banking settings, as Key Vault references (c005 design.md D15, c004 design.md D6).
// Each Key Vault secret EnableBanking--<setting> becomes the Container Apps secret
// enablebanking-<setting in lower case>, read with the app's identity, and reaches the app as the
// environment variable EnableBanking__<setting>, overriding appsettings.json's "<secret>". No version
// in the address, so a renewed value (a new session) reaches the app.
var bankSecretSettings = [
  'ApplicationId'
  'PrivateKey'
  'SessionId'
  'AccountId'
]

var bankSecrets = [
  for setting in bankSecretSettings: {
    name: 'enablebanking-${toLower(setting)}'
    keyVaultUrl: '${keyVaultUri}secrets/EnableBanking--${setting}'
    identity: appIdentityId
  }
]

var bankSettings = [
  for setting in bankSecretSettings: {
    name: 'EnableBanking__${setting}'
    secretRef: 'enablebanking-${toLower(setting)}'
  }
]

// ---- Telemetry (C11) ----
// The app's traces and logs go to Application Insights, signed in with the app's identity (c006
// design.md D8 b, D12). Both resources are in platform.bicep and referenced here as existing, so the
// connection string never travels as a module output. Two plain settings, neither a secret, under
// the names Azure Monitor and Azure.Identity read: they override appsettings.json's empty values.
resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: 'appi-revolutreader'
}

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: last(split(appIdentityId, '/'))
}

var telemetrySettings = [
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: appInsights.properties.ConnectionString
  }
  {
    name: 'AZURE_CLIENT_ID'
    value: appIdentity.properties.clientId
  }
]

// ---- Sign-in (C6) ----

// ---- The account detail (C7) ----

// ---- Push (C8) ----

@description('The container app\'s name.')
output appName string = app.name

@description('The app\'s public host name, without the scheme.')
output fqdn string = app.properties.configuration.ingress.fqdn
