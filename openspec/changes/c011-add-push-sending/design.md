# Design: c011-add-push-sending

## TL;DR

- **Lib.Net.Http.WebPush 3.3.1** encrypts (aes128gcm) and signs (`vapid`), on our own `HttpClient` with no retries; the tests decrypt with their own code (D1).
- **Every push is a Declarative Web Push message** (title, text, a page of the app), kept 24 hours and urgent (D2). **Only allowlisted accounts get pushes,** checked on every send; gone devices (404, 410) are deleted, other failures counted and kept, nothing retried (D3). **Logs:** counts and outcomes only (D4).
- **The keys** (D5): a VAPID pair and a message key, made by one PowerShell block the owner runs, in Key Vault and the user-secrets; the app refuses to start without a valid pair. The token's contact, and the base of every page a tap opens, is the app's own address.
- **Three endpoints for the app** (D9): the key, register a device, forget a device; push addresses only at Apple's, Google's, Mozilla's and Microsoft's push services. **The message endpoint** `POST /api/push/messages` (D10): the message key in `X-Message-Key`, checked before the body is read; without it the answer is the unknown address's 404; hidden from the API description.
- **One table `pushdevices`,** one partition, a row per device keyed by the SHA-256 of its push address, read whole when sending (D11). Bicep adds the table and the three Key Vault references; C7b's account-wide table role covers it (D12).
- **The shared frontend pieces** for C8b and C8c: a push module and test stand-ins, unit-tested, no screen (D8). **18 scenarios,** all API acceptance tests (D14). **ADR-0010-web-push** for the cross-cutting part (D15).
- **New public interfaces:** `GET /api/push/key`, `PUT` and `DELETE /api/push/subscription`, `POST /api/push/messages`; `SendPushHandler` (C9 sends through it), `RegisterDeviceHandler`, `ForgetDeviceHandler`; the ports `IPushDeviceStore` and `IPushDelivery` with their adapters; `PushOptions`; DSL `PushDsl`, drivers `PushDriver`, `FakePushService`, `TestDevice`; frontend `src/app/push.ts` and `src/test/push.ts`.
- **Integration points:** the push services of Apple, Google, Mozilla and Microsoft; the app's storage account (a new table); Key Vault (three secrets); the allowlist (C6); the AppHost's user-secrets; the regenerated TS client.
- **Hard to reverse:** the table's keys; the setting and secret names (the owner's guided block writes them); the endpoint and field names C8b, C8c and C9 build on; the message key's header.

## Context

