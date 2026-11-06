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
// The four Enable Banking settings, as Key Vault references (c005 design.md D15).

// ---- Sign-in (C6) ----

// ---- The account detail (C7) ----

// ---- Push (C8) ----

@description('The container app\'s name.')
output appName string = app.name

@description('The app\'s public host name, without the scheme.')
output fqdn string = app.properties.configuration.ingress.fqdn
