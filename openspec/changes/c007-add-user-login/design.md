# Design: c007-add-user-login

## TL;DR

- **One change, backend first.** The iPhone Home Screen check runs right after the merge deploys; its fallbacks would be a follow-up change (D1).
- **Every sign-in address sits under `/api/auth/`:** login, Microsoft's return, logout. After sign-in the visitor always lands on `/`. Sign-out ends only our session; "try another account" asks Microsoft for its account picker. Locally Vite runs over HTTPS and keeps the browser's host (D2).
- **Strangers are signed in but refused:** every `/api` request is checked against the allowlist. Anonymous gets 401; a stranger gets 403 naming their own email. A stranger's sign-in is logged once as a warning, without the email. `GET /api/me` answers name and email. The page picks its screen from that first answer (D3).
- **`__Host-` cookies and one app-wide rule against writes from other sites,** because `azurecontainerapps.io` is not on the Public Suffix List and .NET 11's built-in check covers only forms (D4).
- **Waiting and offline screens move to C7,** hooked onto the app's first request (D5).
- **Tests sign in through a fake Microsoft** (WireMock.Net: discovery, keys, token endpoint), so the whole sign-in runs production code; the fake clock enters the harness (D6).
- **Cookie keys:** a blob in the new storage account, encrypted by a Key Vault key. Production only; the owner adds the sixth grantable role (D7).
- **Allowlist:** one comma-separated secret (D8). **API client:** exported by an explicit check that starts an app copy (the build-time export failed at bootstrap) and generated with TypeScript 5 in `tools/api-client/`; drift checked in the existing CI jobs (D9). **Forwarded headers** from the ingress (D10). **Guided steps** for the owner (D11). **UI:** three sign-in boards and the account menu (D12).
- **New public interfaces:**
  - `GET /api/me`, `GET /api/auth/login`, `POST /api/auth/logout`;
  - the `SignIn` and `DataProtection` settings;
  - `AddSignIn()` and `UseSignIn()`, plus `UseCrossSiteWriteProtection()`;
  - DSL `Visitor` and drivers `FakeMicrosoft`, `SignInDriver`;
  - frontend `readSession()`, `startSignIn()`, `signOut()`.
- **Integration points:** Microsoft's personal-account service (OpenID Connect, code flow); the Entra registration (redirect URIs, client secret); Key Vault (two secrets, one key); the new storage account; the AppHost (two parameters, Vite HTTPS); CI (two drift steps).
- **Hard to reverse:** the sign-in addresses, which are registered in Entra; the cookie names, since renaming signs everyone out once; the 403-for-strangers model, which C7 and C8 build on.

## Context

- See proposal.md § Why. Every decision below was made with the user in explore, one at a time (2026-11-07). The details marked *(propose)* were settled while writing this design and follow from those decisions.
- **Backend today:**
  - `Program.cs`: ServiceDefaults, `AddProblemDetails` with `UseStatusCodePages`, C3's `UseAppPages()` (static files plus an anonymous page fallback for every address outside `/api`), FastEndpoints with `GET /health` (`AllowAnonymous`), and C5's `AddEnableBanking()`.
  - No authentication, no `TimeProvider` registration, no OpenAPI.
  - `AnonymousEndpointsTests` treats an endpoint without authorization metadata as open, with a note that C6's fallback policy changes this.
- **Frontend today:** `App` shows the install hint in an iPhone Safari tab and the empty `AppShell` otherwise. There is no fetch, no Radix and no API client. The service worker leaves `/api` and `/health` to the server (`sw.ts`, `SERVER_ONLY`).
- **Local development:** the browser talks to Vite (the `web` resource), which forwards `/api` to the API with `changeOrigin: true` (c003 design.md D11). That design already flagged that the sign-in return must sit under `/api`.
- **Azure:**
  - The container app `tarjeta-papa` runs behind Container Apps' HTTPS ingress and scales to zero after 300 s idle. It reads the four Enable Banking secrets through Key Vault references.
  - The deploy identity may grant four roles (Key Vault Secrets User and Officer, Storage Blob and Table Data Contributor; docs/operations/azure-prerequisites.md step 5).
  - Key Vault `kv-revolutreader` is open to the internet and guarded by roles (R-52).
- **Entra:**
  - App registration `7833ec21-abbc-493b-b764-8b74eb3bcaa0`, personal Microsoft accounts only, `openid profile email` plus the optional `email` claim.
  - Redirect URIs `https://localhost/signin-oidc` and `https://localhost/signout-callback-oidc`. Microsoft ignores the port on `localhost`.
  - No client secret yet (docs/operations/entra-id.md).
- **Facts checked during explore (2026-11-07):**
  - `azurecontainerapps.io` is not on the Public Suffix List (`azurewebsites.net` and `azurestaticapps.net` are), so every container app counts as the same site as ours.
  - .NET 11's automatic CSRF protection is described as enforced only where a form is read (Andrew Lock, 2026-08-04). Duende describes it as inspecting every unsafe request. Its public `ICsrfProtection` interface changed shape late in the PR (dotnet/aspnetcore#66585).
  - ASP.NET Data Protection has no store in Key Vault; Microsoft's documented Azure pattern is Blob Storage for the keys plus a Key Vault key that encrypts them, with the Key Vault Crypto User role (Microsoft Learn, updated 2026-11-02).
  - The key ring is read once and cached; the store is checked about every 24 h.
  - A key declared in Bicep is created once; a redeploy reads the existing key and writes nothing (Microsoft Learn, Key Vault key quickstart).
  - Package versions: proposal.md § Impact.

## Goals / Non-Goals

**Goals:**

- The 18 `sign-in` scenarios and the two `app-shell` ones, each verified at the level § How each scenario is verified gives.
- A sign-in that works locally (Vite, HTTPS) and on Azure (behind the ingress), checked by hand in both places, then on the iPhone.
- The first committed API contract and the generated client, with drift checks that never generate in CI.

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- **No in-memory fake of any port and no `[integration]` group.** Sign-in has no port of ours: Microsoft is faked at the HTTP level, as the bank is.
- **No storage in a database:** the allowlist is a setting, and the login lives in the cookie.
- **No Microsoft.Identity.Web** (ADR-0003 § Decision, item 1): ASP.NET Core's own OpenID Connect and cookie handlers.
- **No per-user state on the server:** a stranger's cookie grants nothing, and removing someone takes effect on their next request after the app restarts with the new list.

## Bootstrap (done before `/tdd-apply`, not in tasks.md)

As in C1, C3 and C5, Claude prepares a green starting point on the change branch once the user approves these artifacts, committed as `[setup]`. None of it is behaviour.