- See proposal.md § Why. Every decision below was made with the owner in C8's explore (2026-11-08/09) and handed over in #51's comments: the shared [S1–S12](https://github.com/jakubbohm/RevolutReader/issues/51#issuecomment-6728682809) and C8a's [A1–A8](https://github.com/jakubbohm/RevolutReader/issues/51#issuecomment-6728684372). This design copies each one it uses (citing its label) and is their home from now on. Details settled while writing it are marked *(propose)*; A6 left them to propose.
- **What merged before** (S1), read 2026-11-09: c009 (C7a) and c010 (C7b) archived design.md, and `main` at `a30141f`. Nothing contradicts S1–S12 or A1–A8, so no explore was needed. What this change builds on:
  - **Storage (C7b):** `Storage/StorageRegistration.AddTransactionStore` checks `ConnectionStrings:tables` at registration, registers Aspire's tables client (`AddAzureTableServiceClient("tables")`, health checks off) and `TableTransactionStore` (one partition, a SHA-256 row key, the table created once per process). The app's identity holds Storage Table Data Contributor on the whole storage account (`infra/platform.bicep:211-225`), chosen in c010 D11 so that C8a's table needs no new role. Tests: one Azurite per test session (`Drivers/AzuriteStorage`), a table of each app copy's own, the store's contract tests on the fake and on Azurite.
  - **Sign-in (C6):** the `AllowedUser` default and fallback policy on every `/api` address; the parsed `Allowlist` singleton (`Allows(email)`, whole addresses ignoring case); the signed-in email from `JwtRegisteredClaimNames.Email` (`MeEndpoint`); the cross-site rule on every write under `/api`, which lets a request with neither `Sec-Fetch-Site` nor `Origin` through (`CrossSiteWrites.cs:63-71`).
  - **Errors:** an unknown `/api` address answers through the anonymous catch-all `ApiNotFound`, which sets 404 and writes nothing, so `UseStatusCodePages` fills in the problem description; a wrong method on a real address answers the same 404 (README.md § Backend code). FastEndpoints' validation 400 is a problem description titled `Bad Request` with `errors` (guarded by `Conventions/OlderTransactionsRequestTests`). `UseExceptionHandler` answers 500 (C7a).
  - **Settings:** `[NotSecretPlaceholder]` on every secret; an `IValidateOptions<T>` for what annotations cannot check (`EnableBankingOptionsValidator`: plain http only on a loopback host; a key's messages never quote it). The OpenAPI export check and the CI image smoke run start the app with made-up values for every setting checked at start.
  - **Frontend:** `askTheApi` (`api/client.ts`) turns offline, 401, 403 and a non-JSON success into kinds every read shares; the test kit's fake server (`src/test/server.ts`) answers by address, the last answer repeating.
- **The deploy identity's condition** lists Key Vault Secrets Officer as grantable "(C8, the push subscription)" (`docs/operations/azure-prerequisites.md` step 5). This design does not need it (A3; D16).

## Goals / Non-Goals

**Goals:**

- The 18 scenarios of the two new specs, each an API acceptance test (§ How each scenario is verified).
- A sender C9 can call as it is: allowlist, gone devices and logging inside it, not in the endpoint.
- The frontend pieces C8b and C8c both need, so neither waits for the other (S10).

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- **No in-memory fake of the push services:** the sender's unit tests use a hand-written stub of `IPushDelivery`; the adapter runs against the WireMock fake push service in the acceptance tests and its edge cases in `IntegrationTests/Wiring/WebPush/`.
- **No queue and no background sending:** a message is sent while the request waits, to a handful of devices at once.
- **No rate limit on the message endpoint:** its key has 256 bits and is compared in constant time.

## Decisions

### D1 — The sending library: Lib.Net.Http.WebPush 3.3.1 (S2)

- **Chosen** (the owner): [Lib.Net.Http.WebPush](https://www.nuget.org/packages/Lib.Net.Http.WebPush) 3.3.1, MIT, released 2025-03-09; repository active (last push 2026-01-04, read 2026-11-08).
  - Encrypts with `aes128gcm` (RFC 8291, `Aes128GcmEncodedContent`) and signs with the RFC 8292 header `vapid t=…, k=…` (`PushServiceClient.DefaultAuthenticationScheme = VapidAuthenticationScheme.Vapid`), read in its [source](https://github.com/tpeczek/Lib.Net.Http.WebPush/blob/HEAD/src/Lib.Net.Http.WebPush/PushServiceClient.cs).
  - Takes our own `HttpClient` (`new PushServiceClient(HttpClient)`), registered like the project's other clients, with no retry handler (README.md § Backend code), so tests reach the fake push service.
  - Reports a failed send as `PushServiceClientException` with its `StatusCode`, which gives 404 and 410 (gone, D3).
  - On .NET 6 and later it depends only on the same author's Lib.Net.Http.EncryptedContentEncoding 2.1.1 and uses .NET's own cryptography; Portable.BouncyCastle is a dependency of its .NET Framework and netstandard2.0 builds only (the package's metadata, and no BouncyCastle assembly loaded on net11.0: the bootstrap's probe, 2026-11-09). No known vulnerability (`dotnet list package --vulnerable --include-transitive`, 2026-11-09). The build runs with `TreatWarningsAsErrors`, so a vulnerability published later turns it red; the escape route is the own implementation below.
  - **Its retries are switched off** (bootstrap's probe): by default (`AutoRetryAfter = true`, `MaxRetriesAfter = 0`) it retries a 429 after its `Retry-After` with no limit, and `HttpClient.Timeout` does not end the loop. `WebPushDelivery` sets `AutoRetryAfter = false`, so a 429 is one request and counts as failed (D3).
- **Not chosen:**
  - [WebPush](https://www.nuget.org/packages/WebPush) 1.0.13 (MPL-2.0, 2026-04-28): its assembly sends only the older draft encryption `aesgcm` with the `WebPush` / `Crypto-Key: p256ecdsa=` header (strings read from the DLL, 2026-11-08), and its README marks Safari unsupported.
  - Our own code on .NET's cryptography (ECDH P-256, HKDF, AES-GCM, ES256; about 150–200 lines, provable against RFC 8291's worked example): no third-party cryptography, about half a day more. The owner chose speed.
  - Azure Notification Hubs (asked by the owner): [Microsoft Learn](https://learn.microsoft.com/en-us/azure/notification-hubs/browser-push) (updated 2026-03-04) says "Apple Safari isn't included" and lists iOS as not supported; it would also add a namespace, a hub and a connection-string secret, and still need VAPID keys.
- **The tests decrypt independently** (D7): their own RFC 8291 decryption on .NET's cryptography, never the library's decoder, so the library never checks itself.
- The library's exact type and member names were confirmed by the bootstrap's probe (2026-11-09) and are in § Public API sketch (`WebPushDelivery`). Two more facts from it: the token's `aud` is the push address's scheme and host **without its port** (the same as the origin for the real push services, all on 443), and every request gets a newly signed token (no token cache unless one is set).

### D2 — Every push is a Declarative Web Push message (S3)

- **The format** ([Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), WebKit, iOS 18.4 and later; re-read 2026-11-09): `"web_push": 8030`, and a `notification` with a non-empty `title` and `navigate`, both required, and the text as `body`. Safari shows it itself, even when the service worker does not run, and a declarative push always shows something, so Safari's revocation of sites whose pushes show nothing cannot hit us. The daughter's iPhone 13 Pro runs iOS 26.
  ```text
  {"web_push":8030,"notification":{"title":"Ahoj","body":"Zkušební zpráva","navigate":"https://<the app's address>/"}}
  ```
  *(propose)* `body` is left out when the message has no text; nothing else is added.
- **The service worker** still gets the push event and may replace the notification. Ours (C8b) leaves Safari's notification as it is and shows the same JSON itself on browsers that do not read the format (Chrome on a computer). C9 hooks into the same handler to store the balance, and must never touch the stored balance for a message that carries none (ADR-0007).
- **`navigate` is always a page of the app itself,** never another site. *(propose)* The server builds it: the app's own address (`Push:Subject`, D5) with the message's page, a path that starts with a single `/` and lies outside `/api` (a page the app serves, `PagesExtensions`). The page defaults to `/` (the account screen).
- **Never `app_badge`** (the design system: "no badges counting anything").
- **Lifetime and urgency:** every push waits up to **24 hours** at the push service when the device is offline (`TTL: 86400`) and is sent as **urgent** (`Urgency: high`). C9 sets its own values for its notifications; *(propose)* the delivery port takes both with each push, and the sender passes these two for every message today.
- *(propose)* **Size:** the JSON's UTF-8 bytes may be at most **3993**, the plaintext a push service must accept: RFC 8291 § 4, 4096 octets of body less the 86-octet header, at least one octet of padding and the 16-octet tag (read 2026-11-09). A longer message is refused (D10) rather than cut, because a cut text would read as complete. The library checks no size (bootstrap's probe: 3993 bytes give exactly 4096 octets of body; longer content is sent anyway, from 4080 bytes in two records), so this check is the only one.

### D3 — Who gets a push (S4)

- **One record per device,** keyed by its push address, under the account that was signed in when the device last registered it. A message to an account goes to all its devices, at once (in parallel), each once.
- **Only accounts on the allowlist get pushes,** checked by the sender itself (`SendPushHandler`) on every send, so C9's notifications follow the same rule. A message to an account not on the list is refused, and the devices still registered under it are deleted. *(propose)* Accounts are compared as the allowlist compares them: whole addresses, ignoring case.
- **A device the push service reports gone** (404 or 410) is deleted at once and counted as removed.
- **Any other failure** (another status such as 429, 413 or a 5xx; no answer within the timeout; no connection) is counted as failed and the device kept. **No retries:** the caller can send again, and C9 decides for its own notifications.
- **The answer** counts the devices reached, failed and removed. An allowed account with no devices gets three zeros, not an error.

### D4 — Logs (S5)

- Counts and outcomes only. Never the message text (C9's will hold amounts; the owner's are private), never a device's keys, never an email address. The app's own lines never name a device's push address either.
- **The push client's own request logging and traces keep the push address** (the owner, 2026-11-09, after a review finding): like every outgoing client except the bank's, the push client keeps the framework's request lines (Information, with the request's URL) and its exported HTTP-client traces (`url.full`), so a device's push address, the push service's address with the device's token in its path, reaches Application Insights. Accepted: Application Insights is the project's private telemetry, and a push address alone cannot deliver a push (that also takes the VAPID private key and the device's own two keys). Weighed and not chosen: the bank client's two measures, `RemoveAllLoggers()` and requests marked `HttpRequestTracing.Exclude` (through a small handler, since the library builds its own requests), with the guard below also reading exported traces.
- *(propose)* The lines, source-generated in `PushLog`: `PushSent` (Information: reached, failed, removed); `PushDeliveryFailed` (Warning: the status, or none when no answer came); `PushDeviceGone` (Information: the status); `PushAccountNotAllowed` (Warning: how many devices were deleted). Registering and forgetting a device log nothing of their own; the request telemetry already records them, and its URLs carry no push address (the address travels in the request body, D9).
- *(propose)* A convention test (`Conventions/PushTelemetryTests`) captures every line a registration and a send write and finds no key, email, title or text in them, and no push address outside the push client's own request lines (above).

### D5 — The keys (S6, S7)

- **One PowerShell 7 block** on the owner's machine makes the VAPID key pair (P-256, with .NET's own `ECDsa`, no extra tool) and the **message key** (32 random bytes), and writes them straight into Key Vault and the AppHost's user-secrets without printing them. It writes to Key Vault, so the owner runs it (as C6's client secret, `docs/operations/entra-id.md` § The client secret and the allowlist). It must run before the merge: Container Apps refuses to update the app while a Key Vault reference points at a missing secret (`docs/operations/deployment.md`, step 5).
- **Separate values for the owner's laptop and for production.** The laptop copies go to the backup vault like every other local secret (configuration.md § Local development and tests); the production values live only in Key Vault, because a lost or rotated key heals itself (below).
- *(propose)* **Formats:** each value in base64url without padding, the form browsers and the library use: the public key the 65-byte uncompressed point (`0x04`, X, Y), the private key the 32-byte scalar, the message key 32 random bytes.
- **The token's contact** (`sub`): Apple and Google require a `mailto:` or `https:` contact. An email would put personal data into the public repository, so it is the app's own `https://` address: in production set by Bicep from the app's address, locally `https://localhost` (`appsettings.json`'s value). *(propose)* The same setting is the base of every `navigate` (D2). Locally a tap would then open `https://localhost/`, not the Vite address: a heads-up for C8b, whose local check can hand the web resource's address to the API from the AppHost if it needs the tap.
- **Names,** following C5's and C6's pattern:
  - settings section `Push`: `VapidPublicKey`, `VapidPrivateKey` and `MessageKey` declared as `"<secret>"`; `Subject` an ordinary setting; *(propose)* `Services` (D9) and `RequestTimeout` (D13) ordinary settings too;
  - Key Vault `Push--VapidPublicKey`, `Push--VapidPrivateKey`, `Push--MessageKey`;
  - AppHost parameters `push-vapid-public-key`, `push-vapid-private-key`, `push-message-key`;
  - the public key is not secret (every browser gets it), but it is kept next to its private half so the two always match, as with the Enable Banking application ID.
- **The app refuses to start** if any of the three is missing or still `"<secret>"`, or if the two VAPID halves do not form a valid P-256 pair. The message names the setting, never a value. *(propose)* `PushOptionsValidator` checks: the public key decodes to a P-256 point, the private key to 32 bytes, and a fixed text signed with the private half verifies with the public half (an import alone does not prove they belong together); the message key decodes to at least 32 bytes; `Subject` is an absolute `https` address with no path beyond `/`, no query and no fragment; every known push service is a valid pattern (D9); the timeout is between 1 and 60 seconds. Unit tests, no scenario (as C5's and C6's settings; A7 item 15).
- **A replaced key heals itself** (S7): at every opening the app compares the key its subscription was made with against the server's current public key, and replaces a subscription made with another key quietly (C8c builds it; C8a serves the key and the module function that reads a subscription's key, D8). A lost or rotated production key costs only each device's next opening.
- **Records:** configuration.md § Hand-provisioned secrets, `docs/operations/expiring-approvals.md` (no expiry; how to restore them), `docs/operations/local-secrets.md` (the three laptop entries).

### D6 — How Claude Code sends a test message (S8)

- Through the message endpoint (D10). The message key is read into a variable and used within the same command, never printed: in production `az keyvault secret show` (with the subscription named explicitly) for `Push--MessageKey`; locally that one entry of the AppHost's user-secrets.
- *(propose)* Sending a push reaches a real device, so Claude sends one only on the owner's go, each time. The commands go into `docs/operations/deployment.md` (§ Sending a test message).

### D7 — Tests (S9)

- **The fake push service** (testing.md § Decided later left it to C8): a WireMock server per test, like `Drivers/FakeBank`, standing in for Apple's or Google's push service. *(propose)* `Drivers/FakePushService` starts before the app copy, and its `Configure` writes the `Push` section: a made-up VAPID pair generated once per test run, a made-up message key per test, `Subject` a made-up app address, and the fake's own origin as a known push service (`Push:Services:FakePushService`, plain `http` on a loopback host, which only loopback entries allow, D9).
- **A test device plays the phone:** it makes its own P-256 key pair and 16-byte secret, as a browser does, and its push address points at the fake (`http://127.0.0.1:<port>/push/<device>`). The test signs in as Lucie, registers the device through the real API, then sends through the message endpoint with the key.
- **The fake checks what Apple would, and more,** and answers 403 when a check fails, so a wrong push counts as failed and the scenario goes red:
  - the token is an ES256 JWT signed with the app's VAPID key, `k` is that key, `aud` is the fake's own scheme and host (the library leaves out the port, D1; the real push services have none), `exp` lies in the future and no more than 24 hours ahead (RFC 8292), `sub` is an `https:` address;
  - `TTL` and `Urgency` are present (their values are what the scenarios assert);
  - `Content-Encoding: aes128gcm`, and the body decrypts with the device's own key and secret (the tests' own decryption, D1);
  - the decrypted JSON holds the expected title, text and address.
