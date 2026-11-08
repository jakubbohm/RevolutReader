# RevolutReader — Configuration

**Status:** decided in F0-1 (2026-11-04), from the DoseUp configuration conventions; the host is Azure Container Apps since F0-2 ([ADR-0006-hosting-registry-and-job](../adr/0006-hosting-registry-and-job.md)) · **Mirror:** `.claude/rules/configuration.md`

Kickoff ch. 6 fixes the frame: configuration normally lives in the repository (appsettings); Key Vault is for secrets only; Azure App Configuration only if something ever has to change at runtime. This document says how. **Widened (2026-11-05):** because the repository is public, Key Vault also holds values that must not be public, such as the account allowlist ([ADR-0004-account-allowlist](../adr/0004-account-allowlist.md)).

## The one rule

**The app reads only `appsettings.json` (plus `appsettings.Development.json` locally) and environment variables.** No Azure SDK, Key Vault client or Key Vault configuration provider in the app's configuration path. The container must not be able to tell where a value came from; everything platform-specific lives in Bicep.

## Where each value lives

| Kind of value | Local development | Production |
|---|---|---|
| Non-secret default | `appsettings.json` | `appsettings.json` |
| Local deviation | `appsettings.Development.json` | — |
| Production-only non-secret | — | an environment variable on the container app, authored in Bicep from `.bicepparam` or a resource reference |
| Secret, or a value that must not be public (e.g. the account allowlist, [ADR-0004-account-allowlist](../adr/0004-account-allowlist.md)) | the AppHost's user-secrets, surfaced as Aspire parameters → environment variables | Key Vault secret → a Container Apps secret that references it, authored in Bicep, resolved by the app's managed identity → environment variable |

