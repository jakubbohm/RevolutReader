---
paths:
  - "**/*.cs"
  - "**/appsettings*.json"
  - "**/*.bicep"
  - "**/*.bicepparam"
  - "**/.env*"
  - "**/vite.config.*"
---

# Configuration

- **The app reads only `appsettings.json` + environment variables.** No Azure SDK, no Key Vault client or configuration provider, no cloud credential in the configuration path — the container must not be able to tell where a value came from.
- **Every setting is declared in `appsettings.json`**, including ones always overridden elsewhere: that file is the schema *and* the settings inventory. A setting that isn't declared there is invisible.
- **A secret's declared value is the literal `"<secret>"`** — never a real value, never omitted. It is also a startup tripwire: a bound value still equal to `"<secret>"` fails validation.
- Provenance goes in a `//` comment on the key (the JSON config parser skips comments): where the value comes from in production, and where locally.
- **Never create `appsettings.Production.json`** — the base file *is* production truth; `Development.json` carries local deviations; production-only values are environment variables on the container app, authored in Bicep.
- **Bind with `IOptions<T>`** — `BindConfiguration` + `ValidateDataAnnotations` + `ValidateOnStart`, section named after the options class. **Never inject `IConfiguration`/`IConfigurationSection` outside the composition root.**
- Local secrets live in the **AppHost's** user-secrets as Aspire parameters — never a per-service or per-test-project secrets file.
- Production app settings are **authored in Bicep** (from `.bicepparam` or a resource reference), never read off a resource by a workflow step and passed along. Secrets reach the app as Container Apps secrets that reference Key Vault, resolved by its managed identity and exposed as environment variables. The repository is public, so a value that must not be public (e.g. the account allowlist) is handled exactly like a secret.
- **Never put a secret or environment-specific value in a `VITE_` variable** — Vite inlines them into the shipped bundle at build time.
- **The frontend gets a runtime value from an ordinary API endpoint** behind sign-in, added by the first change that needs one; never written into `index.html` or a settings file loaded before start.
- A change that adds a setting declares it in `appsettings.json` in the same change; a hand-provisioned secret is also listed in `docs/conventions/configuration.md § Hand-provisioned secrets`.

Source of truth: [docs/conventions/configuration.md](../../docs/conventions/configuration.md).