1. **Packages** (versions in proposal.md § Impact), added to `Directory.Packages.props` and referenced, with no code using them yet. In `tools/api-client/`, `package.json` and `package-lock.json` with openapi-typescript and TypeScript 5.9.3, and `npm ci` passing.
2. **Build-time OpenAPI export, proven on the current API:** `Microsoft.Extensions.ApiDescription.Server` writes `src/RevolutReader.Api/openapi.json` on `dotnet build` through FastEndpoints.OpenApi, with no `MapOpenApi()`, so nothing is served. The check is that `dotnet build` writes a document listing `GET /health` and the start-up checks don't break the build.
   - **If build-time export fails** (FastEndpoints 9 beta, or the start-up checks): the fallback is an explicit test in the integration project that starts an app copy in-process, reads its document and writes the file. It runs from the regenerate script, never from `dotnet test`. Bootstrap records which way it went.
   - **Outcome (bootstrap, 2026-11-08): the fallback.** The build-time export starts the app with `appsettings.json`'s placeholder secrets, and the bank settings' start-up check refused them, so the build failed. FastEndpoints' own exporter (`ExportOpenApiDocsAndExitAsync`) starts the app too. Getting past the checks would take a build-only branch in Program.cs. So `Microsoft.Extensions.ApiDescription.Server` is not used. Instead:
     - `tests/RevolutReader.IntegrationTests/Wiring/OpenApi/OpenApiExport.cs` (`[Explicit]`) starts an app copy in `Production` with made-up values for every secret checked at start, reads FastEndpoints' `v1` document through `IOpenApiDocumentProvider`, and writes `src/RevolutReader.Api/openapi.json` with LF line endings;
     - the command is `dotnet test --project tests/RevolutReader.IntegrationTests --treenode-filter "/*/*/OpenApiExport/*"`;
     - FastEndpoints' default JWT bearer scheme is switched off (`EnableJWTBearerAuth = false`), because the app signs in with a cookie;
     - the document is OpenAPI 3.2.0, and openapi-typescript 7.13.0 reads it (a trial run, not committed);
     - `openapi.json` is not committed in setup: task 6.1 commits it with `schema.d.ts`. Today's document describes `GET /health` as answering 204 No Content, but it answers 200 with the text `Healthy`. Task 6.1 corrects that description.