- **Bicep authors every production app setting.** The CD workflow passes only the image tag and which parameter file to apply; it never reads a value off one resource to hand it to another.
- **GitHub Actions variables and secrets are not an app configuration store.** They hold only what the workflow needs before Bicep can run (subscription, resource group, the deploy identity's client id).
- **No `appsettings.Production.json`:** the base file *is* production truth.
- **Orchestrator-generated values are a configuration source too:** Aspire's `WithReference` generates environment-variable names locally (e.g., connection strings); Bicep must reproduce exactly those names.

## `appsettings.json` is the inventory

- **Every setting is declared there,** including ones that are always overridden elsewhere. The file is the schema; a setting missing from it is invisible to readers and reviewers.
- **Secrets are declared with the literal value `"<secret>"`** — a greppable marker and a startup tripwire: a bound value still equal to `"<secret>"` fails validation, so a missing secret stops the app at startup instead of failing later.
- **Provenance goes in a `//` comment on the key** (production source · local source). The .NET JSON configuration parser accepts comments.
- A change that adds a setting declares it in the same change.

## Binding

- `IOptions<T>` with `BindConfiguration` + `ValidateDataAnnotations` + `ValidateOnStart`; the section is named after the options class; a shared validator rejects `"<secret>"`: `[NotSecretPlaceholder]` (`src/RevolutReader.Api/Configuration/`, built in C5), put on every secret next to `[Required]`. Its failure names the setting, never its value. A check that data annotations can't express (e.g. that the Enable Banking key is an RSA private key in PEM form) is an `IValidateOptions<T>` registered next to them, under the same rule.
- Never inject `IConfiguration` / `IConfigurationSection` outside the composition root.

## Telemetry settings

The deployed app sends its logs and traces to Application Insights ([ADR-0009-application-telemetry](../adr/0009-application-telemetry.md)), driven by two settings (C11, c006 design.md D12):

| Setting | What it holds | Production | Local and tests |
|---|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Where to send: the Application Insights connection string, under the name Microsoft's libraries document | an environment variable on the container app, from the Application Insights resource (`features.bicep`) | empty: nothing is exported to Azure |
| `AZURE_CLIENT_ID` | The client ID of the app's user-assigned identity, which signs the telemetry in, under the name Azure.Identity uses | an environment variable on the container app, from `id-revolutreader-app` (`features.bicep`) | empty |

- **Standard names, so not a section:** both are declared at the top level of `appsettings.json`, empty, with provenance comments. Any reader who knows Azure recognises them; a project-style section would have needed a small settings class and names nobody outside the project knows.
- **Read in ServiceDefaults,** as `OTEL_EXPORTER_OTLP_ENDPOINT` is, not bound to an options class. The Azure Monitor exporter is added only when the connection string is set, and the app refuses to start when it is set without the client ID; the message names the setting, never a value.
- **Neither is a secret:** local authentication is off on Application Insights, so the connection string only says where to send. Writing needs the app's identity and its role there.
- **The one rule still holds:** the managed-identity credential authorises sending telemetry, never reading a setting.

## Local development and tests

- Local secrets live **only** in the AppHost's user-secrets as Aspire parameters — never in per-service or per-test-project secret files.
- How the test harness gets its configuration: [testing.md](testing.md). No automated test needs a real secret. Local development reads Enable Banking's Mock ASPSP through the sandbox application, whose key and session are local secrets like any other ([testing.md § Fake bank](testing.md#fake-bank-a-local-fake-server-in-front-of-our-real-enable-banking-client)).
- **The Enable Banking values (C5):** the four `Parameters:enablebanking-*` keys, which the AppHost hands to the API as `EnableBanking__*`, so `aspire start` does not start the API until they are set. Next to them, the `RealAccountCheck:*` keys hold the real account's values for the one-off Check 2. The AppHost declares no parameter for them, so they never reach the API (c004 design.md D7). How they are set from the owner's files, and the commands: [docs/operations/local-secrets.md](../operations/local-secrets.md).
- **Every local secret has a backup copy** in the owner's personal Key Vault `jb-localdev-secrets-copy`, named `RevolutReader--<store>--<key>` with `:` written as `--`, so a new or reinstalled laptop gets them back mechanically (c004 design.md D6). The app and the tests never read it.

## Frontend

- **Nothing secret or environment-specific goes into a `VITE_` variable.** Vite inlines them into the bundle at build time, which publishes them and ties the bundle to one environment (breaking build once, deploy the same artifact).
- **The frontend shares the backend's origin** ([ADR-0002-frontend-hosting](../adr/0002-frontend-hosting.md)). It calls the API by relative paths and gets any other runtime value from the backend.
- **A runtime value comes from an ordinary API endpoint,** behind sign-in like every endpoint, typed by the generated client (the user, 2026-11-06, in C3; c003 design.md D13).
  - The first change that needs a value adds the endpoint, e.g. C8 with the public push key. Until then, there is none.
  - Not in `index.html`: the service worker serves a cached copy, so a value written into it would go stale.
  - Not in a settings file loaded before start: it delays every start and can go stale the same way.

## Hand-provisioned secrets

Secrets that only a human can produce are put into Key Vault by hand, guided by Claude, as a task in the change that first needs them (roadmap section 1: until Key Vault exists, they stay on the user's machine, never in the repository). Each is declared in `appsettings.json` as `"<secret>"` and listed here when it is created:

| Secret | Purpose | Key Vault secret name | Provisioned in | Date |
|---|---|---|---|---|
| Enable Banking application ID (not confidential: the JWT's `kid`; kept out of the visible settings, c004 design.md D6) | `EnableBanking__ApplicationId`: the key id of every request's token | `EnableBanking--ApplicationId` | C4, [deployment.md § Guided task](../operations/deployment.md#guided-task-the-enable-banking-values-into-key-vault) | 2026-11-06 |
| Enable Banking private key (PEM text) | `EnableBanking__PrivateKey`: signs every request's token | `EnableBanking--PrivateKey` | C4, same task | 2026-11-06 |
| Enable Banking session ID | `EnableBanking__SessionId`: the session the account belongs to (validated at start; no C5 read sends it) | `EnableBanking--SessionId` | C4, same task | 2026-11-06 |
| Enable Banking account ID | `EnableBanking__AccountId`: the account the reads address | `EnableBanking--AccountId` | C4, same task | 2026-11-06 |

## Not adopted

- **Azure App Configuration:** only if a real need for runtime-changing configuration appears (kickoff ch. 6).
- **Feature flags:** none ([docs/software-factory/divergences.md R-4](../software-factory/divergences.md)).
