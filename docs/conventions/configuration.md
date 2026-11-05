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

- `IOptions<T>` with `BindConfiguration` + `ValidateDataAnnotations` + `ValidateOnStart`; the section is named after the options class; a shared validator rejects `"<secret>"`.
- Never inject `IConfiguration` / `IConfigurationSection` outside the composition root.

## Local development and tests

- Local secrets live **only** in the AppHost's user-secrets as Aspire parameters — never in per-service or per-test-project secret files.
- How the test harness gets its configuration: [testing.md](testing.md). No automated test needs a real secret. Local development reads Enable Banking's Mock ASPSP through the sandbox application, whose key and session are local secrets like any other ([testing.md § Fake bank](testing.md#fake-bank-a-local-fake-server-in-front-of-our-real-enable-banking-client)).

## Frontend

- **Nothing secret or environment-specific goes into a `VITE_` variable.** Vite inlines them into the bundle at build time, which publishes them and ties the bundle to one environment (breaking build once, deploy the same artifact).
- **The frontend shares the backend's origin** ([ADR-0002-frontend-hosting](../adr/0002-frontend-hosting.md)). It calls the API by relative paths and gets any other runtime value from the backend. The mechanism is chosen in C3.

## Hand-provisioned secrets

Secrets that only a human can produce are put into Key Vault by hand, guided by Claude, as a task in the change that first needs them (roadmap section 1: until Key Vault exists, they stay on the user's machine, never in the repository). Each is declared in `appsettings.json` as `"<secret>"` and listed here when it is created:

| Secret | Purpose | Key Vault secret name | Provisioned in | Date |
|---|---|---|---|---|
| — | — | — | — | — |

## Not adopted

- **Azure App Configuration:** only if a real need for runtime-changing configuration appears (kickoff ch. 6).
- **Feature flags:** none ([docs/software-factory/divergences.md R-4](../software-factory/divergences.md)).
