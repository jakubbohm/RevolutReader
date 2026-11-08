# Tasks: c007-add-user-login

Before this list: design.md § Bootstrap, committed as `[setup]`, covering:

- the packages and `tools/api-client/`;
- the OpenAPI export proven on today's API (it went the fallback way: the explicit export check `OpenApiExport`, design.md § Bootstrap item 2);
- Microsoft's logo file;
- the Czech button label checked.

Its baseline holds one known exception, accepted once: the traceability check reports this change's 19 new scenarios as not claimed. Group 1 claims them.

Run with `/tdd-apply c007-add-user-login` (roadmap C6; the user picks the review mode at the start). There are 20 scenarios: 11 API, 7 frontend, 2 manual. So the work is sliced per scenario, backend first (design.md D1): slices 1–11 are the API, 12–17 the screens. Then come the cookie keys, local development, deployment and the final close.

- Docs tasks are the orchestrator's; "Guided" tasks need the owner (design.md D11).
- **"Green"** means the full suite: `dotnet test`, and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck` and `format:check`. Two exceptions: this change's acceptance tests stay red until their slice, and the guards 1.3 and 1.4 until slices 3 and 4.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (API): `Drivers/FakeMicrosoft`, a WireMock.Net server per test started before the app copy, serving discovery, keys and token (design.md D6). Every app copy gets:
  - `SignIn:Authority` = the fake, a made-up client id and secret, `SignIn:AllowedEmails` = `lucie@example.com`;
  - in `ConfigureTestServices`: `RequireHttpsMetadata = false`, ephemeral Data Protection keys, and `FakeTimeProvider` as the app's `TimeProvider`, started at the real current time.

  `AcceptanceTest.ConfigureWebHostBuilder` calls `FakeMicrosoft.Configure` next to `FakeBank.Configure`. Verify: every acceptance test that was green stays green
- [x] 1.2 Foundation (API): `SignInDriver` (own `HttpClient`: `https://localhost`, no redirects, cookies kept), `SignInDsl`, `Visitor`, `IdentityAtMicrosoft`, `SignInStart`, `Landing` and `WhoAnswer` as signatures whose methods throw `NotImplementedException`, exactly as design.md § Public API sketch; `AcceptanceTest.SignIn`. Verify: build passes
- [x] 1.3 Guard: `Conventions/SignInTelemetryTests` (design.md D3, D8):
  - a stranger's sign-in logs exactly one `SignInRefused` warning, and no captured line contains the stranger's email;
  - an allowed user's sign-in logs no warning.

  Verify: fails at runtime until slice 3
- [x] 1.4 Guard: `Conventions/AnonymousEndpointsTests`:
  - "open" now means `IAllowAnonymous` only, because the fallback policy protects the rest (design.md D3);
  - the allowlist gains `GET /api/auth/login` (and `HEAD` if FastEndpoints maps it) and `POST /api/auth/logout`.

  Verify: fails at runtime until slice 4
