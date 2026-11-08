# Proposal: c007-add-user-login

## TL;DR

- **What:** UC1 end to end. The backend signs users in through Microsoft (personal accounts), keeps a 30-day login cookie, and checks every `/api` request against the email allowlist. A stranger is signed in but refused everything, and the refusal names their own email. The app shows the sign-in, no-access and signed-out screens and the account menu. It also brings the generated TypeScript API client, the cookie's encryption keys in Blob Storage (encrypted by a Key Vault key), a rule that refuses writes from other sites, the guided secret steps, and the iPhone check after deploy.
- **Out of scope:** the waiting and offline screens (C7, hooked onto the app's first request), the balance and transactions (C7), Microsoft's own sign-out, deep links back to a page, CSRF tokens.
- **Riskiest assumption:** signing in works inside the iPhone Home Screen app (ADR-0003). It is checked right after the merge deploys; the fallbacks are a follow-up change.
- **Scenarios added** (`sign-in`): An anonymous visitor is asked to sign in · An allowed user who signs in gets in · A stranger who signs in is refused, with their own email · Signing in again with another account opens Microsoft's account picker · Sign-in returns to the app's own HTTPS address behind the hosting proxy · A sign-in cancelled at Microsoft leaves the visitor signed out · An account from a work or school directory is not signed in · A login unused for 30 days has ended · Using the app keeps the login alive · Signing out ends the login · A write request from another site is refused · The sign-in screen shows when nobody is signed in · Tapping the sign-in button starts the Microsoft sign-in · A refused account sees that it has no access · Trying another account signs out and starts a new sign-in · Signing out from the account menu shows the signed-out screen · Signing in from the Home Screen app opens the app (manual) · The Home Screen app stays signed in after it is closed (manual)
- **Scenarios added** (`app-shell`): The account menu shows who is signed in · **modified:** The top bar shows the app name (now with someone signed in, because the sign-in screens have no top bar)
- **Scenario added** (`api-errors`, after slice 1's review, 2026-11-08): A write to an unknown API address answers with a problem description (the requirement now says 404 whatever the method and whether or not the caller is signed in; writes answered 405 since C3)

## Why

Roadmap step **C6** (`pm/roadmap.md`), use case **UC1** (kickoff ch. 5): a signed-out user signs in with their Microsoft account, only a pre-approved account gets through, and the account detail follows. The app is about to show bank data (C7), so access must be strictly limited first. C7 and C8 build on the sign-in, and every later endpoint requires a signed-in, allowed user. Everything below was decided with the user in explore, one decision at a time (2026-11-07, design.md D1–D9).

## What Changes

- **Signing in through Microsoft** (design.md D2):
  - ASP.NET Core's OpenID Connect and cookie handlers, with the authorization code flow against Microsoft's personal-account service and the 12-month client secret;
  - every address under `/api/auth/`: `GET /api/auth/login` starts the sign-in, `POST /api/auth/signin-oidc` is where Microsoft returns, `POST /api/auth/logout` ends the session;
  - after sign-in, the visitor always lands on the start page;
  - a sign-in that does not complete signs nobody in (a login from before stays as it is);
  - "try another account" asks Microsoft for its account picker.
- **Who gets in** (D3):
  - every `/api` request is checked against the allowlist, comparing email addresses ignoring case;
  - an anonymous visitor gets 401;
  - a signed-in stranger gets 403, and the answer names their own email;
  - `GET /api/me` answers the signed-in user's name and email.
- **The login cookie and forged requests** (D4):
  - the cookies are named `__Host-…`, so no other app on the shared hosting domain can plant them;
  - the login lasts 30 days and is renewed while the app is used;
  - one app-wide rule refuses a write request (POST, PUT, PATCH, DELETE) under `/api` that comes from another site, with 403. It protects sign-out now, and C7's and C8's writes later.
- **Behind the hosting proxy** (D10): forwarded headers are honoured, so Microsoft is sent back to the app's own HTTPS address.
- **The cookie's encryption keys** (D7): in Azure they sit in a blob in the app's new storage account, encrypted by a key in the existing Key Vault. Locally ASP.NET's default folder is used; in tests, throwaway keys.
- **The allowlist** (D8): one comma-separated secret. Key Vault in production; the AppHost's user-secrets locally, with a backup copy.
- **The screens** (D12; Screens design: Sign-in / Start, Access denied, Signed out):
  - the sign-in screen with the Microsoft button;
  - the no-access screen naming the refused account, with "Zkusit jiný účet";
  - the signed-out screen;
  - the account menu in the top bar (name, email, "Odhlásit se"), the app's first Radix component.

  The screen is chosen from the first answer to "who is signed in?". Until C7, the frame stays empty while the server wakes or the phone is offline (D5).
- **The generated API client** (D9): the OpenAPI document is exported by an explicit check that starts an app copy, and committed, and the TypeScript types are generated from it (openapi-typescript on its own TypeScript 5) and committed too. The page calls the API through openapi-fetch. The drift check runs in the existing CI jobs.
- **Local development** (D2): Vite runs over HTTPS and keeps the browser's address when it forwards `/api`. The AppHost gets two new secret parameters.
- **Guided steps for the owner** (D11), each a ready PowerShell 7 block run with the owner's go:
  - the Entra redirect URIs moved under `/api/auth/` and the production one added;
  - the 12-month client secret, straight into Key Vault, the user-secrets and the backup vault;
  - the allowlist, into the same three places;
  - the deploy identity's sixth grantable role (Key Vault Crypto User);
  - the iPhone check after the merge deploys.
- **Records:**
  - ADR-0003 is amended with the addresses, the cookie names, the forged-request rule and local-only sign-out;
  - ADR-0004 with the allowlist format;
  - ADR-0006 with the keys encrypted by a Key Vault key;
  - conventions, operations docs and software-factory lessons follow (design.md § Cross-cutting effects).

## Capabilities

### New Capabilities

- `sign-in`: how a user signs in with a Microsoft account, who gets in (the allowlist), how long the login lasts, signing out, the protection of the login against other sites, and the sign-in screens.

### Modified Capabilities

- `app-shell`:
  - the top bar gains the account menu (name, email, "Odhlásit se") when someone is signed in;
  - the sign-in, no-access and signed-out screens join the install hint as screens without the top bar, because the Screens design shows the app's name large in their middle;
  - the existing scenario therefore states that someone is signed in.

- `api-errors` (after slice 1's review): an unknown API address answers 404 whatever the method and whether or not the caller is signed in, with a scenario for a write (design.md D3).

The other capabilities keep their requirements. `service-health`'s `GET /health` and `app-delivery`'s pages stay open to every caller. `api-errors` already covers 401 and 403 as problem descriptions, and `bank-reads` is untouched.

## Non-goals

- **The waiting and offline screens:** C7 builds them, hooked onto the app's first request, so the sign-in path gets them too (D5).
- **The balance, transactions and the stored balance:** C7.
- **Signing out of Microsoft itself:** sign-out ends only this app's session (D2).
- **Returning to a deep page after sign-in:** the app is one screen, so sign-in always lands on the start page. That also rules out open redirects (D2).
- **Antiforgery tokens:** the forged-request rule uses the browser's own fetch-metadata headers (D4).
- **The iPhone fallbacks** (`window.open`, one-time code handoff): a follow-up change, only if the iPhone check fails (D1).
- **Publisher verification and a custom domain:** the consent screen shows the app as unverified, and the app stays on its `azurecontainerapps.io` address.
- **The .NET 11 GA upgrade:** a separate PR. The new packages start on RC3 like the rest.

## Open questions

- **Applies Q1** ([ADR-0004-account-allowlist](../../../docs/adr/0004-account-allowlist.md)): the email allowlist with personal accounts only, checked on every request; the list in Key Vault and user-secrets, never in the repository.
- **Applies Q2** ([ADR-0003-sign-in](../../../docs/adr/0003-sign-in.md)): the BFF login cookie, 30 days and renewed while used, with a 12-month client secret. This change picks the forged-request mechanism ADR-0003 left to C6.
- **Applies Q9** (ADR-0003 § The main user's phone): sign-in is checked on the owner's iPhone from the Home Screen app.

## Impact

- **New code (backend):** sign-in in `src/RevolutReader.Api/SignIn/`, covering:
  - options and the allowlist;
  - the OpenID Connect and cookie setup;
  - the authorization policy;
  - the 401/403 problem descriptions;
  - the login, callback and logout endpoints;
  - `GET /api/me`;
  - the forged-request rule;
  - forwarded headers;
  - the Data Protection keys.

  Also the page fallback marked anonymous, and two secret parameters plus Vite HTTPS in the AppHost.
- **New code (frontend):**
  - the session (who is signed in) and the generated client in `src/api/`;
  - the screens;
  - `Button`, `Banner`, `MicrosoftSignInButton` and `AccountMenu` in `src/components/`;
  - Microsoft's official logo file in `public/`.
- **Tests:**
  - a fake Microsoft server (WireMock.Net) in `Drivers/`;
  - the fake clock in the harness;
  - the sign-in scenarios, DSL and drivers, and the anonymous-endpoint check's fallback-policy case;
  - unit tests for the allowlist, the forged-request rule, the settings and the session;
  - frontend scenario tests.
- **Packages:**
  - backend: `Microsoft.AspNetCore.Authentication.OpenIdConnect` and `Microsoft.AspNetCore.OpenApi` (11.0.0-rc.3); `FastEndpoints.OpenApi` 9.0.0-beta.7; `Azure.Extensions.AspNetCore.DataProtection.Blobs` 1.5.5; `Azure.Extensions.AspNetCore.DataProtection.Keys` 1.6.5; `Azure.Identity` 1.21.0;
  - tests: `Microsoft.Extensions.TimeProvider.Testing` 10.11.0;
  - frontend: `openapi-fetch` 0.17.0 and `@radix-ui/react-dropdown-menu` 2.2.1;
  - tools folder: `openapi-typescript` 7.13.0 and `typescript` 5.9.3 (all versions checked 2026-11-07).
- **API contract:** the first committed `openapi.json` (`GET /api/me`) and the generated TypeScript types.
- **Settings:** a `SignIn` section and a `DataProtection` section in `appsettings.json`; two new `"<secret>"` entries.
- **Azure (Bicep):**
  - the storage account (shared keys off) with a blob container for the keys;
  - a key in the existing Key Vault;
  - the app identity's two roles;
  - the sign-in secrets and settings on the container app.
- **Azure and Entra by hand (owner's go):** the sixth grantable role, the client secret, the allowlist, the redirect URIs.
- **CI:** drift checks in `build-and-test` and `frontend`; no new required check, so the ruleset on `main` stays as it is.
- **Docs:**
  - ADR-0003, ADR-0004, ADR-0006;
  - `docs/conventions/` (README.md, configuration.md, testing.md, workflow.md § 5) and their `.claude/rules/` mirrors;
  - `docs/operations/` (entra-id.md, azure-prerequisites.md, expiring-approvals.md, local-secrets.md, deployment.md);
  - `tests/manual-scenarios.md`;
  - `docs/software-factory/` (lessons and the inventory);
  - `CLAUDE.md` § Commands, `pm/progress.md`.