- **"Gone" and failures** are the fake's answers: 410 for a device the app must delete, 500 once for one counted as failed and kept.
- **No test needs a real secret:** the VAPID keys are made up for each test run, as the bank's key is, and the message key for each test.
- **Storage** runs on C7b's Azurite setup, as merged; *(propose)* `AzuriteStorage.Configure` also gives each app copy a `PushDevices:TableName` of its own.
- *(propose)* **A second allowed user,** Petr (`petr@example.com`, made up), joins the fake Microsoft's allowlist and `Dsl/Visitor`, because two scenarios need two allowed accounts. The DSL's allowlist steps check the configured list (testing.md § Test sign-in), so they keep holding.
- **The frontend:** jsdom has none of the browser's notification and push features, so the frontend test kit gets small stand-ins for `Notification`, `PushManager` and the service worker registration (built here, used by C8b and C8c; D8).
- **What tests cannot show:** that Apple accepts our token and encryption. That is a manual check on the iPhone (C8b).

### D8 — The shared frontend pieces, and C8b and C8c side by side (S10, A5)

- **C8a builds the shared frontend pieces:** a push module, `src/app/push.ts`, with unit tests: get the key, subscribe with it, send the subscription, forget it, unsubscribe, read the current subscription and the key it was made with. And the test kit's stand-ins, `src/test/push.ts`, for `Notification`, `PushManager` and the service worker registration, with the fake server's answers to the three push addresses in `src/test/server.ts`. No screen and no scenario of their own.
- **C8b owns the screens:** the card, the account menu's item, the failure banner, the service worker showing a push. **C8c owns the lifecycle:** what happens at every opening, at sign-out, and on a 401 or 403.
- Neither adds an endpoint (forgetting a device is C8a's), so no generated API file is merged by hand. The second to merge rebases and joins by hand: the wiring in `App.tsx` and the rows in `pm/progress.md`.
- C8c's last task group, the iPhone check that needs a phone subscribed through C8b's card, waits for C8b's merge.
- *(propose)* Every function that talks to the API never throws and answers a kind, through `askTheApi`, as C7a's reads do; the browser calls (`subscribe`, `unsubscribe`, `getSubscription`) pass their failures on as they come, because only C8b and C8c know what to show.

### D9 — The app's three endpoints (A1)

| Endpoint | Who may call it | What it does |
|---|---|---|
| `GET /api/push/key` | signed-in, allowed users | `{ "publicKey": "<base64url>" }`, the VAPID public key the app subscribes with. The first runtime value from the API, the pattern configuration.md § Frontend reserved for exactly this |
| `PUT /api/push/subscription` | signed-in, allowed users | stores or updates this device (push address and keys) under the signed-in account (D3), 204; registering the same device again moves it to the account signed in now |
| `DELETE /api/push/subscription` | signed-in, allowed users | forgets this device, 204; also when it was never stored (used at sign-out by C8c) |

- **The bodies** *(propose)*: `PUT` takes the browser's own `PushSubscription.toJSON()`: `{ "endpoint", "expirationTime", "keys": { "p256dh", "auth" } }`, `expirationTime` read and ignored. `DELETE` takes `{ "endpoint" }`. The push address travels in the body, never in the URL, so it never reaches the request telemetry (D4).
- **The bodies in the contract** (bootstrap's probe, 2026-11-09): FastEndpoints binds a `DELETE` body, and openapi-fetch sends one. These are the first endpoints with a request body, and the project's `Description(…, clearDefaults: true)` drops the body from `openapi.json`; so both declare it with `Accepts<T>("application/json")`, which keeps it in the description and in `schema.d.ts` as required. Its effect on routing: a request without a JSON body never reaches either endpoint and gets the catch-all's 404, as an unknown address does. The app's module always sends JSON. No `POST …/forget` fallback is needed.
- **Known push services only:** whatever address a device registers, the server later sends a request to it, so `PUT` accepts only addresses at Apple's, Google's, Mozilla's and Microsoft's push services. Without it a signed-in user could make the server call any address, e.g. inside Azure's network. *(propose)* The list:
  - in `appsettings.json` as `Push:Services`, named entries, so a test adds one without rewriting the others: `Apple` `https://*.push.apple.com`, `Google` `https://fcm.googleapis.com`, `Mozilla` `https://updates.push.services.mozilla.com`, `Microsoft` `https://*.notify.windows.com`. Hosts from [pushpad's known-push-services list](https://github.com/pushpad/known-push-services/blob/master/whitelist) (last changed 2026-06-01, read 2026-11-09), leaving out its legacy (`android.googleapis.com`), staging and test hosts;
  - an entry is an origin: `https`, a host or `*.` and a host suffix, no path, query or fragment; plain `http` only on a loopback host (the tests' fake, as `EnableBankingOptionsValidator` allows for the bank);
  - an address matches an entry when its scheme and port are the entry's and its host is the entry's host, or for `*.` ends in `.` and the suffix (`evil.push.apple.com.example.com` does not match); it has no user information, and it is at most 2048 characters long.
- **A malformed subscription is refused too:** a missing push address, a missing key, or a key of the wrong size or form. *(propose)* `p256dh` decodes from base64url to 65 bytes starting with `0x04`, `auth` to 16 bytes.
- **The refusals** *(propose)*: 400, FastEndpoints' validation problem (titled `Bad Request`, as `OlderTransactionsValidator`'s), whose `errors` name the refused member (`endpoint`, `keys.p256dh`, `keys.auth`) with a fixed reason, never the value; nothing is stored. The handler decides (`RegisterDeviceHandler`, a pure check of the known services and the keys), and the endpoint adds its refusals as FastEndpoints errors.
- The writes need nothing of their own against other sites: C6's rule covers every write under `/api` (`UseCrossSiteWriteProtection`).
- **Contract:** the three are in `openapi.json` and the regenerated `schema.d.ts`.

### D10 — The message endpoint (A2, S12)

The owner chose it instead of a confirmation push when notifications are turned on, a test button, or no push before C9.

- **Who may call it:** anyone holding the **message key** (D5), sent in a request header and compared in constant time. The endpoint itself is anonymous, so it goes on the checked list of anonymous endpoints (`Conventions/AnonymousEndpointsTests.cs`). A request from PowerShell carries neither `Sec-Fetch-Site` nor `Origin`, so C6's cross-site rule lets it through.
- *(propose)* **The address and the header:** `POST /api/push/messages`, the key in `X-Message-Key`. `MessageKeyCheck` hashes both the sent value and the key with SHA-256 and compares the hashes with `CryptographicOperations.FixedTimeEquals`, so neither the time nor a length gives anything away; a header sent twice, or not at all, does not match.
- **Hidden** (the owner): kept out of the API description (`openapi.json`; the running app serves no description at all), and a missing or wrong key gets **exactly the 404 problem an unknown `/api` address gets**, so a probe cannot tell it exists. *(propose)* How:
  - the key is checked **before the body is read:** the endpoint binds nothing (`EndpointWithoutRequest`) and reads its JSON body itself once the key matched, so a keyless request with a malformed body still gets the 404, never FastEndpoints' binding 400;
  - the 404 is `TypedResults.NotFound()`: a status with no body, which `UseStatusCodePages` fills in exactly as it does for `ApiNotFound`;
  - a wrong method on the address answers the catch-all's 404 already (README.md § Backend code);
  - a test pins that the answers are the same: status, content type and body, apart from `traceId`. The bootstrap's probe showed them identical (in the test harness and on Kestrel: 404, the same headers, the same problem body with no `instance`), also for a keyless request with a malformed body;
  - kept out of the description with `Description(x => x.ExcludeFromDescription())`, ASP.NET's own extension (FastEndpoints 9's beta has none of its own; the probe showed the endpoint absent from the export);
  - a convention test reads the committed `openapi.json` (which CI's drift check keeps equal to the code) and finds no `/api/push/messages`.
- **The request:** `{ "account", "title", "text", "page" }`, the target account (an email address) and the same message object the app's own sender uses (`PushMessage`): the **title**, the optional **text**, and the optional **page** a tap opens (D2, `/` when none). Whatever C9 later adds to the message, this endpoint can send too, so C9 can be tested the same way.
- **What it refuses:**
  - an account not on the allowlist: 404, a problem description of `type` `/problems/push-account-not-allowed`, title `Account not allowed` *(propose: a type of its own, README.md § Backend code, because it means more than an unknown address; only a caller with the key ever sees it)*, and that account's devices deleted (D3);
  - a missing or blank title, a page that is not a page of the app, or a message whose push content is longer than 3993 bytes (D2): 400, FastEndpoints' validation problem naming `title`, `page` or `message` with a fixed reason, never a value;
  - *(propose)* a missing account, or a body that is not the request's JSON: 400 the same way, naming `account` or `body`.

  `PushMessages.Check` holds the 400 rules, pure; the endpoint applies it before calling the sender, and the sender refuses a message that fails it with an `ArgumentException` (a caller's bug, never an expected outcome).
- **The answer:** `{ "delivered", "failed", "removed" }`, counts of devices (D3).
- **Long-term, no switch** (the owner): it stays open after development, for tests and for the owner's own messages to an allowed account; no on/off setting.
- **The repository is public** (S12): no email address anywhere; the endpoint names the account in each request, so no address is configured or written down. Its path is in the code and specs only, never in issues or comments.

### D11 — Storage (A3)

- A table in the app's storage account `strevolutreader` (ADR-0005), on C7b's Table Storage setup: the same tables client and connection, the same Azurite in tests, a table of each app copy's own.
- *(propose)* **The layout,** as simple as C7b's (c010 D5):
  - table `pushdevices`, one partition (`devices`), one row per device;
  - **row key:** the SHA-256 of the push address (its UTF-8 bytes) in lowercase hex, since an address holds `/` and often `?`, which Table Storage forbids in keys; the address itself kept unchanged in a column;
  - **columns:** `Endpoint`, `P256dh`, `Auth`, `Account` (the email the device registered under, as the sign-in gave it);
  - **every send reads every row** and keeps the account's (a handful of devices); there is no query by account, so moving a device to another account is one upsert by its key.
- *(propose)* **The port** `IPushDeviceStore` in `Push/` (next to its handlers, as `ITransactionStore` sits in `Account/`), its adapter `TablePushDeviceStore` with `PushDeviceStoreOptions` (section `PushDevices`, `TableName` default `pushdevices`, validated as C7b's) in `Storage/`. `StorageRegistration.AddPushDeviceStore` binds the options and registers the store on the tables client `AddTransactionStore` registered, so `Program.cs` calls it after `AddTransactionStore` (a second `AddAzureTableServiceClient` would register a second client). The adapter creates its table when missing, once per instance, as C7b's does.
- *(propose)* A storage failure is an exception (README.md § Backend code), so a registration, a forget or a send that cannot reach the table answers C7a's 500.

### D12 — Deployment (A4)

- **`infra/platform.bicep`:** the table `pushdevices` under the existing table service, beside `transactions`. C7b's Storage Table Data Contributor on the storage account covers it, so no new role and no change to the deploy identity's condition. *(propose)* A new output, the Container Apps environment's default domain, for the app's address below.
- **`infra/features.bicep`,** section "Push (C8)":
  - the three secrets as Key Vault references (`push-vapidpublickey` → `Push--VapidPublicKey`, and so on), in the bank's and sign-in's pattern, appearing to the app as `Push__VapidPublicKey`, `Push__VapidPrivateKey`, `Push__MessageKey`;
  - `Push__Subject`, the app's address: *(propose)* `https://` + the app's name + `.` + the environment's default domain, the address Container Apps gives an external app. Read from the app's own `fqdn` it would be a reference to itself; the app's name becomes one variable, used for both.
- **`infra/main.bicep`** passes the domain on.
- The read-only preview before the PR (`docs/operations/deployment.md` § Previewing a change to the Bicep) should show exactly: the new table, three secrets and four settings on the container app.
- **The guided task** (D5) runs before the merge.

### D13 — The sender's details *(propose)*

- **Timeout:** each push request waits at most **10 seconds** (`Push:RequestTimeout`, the push client's `HttpClient.Timeout`). A push service answers in well under a second; the devices are sent to in parallel, so a whole message waits at most about 10 s, which the owner's PowerShell and C9's trigger can afford. A request that runs out counts as failed (D3).
- **The caller's cancellation** passes on as cancellation, never as a failed device: the adapter tells its own timeout from the caller's token.
- **The adapter** (`WebPushDelivery`) maps: 201 (the success Apple and Google answer; the library's success) → delivered; `PushServiceClientException` with 404 or 410 → gone; with any other status (429 included, its retries off, D1) → failed, with that status; an `HttpRequestException` or its own timeout → failed, with no status.
- **Telling the timeout from the caller** (bootstrap's probe): `HttpClient.Timeout` surfaces as `TaskCanceledException` whose inner exception is a `TimeoutException`; the caller's cancellation as an `OperationCanceledException` while the caller's token `IsCancellationRequested`. The caller's case is checked first.

### D14 — Capabilities and scenarios *(propose)*

- **Two capabilities,** each a behaviour later changes extend: `push-devices` (the registration C8b and C8c call from the browser) and `push-sending` (the sender C9 calls, and the owner's endpoint on it).
- **18 scenarios,** close to explore's estimate of about 15 (A7): A7's items 1–14, with item 7 as two scenarios (forgetting a stored device and one never stored), item 9 as two (an account never allowed, and one that left the list with devices still registered) and item 10 as three. Item 15, the refusal to start without valid keys, is unit tests, as C5's and C6's settings are.
- **Not scenarios:** the endpoint's absence from `openapi.json` and its entry on the anonymous-endpoint list (convention tests, A7); the log guard (D4); the frontend pieces (unit tests, D8).

### D15 — ADR-0010-web-push *(propose)*

- Cross-cutting decisions get an ADR (workflow.md § 2). D1 (the library), D2 (the message format and its lifetime), D3 (who gets a push, no retries), D5 (the keys and how a replaced key heals itself) and D10 (a key-protected endpoint that answers like a missing address) bind C8b, C8c and C9 as well as this change, so a task writes them as **ADR-0010-web-push**, linking this design for the detail, as C12 wrote ADR-0009 from its design (c006 D11).
- ADR-0005 gets no amendment: its item 4 already names the push subscriptions; the table's layout is this design's (D11).

### D16 — The deploy identity's Key Vault Secrets Officer grant *(propose, A3)*

- Nothing in C8a needs the deploy identity to grant Key Vault Secrets Officer: subscriptions go to a table, and the owner writes the keys with the owner's own role (`azure-prerequisites.md` step 7).
- **Recorded as unused,** with a dated note in `azure-prerequisites.md` step 5's table. Narrowing the condition would take one of the owner's manual commands (as C12's widening did) and is outside this change (A3); whether to narrow it is the owner's call, asked when this design is presented. Until then it stays grantable, as it has been since M3.

### D17 — Software-factory records *(propose)*

Web Push is new to the factory (A6). The next free numbers when written (R-70 was the last on 2026-11-09):

- *(New)* Web Push from .NET: the library choice and its alternatives (D1), with the tests decrypting by their own code so the library never checks itself;
- *(New)* Declarative Web Push as the message format for an iOS Home Screen app, and why it removes the revocation risk (D2);
- *(New)* a key-protected operator endpoint that answers exactly like a missing address, checked before its body is read, and kept out of the API description (D10);
- *(New)* push addresses only at known push services, against server-side request forgery, with plain `http` allowed only for a loopback test fake (D9);
- *(Divergence, apply, 2026-11-09)* push addresses reach the private telemetry through the push client's own request lines and traces (D4, the owner's choice for speed); the full version gives the push client the bank client's two measures and a guard over exported traces as well as log lines;
- *(Apply, 2026-11-09)* the apply's test-writer and implementer are spawned fresh per chapter of slices (C8a: five chapters, from the foundation to the close), not kept for the whole change as the skill says nor spawned per slice: the test-writer spent about 320k tokens on the acceptance group alone, so one pair for 18 slices outgrows its context, while a fresh pair per slice rereads the design and conventions (about 50k tokens) for many small slices; the files are the source of truth, so a fresh agent loses nothing that matters. Links the size guide's lesson, which named splitting the apply among fresh agents as its reversal; a candidate change to the tdd-apply skill;
- inventory lines: the fake push service with its test device (template), the push module and its test stand-ins (template), the key-generation block (example).

## Public API sketch

```csharp
// ---- src/RevolutReader.Api/Push/ ----

/// <summary>The Push section (D5, D9, D13), validated on start with PushOptionsValidator.</summary>
public sealed class PushOptions {
  public const string SECTION = "Push";
  [Required, NotSecretPlaceholder] public required string VapidPublicKey { get; init; }   // base64url, 65-byte point
  [Required, NotSecretPlaceholder] public required string VapidPrivateKey { get; init; }  // base64url, 32 bytes
  [Required, NotSecretPlaceholder] public required string MessageKey { get; init; }       // base64url, ≥ 32 bytes
  [Required] public required Uri Subject { get; init; }                                  // the app's own https address
  [Required, MinLength(1)] public required IReadOnlyDictionary<string, string> Services { get; init; }   // name → origin pattern
  [Range(typeof(TimeSpan), "00:00:01", "00:01:00")] public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(10);
}
/// <summary>The pair, the message key's length, Subject an https origin, every service a valid pattern (D5, D9). Messages name the setting, never a value.</summary>
public sealed class PushOptionsValidator : IValidateOptions<PushOptions>;

/// <summary>The known push services (D9): whether a push address may be registered.</summary>
public sealed class KnownPushServices(IOptions<PushOptions> options) {
  public bool Accepts(string pushAddress);
}

/// <summary>A device as kept (D3, D11): its push address, its two keys (base64url) and the account it registered under.</summary>
public sealed record PushDevice(string Endpoint, string P256dh, string Auth, string Account);

/// <summary>The device store (§ Ports and contracts).</summary>
public interface IPushDeviceStore {
  Task<IReadOnlyList<PushDevice>> ReadAll(CancellationToken cancellationToken);
  /// <summary>Inserts or replaces the device by its push address; saving it under another account moves it.</summary>
  Task Save(PushDevice device, CancellationToken cancellationToken);
  /// <summary>Deletes the device with this push address; none stored is fine.</summary>
  Task Forget(string endpoint, CancellationToken cancellationToken);
}

/// <summary>A message (D2, D10): the title, the optional text, the page a tap opens ("/" when none).</summary>
public sealed record PushMessage(string Title, string? Text, string Page = "/");

/// <summary>A member a request names wrongly and the fixed reason, never the value (D9, D10).</summary>
public sealed record RefusedMember(string Member, string Reason);

/// <summary>The message rules (D2, D10), pure.</summary>
public static class PushMessages {
  public const int MOST_BYTES = 3993;                                       // RFC 8291 § 4
  public static bool IsAppPage(string page);                                // "/" + path, not "//", outside /api
  public static IReadOnlyList<RefusedMember> Check(PushMessage message, Uri appAddress);   // title, page, message (too long)
  /// <summary>The Declarative Web Push JSON: web_push 8030, title, body when there is text, navigate = appAddress + page.</summary>
  public static string DeclarativeJson(PushMessage message, Uri appAddress);
}

/// <summary>One push to one device (D2): the content, how long the push service keeps it, how urgent it is.</summary>
public sealed record OutgoingPush(string Content, TimeSpan Lifetime, PushUrgency Urgency);
public enum PushUrgency { VeryLow, Low, Normal, High }

/// <summary>What one delivery came to (D3, D13).</summary>
public sealed record Delivered;
public sealed record DeviceGone(int Status);
public sealed record DeliveryFailed(int? Status);           // null: no answer (timeout, no connection)
public union DeliveryOutcome(Delivered, DeviceGone, DeliveryFailed);

/// <summary>The push services (§ Ports and contracts). Never retries; the caller's cancellation throws.</summary>
public interface IPushDelivery {
  Task<DeliveryOutcome> Deliver(PushDevice device, OutgoingPush push, CancellationToken cancellationToken);
}

/// <summary>IPushDelivery on Lib.Net.Http.WebPush's PushServiceClient (D1, D13), with its own HttpClient (timeout
/// Push:RequestTimeout, no retry handler), the VAPID pair and Subject from PushOptions, the vapid scheme.</summary>
public sealed class WebPushDelivery(HttpClient http, IOptions<PushOptions> options) : IPushDelivery;
// The library's names, confirmed by the bootstrap's probe (Lib.Net.Http.WebPush 3.3.1, 2026-11-09):
//   new PushServiceClient(http) { DefaultAuthentication = new VapidAuthentication(publicKey, privateKey) { Subject = … },
//     DefaultAuthenticationScheme = VapidAuthenticationScheme.Vapid, AutoRetryAfter = false }
//     (PushServiceClient is not IDisposable and never disposes our HttpClient; VapidAuthentication is IDisposable;
//      its Expiration defaults to 43200 s, at most 86400; Subject must be mailto: or https:)
//   var subscription = new PushSubscription { Endpoint = device.Endpoint };
//   subscription.SetKey(PushEncryptionKeyName.P256DH, device.P256dh); subscription.SetKey(PushEncryptionKeyName.Auth, device.Auth);
//   new PushMessage(push.Content) { TimeToLive = (int)push.Lifetime.TotalSeconds, Urgency = PushMessageUrgency.High }
//     (PushMessageUrgency { VeryLow, Low, Normal, High }; without TimeToLive the client's default is 28 days)
//   await client.RequestPushMessageDeliveryAsync(subscription, message, cancellationToken);   // Task; success = no exception
//   failures: PushServiceClientException (StatusCode, Headers, Body); TaskCanceledException { InnerException: TimeoutException }
//     for HttpClient.Timeout; HttpRequestException (HttpRequestError.ConnectionError) for no connection.
//   On the wire: Authorization "vapid t=<ES256 JWT>, k=<public key>", TTL, Urgency, Content-Encoding aes128gcm,
//     Content-Type application/octet-stream; JWT claims aud (scheme://host, no port), exp, sub.

/// <summary>The sender's answer (D3).</summary>
public sealed record PushSent(int Delivered, int Failed, int Removed);
public sealed record AccountNotAllowed;
public union SendResult(PushSent, AccountNotAllowed);

/// <summary>
/// The sender (D2, D3, D4): the allowlist first (not allowed → its devices forgotten, AccountNotAllowed); then every device
/// of the account (ignoring case), at once, each with OutgoingPush(DeclarativeJson, 24 h, High); a gone device forgotten;
/// counts logged. A message PushMessages.Check refuses throws ArgumentException. C9 sends through Send.
/// </summary>
public sealed class SendPushHandler(IPushDeviceStore store, IPushDelivery delivery, Allowlist allowlist,
  IOptions<PushOptions> options, ILogger<SendPushHandler> logger) {
  public static readonly TimeSpan LIFETIME = TimeSpan.FromHours(24);
  public Task<SendResult> Send(string account, PushMessage message, CancellationToken cancellationToken);
}

/// <summary>A device as the browser describes it (D9): PushSubscription.toJSON()'s members.</summary>
public sealed record DeviceSubscription(string? Endpoint, string? P256dh, string? Auth);
public sealed record Registered;
public sealed record SubscriptionRefused(IReadOnlyList<RefusedMember> Members);
public union RegistrationResult(Registered, SubscriptionRefused);

/// <summary>Checks the push address against the known services and the keys' sizes; saves under the account (D9).</summary>
public sealed class RegisterDeviceHandler(IPushDeviceStore store, KnownPushServices services) {
  public Task<RegistrationResult> Handle(DeviceSubscription subscription, string account, CancellationToken cancellationToken);
}

/// <summary>Forgets the device with this push address; none stored, or no address, is fine (D9).</summary>
public sealed class ForgetDeviceHandler(IPushDeviceStore store) {
  public Task Handle(string? endpoint, CancellationToken cancellationToken);
}

/// <summary>The message key's check (D10): SHA-256 of both, compared in constant time; missing or repeated → false.</summary>
public static class MessageKeyCheck {
  public const string HEADER = "X-Message-Key";
  public static bool Matches(StringValues sent, string messageKey);
}

/// <summary>Source-generated log lines (D4): counts, statuses and outcomes only.</summary>
public static partial class PushLog {
  public static partial void PushSent(ILogger logger, int delivered, int failed, int removed);   // Information
  public static partial void PushDeliveryFailed(ILogger logger, int? status);                    // Warning
  public static partial void PushDeviceGone(ILogger logger, int status);                         // Information
  public static partial void PushAccountNotAllowed(ILogger logger, int removed);                 // Warning
}

// Endpoints (thin; FastEndpoints):
/// <summary>GET /api/push/key → 200 PushKeyResponse. Description: 200, 401, 403.</summary>
public sealed class PushKeyEndpoint(IOptions<PushOptions> options) : EndpointWithoutRequest<PushKeyResponse>;
public sealed record PushKeyResponse(string PublicKey);

/// <summary>PUT /api/push/subscription: the signed-in email (JwtRegisteredClaimNames.Email) → RegisterDeviceHandler;
/// Registered → 204; SubscriptionRefused → FastEndpoints' validation 400 naming each member. Description: Accepts<SubscriptionRequest>
/// ("application/json"), 204, 400, 401, 403 (D9: clearDefaults would otherwise drop the body).</summary>
public sealed class SubscriptionEndpoint(RegisterDeviceHandler handler) : Endpoint<SubscriptionRequest>;
public sealed record SubscriptionRequest { public string? Endpoint { get; init; } public double? ExpirationTime { get; init; }
  public SubscriptionKeys? Keys { get; init; } }
public sealed record SubscriptionKeys { public string? P256dh { get; init; } public string? Auth { get; init; } }

/// <summary>DELETE /api/push/subscription → ForgetDeviceHandler → 204. Description: Accepts<ForgetSubscriptionRequest>
/// ("application/json"), 204, 401, 403 (D9).</summary>
public sealed class ForgetSubscriptionEndpoint(ForgetDeviceHandler handler) : Endpoint<ForgetSubscriptionRequest>;
public sealed record ForgetSubscriptionRequest { public string? Endpoint { get; init; } }

/// <summary>
/// POST /api/push/messages (D10): AllowAnonymous, Description(x => x.ExcludeFromDescription()), binds nothing. MessageKeyCheck first →
/// TypedResults.NotFound() (body-less, filled by UseStatusCodePages); then the JSON body (MessageRequest) read by hand →
/// 400 for an unreadable body; PushMessages.Check and a missing account → FastEndpoints' validation 400; then
/// SendPushHandler: PushSent → 200 MessageOutcomeResponse; AccountNotAllowed → 404 /problems/push-account-not-allowed.
/// </summary>
public sealed class MessageEndpoint(SendPushHandler sender, IOptions<PushOptions> options) : EndpointWithoutRequest;
public sealed record MessageRequest(string? Account, string? Title, string? Text, string? Page);
public sealed record MessageOutcomeResponse(int Delivered, int Failed, int Removed);

public static class PushRegistration {
  /// <summary>PushOptions (+ validator, on start), KnownPushServices, the three handlers, WebPushDelivery as
  /// IPushDelivery with its typed HttpClient (no resilience handler). The device store comes from AddPushDeviceStore.</summary>
  public static IServiceCollection AddPush(this IServiceCollection services);
}

// ---- src/RevolutReader.Api/Storage/ ----
public sealed class PushDeviceStoreOptions { public const string SECTION = "PushDevices"; public required string TableName { get; init; } }
/// <summary>IPushDeviceStore on Table Storage (D11): partition "devices", row key SHA-256(endpoint) in lowercase hex;
/// columns Endpoint, P256dh, Auth, Account; the table created if missing, once per instance; Save upserts whole rows.</summary>
public sealed class TablePushDeviceStore(TableServiceClient tables, IOptions<PushDeviceStoreOptions> options) : IPushDeviceStore;
// StorageRegistration.AddPushDeviceStore(this IHostApplicationBuilder): the options (validated on start) and the store,
// on the tables client AddTransactionStore registered.

// Program.cs: builder.AddPushDeviceStore() after AddTransactionStore(); builder.Services.AddPush().
// AppHost: push-vapid-public-key, push-vapid-private-key, push-message-key (secret) → Push__VapidPublicKey, … .
```

```csharp
// ---- tests/RevolutReader.UnitTests/Push/ ----
// InMemoryPushDeviceStore : IPushDeviceStore — the fake, also compiled into the integration project (as C7b's).
// StubPushDelivery : IPushDelivery — answers per push address (delivered by default; gone or failed when set), records
//   each push. Handler tests capture log lines with a hand-written ILogger. Allowlist.Parse for the allowlist.

// ---- tests/RevolutReader.IntegrationTests ----
// Push/PushDeviceStoreContract.cs — abstract; InMemoryPushDeviceStoreContract and TablePushDeviceStoreContract (Azurite).
// Wiring/WebPush/ — WebPushDelivery against WireMock: timeout, no connection, 429, 404/410, the caller's cancellation (implementer).

// ---- tests/RevolutReader.AcceptanceTests ----

// As the acceptance group wrote it (group 1, approved 2026-11-09; this sketch updated to match in a [plan] fix):
// Drivers/FakePushService.cs — WireMock per test; Configure writes the Push section (D7): the run's VAPID pair, this test's
//   message key, the made-up Subject https://app.example.net, and its own origin as Push:Services:FakePushService. Answers
//   201 to every push at /push/<device>, unless told: Gone(device) → 410 from then on, FailsOnce(device) → 500 once.
//   Checks token, k, aud, exp, sub, TTL, Urgency and Content-Encoding (403 when one fails); records every request with its
//   headers, body, whether its token passed and the answer (ReceivedPush).
public sealed class FakePushService : IDisposable {
  public const string SERVICE_NAME = nameof(FakePushService);
  public static FakePushService Start();
  public void Configure(IWebHostBuilder builder);
  public string VapidPublicKey { get; }                 // the run's
  public string Origin { get; }                         // http://127.0.0.1:<port>
  public string AppAddress { get; }                     // the made-up Push:Subject
  public string MessageKey { get; }                     // made up per test
  public TestDevice NewDevice(string name);             // a push address at this fake, new keys
  public void Gone(TestDevice device);
  public void FailsOnce(TestDevice device);
  public IReadOnlyList<ReceivedPush> PushesFor(TestDevice device);   // at its push address, however answered
  public IReadOnlyList<ReceivedPush> Pushes();                       // every request, at any address
}
// Drivers/ReceivedPush(Path, Headers, Body, SignedWithServerKey, Answer): a request as it arrived and the fake's answer.
// Drivers/TestDevice.cs — a P-256 key pair and a 16-byte secret, as a browser makes (Name, PushAddress, P256dh, Auth);
//   Decrypt(body) by RFC 8291 on .NET's ECDiffieHellman, HKDF and AesGcm (never the library).
// Drivers/PushDriver(HttpClient browser, HttpClient owner, FakePushService, IServiceProvider app), kept inside the DSL
//   (not on AcceptanceTest): the browser (the signed-in HttpClient): GET key, PUT and DELETE subscription (with
//   Sec-Fetch-Site: same-origin, as the app's page sends); the owner (an anonymous HttpClient, no fetch metadata): POST
//   message with or without the key, and the same request to an unknown /api address; the app copy's IPushDeviceStore for
//   a device registered before its account left the allowlist and for whether a push address is still registered. Checks
//   the exact shapes (key: exactly publicKey; counts: exactly three; a problem as BalanceDriver, plus the member its
//   errors name, mapped to RequestPart; a forget: 204 without content) and decrypts each received push into a PushReceived.
// Dsl/PushDsl.cs — AcceptanceTest.Push, written in full, calling only the driver:
public sealed class PushDsl(PushDriver driver, FakePushService pushService) {
  public string ServerPushKey { get; }
  public PhoneForPush NewPhone(string name);                                           // unique name per test
  public void PushServiceSaysGone(PhoneForPush phone);
  public void PushServiceFailsOnce(PhoneForPush phone);
  public Task<string> AsksForThePushKey();
  public Task<RegistrationAnswer> Registers(PhoneForPush phone);
  public Task HasRegistered(PhoneForPush phone);                                       // a GIVEN: throws unless registered
  public Task<RegistrationAnswer> RegistersAt(string pushAddress);                    // outside the known services
  public Task<RegistrationAnswer> RegistersWithSecretOfBytes(PhoneForPush phone, int bytes);
  public Task<ForgetAnswer> Forgets(PhoneForPush phone);
  public Task<MessageAnswer> OwnerSends(string account, string? title, string? text = null, string? page = null);
  public Task<WholeAnswer> SomeoneSendsWithAWrongKey(string account, string title);
  public Task<WholeAnswer> AnUnknownApiAddressAnswers();                               // the same request, to an unknown /api address
  public Task DeviceRegisteredFor(PhoneForPush phone, string account);                 // storage, for "left the allowlist"; checks itself
  public Task<bool> IsRegistered(PhoneForPush phone);
  public IReadOnlyList<PushReceived> PushServiceReceived(PhoneForPush phone);          // every push, whatever the answer
  public IReadOnlyList<PushReceived> Received(PhoneForPush phone);                     // those that reached the phone
  public int PushesAnyPushServiceReceived();
  public string AppAddressOf(string page);                                             // what a tap on a push opens
}
// Dsl/: PhoneForPush(Name), a test device by name; MessageAnswer(Delivered, Failed, Removed, Problem, RefusedMember) with
//   Counts(…) and Refused(problem, naming?); RegistrationAnswer(Problem, RefusedMember) with Registered and
//   Refused(problem, naming); RequestPart { PushAddress, DeviceKey, Secret, Account, Title, Page, Message, Body } (the
//   member a refusal names, mapped by the driver so the API's member names stay out of Scenarios/); ForgetAnswer
//   { SomethingElse, Forgotten }; WholeAnswer(Problem, Text): status, content type and body without traceId, compared by
//   value (D10); PushReceived(Title, Text, Navigate, LifetimeSeconds, Urgency, SignedWithServerKey, ReachedThePhone).
// Dsl/Visitor.Petr ("Petr Novák", "petr@example.com"); FakeMicrosoft.ALLOWED_EMAILS gains it. ProblemDescription gains
//   PushAccountNotAllowed ("Account not allowed", "/problems/push-account-not-allowed").
// Drivers/AzuriteStorage.Configure also sets PushDevices:TableName (a table of the app copy's own).
// Conventions/: AnonymousEndpointsTests gains "POST /api/push/messages"; HiddenEndpointsTests (openapi.json has no
//   /api/push/messages); PushTelemetryTests (D4).
```

```ts
// ---- src/RevolutReader.Web/src/app/push.ts (D8) ----
export type PushKeyRead =
  | { kind: "key"; key: string }                                  // base64url, as served
  | { kind: "signed out" } | { kind: "refused"; email: string | null } | { kind: "unexpected" } | { kind: "offline" };
export function readPushKey(options?: { signal?: AbortSignal }): Promise<PushKeyRead>;          // never throws

export type SubscriptionSent =
  | { kind: "done" }                                              // 204
  | { kind: "refused subscription" }                              // 400: the server will not keep it
  | { kind: "signed out" } | { kind: "refused"; email: string | null } | { kind: "unexpected" } | { kind: "offline" };
export function sendSubscription(subscription: PushSubscription, options?: { signal?: AbortSignal }): Promise<SubscriptionSent>;
export function forgetSubscription(endpoint: string, options?: { signal?: AbortSignal }): Promise<SubscriptionSent>;

export function pushSupported(browser?: Window): boolean;        // a service worker, PushManager and Notification
export function currentSubscription(registration: ServiceWorkerRegistration): Promise<PushSubscription | null>;
export function subscribe(registration: ServiceWorkerRegistration, key: string): Promise<PushSubscription>;  // userVisibleOnly
export function unsubscribe(subscription: PushSubscription): Promise<boolean>;
export function keyOf(subscription: PushSubscription): string | null;   // its applicationServerKey, base64url
export function madeWith(subscription: PushSubscription, key: string): boolean;
export function fromBase64Url(text: string): Uint8Array;  export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string;

// ---- src/RevolutReader.Web/src/test/push.ts (the test-writer's) ----
// installPushStandIns({ permission?, subscription?, subscribeFails? }): Notification (permission, requestPermission),
//   PushManager on a registration (subscribe, getSubscription, permissionState), navigator.serviceWorker.ready;
//   a fake PushSubscription (endpoint, options.applicationServerKey, toJSON, unsubscribe); removed after each test.
// server.ts gains GET /api/push/key, PUT and DELETE /api/push/subscription answers, in its vocabulary.
```

## Rule ownership

| Rule (spec, ADR or convention) | Enforced by |
|---|---|
| The key endpoint answers exactly `publicKey` | `PushKeyEndpoint`, `PushKeyResponse`; the exact shape checked by `PushDriver` |
| A device is stored under the signed-in account; the same address again moves it | `SubscriptionEndpoint` (the email claim), `RegisterDeviceHandler`, `IPushDeviceStore.Save` (upsert by address) |
| Only `https` addresses at the known push services (http only for a loopback entry) | `KnownPushServices`, `PushOptionsValidator` (the patterns), `RegisterDeviceHandler` |
| Keys of the right size and form | `RegisterDeviceHandler` |
| Refusals name the member, never the value; nothing stored | `RegisterDeviceHandler`, `PushMessages.Check`; the endpoints' FastEndpoints errors |
| Forgetting answers 204 whether or not the device is stored | `ForgetDeviceHandler`, `IPushDeviceStore.Forget` |
| Every device of the account, and no other, gets the message once | `SendPushHandler` |
| Encrypted for the device (RFC 8291), signed for the push service (RFC 8292) | `WebPushDelivery` (the library); checked by `FakePushService` and `TestDevice` |
| Declarative Web Push JSON; `navigate` a page of the app; no badge | `PushMessages.DeclarativeJson`, `PushMessages.IsAppPage` |
| 24 hours, urgent | `SendPushHandler` (`OutgoingPush`), `WebPushDelivery` (`TTL`, `Urgency`) |
| At most 3993 bytes; a title; a page of the app | `PushMessages.Check`, applied by `MessageEndpoint`; `SendPushHandler` throws on a message it refuses |
| Allowlisted accounts only; a refused account's devices deleted | `SendPushHandler` (the C6 `Allowlist`) |
| Gone (404, 410) deleted; other failures counted and kept; no retries | `WebPushDelivery` (the mapping, no resilience handler), `SendPushHandler` |
| The message endpoint answers only with its key, like an unknown address without it | `MessageEndpoint`, `MessageKeyCheck`; the catch-all's 404 through `UseStatusCodePages` |
| Hidden from the API description; on the anonymous list | `MessageEndpoint` (`ExcludeFromDescription`); `HiddenEndpointsTests`, `AnonymousEndpointsTests` |
| The app refuses to start without valid keys | `PushOptions`, `PushOptionsValidator`, `[NotSecretPlaceholder]` |
| Logs hold counts and outcomes only | `PushLog`; guarded by `PushTelemetryTests` |
| Allowed users only on the three app endpoints; writes from other sites refused | the `AllowedUser` policy and the cross-site rule (C6), unchanged |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected outcomes (answers) | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `SendPushHandler.Send` | `PushSent` | `AccountNotAllowed` | `ArgumentException` for a message `PushMessages.Check` refuses; the store's failures |
| `IPushDelivery.Deliver` | `Delivered` | `DeviceGone`, `DeliveryFailed` (every push-service failure, its timeout, no connection) | `OperationCanceledException` for the caller's cancellation |
| `RegisterDeviceHandler.Handle` | `Registered` | `SubscriptionRefused` (unknown service, malformed keys) | the store's failures |
| `ForgetDeviceHandler.Handle` | — | — | the store's failures |
| `IPushDeviceStore` | rows / — | — (a missing device is not an error) | the adapter's `RequestFailedException`; a row it cannot read → `InvalidOperationException` naming the column, never its value |
| `GET /api/push/key` | 200 | 401, 403 | → 500 (C7a's handler) |
| `PUT /api/push/subscription` | 204 | 400 (the refused members; JSON it cannot read), 401, 403; no JSON body: the catch-all's 404 (D9) | → 500 |
| `DELETE /api/push/subscription` | 204 | 400 (JSON it cannot read), 401, 403; no JSON body: the catch-all's 404 (D9) | → 500 |
| `POST /api/push/messages` | 200 `MessageOutcomeResponse` | 404 (no key, as an unknown address), 404 `/problems/push-account-not-allowed`, 400 (refused members; an unreadable body) | → 500 |
| `readPushKey`, `sendSubscription`, `forgetSubscription` | the kinds | every answer and failure becomes a kind | none; never throw |
| `subscribe`, `unsubscribe`, `currentSubscription` | the browser's values | — | the browser's own failures, passed on (D8) |

- **Two new unions** (README.md § Backend code): `DeliveryOutcome` and `SendResult`, plus `RegistrationResult`; their files are exempt from CA1815 as the bank's union is.
- **README.md's case → status table** gains the row: an account not on the allowlist named by the message endpoint, 404, `/problems/push-account-not-allowed`, `Account not allowed`, push-sending / A message to an account not on the allowlist is refused.

## Ports and contracts

**`IPushDeviceStore`** (new; the in-memory fake `InMemoryPushDeviceStore` serves the unit tests):

- **`ReadAll`:** every stored device, in no promised order; an empty store answers an empty list. Every field comes back as saved, the push address unchanged (with its query, as Microsoft's addresses carry `?token=…`).
- **`Save`:** inserts or replaces the device by its push address, whole: saving the same address again leaves one device with the latest keys and account.
- **`Forget`:** deletes the device with that push address; an address not stored does nothing and raises nothing.
- **Concurrency:** last write wins; a send that forgets a gone device while the same browser registers it again may leave either, and the next opening (C8c) registers it again.
- **Failures:** an exception, never a result.
- **Real adapter:** `TablePushDeviceStore` on `Azure.Data.Tables` through the tables client C7b registered; Azurite locally and in tests; the deployed table with the app's managed identity in Azure.
- **Contract tests:** `[integration]`, the fake and the adapter against the same tests (testing.md § Integration tests).

**`IPushDelivery`** (new; no in-memory fake, the sender's unit tests use a hand-written stub):

- **One call, one HTTP request** to the device's push address: never retried, never split.
- **Outcomes:** delivered on the push service's success; gone on 404 or 410; failed on any other status, on no answer within `Push:RequestTimeout`, or on no connection. Never an exception for any of these.
- **Cancellation:** the caller's token cancelled → `OperationCanceledException`.
- **Real adapter:** `WebPushDelivery` on Lib.Net.Http.WebPush (D1), with its own typed `HttpClient` from `IHttpClientFactory` (no resilience handler; the convention test `HttpClientDefaultsTests` still holds).
- **Tests:** the acceptance scenarios against the fake push service; its edge cases (timeout, no connection, 429, gone, cancellation) in `IntegrationTests/Wiring/WebPush/`, written by the implementer after the implementation (testing.md § Integration tests).

## How each scenario is verified

| Scenarios | Level | Why |
|---|---|---|
| `push-devices`: all 6 | API acceptance tests in `Scenarios/PushDevices/PushDevicesScenarios.cs`, with the fake push service and test devices | the default level; everything they assert is an answer of the API or what a push service received |
| `push-sending`: all 12 | API acceptance tests in `Scenarios/PushSending/PushSendingScenarios.cs` | as above; "A message to an account no longer on the allowlist deletes its devices" also reads what storage then holds through the app copy's own store (C7b's precedent, c010 § How each scenario is verified), because the allowlist is fixed when the app copy starts and that device can never be reached again through the API |

No frontend scenario and no manual row: the frontend pieces are unit-tested (D8), and the first push to a real phone is C8b's manual row.

## Cross-cutting effects

- **API contract / TS client:** three endpoints; `openapi.json` and `schema.d.ts` regenerated in the slices that add them. The message endpoint stays out of both.
- **Bicep:** D12. Linted (`az bicep lint`; a warning fails CI) and previewed before the PR.
- **AppHost and settings:** the three parameters; `appsettings.json` gains `Push` (three `"<secret>"`s, `Subject` `https://localhost`, `Services`, `RequestTimeout`) and `PushDevices` (`TableName`), each with its provenance comment.
- **Made-up values:** the OpenAPI export check, the CI image smoke run (`.github/workflows/ci.yml`) and `CLAUDE.md`'s image quick start get made-up push keys. A pair must be valid, so the smoke run and the quick start generate one per run (a one-line Node command, which prints a pair in base64url from `crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })`'s JWK), and the message key is any 32 random bytes.
- **ADRs:** ADR-0010-web-push (D15).
- **Conventions:** configuration.md (§ `appsettings.json` is the inventory: `Push`, `PushDevices`; § Hand-provisioned secrets: three rows; § Local development and tests: the three parameters; § Frontend: the first runtime value is served); testing.md (§ Decided later: the fake push service decided; a § Fake push service: the fake, the test device, its own decryption, the made-up keys, the second allowed user); README.md (§ Backend code: the device store's port and adapter, the case → status row, the message endpoint as the second key-protected anonymous address); their `.claude/rules/` mirrors.
- **Operations:** `deployment.md` (the guided task for the production keys, the table, § Sending a test message, the after-merge checks); `local-secrets.md` (the three laptop entries and their backups); `expiring-approvals.md` (the keys: no expiry, how to restore, a lost key heals itself); `azure-prerequisites.md` (D16's note).
- **Software factory:** D17.
- **CLAUDE.md § Commands:** the quick start's push values.

## Risks / Trade-offs

- **[Apple refuses what the library sends, or shows nothing]** → tests check RFC 8291 and 8292 with their own decryption, but only C8b's iPhone check proves it. Fallback: our own implementation (D1, about half a day), behind the same `IPushDelivery`.
- **[The library's names differ from the sketch]** → settled: the bootstrap's probe confirmed them (D1, the sketch).
- **[The library retries on its own]** → its 429 retries are switched off (`AutoRetryAfter = false`, D1); `Wiring/WebPush/` tests a 429 as one request.
- **[A vulnerability is published in the library or Lib.Net.Http.EncryptedContentEncoding]** → the build turns red (`TreatWarningsAsErrors`); the same fallback.
- **[FastEndpoints drops a `DELETE` body, or the API description does]** → settled: it binds the body; `Accepts<T>` keeps it in the description (D9).
- **[The keyless 404 differs from the unknown address's in some detail]** (a header, the `instance`) → the bootstrap's probe showed them identical; a test compares the two answers whole except `traceId` (D10).
- **[The production keys are missing when the merge deploys]** → the new revision stops (deployment.md step 5). The guided task runs before the merge, and its read-back lists the three names.
- **[A wildcard host matches more than meant]** → matching on the parsed host by whole labels; unit tests with look-alike hosts (D9).
- **[Petr on the test allowlist breaks a scenario that assumed one address]** → the test-writer runs the whole suite when adding him; the DSL's allowlist steps check the configured list.
- **[A push address or an email in telemetry]** → addresses travel in bodies, never in the app's URLs; `PushLog` takes numbers only; the guard test (D4). The push client's own request lines and traces do hold the push address: accepted by the owner (D4).
- **[A brute force on the message key]** → 256 bits, constant-time comparison; no rate limit (accepted, Non-Goals).
- **[Locally a tap opens `https://localhost/`]** → harmless in C8a, which shows nothing; a heads-up for C8b (D5).
- **[18 slices make a long `/tdd-apply`]** → several slices only close, because earlier ones turned them green (tasks.md).

## Bootstrap (before `/tdd-apply`, committed as `[setup]`)

1. **Package:** `Lib.Net.Http.WebPush` 3.3.1 in the API (`Directory.Packages.props`); `dotnet list package --vulnerable --include-transitive` again.
2. **Probes,** throwaway, deleted afterwards:
   - the library sends through our `HttpClient` to a WireMock server: the `Authorization: vapid t=…, k=…` header, `TTL`, `Urgency`, `Content-Encoding: aes128gcm`, a body a quick RFC 8291 decryption reads; a 410 surfaces as `PushServiceClientException` with that status; its type and member names go into § Public API sketch;
   - FastEndpoints binds a `DELETE` request's JSON body, and the exported `openapi.json` and the generated `schema.d.ts` carry it (D9);
   - an anonymous `EndpointWithoutRequest` answering `TypedResults.NotFound()` gives the same answer as an unknown `/api` address, and `ExcludeFromDescription` keeps it out of the export (D10).
3. **Baseline:** the full suite green, except the traceability check naming this change's 18 new scenarios.

**Done 2026-11-09:** the package added, no known vulnerability; the probes' outcomes are in D1 (dependencies, retries off, names, `aud`), D2 (no size check in the library), D7 (`aud`), D9 (`Accepts<T>`), D10 (identical 404s, `ExcludeFromDescription`), D13 (telling the timeout from the caller) and the sketch. None contradicted D9 or D10. The probe code was deleted; the RFC 8291 decryption the library probe proved on RFC 8291 Appendix A is a model for `TestDevice` (the test-writer's own code).

## Migration plan

1. **Before `/tdd-apply`:** the bootstrap.
2. **During it,** after the last API slice: the guided task for the laptop keys (D5), then a local check with `aspire start --isolated`: `GET /api/push/key` in the signed-in browser shows the laptop's public key; a message through the message endpoint to the owner's account (PowerShell, the laptop's message key) answers three zeros; a wrong key answers as an unknown address does.
3. **Before the merge** (workflow.md § 6, a change's path): the Bicep lint and the read-only preview (D12); the guided task for the production keys, run by the owner, its read-back the three names; the push and a draft PR on the owner's go; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; the archive on the branch.
4. **After the merge:**
   - the deploy runs and the new revision starts (no missing secret);
   - read-only: the table `pushdevices` exists, the container app has the three secrets and `Push__Subject` at its own address;
   - with the owner's go: a message to the owner's account answers three zeros (no device can register before C8b), and a wrong key answers as an unknown address does (D6).

   Findings go into `pm/progress.md` through a small docs PR if they come after the archive.
5. **Rollback:** revert the merge. The endpoints disappear, and the stack deletes the `pushdevices` table, which holds only subscriptions: C8b's card and C8c's upkeep make them again. The three Key Vault secrets stay (hand-provisioned, not in the stack) and are reused when the change returns.

## Open questions

None. D16 (whether to narrow the deploy identity's condition) is the owner's call outside this change, and changes nothing here.