- [x] 1.5 Foundation (frontend): `src/test/renderApp.tsx` takes the server's answer to `GET /api/me` (401, 403 with or without an email, 200 with a name and email, a failure). It records the requests the app sends and where the app navigates. Verify: the existing frontend tests stay green
- [x] 1.6 Acceptance: sign-in / An anonymous visitor is asked to sign in
- [x] 1.7 Acceptance: sign-in / An allowed user who signs in gets in
- [x] 1.8 Acceptance: sign-in / A stranger who signs in is refused, with their own email
- [x] 1.9 Acceptance: sign-in / Signing out ends the login
- [x] 1.10 Acceptance: sign-in / A write request from another site is refused
- [x] 1.11 Acceptance: sign-in / Sign-in returns to the app's own HTTPS address behind the hosting proxy
- [x] 1.12 Acceptance: sign-in / Signing in again with another account opens Microsoft's account picker
- [x] 1.13 Acceptance: sign-in / A sign-in cancelled at Microsoft leaves the visitor signed out
- [x] 1.14 Acceptance: sign-in / An account from a work or school directory is not signed in
- [x] 1.15 Acceptance: sign-in / A login unused for 30 days has ended
- [x] 1.16 Acceptance: sign-in / Using the app keeps the login alive
- [x] 1.17 Acceptance: sign-in / The sign-in screen shows when nobody is signed in (frontend)
- [x] 1.18 Acceptance: sign-in / Tapping the sign-in button starts the Microsoft sign-in (frontend)
- [x] 1.19 Acceptance: sign-in / A refused account sees that it has no access (frontend)
- [x] 1.20 Acceptance: sign-in / Trying another account signs out and starts a new sign-in (frontend)
- [x] 1.21 Acceptance: sign-in / Signing out from the account menu shows the signed-out screen (frontend)
- [x] 1.22 Acceptance: app-shell / The account menu shows who is signed in (frontend)
- [x] 1.23 Acceptance: app-shell / The top bar shows the app name (frontend), modified: the test signs someone in first. Verify: it passes, because a signed-in user sees the top bar today too
- [x] 1.24 Acceptance: sign-in / Signing in from the Home Screen app opens the app (manual): a row in `tests/manual-scenarios.md` (why manual: Microsoft's real pages and the Home Screen app's own cookie jar; handover step M5; first chance right after the merge deploys)
- [x] 1.25 Acceptance: sign-in / The Home Screen app stays signed in after it is closed (manual): a row as in 1.24
- [x] 1.26 Docs (design.md D6):
  - testing.md § Test sign-in (the fake provider, the HTTPS client, the clock starting at the real time) and § Acceptance-test harness (what each app copy now gets);
  - `.claude/rules/testing.md`;
  - lesson R-24 gains the test mechanics;
  - the inventory line for `FakeMicrosoft`.

  Verify: no statement contradicts design.md D6

## 2. [wiring] Slice 1 — Who is asked to sign in

- [x] 2.1 `AddSignIn()`, first part:
  - the cookie scheme as default and challenge scheme;
  - `OnRedirectToLogin` → 401 and `OnRedirectToAccessDenied` → 403, both without a redirect;
  - the `AllowedUser` policy (for now: a signed-in user) as default and fallback policy;
  - `TimeProvider.System` registered unless one is.

  Also `UseSignIn()` in `Program.cs` in design.md's order, and the page fallback `.AllowAnonymous()`. Verify: build passes; green
- [x] 2.2 `MeEndpoint` (`GET /api/me`, default policy) and `MeResponse`, from the `name` and `email` claims; `SignInDriver.AskWhoIsSignedIn` replaces its stub. Verify: the scenario runs against the app
- [x] 2.3 Docs: README.md § Backend code: the 401 row in the case → status table; secure by default now means the `AllowedUser` fallback policy. Verify: README.md matches design.md D3

## 3. [close] Slice 1 — An anonymous visitor is asked to sign in

- [x] 3.1 The scenario's test passes. Verify: green, including sign-in / An anonymous visitor is asked to sign in

## 3a. [acceptance] Slice 1 fix — Unknown addresses (added after slice 1's review, design.md D3)

- [x] 3a.1 Acceptance: api-errors / A write to an unknown API address answers with a problem description. `AnonymousEndpointsTests`' allowlist gains `ApiNotFound`'s route for every method. Verify: the new test and the allowlist check fail at runtime; traceability passes

## 3b. [unit] Slice 1 fix — The router's method rejection

- [x] 3b.1 A request matched only by the router's method rejection (an endpoint that is not a route endpoint) is passed on, as an unmatched one is

## 3c. [wiring] Slice 1 fix — Unknown API addresses

- [x] 3c.1 `ApiNotFound`: `/api/{**path}` for every method, anonymous, answering 404 without a body. Verify: the scenario runs against the app; green except the slices still to come
- [x] 3c.2 Docs: README.md § Backend code, secure by default: the catch-all and the method rejection. Verify: it matches design.md D3

## 3d. [close] Slice 1 fix — A write to an unknown API address answers with a problem description

- [x] 3d.1 The scenario's test passes, and the existing GET one still does. Verify: green, including both api-errors scenarios

