# ADR-0003: Sign-in — the backend signs users in and keeps a login cookie (BFF)

**Status:** Accepted (the user's decision, 2026-11-05); amended 2026-11-05 in M4: the client secret is created in C6, not M4 (Decision, item 4); amended 2026-11-08 in C6: the addresses, landing on `/`, local-only sign-out and the cookie names (Decision, item 6) · **Date:** 2026-11-05 · **Roadmap:** F0-2; applied in M4, C3, C6, M5 · **Questions:** Q2; Q9 (finding)

> Findings verified on 2026-11-05 against the sources linked with each one.

## Context

- **What sign-in must do:** use Microsoft Entra ID with personal Microsoft accounts and let in only pre-approved accounts. The daughter must not face any extra steps (kickoff ch. 4). The frontend and the API share one origin ([ADR-0002-frontend-hosting](0002-frontend-hosting.md)).

### The main user's phone (Q9)

- The daughter has an **iPhone 13 Pro**, probably on the current iOS. The exact version gets confirmed at handover (M5). The owner has an iPhone for testing (the user, 2026-11-05).
- The iPhone 13 Pro supports iOS 26 ([9to5Mac](https://9to5mac.com/2025/07/24/ios-26-supports-these-recent-iphones-but-drops-three-models/), 2025-07-24).
- **On iOS, Web Push works only in a web app added to the Home Screen, iOS 16.4 or later** ([WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), 2023-02-16). So the daughter uses the app from the Home Screen, and sign-in must work there.

### Sign-in in an iOS Home Screen app

- **Cookies:** Home Screen web apps have "separate cookies and storage from the browser" ([WWDC23: What's new in web apps](https://developer.apple.com/videos/play/wwdc2023/10120/)). Copying Safari's cookies when the app is created is described only for web apps on the Mac.
- **Links outside the app:** in Home Screen web apps on iOS, they "open in Safari View Controller", a Safari sheet over the app (same source). Apple says `window.open` keeps an OAuth flow inside the web app, but only in the macOS part of the talk.
- **Failing sign-ins:** developer reports from 2026, one mentioning iOS 26, describe OpenID Connect sign-ins failing in Home Screen apps. The state cookie set before the redirect was missing when the redirect came back ([FlashCardApp #19](https://github.com/Naijei1/FlashCardApp/pull/19), [wynteam #663](https://github.com/warren-wyn-dev/wynteam/pull/663), [bulwarkmail #1267](https://github.com/bulwarkmail/webmail/issues/1267)). No authoritative source settles it.
- **Cookies without an expiry date:** a WebKit bug reset them at random in Home Screen apps on iOS 17.2–17.5, and it was still reported on 18.1 ([WebKit bug 272325](https://bugs.webkit.org/show_bug.cgi?id=272325)).

### Tokens in the browser (single-page app)

- **Refresh tokens:** those issued to a single-page app last 24 hours, and renewing does not extend them. After that the app must run the sign-in again in a top-level redirect or popup ([Microsoft Learn: refresh tokens](https://learn.microsoft.com/entra/identity-platform/refresh-tokens)).
- **Silent renewal:** done in a hidden frame, it is blocked by Safari's third-party cookie blocking ([Microsoft Learn: third-party cookies and SPAs](https://learn.microsoft.com/entra/identity-platform/reference-third-party-cookies-spas)).
- **MSAL.js** (`@azure/msal-browser` 5.27.0):
  - it needs a redirect bridge page that does not send the COOP header;
  - Microsoft says its `navigatePopups` setting "can be set to false for … progressive web apps" ([MSAL v4 migration notes](https://learn.microsoft.com/entra/msal/javascript/browser/v4-migration)).

### Credentials for a server-side sign-in

- **Something to redeem the code:** a web app needs a client secret or a client assertion ([Microsoft Learn: auth code flow](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow)).
- **Client secret** ([Microsoft Learn: add credentials](https://learn.microsoft.com/entra/identity-platform/how-to-add-credentials)):
  - at most 24 months; Microsoft recommends under 12 and says secrets "should not be used in production";
  - an app that accepts personal accounts can have at most two ([supported-accounts validation](https://learn.microsoft.com/entra/identity-platform/supported-accounts-validation));
  - a certificate is Microsoft's recommended credential.
- **Managed identity as a federated credential:** this needs a user-assigned identity in the app's tenant ([Microsoft Learn](https://learn.microsoft.com/entra/workload-id/workload-identity-federation-config-app-trust-managed-identity)). Whether it works for an app that accepts personal accounts is not documented.
- **Signing in with the ID token only** (`response_type=id_token`, `form_post`) needs no credential. Microsoft calls it the implicit grant and says to use it only "when other more secure flows aren't viable" ([Microsoft Learn: OpenID Connect](https://learn.microsoft.com/entra/identity-platform/v2-protocols-oidc), [implicit grant](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-implicit-grant-flow)).
- **Microsoft.Identity.Web 4.17.0** (2026-11-04) targets .NET versions up to net10.0. Support for .NET 11 sits in open pull requests, and a stable release is planned shortly after .NET 11 ships on 2026-11-10 ([NuGet](https://www.nuget.org/packages/Microsoft.Identity.Web), [PR #4068](https://github.com/AzureAD/microsoft-identity-web/pull/4068)).

## Decision

Decided by the user, 2026-11-05:

1. **The backend signs the user in.** It uses the authorization code flow through ASP.NET Core's own OpenID Connect handler, then its cookie handler. Microsoft.Identity.Web is not needed for sign-in only.
2. **The browser never holds a Microsoft token, and the frontend has no sign-in library.** It calls `/api`. When the answer is 401, it shows a link to the backend's login endpoint.
3. **The login cookie:**
   - HttpOnly and Secure, scoped to the app's own site;
   - **persistent with an expiry date** (because of the WebKit bug above);
   - **30 days, renewed while the app is used.**
4. **The credential is a client secret valid for 12 months.** C6 creates it in its guided task, straight into Key Vault and the AppHost's user-secrets, so it never sits in a file and its 12 months start when it is first needed. It is listed with the expiring approvals. *(Amended by the user, 2026-11-05, in M4: originally M4 created it and kept it on the owner's machine until Key Vault existed.)*
5. **Sign-in from the Home Screen app is tested on a real iPhone** (the owner's) on the deployed app in C6, before the handover (M5).
6. **The addresses and the cookies** *(amended in C6, 2026-11-08, with the user in explore; c007 design.md D2, D4)*:
   - every sign-in address sits under `/api/auth/`, which the page fallback, the service worker and the local Vite proxy already leave to the server: `GET /api/auth/login` starts the sign-in, `POST /api/auth/signin-oidc` is Microsoft's return (`response_mode=form_post`), `POST /api/auth/logout` ends the session;
   - after sign-in the visitor always lands on `/`. There is no return-address parameter, so there is no open redirect to guard;
   - sign-out ends only this app's session, never the Microsoft account's. "Try another account" therefore asks Microsoft for its account picker (`prompt=select_account`), or Microsoft would sign the same account in again silently;
   - the login cookie is `__Host-session` (SameSite Lax, Path `/`, no Domain); the handler's round-trip cookies use the prefix `__Host-signin-` (Path `/`, SameSite None, because Microsoft returns with a cross-site POST). The `__Host-` prefix makes the browser accept them only from the app's exact host, so no other app on the shared hosting domain can plant a session.

## Alternatives considered

- **Single-page app with MSAL and a bearer token.** It's the standard for single-page apps and needs no secret. It lost on the iPhone:
  - the refresh token's 24-hour limit would push the daughter through the redirect every day, and that redirect is exactly the uncertain part in a Home Screen app;
  - the token would be readable by JavaScript;
  - MSAL's bridge page and its PWA settings would also have to be right.

  DoseUp chose this (a public client with PKCE and a JWT bearer).
- **BFF with the ID token only, no credential.** Nothing to store or renew, but it is the flow Microsoft discourages. The code differs only in the requested response type, so the switch stays open if the secret becomes a burden.
- **A certificate or a managed identity instead of the secret.** They are Microsoft's preferred credentials. But they take more setup, and the managed identity is unconfirmed for personal-account apps. Not worth it for about two months.

## Consequences

- **M4:** register the app with the web platform's redirect URIs (local, and production once C4 gives the URL).
- **C6:**
  - a guided task creates the 12-month client secret straight into Key Vault and the AppHost's user-secrets, and adds it to [expiring-approvals.md](../operations/expiring-approvals.md);
  - the OpenID Connect and cookie handlers, the login and logout endpoints, and the allowlist check (Q1);
  - the manual check on the owner's iPhone, signing in from the Home Screen app;
  - if that fails, fall back in this order: open the sign-in via `window.open`, then hand the session to the app with a one-time code.
- **The cookie's encryption keys (ASP.NET Core Data Protection) persist in Blob Storage.** The app scales to zero, so without that every wake would sign everyone out ([ADR-0006-hosting-registry-and-job § Decision](0006-hosting-registry-and-job.md#decision), item 2; C6).
- **C3:** no sign-in library; a 401 shows the sign-in link.
- **Write requests authenticated by the cookie need CSRF protection:** the last view in C7 and the push subscription in C8. C6 chooses the mechanism.
- **Tests:** a fake Microsoft (discovery, keys, token endpoint) in front of the real handlers, walked by a test browser, so the whole sign-in runs production code ([testing.md § Test sign-in](../conventions/testing.md#test-sign-in-fake-the-signature-never-the-security-code); C6 replaced the earlier plan of a harness-made cookie).
- **Push on iOS** needs the Home Screen app (Q9). C8 subscribes from it, and the handovers (M5, M7) install it and confirm the iOS version.
- **Software factory:** this diverges from DoseUp ([lessons.md R-24](../software-factory/lessons.md)).