3. **Microsoft's logo:** `ms-symbollockup_mssymbol_19.svg` from Microsoft Learn's "Sign in with Microsoft: Branding guidelines", downloaded and committed unchanged as `src/RevolutReader.Web/public/microsoft-logo.svg` (the design system's MicrosoftSignInButton guideline; docs/conventions/workflow.md § 8, files copied as they are).
4. **The button's Czech label:** checked against Microsoft's own Czech wording, as the design system asks. If Microsoft's wording differs from "Přihlásit se účtem Microsoft", Claude reports it at the acceptance gate and the user decides. A different label means a spec fix (`[plan]`).
5. The setup build and the full suite are green. The only accepted red is the traceability check reporting this change's 19 new scenarios as not claimed; group 1 claims them. The modified "The top bar shows the app name" keeps its existing claim.

## Decisions

> Made in `/opsx:explore` (2026-11-07), one decision at a time with the user (D1–D9). D10–D12 collect what those decisions imply and were written in `/opsx:propose`; the propose-time details are marked *(propose)*.

### D1 — One change, backend first, the iPhone after the merge

- **One change** (the user). Slices start with the backend sign-in, then the screens. The iPhone Home Screen check (two manual scenarios) runs right after the merge deploys.
- **If the iPhone check fails,** ADR-0003's fallbacks come as a follow-up change, in this order: open the sign-in with `window.open`, then hand the session to the app with a one-time code. The screens don't change for either: fallback 1 changes one click handler, fallback 2 adds endpoints.
- **Rejected:**
  - **splitting into C6a (backend plus a bare sign-in link) and C6b (screens, client):** it finds out sooner, but costs a second propose/archive cycle and a roadmap change;
  - **merging halfway through one change:** the change's acceptance tests, written first and red until the end, would turn CI red on `main`.

### D2 — The sign-in addresses, local HTTPS, sign-out

- **Addresses, all under `/api/auth/`:**

  | Address | Handled by | What it does |
  |---|---|---|
  | `GET /api/auth/login[?anotherAccount=true]` | an anonymous endpoint | challenges OpenID Connect; with `anotherAccount=true`, Microsoft is sent `prompt=select_account` |
  | `POST /api/auth/signin-oidc` | the OpenID Connect handler (its `CallbackPath`; middleware, not an endpoint) | Microsoft's return, `response_mode=form_post` |
  | `POST /api/auth/logout` | an anonymous endpoint | signs out of the cookie scheme only; 204 |

  - **Why under `/api`:** Vite already forwards it locally; the page fallback and the service worker already leave it to the server. No new exception anywhere.
  - **Login and logout are anonymous.** A stranger must be able to sign out ("Zkusit jiný účet"), and signing out without a login is harmless. Both go on the anonymous-endpoint allowlist.
- **After sign-in the visitor always lands on `/`** *(propose)*. There is no return-address parameter, so there's no open redirect to guard against. The app is one screen, and a push notification (C8) opens `/` too.
- **Sign-out ends only our session.** The cookie is deleted, and Microsoft's session is left alone, so there's no Microsoft page and no sign-out redirect URI. Without the account picker, Microsoft would silently sign the same account in again; "Zkusit jiný účet" therefore starts the sign-in with `anotherAccount=true`.
- **Local development:**
  - **Vite runs over HTTPS** with the ASP.NET Core development certificate. Aspire tries to set this up for Vite apps by itself; if it doesn't, the AppHost adds `WithHttpsDeveloperCertificate()` (experimental, `ASPIRECERTIFICATES001`, suppressed with a reason).
  - **The forwarding keeps the browser's host** (`changeOrigin: false`). So the API builds the return address from Vite's `https://localhost:<port>`, which matches the registered `https://localhost/api/auth/signin-oidc`, since Microsoft ignores the port.
- **Entra** (a guided step, D11): `https://localhost/api/auth/signin-oidc` replaces the two old addresses, and the production `https://tarjeta-papa.livelyground-53b2e5ad.germanywestcentral.azurecontainerapps.io/api/auth/signin-oidc` is added before the merge.
- **Rejected:**
  - **ASP.NET's default addresses** (`/signin-oidc`): Vite would not forward them, and they'd need exceptions in the page fallback and the service worker;
  - **a full Microsoft sign-out:** a Microsoft page on every sign-out and one more registered address;
  - **registering `http://localhost` addresses instead of HTTPS for Vite:** the sign-in's temporary cookies need `Secure`, and browsers differ on `Secure` cookies over plain-HTTP `localhost`.

### D3 — Strangers: signed in, refused everywhere, told their email

- **Authentication and authorization are separate:**
  - any valid sign-in through Microsoft's personal-account service gets the login cookie;
  - every API request then checks the allowlist through the authorization policy `AllowedUser` (signed in, and the `email` claim on the list, ignoring case). It is both the default policy (what FastEndpoints applies to an endpoint without its own settings) and the fallback policy (anything else without metadata).
  - **Only requests that matched an address are checked** (the user, 2026-11-08, at slice 1). ASP.NET applies the fallback policy also to a request that matches no endpoint, so an anonymous request to an unknown `/api` address would answer 401 instead of api-errors' 404. So a refusal counts only when an endpoint matched: `UnmatchedRequestsPass`, an `IAuthorizationMiddlewareResultHandler` (ASP.NET's documented hook for authorization results), passes a request that matched no endpoint on unchanged and hands every other result to ASP.NET's default handler. An unknown address answers 404 to everyone, and every real address stays protected by default.
  - **Writes to unknown API addresses answer 404 too** (the user, 2026-11-08, after slice 1's review). ASP.NET's routing picks the method before it checks the page fallback's path rule, so a POST, PUT, PATCH or DELETE to an unknown address lands on the router's own "405 method not allowed" endpoint: a 405 since C3, and with sign-in a 401 for anonymous callers, because that endpoint has no metadata and gets the fallback policy. Two fixes:
    - `ApiNotFound`, an anonymous endpoint `/api/{**path}` for every method, answers 404 without a body (`UseStatusCodePages` writes the problem). Real addresses win over it by route precedence, so a wrong method on a real address (`POST /api/me`) answers 404 as well. It joins the anonymous-endpoint allowlist; it can only ever answer 404. The api-errors requirement now says "whatever its method and whether or not the caller is signed in", with a scenario for a write.
    - `UnmatchedRequestsPass` treats any endpoint that is not a `RouteEndpoint` (the router's 405 rejection) as unmatched, so a write to an unknown page address answers the same 405 to everyone instead of 401 to anonymous callers. Page addresses are not the API, so 405 stays there.
  *(Slice 1: the first idea, `UseAuthorization` inside `UseWhen`, isn't enough on its own: `WebApplication` then adds an unconditional authorization step of its own at the start of the pipeline, and suppressing it takes ASP.NET's internal property name.)* Rejected: changing api-errors to 401 for anonymous callers (a typo would read as "sign in"); dropping the fallback policy (a future endpoint not built with FastEndpoints would be open, and `AnonymousEndpointsTests` couldn't see it).
- **Answers:**

  | Who | `GET /api/me` and every other protected endpoint |
  |---|---|
  | not signed in | 401, problem `Unauthorized` (the cookie handler's login redirect becomes 401) |
  | signed in, not on the list | 403, problem `Forbidden`, with the extension `email` = the account's own email (the access-denied redirect becomes 403; `CustomizeProblemDetails` adds `email` to a 403 only when the allowlist refuses the signed-in account: a refused account is named on every 403, while an allowed account's other 403s, such as D4's refusal of her write from another site, name nobody; issue #33, finding 4) |
  | signed in, on the list | the endpoint's answer; `GET /api/me` → `{ "name": …, "email": … }` exactly |

- **No email claim means not allowed:** the 403 then has no `email` extension. The name comes from the `name` claim; without one, the email stands in *(propose)*.
- **The page picks its screen from the first answer** to `GET /api/me`: 401 → sign-in screen, 403 → no-access screen with the email, 200 → the app with the account menu. Anything else (offline, a 5xx, the server still waking) keeps the empty frame until C7 (D5).
- **The tenant check needs no code of ours.** The authority is `https://login.microsoftonline.com/consumers/v2.0`, whose discovery document names one fixed issuer (the personal-account tenant `9188040d-6c67-4c5b-b112-36a304b66dad`). The handler's issuer validation rejects any other, which is the scenario "An account from a work or school directory is not signed in".
- **A sign-in that doesn't complete,** whether cancelled (`error=access_denied`) or failed (a bad token, a wrong issuer, a missing state cookie), goes back to `/`. The handler's `OnAccessDenied` and `OnRemoteFailure` events redirect there and log it, never the token or the email:
  - a cancel is logged as `SignInCancelled`, Information, because cancelling is normal;
  - a failure is logged as `SignInFailed`, Warning, with only the failure's kind (the exception type or Microsoft's error code), never an exception message, which may quote the token;
  - **it never signs out:** a login from before stays as it is (a completed sign-in replaces it). The return address takes form posts from any site (exempt from D4's rule) and even an empty form ends in `OnRemoteFailure`, so signing out there would let any site sign the visitor out, which D2 rules out for the handler's sign-out addresses (issue #33, finding 3).
- **A sign-in by an account not on the allowlist is logged as a warning, once, at sign-in** (the user, 2026-11-07, in propose):
  - **When:** the handler's `OnTokenValidated` event checks the allowlist. If the email is missing or not on the list, it logs `SignInRefused` at Warning. The sign-in itself still completes; the refusal happens per request, as above.
  - **What the line holds:** the account's pairwise subject (`sub`), an opaque ID that means something only to this app, so repeated attempts by the same account can be grouped. It never holds the email (D8).
  - **Not warned:** the per-request 403s, which would be every app open. ASP.NET's own "authorization failed" lines stay below the `Microsoft.AspNetCore` log level of Warning.
- **Rejected: refusing at sign-in with no cookie for strangers.** The email would then have to reach the page through the address bar or an extra cookie, and the per-request check is needed anyway for removed users.

### D4 — The cookies and the rule against writes from other sites

- **Cookies** (ADR-0003 § Decision, item 3, plus the prefix):

  | Cookie | Name | Attributes |
  |---|---|---|
  | Login | `__Host-session` | HttpOnly, Secure, Path `/`, no Domain, SameSite Lax; persistent (`IsPersistent`); 30 days, sliding |
  | The handler's correlation and nonce cookies during the round trip | prefix `__Host-signin-` | HttpOnly, Secure, Path `/` (the prefix requires it; the default is the callback path), SameSite None (Microsoft returns with a cross-site POST); 15 minutes (ASP.NET's default) |

  - **Why `__Host-`:** the browser accepts such a cookie only from our exact host, set without a Domain. No sibling app on `azurecontainerapps.io` can plant a session (signing the daughter in as someone else) or a correlation cookie.
  - **Sliding renewal:** ASP.NET renews the cookie on a request when more than half of its 30 days have passed. That's the scenario "Using the app keeps the login alive" (day 20 renews to day 50). A use in the first half renews nothing, so a login ends 15 to 30 days after its last use (signed in on day 0, used on day 14, ended on day 30). **Kept as is by the owner (2026-11-08):** the code review in issue #33 (finding 1) suggested renewing on every request (`OnCheckSlidingExpiration` setting `ShouldRenew`); ASP.NET's standard behaviour is good enough for this app, and the spec's requirement now says exactly that.
- **The rule** (the user: our own, app-wide; *(propose)*: our own code rather than calling .NET 11's `ICsrfProtection`, whose final shape moved late and whose enforcement the sources describe differently). It applies to every request whose method is POST, PUT, PATCH or DELETE to a path under `/api`:

  | Request | Result |
  |---|---|
  | path is the sign-in return `/api/auth/signin-oidc` | passed on. Microsoft's page posts it cross-site by design, and the handler's state, correlation cookie, nonce and PKCE protect it |
  | `Sec-Fetch-Site` or `Origin` sent more than once | refused, as ambiguous, even when the values agree; the rows below see each header sent at most once (part of the pure rule since issue #33, finding 12) |
  | `Sec-Fetch-Site: same-origin` or `none` | allowed |
  | `Sec-Fetch-Site` present with any other value (`same-site`, `cross-site`) | refused |
  | no `Sec-Fetch-Site`, `Origin` present | allowed only if `Origin` equals the request's own scheme and host (after forwarded headers, D10) |
  | neither header | allowed (not a browser, e.g. C9's Shortcut; such callers don't get our cookie automatically) |

  - **Refused means** 403 with a problem description `Forbidden`, written through `IProblemDetailsService`, and the request goes no further, so nothing changes.
  - **Placement:** after `UseAuthentication`, before the endpoints. The callback exemption is still explicit, so the rule doesn't depend on that order.
  - **.NET 11's built-in protection stays on.** It covers form posts too, and ours doesn't depend on it.
- **Rejected:**
  - **antiforgery tokens:** a token endpoint and a header on every write, for no extra protection in browsers that send fetch metadata (Safari has since 16.4);
  - **relying on SameSite alone:** it doesn't stop a sibling app on the same hosting domain.

### D5 — Waiting and offline screens stay in C7

- **Decision** (the user): C7 builds the waiting screen (normal and slow) and the offline screens, as ADR-0007 assigns them. Until then, C6 keeps the empty frame (the top bar without the account menu) while the first answer is pending or missing.
- **Heads-up for C7**, recorded in `pm/progress.md` at the close:
  - hook the waiting screen onto the app's first request, `GET /api/me`, whatever the sign-in state, so the sign-in path gets it too (the "Sign-in / Waiting" boards);
  - the server sleeps 5 minutes after the last request. If the sign-in screen stays open longer, tapping the button reaches a sleeping server and only the button's spinner shows for about 20 s, because a page can't show its own waiting screen while the browser leaves it. If that matters, the button can wake the server first (with the waiting screen) and then go to Microsoft.

### D6 — Test sign-in: a fake Microsoft in front of the real handlers

- **`Drivers/FakeMicrosoft`:** a WireMock.Net server per test, started before the app copy like `FakeBank`. It serves:
  - `GET <authority>/.well-known/openid-configuration`: the issuer string of the real personal-account service (`https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0`), with the authorize, token and keys endpoints on the fake server;
  - `GET /keys`: the public half of an RSA key generated once per test run;
  - `POST /token`: the ID token the driver set up for this sign-in, signed with that key. It carries `iss`, `aud` = the client id, `nonce`, `iat`/`exp`, `sub`, `oid`, `tid`, `name` and `email`.
- **Every app copy gets the sign-in settings:**
  - `SignIn:Authority` = the fake's address;
  - a made-up client id and secret;
  - the allowlist `lucie@example.com`, the only allowed test user.
- **In test code** (`ConfigureTestServices`, never a setting):
  - `RequireHttpsMetadata = false` for the fake's plain-HTTP address;
  - ephemeral Data Protection keys;
  - `FakeTimeProvider` as the app's `TimeProvider`, started at the real current time. The ID token's lifetime is checked against the real clock, so scenarios move the fake clock only after signing in.
- **`SignInDriver` walks the real round trip** with its own `HttpClient`: base address `https://localhost` (so `Secure` cookies flow; the test server takes the scheme from the address), no automatic redirects, cookies kept. It:
  1. gets `/api/auth/login`, reads `state`, `nonce`, `redirect_uri` and `prompt` from the redirect;
  2. programs the token answer;
  3. posts `code` and `state` to the return address as a browser would after Microsoft's page: `Sec-Fetch-Site: cross-site`, `Origin: https://login.microsoftonline.com`, `Content-Type: application/x-www-form-urlencoded`;
  4. follows the result to `/`.

  For the cancelled scenario it posts `error=access_denied`; for the work-directory scenario the token carries another issuer and tenant.
- **DSL** (as approved at the acceptance gate, 2026-11-08):
  - `Visitor` holds the identities: `Lucie` (allowed, "Lucie Nováková", `lucie@example.com`), a `Stranger` (`cizi.ucet@example.com`), and `WorkAccount`: Lucie's name and allowed address from a made-up work tenant, so only the issuer check can keep it out. There is no anonymous value: every test starts signed out;
  - steps say "is on / is not on the allowlist", "starts a sign-in", "Microsoft answers with", "signs in", "has signed in", "signs in to try another account", "cancels at Microsoft", "uses the app", "signs out", "asks who is signed in", "days pass", "another site sends sign-out";
  - the allowlist steps set nothing up, because the list is fixed when the app copy starts: they check the app copy's configured `SignIn:AllowedEmails` and throw when it differs from what the scenario states (software-factory lesson R-15: a DSL default differs from every value a scenario names);
  - "has signed in" signs in, then asks who is signed in and throws unless the API names the visitor, so a broken sign-in can't make a "signed out" scenario pass;
  - every answer is a domain record (`WhoAnswer`, `SignInStart`, `Landing`, `SignOutAnswer`); status codes and headers stay in the driver.
- **What runs as production code:** the handlers and their settings, the issuer check, the cookie names and lifetimes, the allowlist policy, the 401/403 problem descriptions, the forged-request rule, the forwarded headers. Only Microsoft's endpoints are faked.
- **testing.md § Test sign-in is updated:** the mechanics are a fake provider rather than an extra trusted key in the app's configuration. The principle "fake the signature, never the security code" is unchanged.

### D7 — The cookie's encryption keys: Blob Storage, encrypted by a Key Vault key

- **Production** (the user):
  - Data Protection persists its keys to the blob `dataprotection/keys.xml` in the new storage account (`PersistKeysToAzureBlobStorage`) and encrypts them with the key `dataprotection` in `kv-revolutreader` (`ProtectKeysWithAzureKeyVault`);
  - both are reached with the app's user-assigned identity (`ManagedIdentityCredential` with its client id);
  - the application name is pinned (`SetApplicationName("RevolutReader")`), so every revision reads the same keys.
- **Settings** *(propose)*: `DataProtection:KeysBlobUri`, `DataProtection:KeyVaultKeyUri` and `DataProtection:IdentityClientId` are empty in `appsettings.json` and set by Bicep in production.
  - All three empty: ASP.NET's default key folder (locally, your user profile). The harness replaces it with ephemeral keys.
  - All three set: Blob plus Key Vault.
  - Anything in between stops the app at start. The settings are read in the composition root, because the choice is made while registering services.
- **Roles for the app identity,** each on the one resource only: Storage Blob Data Contributor on the container, Key Vault Crypto User on the key. **Key Vault Crypto User is a sixth role** the deploy identity may not grant yet (the fifth was C12's Monitoring Metrics Publisher, merged before C6; 2026-11-08), so the owner widens its condition by hand before the merge (D11).
- **What it buys:** someone who reads the blob still can't forge login cookies without the key, which never leaves Key Vault.
- **What it costs:**
  - a handful of key operations a day (decrypt at start and about every 24 h; the keys are cached in memory);
  - one manual step;
  - one more Key Vault dependency at start: if the vault doesn't answer, sign-ins fail until it does.
- **Rejected:**
  - **Blob without encryption:** no manual step, but whoever reads the blob can forge cookies;
  - **keys stored as Key Vault secrets:** no built-in store; it would need our own code and secret-write access to the whole vault, including the Enable Banking key;
  - **Azurite locally:** Docker on every start for nothing C6 needs.

### D8 — The allowlist: one comma-separated secret

- **Setting** `SignIn:AllowedEmails` = `"<secret>"` in `appsettings.json`. The value comes from Key Vault `SignIn--AllowedEmails` in production and the AppHost parameter `signin-allowed-emails` locally.
- **Read as a list:** split on commas, entries trimmed, compared ignoring case.
- **Checked at start:**
  - at least one entry, no empty entry;
  - each entry has text, one `@`, text;
  - the value is not `"<secret>"`.

  A failure names the setting, never the addresses.
- **Never logged:** no email address appears in any log line. A refused sign-in is a warning without the email (D3).
- **The guard test** `SignInTelemetryTests` checks two things:
  - a stranger's sign-in logs exactly one `SignInRefused` warning, and no captured line contains the stranger's email;
  - an allowed user's sign-in logs no warning.
- **Rejected: an array setting** (`SignIn:AllowedEmails:0`, `:1`, …). .NET reads arrays as one key per entry, so from Key Vault each address would be its own secret and Bicep lines, and adding a person would mean a code change (the user).

### D9 — The generated API client

- **`openapi.json`** is written into `src/RevolutReader.Api/` by the explicit export check `OpenApiExport` (FastEndpoints.OpenApi; the build-time export failed at bootstrap, § Bootstrap item 2) and committed. It is never served by the running app: no `MapOpenApi()`, no new open address. A change that adds a setting checked at start gives the export check a made-up value for it.
- **The TypeScript types:** `tools/api-client/` holds its own `package.json` (openapi-typescript 7.13.0, TypeScript 5.9.3) and lock file. Its script `generate` writes `src/RevolutReader.Web/src/api/schema.d.ts`; `regenerate` runs the export check first, then `generate`. Both outputs are committed.
- **The generated file** is left out of Prettier and oxlint, whose rules it doesn't follow.
- **The client:** `src/RevolutReader.Web/src/api/client.ts` creates one openapi-fetch client on relative paths. `readSession()` and `signOut()` use it. `GET /api/auth/login` is a page navigation, not a fetch, so `startSignIn()` sets the location.
- **Drift checks in the existing CI jobs,** so there is no new required check and no ruleset change:
  - `build-and-test`, after `dotnet build`: the export check, then `git diff --exit-code -- src/RevolutReader.Api/openapi.json`;
  - `frontend`: `npm --prefix tools/api-client ci`, `npm --prefix tools/api-client run generate`, then `git diff --exit-code -- src/RevolutReader.Web/src/api/schema.d.ts`.
- **The contract in C6:**
  - `GET /api/me` → 200 `MeResponse { name, email }`, 401 and 403 problem descriptions;
  - `POST /api/auth/logout` → 204, 403 problem description;
  - `GET /api/auth/login` → 302.

### D10 — Behind the ingress: forwarded headers *(propose, from c005 design.md D5)*

- **What it does:** `UseForwardedHeaders` runs first and takes `X-Forwarded-Proto` and `X-Forwarded-For`, with the known proxies and networks cleared. The app is reachable only through the Container Apps ingress, so in production the header can come only from it (locally, the Vite dev server sends the same two, see below).
- **Effect:**
  - the OpenID Connect handler builds `https://<app host>/api/auth/signin-oidc`;
  - the forged-request rule compares `Origin` against the right scheme;
  - C7 gets the user's address for the bank's PSU header.
- **The host:** the ingress is expected to keep the original `Host` header. The first deploy confirms it, through the local and deployed sign-in checks. If it doesn't, `X-Forwarded-Host` is added, limited to the app's own address.
- **Locally,** Vite keeps the host (D2) and sends `X-Forwarded-Proto` and `X-Forwarded-For` as the ingress does (`xfwd`), so the return address takes the browser's https whichever API address Vite reaches (issue #33, finding 5: before, it depended on Vite reaching the API's HTTPS address).

### D11 — Settings, secrets and the owner's guided steps *(propose)*

- **`appsettings.json`**, each key with its provenance comment:
  - `SignIn:Authority` `https://login.microsoftonline.com/consumers/v2.0`;
  - `SignIn:ClientId` `7833ec21-abbc-493b-b764-8b74eb3bcaa0` (not confidential, already in docs/operations/entra-id.md);
  - `SignIn:ClientSecret` and `SignIn:AllowedEmails` as `"<secret>"`;
  - the three empty `DataProtection` settings.
- **Validation:** `SignInOptions` uses data annotations, `[NotSecretPlaceholder]` on the two secrets, `SignInOptionsValidator` for the allowlist, and `ValidateOnStart`.
- **AppHost:** the secret parameters `signin-client-secret` and `signin-allowed-emails` → `SignIn__ClientSecret`, `SignIn__AllowedEmails`.
- **Guided steps,** each a PowerShell 7 block shown first and run with the owner's go. A secret value never passes through Claude's output.
  - Claude runs a block when its permission check allows it. The owner runs anything it blocks (role assignments, as in C4) and anything that handles a secret value.

  | Step | Before | What it does |
  |---|---|---|
  | Redirect URIs | the local check | Graph `PATCH` on the registration: `https://localhost/api/auth/signin-oidc` replaces both old addresses; the production address is added |
  | Client secret (owner) | the local check | Graph `addPassword`, 12 months, display name `RevolutReader C6`; the returned text goes straight into Key Vault `SignIn--ClientSecret`, the AppHost's user-secrets and the backup vault (`RevolutReader--AppHost--Parameters--signin-client-secret`), never printed. The expiry date is recorded |
  | Allowlist (owner) | the local check | the owner types the addresses at a prompt; the value goes into Key Vault `SignIn--AllowedEmails`, the user-secrets and the backup vault, never printed |
  | Sixth role (owner) | the merge | azure-prerequisites.md step 5 again, with Key Vault Crypto User added to `$roles`; read back with its check |

  The production secrets must exist before the merge: a Key Vault reference to a missing secret stops the new revision.

### D12 — The screens and components *(propose, from the Screens design and the design system)*

- **Artboards implemented** (Screens design, read 2026-11-07, design system version `1793973462-31c9`):
  - "Sign-in / Start / Default" and its dark twin (the same screen through the dark tokens);
  - "Sign-in / Access denied / Default";
  - "Sign-in / Signed out / Default";
  - the top bar's account menu as the design system's AppShell describes it.

  **Not implemented here:** "Sign-in / Waiting" and "Waiting / Slow" (C7, D5), and every Account board (C7).
- **Layout:**
  - the three sign-in screens have no top bar, so the `app-shell` requirement is modified;
  - the app icon (`/app-icon.svg`, 64 px, card radius) and "Tarjeta Papá" in `text-title`, marked Spanish, centred;
  - the action block at the bottom above the home-indicator inset.
- **Components rebuilt in `src/components/`** with Tailwind on the existing tokens (no new token):
  - `Button`: primary and the ghost icon size the menu needs;
  - `Banner`: error tone, `role="alert"`;
  - `MicrosoftSignInButton`: 41 px, square, Microsoft's colours from `color-ms-*` light and dark, the logo file, a 44 pt hit area, `loading` while leaving;
  - `AccountMenu`: Radix `DropdownMenu`, `modal={false}`, trigger `circle-user-round` labelled "Účet a odhlášení", label "Přihlášený účet", name, email, a separator, the item "Odhlásit se" with `log-out`.

  `AccountMenu` is the first Radix component; Radix stays inside `src/components/` (the oxlint rule).
- **Screens in `src/screens/`:** `SignInScreen` (with a `signedOut` note), `NoAccessScreen`, and `AccountScreen` (the `AppShell` with the menu and an empty content area, which C7 fills).
- **Behaviour vs. the design system:** its MicrosoftSignInButton note says "onClick starts the MSAL redirect". ADR-0003 wins for behaviour: the click goes to the backend's login address. That's not a design change.

## Public API sketch

```csharp
// ---- src/RevolutReader.Api/SignIn/ ----

/// <summary>The SignIn section (D8, D11). Validated on start.</summary>
public sealed class SignInOptions {
  public const string SECTION = "SignIn";
  [Required] public required Uri Authority { get; init; }
  [Required] public required string ClientId { get; init; }
  [Required, NotSecretPlaceholder] public required string ClientSecret { get; init; }
  [Required, NotSecretPlaceholder] public required string AllowedEmails { get; init; }
}

/// <summary>The allowlist parses: at least one entry, none empty, each one address. Messages name the setting only.</summary>
public sealed class SignInOptionsValidator : IValidateOptions<SignInOptions>;

/// <summary>The parsed allowlist (D8).</summary>
public sealed class Allowlist {
  public static Allowlist Parse(string commaSeparated);   // trims; throws FormatException without the value
  public IReadOnlyList<string> Addresses { get; }         // the entries, trimmed, in the order written (slice 2's tests)
  public bool Allows(string? email);                      // ignoring case; null or empty → false
}

/// <summary>The AllowedUser policy's requirement and handler (D3).</summary>
public sealed class AllowedUserRequirement : IAuthorizationRequirement;
public sealed class AllowedUserHandler(Allowlist allowlist) : AuthorizationHandler<AllowedUserRequirement>;

/// <summary>Sign-in's log lines (D3, D8), source-generated: never an email address, a token or an exception message.</summary>
public static partial class SignInLog {
  [LoggerMessage(EventName = "SignInRefused", Level = LogLevel.Warning, Message = "Sign-in by an account that is not on the allowlist (subject {Subject}); its requests will be refused")]
  public static partial void SignInRefused(ILogger logger, string subject);
  [LoggerMessage(EventName = "SignInFailed", Level = LogLevel.Warning, Message = "Sign-in failed: {Kind}")]
  public static partial void SignInFailed(ILogger logger, string kind);
  [LoggerMessage(EventName = "SignInCancelled", Level = LogLevel.Information, Message = "Sign-in cancelled at Microsoft")]
  public static partial void SignInCancelled(ILogger logger);
}

/// <summary>Sign-in's fixed names (D2, D4).</summary>
public static class SignInAddresses { public const string LOGIN = "/api/auth/login"; public const string CALLBACK = "/api/auth/signin-oidc"; public const string LOGOUT = "/api/auth/logout"; }
public static class SignInCookies { public const string SESSION = "__Host-session"; public const string ROUND_TRIP_PREFIX = "__Host-signin-"; }

public static class SignInRegistration {
  /// <summary>
  /// Options and validation; the cookie scheme (default, challenge → 401, forbid → 403) and OpenID Connect (code flow,
  /// form_post, PKCE, consumers authority, MapInboundClaims off, name/email kept, events → "/"); the AllowedUser
  /// default and fallback policies; ProblemDetails' 403 email extension; TimeProvider.System if none registered.
  /// </summary>
  public static IServiceCollection AddSignIn(this IServiceCollection services);
  /// <summary>UseForwardedHeaders (first), then after UseAppPages: UseAuthentication, UseAuthorization (a refusal counts only when an endpoint matched, D3), UseCrossSiteWriteProtection.</summary>
  public static WebApplication UseSignIn(this WebApplication app);
}

/// <summary>GET /api/auth/login[?anotherAccount=true] — anonymous; challenges OpenID Connect, back to "/" (D2).</summary>
public sealed class LoginEndpoint : Endpoint<LoginRequest>;
public sealed record LoginRequest { public bool AnotherAccount { get; init; } }

/// <summary>POST /api/auth/logout — anonymous; signs out of the cookie scheme; 204 (D2).</summary>
public sealed class LogoutEndpoint : EndpointWithoutRequest;

/// <summary>GET /api/me — AllowedUser (default policy); exactly name and email (D3).</summary>
public sealed class MeEndpoint : EndpointWithoutRequest<MeResponse>;
public sealed record MeResponse(string Name, string Email);

// ---- src/RevolutReader.Api/Security/ ----

/// <summary>The rule against writes from other sites (D4), pure, so every row of its table is a unit test.</summary>
public static class CrossSiteWrites {
  public static bool IsAllowed(string method, PathString path, StringValues secFetchSite, StringValues origin, string requestOrigin);
}
/// <summary>Applies CrossSiteWrites; a refusal is a 403 problem description and ends the request.</summary>
public static WebApplication UseCrossSiteWriteProtection(this WebApplication app);

// ---- src/RevolutReader.Api/DataProtection/ ----

/// <summary>The DataProtection section (D7): all empty (default key store) or all set (Blob + Key Vault).</summary>
public sealed class DataProtectionKeysOptions { public Uri? KeysBlobUri { get; init; } public Uri? KeyVaultKeyUri { get; init; } public string? IdentityClientId { get; init; } }
// Uri? (not string?): the analyzer rule CA1056 asks for Uri on *Uri properties, and an empty appsettings value binds to null.
public static class DataProtectionKeysRegistration {
  /// <summary>Throws at registration when the settings are partly set; the message names the settings, not their values.</summary>
  public static IServiceCollection AddDataProtectionKeys(this IServiceCollection services, DataProtectionKeysOptions options);
}

// Program.cs order: UseForwardedHeaders → UseStatusCodePages → UseAppPages (fallback .AllowAnonymous()) →
// UseAuthentication → UseAuthorization (UnmatchedRequestsPass, D3) → UseCrossSiteWriteProtection → UseFastEndpoints.
```

```csharp
// ---- tests/RevolutReader.AcceptanceTests ----

// Drivers/FakeMicrosoft.cs — WireMock per test (D6); Configure(IWebHostBuilder) sets SignIn:* and the test services.
public sealed class FakeMicrosoft : IDisposable {
  public const string ALLOWED_EMAILS = "lucie@example.com";
  public static FakeMicrosoft Start();
  public Uri Address { get; }  public string ClientId { get; }  public string ClientSecret { get; }  public FakeTimeProvider Clock { get; }
  public void Configure(IWebHostBuilder builder);   // settings + RequireHttpsMetadata off (ConfigureAll) + ephemeral keys + Clock
  public void AnswerToken(IdentityAtMicrosoft identity, string nonce);
}
public sealed record IdentityAtMicrosoft(string Name, string Email, string Issuer, string TenantId) {
  public static IdentityAtMicrosoft PersonalAccount(string name, string email);
  public static IdentityAtMicrosoft WorkOrSchoolAccount(string name, string email);   // a made-up work tenant
}

// Drivers/SignInDriver.cs — its own HttpClient (https://localhost, no redirects, cookies kept).
public sealed class SignInDriver(HttpClient browser, FakeMicrosoft microsoft, IServiceProvider services) {
  public static WebApplicationFactoryClientOptions BrowserOptions { get; }
  public IReadOnlyList<string> AllowedEmails();                             // the app copy's configured SignIn:AllowedEmails
  public Task<SignInStart> StartSignIn(bool anotherAccount, string? forwardedProto = null, string? host = null);
  public Task<Landing> ReturnFromMicrosoft(IdentityAtMicrosoft identity);  // code + state, cross-site headers
  public Task<Landing> CancelAtMicrosoft();                                 // error=access_denied
  public Task<WhoAnswer> AskWhoIsSignedIn();
  public Task<SignOutAnswer> SignOut(string? fromSite = null);              // fromSite → Sec-Fetch-Site/Origin of another site
  public void Advance(TimeSpan time);                                       // the app's FakeTimeProvider
}

// Dsl/
public sealed record Visitor(string Name, string Email, bool FromWorkOrSchoolDirectory = false) { public static Visitor Lucie, Stranger, WorkAccount; }
public sealed record SignInStart(bool SentToMicrosoft, Uri? ReturnAddress, bool AccountPickerAsked);
public sealed record Landing(bool OnStartPage) { public static Landing StartPage, Elsewhere; }
public sealed record WhoAnswer(bool SignInAsked, bool Refused, string? RefusedEmail, string? Name, string? Email);  // exact shape checked by the driver
//   AskedToSignIn, SomethingElse, RefusedNaming(email), SignedInAs(name, email), SignedInAs(visitor)
public enum SignOutAnswer { SomethingElse, SignedOut, Refused }
public sealed class SignInDsl(SignInDriver driver) {   // AcceptanceTest.SignIn; written in full, calling only the driver
  public void IsOnTheAllowlist(string email);        // checks the configured list; throws if it doesn't hold the address
  public void IsNotOnTheAllowlist(string email);
  public Task<Landing> SignsIn(Visitor visitor);     // StartsSignIn, then MicrosoftAnswersWith
  public Task HasSignedIn(Visitor visitor);          // signs in; throws unless the API then names the visitor
  public Task<SignInStart> StartsSignIn();
  public Task<SignInStart> StartsSignInToTryAnotherAccount();
  public Task<SignInStart> StartsSignInBehindProxy(string host);
  public Task<Landing> MicrosoftAnswersWith(Visitor visitor);
  public Task<Landing> CancelsAtMicrosoft();
  public Task<WhoAnswer> AsksWhoIsSignedIn();
  public Task UsesTheApp();
  public Task<SignOutAnswer> SignsOut();
  public Task<SignOutAnswer> AnotherSiteSendsSignOut();
  public void DaysPass(int days);
}

// Conventions/SignInTelemetryTests.cs — a stranger's sign-in logs exactly one SignInRefused warning and no line containing
//   the email; an allowed user's sign-in logs no warning (D3, D8).
// Conventions/AnonymousEndpointsTests.cs — "open" now means IAllowAnonymous only (the fallback policy protects the rest);
//   the allowlist gains "GET /api/auth/login", "HEAD /api/auth/login" if FastEndpoints maps it, and "POST /api/auth/logout".
```

```ts
// ---- src/RevolutReader.Web/src ----
// api/client.ts:   export const api = createClient<paths>({ baseUrl: <the page's origin> });
// api/schema.d.ts: generated, committed (D9).
// app/session.ts:
export type Session =
  | { kind: "unknown" }                                   // pending, offline, 5xx → empty frame (D5)
  | { kind: "signed-out"; justSignedOut: boolean }
  | { kind: "refused"; email: string | null }
  | { kind: "signed-in"; name: string; email: string };
export function readSession(): Promise<Session>;          // GET /api/me → 401 / 403 (+ email) / 200
export function startSignIn(options?: { anotherAccount?: boolean }): void;   // location → /api/auth/login[?anotherAccount=true]
export function signOut(): Promise<void>;                  // POST /api/auth/logout
// components/: Button, Banner, MicrosoftSignInButton, AccountMenu; AppShell gains an optional account + onSignOut.
// screens/:    SignInScreen({ signedOut }), NoAccessScreen({ email }), AccountScreen({ name, email }).
// test/renderApp.tsx gains the server's answer to GET /api/me (test-writer).
```

## Rule ownership

| Rule (spec, ADR or convention) | Enforced by |
|---|---|
| Every API address requires an allowed, signed-in account; health and pages stay open | the `AllowedUser` default and fallback policies; `AllowAnonymous` on health, the page fallback, login and logout; guarded by `AnonymousEndpointsTests` |
| An unknown API address answers 404 to everyone, signed in or not, whatever the method (api-errors) | `ApiNotFound` (`/api/{**path}`, every method) and `UnmatchedRequestsPass`, the authorization result handler (D3); guarded by api-errors' two scenarios and app-delivery's |
| On the allowlist ignoring case; no email → not allowed | `Allowlist.Allows`, applied by `AllowedUserHandler` |
| The allowlist setting parses; no address in messages or logs | `SignInOptionsValidator`, `Allowlist.Parse`; guarded by `SignInTelemetryTests` |
| 401 for anonymous, 403 with the own email for strangers | cookie events (`OnRedirectToLogin`, `OnRedirectToAccessDenied`), `UseStatusCodePages`, `CustomizeProblemDetails` |
| `GET /api/me` answers exactly name and email | `MeEndpoint`, `MeResponse` (exact-shape check in the scenario's driver) |
| Personal accounts only | the consumers authority and the handler's issuer validation |
| A sign-in that doesn't complete lands on `/` without signing anyone in (a login from before stays); a cancel is Information, a failure a Warning | `OnAccessDenied`, `OnRemoteFailure`, `SignInLog` |
| A sign-in by an account not on the allowlist is one warning, with the subject and without the email | `OnTokenValidated` with `Allowlist`, `SignInLog.SignInRefused`; guarded by `SignInTelemetryTests` |
| Account picker for "try another account" | `LoginEndpoint` (`prompt=select_account`) |
| The return address is the app's own HTTPS address | `UseForwardedHeaders` (D10) and the OpenID Connect handler |
| 30 days, sliding, persistent | cookie options (`ExpireTimeSpan`, `SlidingExpiration`), `IsPersistent` at sign-in; the app's `TimeProvider` |
| `__Host-` names | `SignInCookies`, applied to the cookie and OpenID Connect options |
| Writes from other sites refused, the sign-in return exempt | `CrossSiteWrites`, applied by `UseCrossSiteWriteProtection` |
| Sign-out ends only our session | `LogoutEndpoint` signs out of the cookie scheme only |
| Cookie keys in Blob, encrypted by Key Vault, in production only | `DataProtectionKeysRegistration` |
| The screen follows the first answer | `readSession` and `App` |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected outcomes (answers) | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `GET /api/me` | `MeResponse` | 401, 403 (+ `email`) as problem descriptions, produced by the authentication and authorization layer | none expected; anything else is a 500 |
| `GET /api/auth/login` | 302 to Microsoft | — | discovery unreachable → the handler throws, 500 |
| `POST /api/auth/signin-oidc` | 302 to `/`, signed in | cancelled or failed → 302 to `/`, nobody signed in, a login from before left as it is (`OnAccessDenied`, `OnRemoteFailure`) | — |
| `POST /api/auth/logout` | 204 | 403 when refused by the forged-request rule | — |
| Any write under `/api` | — | 403 problem when refused by the forged-request rule | — |
| App start | — | — | `OptionsValidationException` (`SignIn`), or the Data Protection registration's exception for partly set `DataProtection` settings; messages name settings, never values |

- **No new Result union:** sign-in has no handler returning expected failures. Its outcomes are produced by ASP.NET's authentication and authorization layer and mapped once (D3).
- **README.md's case → status table** gains 401 and 403 (docs/conventions/README.md § Backend code).

## Ports and contracts

None new. Microsoft's service is an external system reached by ASP.NET's own OpenID Connect handler. It is faked at the HTTP level in tests (D6), so there is no port of ours, no in-memory fake and no `[integration]` group. Data Protection's Blob and Key Vault stores are Microsoft's adapters, used only in production and checked by the deploy (§ Migration plan).

## How each scenario is verified

| Scenarios | Level | Why |
|---|---|---|
| `sign-in`: the 11 API scenarios, from "An anonymous visitor is asked to sign in" through "A write request from another site is refused" | API acceptance tests in `Scenarios/SignIn/SignInScenarios.cs`, against the fake Microsoft (D6) | the default level; everything they assert is an answer of the API |
| `sign-in`: "The sign-in screen shows when nobody is signed in", "Tapping the sign-in button starts the Microsoft sign-in", "A refused account sees that it has no access", "Trying another account signs out and starts a new sign-in", "Signing out from the account menu shows the signed-out screen" | frontend tests in `src/scenarios/sign-in.test.tsx` | what the screen shows and where a tap goes only the page can show; the server's answers are stubbed |
| `api-errors`: "A write to an unknown API address answers with a problem description" (added to the modified requirement after slice 1's review) | API acceptance test in `Scenarios/ApiErrors/ApiErrorsScenarios.cs` | an answer of the API, like the existing GET scenario |
| `app-shell`: "The top bar shows the app name" (modified), "The account menu shows who is signed in" | frontend tests in `src/scenarios/app-shell.test.tsx` | as above |
| `sign-in`: "Signing in from the Home Screen app opens the app", "The Home Screen app stays signed in after it is closed" | manual, rows in `tests/manual-scenarios.md`, checked right after the merge deploys and again at M5 | Microsoft's real pages and the iPhone's Home Screen app (its own cookie jar, ADR-0003) cannot run in a test |

## Cross-cutting effects

- **API contract / TS client:** the first committed `openapi.json` and `schema.d.ts`, regenerated in the slices that change endpoints (D9).
- **Bicep:**
  - `platform.bicep`:
    - the storage account (`StorageV2`, `Standard_LRS`, shared keys off, no public blob access, TLS 1.2, public network on and guarded by roles) with the private container `dataprotection`;
    - the RSA key `dataprotection` in `kv-revolutreader` (wrap/unwrap);
    - the app identity's Storage Blob Data Contributor on the container and Key Vault Crypto User on the key;
    - outputs: the blob address, the key's versionless address, the identity's client id.
  - `main.bicep` passes them on.
  - `features.bicep` § Sign-in: two Key Vault-backed secrets (`SignIn--ClientSecret`, `SignIn--AllowedEmails`) and five environment variables.
- **AppHost:** two secret parameters; Vite over HTTPS (D2). No Bicep counterpart for Vite.
- **Settings:** `SignIn` and `DataProtection` sections (D11).
- **ADRs, each a dated amendment:**
  - ADR-0003:
    - the addresses, landing on `/` and local-only sign-out with the account picker;
    - the cookie names and SameSite;
    - the forged-request rule (closing "C6 chooses the mechanism");
    - 403 with the own email;
    - the test mechanics;
  - ADR-0004: the list format, no email in logs, no email claim means refused;
  - ADR-0006 item 2: the keys encrypted by a Key Vault key, the sixth role.
- **Conventions:**
  - README.md:
    - § Backend code: the 401 and 403 rows; secure by default now means the `AllowedUser` fallback policy; the forged-request rule for writes;
    - § API contract: the tools folder and its commands;
  - configuration.md: § Hand-provisioned secrets (two rows), § Local development (two parameters), the `DataProtection` settings as production-only;
  - testing.md § Test sign-in and § Acceptance-test harness (the fake Microsoft, the clock, the HTTPS client);
  - workflow.md § 5: the storage account, the key, the sixth role;
  - the `.claude/rules/` mirrors of the files changed.
- **Operations:**
  - `entra-id.md`: redirect URIs, the client secret and its expiry, the consent screen seen on the iPhone;
  - `azure-prerequisites.md`: the sixth role and step 5's command;
  - `expiring-approvals.md`: the client secret, 12 months;
  - `local-secrets.md`: two parameters with their backup names;
  - `deployment.md`: the sign-in secrets and the keys blob in the deployed-resources list and checks;
  - `tests/manual-scenarios.md`: two rows.
- **CI:** two drift steps (D9). No new job, so no ruleset change.
- **Design:** read only; no design change needed (D12).
- **Software factory** (the next free numbers when written; R-52 was the last on 2026-11-07):
  - *(New)* a shared hosting domain missing from the Public Suffix List makes every tenant the same site: `__Host-` cookies and a same-origin rule for every write;
  - *(New)* .NET 11's built-in CSRF protection is described as enforced where forms are read; cookie-authenticated JSON or body-less writes need their own check;
  - *(New)* Data Protection keys for a scale-to-zero app: Blob plus a Key Vault key, and the grantable-role list that grows with it;
  - R-24 gains the test mechanics for a BFF code-flow sign-in (a fake provider: discovery, keys, token);
  - inventory lines: `FakeMicrosoft`, the cross-site write rule, `tools/api-client/` with its drift checks.

## Risks / Trade-offs

- **[Sign-in fails in the iPhone Home Screen app]** (ADR-0003) → checked right after the merge (D1); the fallbacks are a follow-up change.
- **[.NET 11's built-in CSRF check rejects Microsoft's cross-site return POST]** (its enforcement is described differently; a .NET issue reports a 400 on login/logout) → the acceptance driver posts with real cross-site headers, so a rejection shows up red in the first sign-in slice. Fallbacks, in order: exempt the return path from the built-in check, or switch to `response_mode=query` (a GET, which no CSRF check touches; the one-time, PKCE-bound code then appears in the address).
- **[The ingress doesn't keep the `Host` header]** → the deployed sign-in sends Microsoft the wrong return address, and Microsoft rejects it (unregistered). The deployed check after the merge shows it; `X-Forwarded-Host` limited to the app's address fixes it (D10).
- **[Build-time OpenAPI export doesn't work with FastEndpoints 9 beta or the start-up checks]** → happened at bootstrap (the start-up checks); the in-process export check is used instead (§ Bootstrap, item 2). Its remaining risk: a setting checked at start that the export check lacks fails `regenerate` and the CI drift step, with the validation message naming the setting.
- **[Aspire doesn't serve Vite over HTTPS by itself]** → `WithHttpsDeveloperCertificate()` (experimental). If the certificate isn't trusted, `dotnet dev-certs https --trust` (the owner).
- **[The cookie handler doesn't take the app's `TimeProvider`]** → the 30-day scenarios fail in their slice; the app then sets the handler's `TimeProvider` explicitly from the registered one.
- **[The sixth role is missing at merge]** → the deploy fails at the role assignment and the old revision keeps running. The guided step comes before the merge, with a read-back (D11).
- **[Key Vault is unreachable at start or at the daily refresh]** → sign-ins and cookie reads fail until it answers. Accepted: the app already depends on Key Vault for its secrets.
- **[Someone deletes the storage account or the key through a Bicep change]** → everyone is signed out once (no data is lost; the keys are recreated). Accepted, as for Key Vault (docs/conventions/workflow.md § 5).
- **[The client secret expires in 12 months]** → listed in `expiring-approvals.md`; the operation ends long before.
- **[A changed email address locks its owner out]** (ADR-0004) → update the list and restart.
- **[17 scenario slices make a long `/tdd-apply`]** → several of them close only, because earlier slices already turned them green (tasks.md).

## Migration plan

1. **Before `/tdd-apply`:** the bootstrap (`[setup]`).
2. **During it:** the guided steps before the local check (redirect URIs, client secret, allowlist), then the local check in a browser with `aspire start`:
   - sign in with the owner's account and see the account menu;
   - sign out;
   - sign in with the second personal account and see the no-access screen;
   - "Zkusit jiný účet" opens the account picker.
3. **Before the merge:** the sixth role (owner), the Bicep lint and preview (docs/operations/deployment.md), and the archive in the same PR, as C5 did.
4. **After the merge:**
   - the deploy runs: the new revision starts, the keys blob appears, the app's log shows no Data Protection or sign-in error;
   - sign in at the production address in a desktop browser, then the two iPhone manual scenarios;
   - their dates go into `tests/manual-scenarios.md`, and the consent screen as seen into `entra-id.md`, through a small follow-up docs PR, as C4 did.
5. **Rollback:** revert the merge. Sign-in disappears, and the storage account and key are deleted by the stack. The Entra and Key Vault values stay and do no harm.

## Open questions

- **Exactly what Microsoft's consent screen shows a personal account on the iPhone:** recorded at the iPhone check (docs/operations/entra-id.md, M4's follow-up). It changes nothing in the code.