## 4. [unit] Slice 2 — Sign-in settings

- [x] 4.1 A sign-in secret still holding the placeholder fails validation, and the message names the setting only
- [x] 4.2 An allowlist without any address fails validation
- [x] 4.3 An allowlist with an empty entry between commas fails validation
- [x] 4.4 An allowlist entry that is not an email address fails validation, and the message does not contain the entry
- [x] 4.5 Complete sign-in settings pass validation
- [x] 4.6 The allowlist's entries are trimmed

## 5. [wiring] Slice 2 — Signing in through Microsoft

- [x] 5.1 `SignInOptions` and the `SignIn` section in `appsettings.json`: `Authority`, `ClientId`, and the two secrets as `"<secret>"`, each key with its provenance comment (design.md D11). Bound with `ValidateDataAnnotations`, `SignInOptionsValidator` and `ValidateOnStart`. The export check `OpenApiExport` (`RevolutReader.IntegrationTests/Wiring/OpenApi/`) gets made-up values for the new settings (design.md D9). Verify: build passes; green (the harness's settings pass); the export check passes
- [x] 5.2 OpenID Connect in `AddSignIn()`, as design.md D2–D4 describe:
  - authority, client id and secret, code flow with `form_post` and PKCE;
  - `CallbackPath` `/api/auth/signin-oidc`;
  - `MapInboundClaims` off, `name` and `email` kept in the login;
  - the `__Host-` names and Path `/` for the session and round-trip cookies;
  - the login persistent, 30 days, sliding.

  Verify: build passes; green
- [x] 5.3 `LoginEndpoint` (`GET /api/auth/login`, anonymous) challenges OpenID Connect and returns to `/`. Verify: build passes
- [x] 5.4 `FakeMicrosoft`'s discovery, keys and token answers, and `SignInDriver.StartSignIn` and `ReturnFromMicrosoft` (with the cross-site headers of design.md D6) replace their stubs (the DSL was written in full at the acceptance gate). Verify: the scenario runs against the app; a rejection by .NET 11's own CSRF check shows here (design.md § Risks)
- [x] 5.5 Docs: configuration.md § `appsettings.json` and § Binding mention the `SignIn` section; ADR-0003 is amended with the addresses, landing on `/` and the cookie names. Verify: they match design.md D2, D4, D11

## 6. [wiring] Slice 2 — The generated API client

- [x] 6.1 `GET /api/me`'s OpenAPI description (200 `MeResponse`, 401 and 403 problem descriptions), and `GET /health`'s corrected to 200 with the text `Healthy` (today's document says 204, design.md § Bootstrap item 2); `tools/api-client`'s `generate` and `regenerate` scripts (`regenerate` runs the export check `OpenApiExport`, then `generate`). Regenerate the TS client: `openapi.json` and `src/RevolutReader.Web/src/api/schema.d.ts` committed; `schema.d.ts` left out of Prettier and oxlint. Verify: `npm --prefix tools/api-client run regenerate` leaves no diff; frontend checks green
- [x] 6.2 `src/RevolutReader.Web/src/api/client.ts`: one openapi-fetch client on the page's origin. Verify: typecheck passes
- [x] 6.3 CI drift steps (design.md D9): in `build-and-test` after `dotnet build` and the export check, and in `frontend` after `npm --prefix tools/api-client ci` and `run generate`, each a `git diff --exit-code` on its generated file. Verify: locally, an edited `openapi.json` makes the step's command fail, and reverting makes it pass; the workflow file passes `actionlint` if installed, else review
- [x] 6.4 Docs:
  - README.md § API contract: the tools folder, its scripts and the drift steps;
  - `CLAUDE.md` § Commands: "Regenerate the API client";
  - the inventory line for `tools/api-client/`.

  Verify: the command in `CLAUDE.md` runs as written

## 7. [close] Slice 2 — An allowed user who signs in gets in

- [x] 7.1 The scenario's test passes, including the exact shape of `GET /api/me`. Verify: green, including sign-in / An allowed user who signs in gets in

## 8. [unit] Slice 3 — Allowlist

- [x] 8.1 An address on the allowlist is allowed
- [x] 8.2 An address on the allowlist written in other letter case is allowed
- [x] 8.3 An address not on the allowlist is not allowed
- [x] 8.4 An account without an email address is not allowed

## 9. [wiring] Slice 3 — Strangers refused

- [x] 9.1 `AllowedUserRequirement` and `AllowedUserHandler` join the `AllowedUser` policy, with the parsed `Allowlist` registered. Verify: build passes; green except this slice's scenario
- [x] 9.2 `CustomizeProblemDetails` adds `email` to a 403 for a signed-in account; `WhoAnswer` reads it in the driver. Verify: the scenario runs against the app
- [x] 9.3 `SignInLog` and the handler's `OnTokenValidated` event: an account not on the allowlist (or without an email) logs `SignInRefused` at Warning with its `sub`, never the email, and the sign-in still completes (design.md D3). Verify: the guard 1.3 runs against the app
- [x] 9.4 Docs:
  - README.md: the 403 row;
  - ADR-0004 amended (the list format, no email in logs, a refused sign-in logged once as a warning, no email claim means refused);
  - configuration.md: the allowlist's format.

  Verify: they match design.md D3, D8

## 10. [close] Slice 3 — A stranger who signs in is refused, with their own email

- [x] 10.1 The scenario's test and the guard 1.3 pass. Verify: green, including sign-in / A stranger who signs in is refused, with their own email and `SignInTelemetryTests`

## 11. [wiring] Slice 4 — Signing out

- [x] 11.1 `LogoutEndpoint` (`POST /api/auth/logout`, anonymous, 204) signs out of the cookie scheme only. Its OpenAPI description, then regenerate the TS client. `SignInDriver.SignOut` replaces its stub. Verify: the scenario runs against the app; `regenerate` leaves no diff

## 12. [close] Slice 4 — Signing out ends the login

- [x] 12.1 The scenario's test and the guard 1.4 pass. Verify: green, including sign-in / Signing out ends the login and `AnonymousEndpointsTests`

## 13. [unit] Slice 5 — Writes from other sites

- [x] 13.1 A read (GET, HEAD, OPTIONS) passes whatever its headers
- [x] 13.2 A write from the app's own page is allowed
- [x] 13.3 A write the user started directly is allowed
- [x] 13.4 A write from a neighbouring site on the same domain is refused
- [x] 13.5 A write from another site is refused
- [x] 13.6 A write without fetch metadata but with the app's own origin is allowed
- [x] 13.7 A write without fetch metadata from another origin is refused
- [x] 13.8 A write with neither header is allowed
- [x] 13.9 The sign-in return is passed on whatever its headers
- [x] 13.10 A write outside `/api` is passed on

## 14. [wiring] Slice 5 — The rule in the app

- [x] 14.1 `UseCrossSiteWriteProtection()`: a refusal answers 403 through `IProblemDetailsService` and ends the request; placed as design.md D4 says. `SignInDriver.SignOut(fromSite)` sends the other site's fetch metadata and `Origin`. Verify: the scenario runs against the app; green except this slice's scenario
- [x] 14.2 Docs:
  - README.md § Backend code: the rule for writes;
  - ADR-0003 amended with the forged-request rule (closing "C6 chooses the mechanism") and 403 with the own email;
  - two new lessons: the Public Suffix List gap, and .NET 11's form-only enforcement;
  - the inventory line for the rule.

  Verify: they match design.md D4

## 15. [close] Slice 5 — A write request from another site is refused

- [x] 15.1 The scenario's test passes. Verify: green, including sign-in / A write request from another site is refused

## 16. [wiring] Slice 6 — Behind the hosting proxy

- [x] 16.1 `UseForwardedHeaders` first in the pipeline (`X-Forwarded-Proto`, `X-Forwarded-For`, known proxies and networks cleared, design.md D10); `StartSignIn` sends the host and `X-Forwarded-Proto: https`. Verify: the scenario runs against the app

## 17. [close] Slice 6 — Sign-in returns to the app's own HTTPS address behind the hosting proxy

- [x] 17.1 The scenario's test passes. Verify: green, including sign-in / Sign-in returns to the app's own HTTPS address behind the hosting proxy

## 18. [wiring] Slice 7 — The account picker

- [x] 18.1 `LoginRequest.AnotherAccount` → `prompt=select_account` on the challenge. Its OpenAPI description, then regenerate the TS client. The driver reads `prompt`. Verify: the scenario runs against the app; `regenerate` leaves no diff

## 19. [close] Slice 7 — Signing in again with another account opens Microsoft's account picker

- [x] 19.1 The scenario's test passes. Verify: green, including sign-in / Signing in again with another account opens Microsoft's account picker

## 20. [wiring] Slice 8 — A sign-in that does not complete

- [x] 20.1 `OnAccessDenied` and `OnRemoteFailure` redirect to `/`. A cancel logs `SignInCancelled` (Information); any other failure logs `SignInFailed` (Warning) with the failure's kind only, never a token, an email or an exception message (design.md D3). `SignInDriver.CancelAtMicrosoft` replaces its stub. Verify: the scenario runs against the app; the guard 1.3 stays green

## 21. [close] Slice 8 — A sign-in cancelled at Microsoft leaves the visitor signed out

- [x] 21.1 The scenario's test passes. Verify: green, including sign-in / A sign-in cancelled at Microsoft leaves the visitor signed out

## 22. [wiring] Slice 9 — A work or school account

- [x] 22.1 `FakeMicrosoft` answers a token issued by a made-up work tenant (`Visitor.WorkAccount`). The scenario should already pass through the issuer check and slice 8's events; if not, fix the handler's settings here. Verify: the scenario runs against the app

## 23. [close] Slice 9 — An account from a work or school directory is not signed in

- [x] 23.1 The scenario's test passes. Verify: green, including sign-in / An account from a work or school directory is not signed in

## 24. [wiring] Slice 10 — The login's lifetime

- [x] 24.1 `SignInDriver.Advance` moves the app copy's `FakeTimeProvider`. The cookie handler takes its clock from the app's `TimeProvider`; if the default doesn't, set it explicitly (design.md § Risks). Verify: the scenario runs against the app

## 25. [close] Slice 10 — A login unused for 30 days has ended

- [x] 25.1 The scenario's test passes. Verify: green, including sign-in / A login unused for 30 days has ended

## 26. [close] Slice 11 — Using the app keeps the login alive

- [x] 26.1 The scenario's test passes with slice 2's sliding renewal; if not, fix the cookie settings here. Verify: green, including sign-in / Using the app keeps the login alive

## 27. [unit] Slice 12 — Session

- [x] 27.1 Nobody signed in reads as signed out
- [x] 27.2 A refused account reads as refused, with its email
- [x] 27.3 A refused answer without an email reads as refused, without one
- [x] 27.4 A signed-in account reads as signed in, with its name and email
- [x] 27.5 A server error or no answer reads as unknown

## 28. [wiring] Slice 12 — The sign-in screen

- [x] 28.1 `readSession()` on the generated client, and `App` choosing the screen from it: unknown → the empty frame, signed out → `SignInScreen` (design.md D3, D5). Verify: build and typecheck pass
- [x] 28.2 `MicrosoftSignInButton` and `SignInScreen`, built as design.md D12 says (the "Sign-in / Start" board, light and dark):
  - 41 px, Microsoft's colours from `color-ms-*`, the logo file, a 44 pt hit area;
  - no top bar; the icon and the name marked Spanish, centred.

  Verify: the scenario runs against the app; lint, format and typecheck pass

## 29. [close] Slice 12 — The sign-in screen shows when nobody is signed in

- [x] 29.1 The scenario's test passes. Verify: green, including sign-in / The sign-in screen shows when nobody is signed in

## 30. [unit] Slice 13 — Starting a sign-in

- [x] 30.1 A sign-in goes to the backend's sign-in address
- [x] 30.2 A sign-in to try another account asks for Microsoft's account picker

## 31. [wiring] Slice 13 — The button starts the sign-in

- [x] 31.1 The button calls `startSignIn()` and shows its loading state while the page leaves. Verify: the scenario runs against the app

## 32. [close] Slice 13 — Tapping the sign-in button starts the Microsoft sign-in

- [x] 32.1 The scenario's test passes. Verify: green, including sign-in / Tapping the sign-in button starts the Microsoft sign-in

## 33. [wiring] Slice 14 — The no-access screen

- [x] 33.1 `Button` (primary, block), `Banner` (error tone, `role="alert"`) and `NoAccessScreen` from the "Sign-in / Access denied" board; refused → `NoAccessScreen` with the email. Verify: the scenario runs against the app; lint, format and typecheck pass

## 34. [close] Slice 14 — A refused account sees that it has no access

- [x] 34.1 The scenario's test passes. Verify: green, including sign-in / A refused account sees that it has no access

## 35. [wiring] Slice 15 — Trying another account

- [x] 35.1 `signOut()` on the generated client; "Zkusit jiný účet" signs out, then calls `startSignIn({ anotherAccount: true })`. Verify: the scenario runs against the app

## 36. [close] Slice 15 — Trying another account signs out and starts a new sign-in

- [x] 36.1 The scenario's test passes. Verify: green, including sign-in / Trying another account signs out and starts a new sign-in

## 37. [wiring] Slice 16 — The account menu

- [x] 37.1 `AccountMenu` (Radix `DropdownMenu`, design.md D12), `AppShell`'s optional account and sign-out, and `AccountScreen`; signed in → `AccountScreen`. Radix is imported only in `src/components/`. Verify: the scenario runs against the app; lint (including the Radix import rule), format and typecheck pass

## 38. [close] Slice 16 — The account menu shows who is signed in

- [x] 38.1 Both app-shell scenarios pass. Verify: green, including app-shell / The account menu shows who is signed in and app-shell / The top bar shows the app name

## 39. [wiring] Slice 17 — Signing out from the menu

- [x] 39.1 "Odhlásit se" calls `signOut()`, then shows `SignInScreen` with the note "Odhlášení proběhlo. Pro návrat se znovu přihlas." (`role="status"`), as on the "Sign-in / Signed out" board. Verify: the scenario runs against the app

## 40. [close] Slice 17 — Signing out from the account menu shows the signed-out screen

- [x] 40.1 The scenario's test passes. Verify: green, including sign-in / Signing out from the account menu shows the signed-out screen

## 41. [unit] Cookie keys — settings

- [x] 41.1 All three key settings empty choose the default key store
- [x] 41.2 All three key settings set choose Blob Storage with the Key Vault key
- [x] 41.3 Partly set key settings are refused, and the message names the settings, not their values

## 42. [wiring] Cookie keys — Blob Storage and Key Vault

- [x] 42.1 `DataProtectionKeysOptions` and the `DataProtection` section in `appsettings.json`: three empty settings with provenance comments (design.md D7). `AddDataProtectionKeys()` in the composition root: the application name pinned, and Blob plus the Key Vault key through `ManagedIdentityCredential` when set. Verify: build passes; green (the harness keeps ephemeral keys)
- [x] 42.2 Docs: configuration.md: the `DataProtection` settings are production-only, set by Bicep. Verify: it matches design.md D7

## 43. [wiring] Local development

- [x] 43.1 AppHost: the secret parameters `signin-client-secret` and `signin-allowed-emails` → `SignIn__ClientSecret`, `SignIn__AllowedEmails`; `vite.config.ts` forwards `/api` with `changeOrigin: false`. Start the app through the aspire skill and check that the `web` address is HTTPS; if not, add `WithHttpsDeveloperCertificate()` with the warning suppressed and a reason (design.md D2). Verify: `aspire start` waits for the two parameters, and the `web` address starts with `https://`
- [ ] 43.2 Guided, with the owner's go: the Entra redirect URIs, `https://localhost/api/auth/signin-oidc` and the production address, replacing the two old ones (Graph `PATCH`, design.md D11); read back with entra-id.md § Checks. Verify: the read-back lists exactly the two new addresses
- [ ] 43.3 Guided (owner): the 12-month client secret, straight into Key Vault `SignIn--ClientSecret`, the AppHost's user-secrets and the backup vault, never printed; its expiry date noted. Verify: the names exist in all three places (values not shown); the registration lists one secret with that expiry
- [ ] 43.4 Guided (owner): the allowlist, typed at a prompt, into Key Vault `SignIn--AllowedEmails`, the user-secrets and the backup vault, never printed. The daughter's entry is her personal Microsoft account (the owner confirms it exists; a school account cannot sign in, ADR-0004). Verify: the names exist in all three places
- [ ] 43.5 Local check in a browser with `aspire start`, signing in as the owner (design.md § Migration plan, step 2):
  - the owner's account gets in and sees the account menu;
  - sign-out shows the signed-out screen;
  - the second personal account sees the no-access screen;
  - "Zkusit jiný účet" opens Microsoft's account picker.

  Verify: recorded in `.tdd-state.md` with what was seen, without addresses
- [ ] 43.6 Docs:
  - local-secrets.md: the two parameters and their backup names;
  - configuration.md § Local development and § Hand-provisioned secrets: two rows with the date;
  - entra-id.md: the redirect URIs and the client secret, with its expiry;
  - expiring-approvals.md: the client secret, 12 months;
  - `CLAUDE.md` § Commands, if running the app changed (HTTPS address).

  Verify: every name in them matches the AppHost and Key Vault

## 44. [wiring] Deployment

- [ ] 44.1 Update infra Bicep, as design.md § Cross-cutting effects describes:
  - `platform.bicep`: the storage account and its private container `dataprotection`, the key `dataprotection` in `kv-revolutreader`, the app identity's Storage Blob Data Contributor on the container and Key Vault Crypto User on the key, and the three outputs;
  - `main.bicep` passes them on;
  - `features.bicep` § Sign-in: the two Key Vault-backed secrets and five environment variables.

  `main.bicepparam` is unchanged. Verify: `az bicep lint --file infra/main.bicep` reports nothing; the read-only preview (docs/operations/deployment.md) shows the new resources and no deletion
- [ ] 44.2 Guided (owner): the deploy identity's fifth grantable role, Key Vault Crypto User, with azure-prerequisites.md step 5 run again with its ID added to `$roles`; read back with its check. Verify: the condition lists five role IDs
- [ ] 44.3 Docs:
  - workflow.md § 5: the storage account row, the key and the fifth role;
  - azure-prerequisites.md: the table and step 5's command;
  - deployment.md: the new resources and settings, and the post-deploy checks of § Migration plan, step 4;
  - ADR-0006 item 2 amended;
  - the lesson on Data Protection keys for a scale-to-zero app.

  Verify: they match design.md D7

## 45. [close] Acceptance green

- [ ] 45.1 All acceptance tests of this change pass, and the full suite is green. That includes `dotnet format whitespace RevolutReader.slnx --verify-no-changes`, the frontend build, and the traceability check (every scenario claimed exactly once). Verify: the commands' output
- [ ] 45.2 `pm/progress.md`: the C6 row, the heads-up for C7 (design.md D5: the waiting screen on the first request, the sleeping server on tap), and Q1/Q2 marked as applied. `CLAUDE.md` checked against every command this change added. Verify: the row links the change; `CLAUDE.md`'s commands run as written

## Workflow follow-up

- Archive with `/opsx:archive` in the same PR, before its merge, as C5 did. The traceability check must pass first.
- The owner reviews and squash-merges the PR `feat: add user login (C6)`. The production secrets and the fifth role must exist first (43.3, 43.4, 44.2).
- After the merge (design.md § Migration plan, step 4):
  - the deploy and its checks;
  - sign-in at the production address in a desktop browser;
  - the two iPhone manual scenarios;
  - their dates go into `tests/manual-scenarios.md`, and the consent screen as seen into `entra-id.md`, through a small follow-up docs PR.
- If the iPhone check fails: a follow-up change with ADR-0003's fallbacks (design.md D1).
