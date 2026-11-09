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
- **`DataProtection` (C6, c007 design.md D7): production-only settings, set by Bicep.** `KeysBlobUri` and `KeyVaultKeyUri` are empty in the file. Both empty means ASP.NET's default key folder (locally, the user profile; tests use throwaway keys). Both set means the login cookie's keys live in a blob, encrypted by a Key Vault key, reached with the app's user-assigned identity, whose client ID is the app-wide `AZURE_CLIENT_ID` (one setting for the identity, issue #33 finding 10). One address without the other, or both without `AZURE_CLIENT_ID`, stops the app at start, with a message naming the settings, never their values. They are read while registering services, because the choice is made there. The application name is pinned to `RevolutReader`, so every revision reads the same keys.
- **Sections so far:** `EnableBanking` (C5) and `SignIn` (C6, c007 design.md D11): `Authority` (Microsoft's personal-account service) and `ClientId` (the Entra registration, not confidential) in the file; `ClientSecret` and `AllowedEmails` as `"<secret>"`. **The allowlist's format:** one value, the addresses separated by commas (spaces around them don't matter), e.g. `owner@example.com, daughter@example.com`; letter case doesn't matter. The app refuses to start on a list with no address, an empty entry (two commas in a row, a trailing comma) or an entry that is not an address ([ADR-0004 § Decision](../adr/0004-account-allowlist.md#decision), item 7).
- **`Transactions` (C7b, c010 design.md D11):** `TableName`, the table the settled transactions are kept in, `transactions` in the file. It is validated on start as a name Table Storage accepts: 3 to 63 letters (A to Z) and digits, starting with a letter (`^[A-Za-z][A-Za-z0-9]{2,62}$`). Each acceptance test's app copy sets a table of its own ([testing.md § Storage](testing.md#storage-the-real-adapter-on-azurite)).
- **`PushDevices` (C8a, c011 design.md D11):** `TableName`, the table the push devices are kept in, `pushdevices` in the file, in the same storage account and on the same tables client as `Transactions`, validated on start the same way. Each acceptance test's app copy sets a table of its own.
- **`Push` (C8a, c011 design.md D5, D9, D13): Web Push.** `VapidPublicKey`, `VapidPrivateKey` and `MessageKey` as `"<secret>"` (the public key is not confidential, every browser gets it, but it is kept next to its private half so the two always match); `Subject`, the app's own `https` address, `https://localhost` in the file and the app's address in Azure (set by Bicep); `Services`, the known push services a device may register at, named entries (`Apple`, `Google`, `Mozilla`, `Microsoft`), so a test adds one without rewriting the others; `RequestTimeout`, `00:00:10`. **The formats:** base64url without padding; the public key the 65-byte uncompressed P-256 point, the private key the 32-byte scalar, the message key at least 32 random bytes. The app refuses to start when a key does not decode to its form, when the two halves are not one pair (a text signed with the private half must verify with the public half), when `Subject` is not an `https` address without a path, query or fragment, or when the timeout lies outside 1 to 60 seconds; the messages name the setting, never a value.
- **`ConnectionStrings:tables` (C7b, c010 design.md D11): where the transaction store's tables are, not a secret.** Empty in the file. Locally the AppHost sets it to its Azurite's connection string (`WithReference`, as `ConnectionStrings__tables`), and the tests set their own Azurite's. In Azure it is set by the deployment: the storage account's table endpoint, an address with no key in it, which the app reaches with its managed identity, whose client ID is `AZURE_CLIENT_ID` (as for `DataProtection`); shared keys stay off. The tables client checks the value only when it is first used, so registering the store checks that it is set and stops the app at start otherwise, with a message naming the setting, never its value.

## Binding

- `IOptions<T>` with `BindConfiguration` + `ValidateDataAnnotations` + `ValidateOnStart`; the section is named after the options class; a shared validator rejects `"<secret>"`: `[NotSecretPlaceholder]` (`src/RevolutReader.Api/Configuration/`, built in C5), put on every secret next to `[Required]`. Its failure names the setting, never its value. A check that data annotations can't express (e.g. that the Enable Banking key is an RSA private key in PEM form) is an `IValidateOptions<T>` registered next to them, under the same rule. The `SignIn` section binds to `SignInOptions`: `[NotSecretPlaceholder]` on both secrets, and `SignInOptionsValidator` for the allowlist's format, whose messages never hold an address (c007 design.md D8).
- Never inject `IConfiguration` / `IConfigurationSection` outside the composition root.

## Telemetry settings

The deployed app sends its logs and traces to Application Insights ([ADR-0009-application-telemetry](../adr/0009-application-telemetry.md)), driven by two settings (C12, c006 design.md D12):

| Setting | What it holds | Production | Local and tests |
|---|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Where to send: the Application Insights connection string, under the name Microsoft's libraries document | an environment variable on the container app, from the Application Insights resource (`features.bicep`) | empty: nothing is exported to Azure |
| `AZURE_CLIENT_ID` | The client ID of the app's user-assigned identity, under the name Azure.Identity uses. It signs the telemetry in and, from C6, reaches the login cookie's keys (`DataProtection`, above): with the key addresses set, the app refuses to start without it | an environment variable on the container app, from `id-revolutreader-app` (`features.bicep`) | empty |

- **Standard names, so not a section:** both are declared at the top level of `appsettings.json`, empty, with provenance comments. Any reader who knows Azure recognises them; a project-style section would have needed a small settings class and names nobody outside the project knows.
- **Read in ServiceDefaults,** as `OTEL_EXPORTER_OTLP_ENDPOINT` is, not bound to an options class. The Azure Monitor exporter is added only when the connection string is set, and the app refuses to start when it is set without the client ID; the message names the setting, never a value.
- **Neither is a secret:** local authentication is off on Application Insights, so the connection string only says where to send. Writing needs the app's identity and its role there.
- **The one rule still holds:** the managed-identity credential authorises sending telemetry, never reading a setting.

## Local development and tests

- Local secrets live **only** in the AppHost's user-secrets as Aspire parameters — never in per-service or per-test-project secret files.
- How the test harness gets its configuration: [testing.md](testing.md). No automated test needs a real secret. Local development reads Enable Banking's Mock ASPSP through the sandbox application, whose key and session are local secrets like any other ([testing.md § Fake bank](testing.md#fake-bank-a-local-fake-server-in-front-of-our-real-enable-banking-client)).
- **The Enable Banking values (C5):** the four `Parameters:enablebanking-*` keys, which the AppHost hands to the API as `EnableBanking__*`, so `aspire start` does not start the API until they are set. Next to them, the `RealAccountCheck:*` keys hold the real account's values for the one-off Check 2. The AppHost declares no parameter for them, so they never reach the API (c004 design.md D7). How they are set from the owner's files, and the commands: [docs/operations/local-secrets.md](../operations/local-secrets.md).
- **The sign-in values (C6):** `Parameters:signin-client-secret` and `Parameters:signin-allowed-emails`, which the AppHost hands to the API as `SignIn__ClientSecret` and `SignIn__AllowedEmails`, so `aspire start` does not start the API until they are set. They are the same client secret and allowlist as production, written to the user-secrets, Key Vault and the backup vault by one block ([entra-id.md § The client secret and the allowlist](../operations/entra-id.md#the-client-secret-and-the-allowlist-c6); set 2026-11-08). The cookie keys' two `DataProtection` addresses stay empty locally (the default key folder), whatever `AZURE_CLIENT_ID` holds.
- **The push keys (C8a, c011 design.md D5):** `Parameters:push-vapid-public-key`, `Parameters:push-vapid-private-key` and `Parameters:push-message-key`, which the AppHost hands to the API as `Push__VapidPublicKey`, `Push__VapidPrivateKey` and `Push__MessageKey`, so `aspire start` does not start the API until they are set. Unlike the sign-in values they are **the laptop's own**, never production's: the laptop variant of the guided key block ([deployment.md § Guided task: the push keys](../operations/deployment.md#guided-task-the-push-keys)) makes them and writes them to the user-secrets and the backup vault without printing them (c011 task 54.1). The tests make up their own (testing.md).
- **Every local secret has a backup copy** in the owner's personal Key Vault `jb-localdev-secrets-copy`, named `RevolutReader--<store>--<key>` with `:` written as `--`, so a new or reinstalled laptop gets them back mechanically (c004 design.md D6). The app and the tests never read it.

## Frontend

- **Nothing secret or environment-specific goes into a `VITE_` variable.** Vite inlines them into the bundle at build time, which publishes them and ties the bundle to one environment (breaking build once, deploy the same artifact).
- **The frontend shares the backend's origin** ([ADR-0002-frontend-hosting](../adr/0002-frontend-hosting.md)). It calls the API by relative paths and gets any other runtime value from the backend.
- **A runtime value comes from an ordinary API endpoint,** behind sign-in like every endpoint, typed by the generated client (the user, 2026-11-06, in C3; c003 design.md D13).
  - The first change that needs a value adds the endpoint. The first is the public push key, `GET /api/push/key` (C8a, c011 design.md D5, D9).
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
| Entra client secret (`RevolutReader C6`, 12 months, expires 2027-11-08: [expiring-approvals.md](../operations/expiring-approvals.md)) | `SignIn__ClientSecret`: the app's proof to Microsoft when it redeems the sign-in code | `SignIn--ClientSecret` | C6, [entra-id.md § The client secret and the allowlist](../operations/entra-id.md#the-client-secret-and-the-allowlist-c6) | 2026-11-08 |
| The allowlist (not a credential, but personal data in a public repository, so handled like a secret) | `SignIn__AllowedEmails`: the comma-separated accounts allowed in | `SignIn--AllowedEmails` | C6, same block | 2026-11-08 |
| The VAPID public key (not confidential: every browser gets it; kept next to its private half, c011 design.md D5) | `Push__VapidPublicKey`: the key the app subscribes with and the push services check the token against | `Push--VapidPublicKey` | C8a, [deployment.md § Guided task: the push keys](../operations/deployment.md#guided-task-the-push-keys) (c011 task 54.2) | pending, before C8a's merge |
| The VAPID private key | `Push__VapidPrivateKey`: signs the token of every push | `Push--VapidPrivateKey` | C8a, same block | pending, before C8a's merge |
| The message key | `Push__MessageKey`: lets a request through the owner's message endpoint (c011 design.md D10) | `Push--MessageKey` | C8a, same block | pending, before C8a's merge |

## Not adopted

- **Azure App Configuration:** only if a real need for runtime-changing configuration appears (kickoff ch. 6).
- **Feature flags:** none ([docs/software-factory/divergences.md R-4](../software-factory/divergences.md)).
