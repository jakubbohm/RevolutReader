# Design: c019-show-balance-notifications-at-once

## TL;DR

- **Plain pushes** (D1): the account check's notifications lose `"mutable": true` and `data`. iOS shows them through its push daemon at once; the app's service worker no longer runs for them on the iPhone.
- **The balance in the address** (D2): `navigate` is the start page with `#balance=<payload>.<code>`. The payload is the base64url JSON `GET /api/balance` writes, and the code a 43-character base64url HMAC.
- **The check code** (D3): HMAC-SHA-256 over the payload text, under a key HKDF-SHA-256 derives from the device's push subscription `auth` secret, with this app's own salt and label. Only the phone and the server hold that secret (RFC 8291), so no link can carry a code the phone accepts. No new secret.
- **A push per device** (D4): the sender builds each device's content when the message has a balance; otherwise one content for all, as today. The size check counts the fragment.
- **The page's intake** (D5, D6): sources are the page's own `#` (at the start, on `hashchange`) and the `navigate` of every notification `getNotifications()` lists (at every launch and return). Only a valid code counts, and of those the newest `readAt`. It is kept by c015's rule (`keepNotificationBalance`, one IndexedDB transaction). The page then shows the newer of what it showed and what the phone keeps, and drops the balance fragment from its address (`history.replaceState`). At a launch the kept balance waits for the intake at most 300 ms.
- **The service worker** (D7), where it still gets pushes (a computer's Chrome): it reads the same fragment and checks it with its own subscription, keeps the balance by the same rule, and sends no report.
- **Live or not** (D8): `BalanceHeader` gets `state: "live" | "waiting" | "stale"`, which `screenState` works out from two facts. One is whether the shown balance is this opening's successful read; the other is whether a request that can confirm it is out. A return to the app is an opening and clears the first fact.
- **The waiting clock** (D9): the token `--duration-wait` (1500 ms), the design system's `amount-*` and wait-bar utilities in `theme.css`, and one helper that pins every waiting animation to the document timeline's zero. It does so with a negative `animation-delay` set when the animation starts, not with the reference's `startTime` write (WebKit settles a new animation's start time a frame late).
- **Removed** (D10): the arrival reports end to end, including the sign-in rule that never renewed the login for a report.
- **New public interfaces:** `BalanceInAddress` (server); `notificationBalance.ts`, `notificationIntake.ts`, `waitClock.ts` and `BalanceState` (frontend); `keepPushedBalance` renamed `keepNotificationBalance`. **Removed:** `POST /api/push/arrivals`.
- **Integration points:** Apple's and the other push services (content per device, no change to the protocol); the design system 1795729428-c64a and the Screens design 1795730957-a463 (D14); the API contract (regenerated).
- **Hard to reverse:** the fragment's name and format and the code's salt and label (D2, D3). A notification already in a Notification Center keeps them until it is gone, so a later change must read them or ignore them. Nothing else.

## Context

See proposal.md (Why) for the motivation and the spike's findings. The current state this design builds on:

- **The server's push** (c011, c014): `PushMessages.DeclarativeJson` writes `{web_push, notification: {title, body?, navigate, data?: {balance}}, mutable?}`. `SendPushHandler.Send` builds one `OutgoingPush` for every device, and `WebPushDelivery` encrypts it per device with the device's `P256dh` and `Auth` (RFC 8291). A `PushDevice` holds `Auth`, the subscription's 16-byte secret in base64url, validated at registration (spec push-devices).
- **The service worker** (c012, c015, c016): `listenForPushes` keeps `pushedBalance(event)` through `keepPushedBalance` (c015 D3's rule, one `update` transaction). It reports the arrival through `reportArrival` (`fetch`), and leaves a proposed notification alone or shows its own (data: `navigate`). On the iPhone it runs only for `mutable` pushes.
- **The page:** `useAccountScreen` loads the kept balance at start, beside the question who is signed in. It shows `balance ?? stored`: the latest read, else the kept one. `watchRefreshTriggers` repeats the read on every return and on `online`, and `watchReturns` runs the subscription's upkeep. `pushRegistration()` reaches the registration through `getRegistration()`, never `ready`, which never settles without a worker (c013 D1).
- **The header:** `BalanceHeader` has no state; the amount is always `text-ink`. `WakingUp`'s bar runs `animate-progress-indeterminate`, 1.5 s with `ease-standard`, a 40 % segment translated from −100 % to 250 % of itself, which is −40 % to 100 % of the track, exactly the design's path.
- **Tests:**
  - The test device (`Drivers/TestDevice`) holds its own `Auth` and decrypts with the test kit's own RFC 8291 code. `PushReceived` reads `mutable` and `data.balance`.
  - The frontend has a service worker stand-in (`src/test/serviceWorker.ts`) and push stand-ins (`src/test/push.ts`; registration, subscription with `getKey`).
  - Vitest's jsdom environment keeps Node's WebCrypto: `crypto.subtle` with HKDF ran in a throwaway Vitest 5.1.0 / jsdom 31.0.0 run on 2026-11-27, though jsdom's own `window.crypto` has no `subtle`.

## Goals / Non-Goals

**Goals:**

- One construction for the fragment and its code, written once on each side (C# and TypeScript), pinned by one known-answer vector that neither implementation computed.
- One rule for keeping a notification's balance, whatever brought it (a tap, the list, the service worker): c015's, in one transaction.
- One clock for everything that waits, and a header state derived from facts, never set by hand.
- Removing the arrival reports leaves no trace in code, contract, docs or tests, except the archived change and the history.

**Non-goals** (beyond the proposal's):

- No cap on how many listed notifications the intake reads: iOS lists only those still in Notification Center.
- No retry of a failed intake: the next opening runs it again, and the server's read is the truth.
- No change to when "Obnovuji…" shows (D8).

## Decisions

### D1 — The account's notifications are plain declarative pushes

- **What:** `PushMessages.DeclarativeJson` never writes `mutable` or `notification.data`. With a balance, only `navigate` changes (D2).
- **Why** ([#91's cause comment](https://github.com/jakubbohm/RevolutReader/issues/91#issuecomment-7189303142); [spikes/notification-balance/README.md](../../../spikes/notification-balance/README.md) § Why `data` is `null`, WebKit main read 2026-11-27):
  - For a declarative push without `mutable`, iOS's push daemon shows the notification itself (`WebPushDaemon.mm`, `handleIncomingPushImpl`).
  - With `mutable`, it must first start the app's service worker, and when that fails, the push is held or lost. That is #91: two notifications held 64 and 80 minutes, while the owner's plain message in between arrived at once (ADR-0010, note of 2026-11-21).
- **Consequence:** on the iPhone the service worker no longer runs for any push. c015's way of keeping the pushed balance (the push handler) ends there, and D5 replaces it. c016's report ends with it (D10).
- **Reverses** c014 D14 (`mutable` and `data.balance`) and the iPhone half of c015 D2–D4. On a browser that fires the push event for every push, the service worker still keeps the balance (D7).

### D2 — The balance travels in `navigate`'s fragment

- **The address:** `navigate = <app's address>/#balance=<payload>.<code>`. The page is the check's `/`. A message with a balance whose page has a fragment of its own gets the balance's in its place; only the check sends a balance, always with `/`.
- **The payload:** the balance's JSON exactly as `GET /api/balance` writes it (the same converters: JSON numbers for `amount` and `czkPerEur`, ISO 8601 text for `readAt`), UTF-8, base64url without padding. On the phone it is decoded and checked by `balanceOf`, the one shape check for the API's answer, the kept record and a push's balance (c009 D4, c015 D2).
- **The code:** base64url without padding of the 32-byte HMAC (D3), always 43 characters.
- **Why this format:**
  - base64url's characters are all allowed in a fragment unescaped (RFC 3986 § 3.5), so the address survives every hop unchanged. The spike saw iOS hand the `#` over intact (`#t9`).
  - A readable `amount=…&readAt=…` would need escaping for `:` and `+`, and `URLSearchParams` reads `+` as a space.
  - JSON keeps one parser and one shape check.
  - The name `balance=` lets the page tell a balance fragment from any other: it removes only that kind.
- **One carrier:** the balance travels only here, never also in `data` (the owner, decision 4b): two carriers would need two rules, and iOS drops `data` anyway.
- **Size:** about 200 characters of `navigate` with the app's address, well under 3993 bytes. `PushMessages.Check` measures a balance message with a 16-byte zero secret; the code's length does not depend on the key, so the size is exact.
- **Never logged:** the server logs nothing of a push's content (c011 D4); the fragment never reaches the server (RFC 3986 § 3.5: a browser sends no fragment), and the page removes it from its address (D6).

### D3 — The check code, from the push subscription's secret

- **The construction:**
  - `key = HKDF-SHA-256(IKM = auth, salt = ASCII "tarjeta-papa", info = ASCII "notification balance check code v1", L = 32)` (RFC 5869).
  - `code = HMAC-SHA-256(key, ASCII(payload))`, the payload's base64url text as sent.
  - `auth` is the push subscription's authentication secret, 16 bytes (RFC 8291 § 3.2). The server has it as `PushDevice.Auth`. The page and the service worker read it with `pushManager.getSubscription()` and `getKey("auth")`.
- **Why it proves the server made the balance for this phone:**
  - The secret is made by the browser and shared with the application server only. It is never sent to the push service, which sees only the encrypted push (RFC 8291 § 3.2, § 1). Apple, a link's author, a web page and a chat message cannot know it.
  - So a valid code means: the server made this fragment for the subscription the phone holds now.
- **Why the derivation is separate from Web Push's own use of the same secret:**
  - RFC 8291 § 3.3 uses `auth` as HKDF's *salt*, with the ECDH secret as the keying material and its own info `"WebPush: info" 0x00 ua_public as_public`.
  - Here `auth` is the *keying material*, under a different salt and a different info. HKDF's outputs for different salts and infos are independent (RFC 5869 § 3.1, § 3.2), so the code key reveals nothing of the content keys, and no value is used for two purposes.
  - The label's `v1` lets a later construction live beside this one.
- **Strength:** a 128-bit random secret and a full 256-bit tag. An attacker has no oracle: the phone checks locally and answers nothing.
- **Replay:** a genuine fragment shown again (an old notification, or the address in the history before the page cleans it) is a real balance the server read. c015's `readAt` rule never lets it replace a newer one. A fragment from another device fails on this one (`auth` differs), and would be genuine anyway.
- **When the secret changes** (the subscription replaced because of a new server key, lost, or made again after a sign-in; c013): notifications made for the old one stop verifying, and their balances are ignored. This is a safe failure, rare, and the server's read covers it.
- **Constant time:** WebCrypto's `verify` and .NET's `CryptographicOperations.FixedTimeEquals` (used by the test kit, never needed by the server, which only signs). The page compares nothing itself.
- **Not chosen** (the owner, 2026-11-27):
  - **(b) A separate signing key**, ECDSA with its public half served to the page. It would mean a new secret in Key Vault, a hand-provisioned rotation, an endpoint or a setting for the public half, and one payload for all devices. It proves the same, at more cost.
  - **(c) No code, accepting the risk.** A link such as `https://<app>/#balance=…` could plant a made-up balance. It would show at once (grey), stay offline, and with a far-future `readAt` block every notification's balance until the next read.
- **Software factory:** lessons.md R-108 (D13).

### D4 — The sender builds each device's push

- **When the message has a balance,** `SendPushHandler` builds each device's content: `PushMessages.DeclarativeJson(message, Push:Subject, secret)`, where `secret` is the device's `Auth` decoded (base64url, 16 bytes). Lifetime and urgency are unchanged (24 h, `high`). Delivery, gone devices, counts and logs stay exactly as they are.
- **Without a balance** (the owner's messages), one content for all devices, as today.
- **A stored `Auth` that does not decode to 16 bytes** is impossible through registration (spec push-devices: 16 bytes, refused otherwise). If the table held one anyway, it is a bug or a broken store: an exception, as the encryption library already throws on such a key today. It is never a counted failure.
- **No change to the port** `IPushDelivery`: it already takes the device and its own `OutgoingPush`.

### D5 — Where the page finds a notification's balance

From the spike's answers (on the iPhone, iOS 27.2.1):

| How the app comes to the front | The tapped notification's balance | Other notifications' balances |
|---|---|---|
| Launch by a tap (app closed) | `location.hash` at the start | `getNotifications()` (the tapped one is never listed) |
| Launch from the icon | none | `getNotifications()`; opening removes none |
| Return by a tap, same page | `hashchange`, fired while still hidden | `getNotifications()` at the return |
| Return by a tap, another page | a full load of `navigate` 80–173 ms after the return: a launch | as at a launch |
| Return without a tap | none | `getNotifications()` at the return |

- **The intake runs:**
  - at every launch (the page's address and the list);
  - at every return to the screen (`visibilitychange` to visible: the list, and the page's address in case);
  - on every `hashchange` (the page's address).
- **The list** is `registration.getNotifications()` on `pushRegistration()`'s registration. Each notification's `navigate` is read when it is a string. The service worker's own notifications on a computer have no `navigate` (their address is in `data`), and their balances were kept when their pushes arrived (D7).
- **The secret** is `(await registration.pushManager.getSubscription())?.getKey("auth")`. With no registration, no subscription or no secret, nothing counts: without notifications there are none to read.
- **Every call is the browser's own and may fail or hang;** each failure means no balance this time, never an error on screen (D12, Error model).

### D6 — What the intake keeps, shows and cleans up

- **Which one:** from every candidate (the page's address and the listed `navigate`s), the balances whose code verifies (D3) and whose shape is right (`balanceOf`). Of those, the newest `readAt`, compared as moments (`Date.parse`).
- **Kept by c015's rule:** `keepNotificationBalance` (today's `keepPushedBalance`, renamed because it no longer comes only from a push). It replaces the kept balance only when one of the right shape is kept and the new one was not read earlier, in one `update` transaction (c015 D3). So a day-old notification never overwrites a newer read (the owner, 2026-11-27). It never creates a record (c015 D7), and never rejects. The page's own read keeps `storeBalance`'s unconditional replace.
- **Shown:** after the intake the screen reloads the kept balance. It shows the newer of what it showed and what the phone keeps, by `readAt`. A newer kept balance is never shown in ink (D8). A phone that keeps none shows none, as the spec's "stores none" scenario requires, and a balance forgotten at a sign-out never shows again.
- **The address cleaned:** when the page's own fragment is a balance fragment (`balance=`), valid or not, the page replaces its address with the same path and query and no fragment (`history.replaceState`, which fires no `hashchange`). A bookmark, a share or the back button then never carries it.
- **At a launch, the kept balance waits for the intake,** at most 300 ms *(propose)*:
  - Without the wait, a tap would flash the older kept balance for a frame or two before the notification's.
  - Without the cap, a browser call left hanging would hide the kept balance until the server answers, against "A kept balance shows at once" (spec app-shell).
  - An intake that ends after the cap still updates the screen when it ends.
  - The cap is a timer of the page's own, so the tests' clock drives it.
- **The spike's surprise:** iOS once removed five older notifications at a tap. A notification is not sure to stay, so the intake only ever adds a chance to show a newer balance sooner, and the server's read stays the truth.

### D7 — The service worker on a browser that fires every push

- **Where it runs:** a computer's Chrome, or any browser that does not show declarative pushes itself; Safari never starts it for a plain push (D1).
- **The balance:** `pushedBalance(event, secret)` reads `navigate` from the browser's proposed notification when the event carries one, else from the push's JSON (c015 D2's order, now for `navigate`). It checks the fragment as the page does, with `self.registration.pushManager.getSubscription()`'s secret. It keeps the balance with `keepNotificationBalance` under `event.waitUntil`, never rejecting (c015 D4).
- **The notification:** shown exactly as today: left alone when the browser proposes one, otherwise `showNotification` with `data: navigate`, starting in the same turn, never waiting for the balance. A tap opens `navigate`'s path, query and fragment on the worker's own origin. The page, once open, cleans its address (D6) and finds the balance already kept.
- **Gone:** `reportArrival`, and `PushWorker.fetch`. `PushWorker.registration` gains `pushManager.getSubscription()`.
- **Still never loads the API client** (c015 D5): `notificationBalance.ts` imports only `balanceRecord.ts`, and `tsconfig.sw.json`'s `WebWorker` typecheck guards it.

### D8 — Whether the balance is live: the header's state

- **The facts** (`screenState.Facts`):
  - `balance`: the shown balance, the newer of the latest read and the kept one (D6);
  - a new `confirmed`: the shown balance is the one this opening's latest balance read returned, and that read succeeded.
- **The derivation** (`headerOf`), from the design system's table (BalanceHeader § Live or not):
  - `live` when `confirmed`;
  - otherwise `waiting` when a request that can confirm it is out: who is signed in is being asked (`session === "waiting"`), or a balance read runs (`reading !== "no"`);
  - otherwise `stale`.
- **What sets `confirmed`** (`useAccountScreen`):
  - A successful read sets it.
  - Any other outcome of a read clears it: offline, a bank problem, an unexpected answer, the 60 s limit. That includes a failed "Obnovit" (the owner, decision 3b), so a failed refresh turns a live balance stale.
  - **Every return to the screen clears it** (the owner, decision 3a: every return is an opening), so the balance is waiting until that return's read answers.
  - An intake that shows a newer balance clears it.
  - A login's end clears everything, as today.
- **"Obnovit" on a live balance** keeps `confirmed` while it runs: ink, "Obnovuji…" and the busy button (design: "shine a live balance during `Obnovit`" is a Don't).
- **The freshness line keeps its rules** (`readsOnAwake`): the read time while the server wakes (the WakingUp board), "Obnovuji…" while a read runs on an awake server.
  - The design's README says a stored balance shows "Obnovuji…" from the start, "before WakingUp appears". The app shows it once the balance read starts, after the answer to who is signed in: about 100 ms on an awake server.
  - Changing that would change spec app-shell's "A stored balance shows at once while the server wakes" ("Aktualizováno před 2 h" at once), which the owner did not ask for.
- **Spoken:** nothing changes. The state is a class and a `data-balance` attribute, never text, and no `aria-busy` on the header (the design: some readers then skip the amount).
- **Who shows what:** `screenState` derives, `AccountScreen` passes `state` on, and `BalanceHeader` maps it to the amount's class (D9). A placeholder header has no state.

### D9 — The waiting clock: tokens, utilities and components

Read from the design system 1795729428-c64a (`project/README.md` § Visual foundations › Motion, § States, § Accessibility; `tokens.json`; `tailwind/theme.css`; `components/BalanceHeader/README.md`; `components/WakingUp/README.md`; `components/src/index.tsx`, `syncWaitClock` and `BalanceHeader`):

- **New token `--duration-wait: 1500ms`** in `theme.css`'s `@theme`. The owner decided it in the design loop (2026-11-26): "one cycle of every motion that says the app is waiting for the server, always with `ease-standard`".
- **Keyframes and utilities,** translated into the app's `theme.css` (the design's values, the app's names):
  - `wait-bar`: today's `progress-indeterminate` path, on `--duration-wait` and renamed. The bar keeps its transform (cheaper than the reference's `left`), and the motion is the same.
  - `wait-shine`: background positions from −66.667 % to 166.667 % for a 40 %-wide band, which moves it from −40 % to 100 % of the amount.
  - `live-settle`: from opacity 0.7.
  - `amount-waiting`: muted text, and inside `@supports (background-clip: text)` the band of `--color-ink` over a muted base, clipped to the text, `-webkit-text-fill-color: transparent`, `wait-shine` on `--duration-wait` with `--ease-standard`. Under reduced motion, no animation, no image, and the fill is the current colour.
  - `amount-stale`: muted.
  - `amount-live`: ink, `live-settle` over `--duration-base` once. Under reduced motion, none.
  - `animate-progress-indeterminate` goes; `WakingUp` takes `animate-wait-bar`, and its reduced-motion fallbacks stay.
- **One phase, `syncWaitClock`, changed in how it pins** *(propose)*:
  - The reference sets each waiting animation's `startTime` to 0 in a layout effect. WebKit settles a new CSS animation's start time only on the next rendering frame; until then `getAnimations()` may not list it ([WebKit bug 265280](https://bugs.webkit.org/show_bug.cgi?id=265280) and its discussion, read 2026-11-27, status not shown), and a layout effect runs before that frame.
  - So the app's `waitClock.ts` pins the phase instead with a negative `animation-delay`: `-(document.timeline.currentTime mod 1500) ms`. It is set on the element once, when its waiting animation turns on (a layout effect on the change, never recomputed while it runs, since a changed delay would shift a running animation).
  - Both the bar and the shine thus start at the document timeline's zero, whichever mounted first, the same end as the reference's. They stay in phase within one frame.
  - Under reduced motion there is no animation, and the delay does nothing.
- **`BalanceHeader`:** a new prop `state` (default `live`) maps to `amount-live`, `amount-waiting` or `amount-stale` on the amount, `data-balance={state}` on the section, and the wait clock while `waiting`. The koruna line and the freshness line are unchanged (the design: the koruna line keeps 4.5:1 and does not shine).
- **Contrast,** from the design: grey `color-ink-muted` on `color-background` is 5.7:1 light and 7.9:1 dark, against 3:1 needed at 44 px. The band's edges equal the grey, so the shine only raises contrast.
- **No new component.** The token and the prop are the design loop's, decided by the owner (2026-11-26).

### D10 — The arrival reports removed

Decided by the owner (2026-11-27, decision 3: remove entirely).

- **Server:** `ArrivalReportEndpoint`, `ArrivalReportRequest`, `RecordArrivalHandler` and `ArrivalDelay` deleted. `PushLog.PushArrived` deleted. Their registration in `PushRegistration` deleted. `SignInRegistration.NeverRenewForAnArrivalReport` and its use deleted: no request is exempt from renewing the login any more.
- **Contract:** `POST /api/push/arrivals` leaves `openapi.json`, and `ArrivalReportRequest` leaves `schema.d.ts` (regenerated, both committed). The address then answers as every unknown `/api` address does (spec api-errors), with no new scenario: it is the existing rule.
- **Frontend:** `arrivalReport.ts` and its test deleted; `pushDisplay.ts` loses the report (D7). The service worker stand-in's `fetch` hand-off (`src/test/serviceWorker.ts`, testing.md § the worker's own requests) goes when nothing uses it.
- **Tests deleted:**
  - `Scenarios/PushArrivals/`, `Conventions/PushArrivalLoginTests.cs` and `PushArrivalTelemetryTests.cs`;
  - `Drivers/ArrivalDriver.cs`, `Dsl/ArrivalDsl.cs` and `ReportAnswer.cs`;
  - `IntegrationTests/Wiring/Push/UnreadableArrivalReportTests.cs` and `UnitTests/Push/ArrivalDelayTests.cs`;
  - `src/scenarios/push-arrivals.test.ts`;
  - the arrival members of `AcceptanceTest`, `CapturedTelemetry`, `FakeBank`, `FakeCnb`, `FakePushService`, `BankOnWireMock`, `SubscriptionEndpointApp` and `src/test/server.ts`, wherever they serve only the reports.
  - The traceability check applies the REMOVED delta, so none of the 11 scenarios needs a claim; a claim left behind would name no scenario and fail it.
- **Docs:**
  - `deployment.md` § Push arrivals (c016) removed, and every link to it;
  - `testing.md`, `.claude/rules/testing.md`, `.claude/agents/runner.md` and `.claude/agents/test-writer.md` lose the reports' mentions;
  - `tests/manual-scenarios.md` loses its row;
  - `creating-handover-package.md`'s inventory rows describe `pushDisplay.ts` and the stand-in without the report.
  - `pm/progress.md` is frozen and stays.
- **The capability:** `openspec/specs/push-arrivals/` is left without requirements by the archive. The archive step removes the folder if the CLI leaves it (tasks, the close group).
- **Telemetry:** the `PushArrived` lines already exported age out with the workspace's retention. Nothing reads them.

### D11 — The spike's leftover record

- At every start, before anything else of the screen, the page removes `localStorage["tarjeta-papa.notification-test.record"]` (the owner, decision 4a). A failure (storage disabled) is ignored.
- It holds no bank data (times, addresses and counts of the test notifications; spike README § Verdict), so this is tidiness, not a fix.
- The line costs nothing and can stay. A later change may drop it once both phones have opened the app.

### D12 — Tests

- **The known-answer vector:**
  - Made once by the test-writer with Node's `crypto.hkdfSync` and `crypto.createHmac`, outside both implementations, from a made-up secret (bytes 0x00 to 0x0f) and a made-up balance (`{"amount":45.20,"readAt":"2026-11-21T09:14:03+00:00","czkPerEur":24.6}`).
  - Pinned as the exact fragment in `tests/RevolutReader.UnitTests/Push/BalanceInAddressTests.cs` and in `src/app/notificationBalance.test.ts`. The two implementations can then never drift apart unseen.
- **API acceptance kit** (the test-writer's):
  - `PushReceived` reads the balance from `navigate`'s fragment: `Balance` (the payload, read as `BalanceDriver` reads `GET /api/balance`), `CheckCodeAccepted` (verified with the receiving test device's own secret by the kit's own HKDF and HMAC, compared in constant time) and the raw `BalanceFragment`.
  - `Navigate` is the address without that fragment, so every existing scenario that names the page `/` keeps its claim unchanged.
  - `CarriesData` and `MarkedForServiceWorker` pin the absence of `data` and `mutable`.
  - `PhoneForPush.Accepts(PushReceived)` checks another device's fragment with this device's secret.
- **Frontend kit** (the test-writer's):
  - `src/test/push.ts`'s registration gains `getNotifications()`, listing what the test shows (`{ title, body, navigate }`), with fail and hang options.
  - A new `src/test/notificationBalance.ts` makes a fragment for a made-up secret with Node's `crypto` (not the production module), and a wrong code.
  - `renderApp` starts at an address with a fragment.
  - A tap in the background sets `location.hash` (jsdom fires `hashchange`), then the existing return helper.
  - A `balanceLook()` helper reads the header's `data-balance` as "grey, moving", "grey, still" or "ink", so a scenario reads as its spec.
- **Unit tests:** `BalanceInAddress` and `PushMessages` (server); `notificationBalance`, `notificationIntake`, `keepNotificationBalance`, `screenState`'s derivation, `waitClock`, `BalanceHeader` and the leftover's removal (frontend). They use hand-written fakes and no mocking framework.
- **Manual,** for what only the iPhone shows (§ How each scenario is verified): five rows, two of them existing rows rewritten.

### D13 — Records

- **ADR-0010,** a dated note (2026-11-27, c019):
  - the account's notifications are plain declarative pushes;
  - the balance is in `navigate`'s fragment with the per-device check code;
  - the sender builds a push per device for them;
  - the arrival reports are removed;
  - item 2's statement about `mutable` holds again for every push.
- **ADR-0007,** a dated note on item 3:
  - a notification's balance now reaches the record through the page, from its address and from the listed notifications;
  - the service worker writes it only where it gets the push;
  - the same rule (c015 D3), the newest of several.
- **Lessons:**
  - **R-107**, Reversal of R-88, R-95 and R-96, relates to R-89 and R-106: how a Home Screen web app on iOS gets a push's data onto the phone when the notification must show at once. Plain declarative push, the data in `navigate`'s fragment, and the page reads it from its own address and from `getNotifications()`. It also covers removing a measurement once the decision it served is made.
  - **R-108**, New: how a page tells that a value in its own address came from its server. A MAC under a key derived from the push subscription's secret, domain-separated from RFC 8291's use of it.
- **Docs:** D10's list; `testing.md` § the push kit (the fragment, the vector); `tests/manual-scenarios.md` (§ How each scenario is verified).
- **No new setting or secret**, so `configuration.md` and `local-secrets.md` stay. `CLAUDE.md`'s commands do not change.

### D14 — The design artifacts, and one wording to fix there

- **Read at:** the design system **1795729428-c64a**, and the Screens design **1795730957-a463** (its `canvas.json` names the same design-system version, copied 2026-11-26).
- **Design-system parts implemented:**
  - `BalanceHeader` (the `state` prop, the shine, becoming live, contrast, accessibility, the Don'ts);
  - `WakingUp` (the bar on the waiting clock);
  - `Banner` and `EmptyState` (only their stale wording; no code change);
  - `tokens.json`'s `duration-wait` and the `color-ink-muted` usage;
  - `tailwind/theme.css`'s waiting utilities;
  - `project/README.md` § Motion, § States, § Accessibility › Reduced motion, § What the phone stores.
- **Screens artboards:**
  - waiting: "Account / Detail / Waking up, balance stored" and "Account / Detail / Opening, balance stored";
  - stale: "Shell / Offline / Balance stored", "Account / Detail / Error – bank unavailable", "Account / Detail / Error – too many requests" and "Account / Detail / Error – bank link expired";
  - live while refreshing: "Account / Detail / Refreshing".
- **One wording behind the owner's later decision:** BalanceHeader's README lists "return to the app" among the refreshes that stay `live`, and its `waiting` row names only launch, "Zkusit znovu" and back online. The owner then decided that every return is an opening (decision 3a, 2026-11-27), after the design loop.
  - For behaviour the specs win (`.claude/rules/design.md`), so the app follows the decision, and no code waits on the design.
  - The design system's text should catch up through the design loop: the owner's step, with the prompt in this change's summary.

## Public API sketch

### Server (`src/RevolutReader.Api/Push/`)

```csharp
/// <summary>The balance in a notification's address (c019 D2, D3), pure.</summary>
public static class BalanceInAddress {
  /// <summary>The fragment's name: <c>#balance=&lt;payload&gt;.&lt;code&gt;</c>.</summary>
  public const string NAME = "balance";

  /// <summary>A push subscription's authentication secret, in bytes (RFC 8291 § 3.2).</summary>
  public const int SECRET_BYTES = 16;

  /// <summary><c>balance=&lt;payload&gt;.&lt;code&gt;</c>, without the <c>#</c>; throws <see cref="ArgumentException"/> for a secret not of 16 bytes.</summary>
  public static string Fragment(PushBalance balance, ReadOnlySpan<byte> deviceSecret);

  /// <summary>The balance's JSON as <c>GET /api/balance</c> writes it, UTF-8, base64url without padding.</summary>
  public static string Payload(PushBalance balance);

  /// <summary>HMAC-SHA-256 of the payload's text under the key HKDF derives from the secret (D3), base64url, 43 characters.</summary>
  public static string CheckCode(string payload, ReadOnlySpan<byte> deviceSecret);
}

public static partial class PushMessages {
  // Unchanged signature; a message with a balance is measured with its fragment (a zero secret: the code's length is fixed).
  public static IReadOnlyList<RefusedMember> Check(PushMessage message, Uri appAddress);

  // Never `mutable`, never `data`. With a balance, `navigate` carries `#` + BalanceInAddress.Fragment(balance, deviceSecret)
  // in place of the page's own fragment; throws ArgumentException when the message has a balance and the secret is not 16
  // bytes. Without a balance the secret is not read.
  public static string DeclarativeJson(PushMessage message, Uri appAddress, ReadOnlySpan<byte> deviceSecret = default);
}

// SendPushHandler.Send: signature unchanged; one OutgoingPush per device when message.Balance is set (D4).
// Deleted: ArrivalReportEndpoint, ArrivalReportRequest, RecordArrivalHandler, ArrivalDelay, PushLog.PushArrived,
//          SignInRegistration.NeverRenewForAnArrivalReport.
```

### Frontend (`src/RevolutReader.Web/src/`)

```ts
// app/notificationBalance.ts — shared by the page and the service worker; imports only ./balanceRecord (c015 D5).
export const BALANCE_FRAGMENT = "balance";
/** Whether `address`'s fragment is a balance's (`#balance=…`), whatever its code: the page removes such a fragment. */
export function carriesBalance(address: string): boolean;
/** The balance in `address`'s fragment when its code verifies under `secret` (D3) and `balanceOf` accepts its shape; else null. Never rejects. */
export function balanceInAddress(address: string, secret: ArrayBuffer | null): Promise<Balance | null>;
/** The balance read last, `readAt` compared as moments; null for none. */
export function newest(balances: readonly Balance[]): Balance | null;

// app/notificationIntake.ts — the page's (D5, D6).
export interface IntakeOutcome {
  /** A balance was kept in place of the one before. */
  kept: boolean;
}
/**
 * Takes in the newest valid balance of the page's own address (`fromAddress`) and of every listed notification's
 * `navigate` (`fromList`), kept by `keepNotificationBalance`; removes a balance fragment from the page's address. Never
 * rejects: every browser call that fails means no balance from it.
 */
export function takeInNotificationBalances(options: {
  fromAddress: boolean;
  fromList: boolean;
  browser?: Window;
}): Promise<IntakeOutcome>;
/** Runs `onChange` on every `hashchange` (D5); returns the stop function. */
export function watchAddress(onChange: () => void, browser?: Window): () => void;
/** The launch's wait for the intake (D6). */
export const LAUNCH_INTAKE_LIMIT_MS = 300;

// app/storedBalance.ts — keepPushedBalance renamed; the same rule (c015 D3). Resolves whether it replaced; never rejects.
export function keepNotificationBalance(balance: Balance): Promise<boolean>;

// app/pushDisplay.ts — no report, no fetch (D7).
export interface PushWorker {
  location: { origin: string };
  registration: {
    showNotification(title: string, options?: { body?: string; data?: unknown }): Promise<void>;
    pushManager: { getSubscription(): Promise<{ getKey(name: "auth"): ArrayBuffer | null } | null> };
  };
  clients: {
    /* unchanged */
  };
  addEventListener(/* unchanged */): void;
}
/** The balance in the push's `navigate` (the proposed notification's, else the JSON's), checked with `secret`; null otherwise. */
export function pushedBalance(event: PushLike, secret: ArrayBuffer | null): Promise<Balance | null>;

// app/screenState.ts (D8)
export type BalanceState = "live" | "waiting" | "stale";
// Facts gains: confirmed: boolean
// ShownAccount["header"]: { balance: Balance; refreshing: boolean; state: BalanceState } | "placeholder" | null

// components/waitClock.ts (D9)
/** The negative delay that puts a `--duration-wait` animation starting now in the document timeline's phase. */
export function waitClockDelay(now?: number): string;
/** A ref whose element gets `waitClockDelay()` as its animation delay each time `active` turns on (a layout effect). */
export function useWaitClock<T extends HTMLElement>(active: boolean): RefObject<T | null>;

// components/BalanceHeader.tsx — BalanceHeaderProps gains: state?: BalanceState (default "live")

// app/leftovers.ts (D11)
/** Removes the #113 spike's record from `localStorage`; a failure is ignored. */
export function removeSpikeLeftovers(storage?: Storage): void;
```

### Acceptance DSL (`tests/RevolutReader.AcceptanceTests/`)

```csharp
public sealed record PushReceived(
  string Title, string? Text,
  string Navigate,               // the address a tap opens, without its balance fragment
  int? LifetimeSeconds, string? Urgency,
  bool SignedWithServerKey, bool ReachedThePhone,
  bool MarkedForServiceWorker,   // "mutable": true at the top level
  bool CarriesData,              // notification.data is present
  BalanceReading? Balance,       // the fragment's payload, read as GET /api/balance's answer; null without a fragment
  bool CheckCodeAccepted,        // the fragment's code verifies under the receiving phone's own secret (the kit's own HKDF/HMAC)
  string? BalanceFragment);      // the raw fragment, for another phone to try

// PhoneForPush: bool Accepts(PushReceived push) — the push's fragment verifies under this phone's secret.
```

## Rule ownership

| Rule (spec) | Enforced by |
|---|---|
| No push carries `mutable` or `data` (push-sending) | `PushMessages.DeclarativeJson` |
| A notification about the account carries its balance in `navigate`'s fragment (push-sending, account-check) | `PushMessages.DeclarativeJson`, `BalanceInAddress.Fragment` |
| The check code is made for each device from its secret (account-check) | `BalanceInAddress.CheckCode`; `SendPushHandler` (a push per device) |
| A balance message fits a push (push-sending, size) | `PushMessages.Check` |
| A balance counts only with this phone's check code and the right shape (push-display) | `notificationBalance.balanceInAddress` (`balanceOf` for the shape) |
| Of several, the balance read last counts (push-display) | `notificationBalance.newest`, used by the intake |
| Kept only over a kept balance, and only when not read earlier (push-display; c015 D3) | `storedBalance.keepNotificationBalance` |
| Where the page looks: its own address at a launch and on `hashchange`, the list at every launch and return (push-display) | `notificationIntake`, called by `useAccountScreen` |
| The address carries no balance once read (push-display) | `notificationIntake` (`history.replaceState`) |
| The service worker keeps a pushed balance where it gets the push (push-display) | `pushDisplay.listenForPushes`, `pushedBalance` |
| Ink only for this opening's successful read; every return an opening; "Obnovit" keeps ink; a failed read turns grey (account-balance) | `useAccountScreen` (`confirmed`), `screenState.headerOf` (`state`) |
| Grey moves while a request is out, else stands still (account-balance) | `screenState.headerOf`; `theme.css` (`amount-waiting`, `amount-stale`) |
| In step with the waking-up bar (account-balance) | `waitClock` (`--duration-wait`, the phase), `BalanceHeader`, `WakingUp` |
| Nothing more spoken (account-balance) | `BalanceHeader` (class and data attribute only) |
| Reduced motion stands still, grey stays (account-balance) | `theme.css` (`prefers-reduced-motion` in the utilities) |
| The spike's record is removed (D11) | `leftovers.removeSpikeLeftovers`, called at start |

## Error model

- **Server:**
  - `BalanceInAddress` and `PushMessages` are pure, and their only failure is a caller's bug: a secret not of 16 bytes, or a message `Check` refuses. That throws `ArgumentException`, naming the member, never a value.
  - `SendPushHandler` lets a stored secret that does not decode throw: an infrastructure fault, as the encryption library throws for one today (D4).
  - Expected failures stay Result values as they are (`AccountNotAllowed`, the delivery outcomes). No new endpoint and no new ProblemDetails.
- **Frontend:** a notification's balance is a convenience, so nothing in the intake, the check or the keep ever rejects or shows an error.
  - A failed or refused browser call means no candidate from it, whether it is `getRegistration`, `getNotifications`, `getSubscription`, `getKey`, `crypto.subtle` or IndexedDB.
  - A malformed fragment is no balance.
  - A launch's hanging intake is capped (D6).
  - A hanging notification list holds back only the list's balances: the intake reads its address once at its start, keeps the address's balance and cleans the address first (chapter C's review, C-1).
  - A hanging `getRegistration` or `getSubscription` holds back the whole intake, its cleanup included, until it ends.
  - An intake cleans only the fragment it read itself, and only while the address still carries it, so an intake still under way never removes a newer fragment that a tap brought (C-2).
  - `removeSpikeLeftovers` ignores a throwing `localStorage`.
- **The service worker:** the same, under `waitUntil`. The notification never waits for the balance (D7).

## Ports and contracts

- **`IPushDelivery`:** unchanged (c011 § Ports and contracts). It already takes one `OutgoingPush` per device, and its fake (`StubPushDelivery`) records each device's content, so unit tests can read every device's fragment.
- **`IPushDeviceStore`:** unchanged; `Auth` is read, never written, by this change.
- **The browser's notification list** (`ServiceWorkerRegistration.getNotifications()`), a platform API rather than a port of ours:
  - Its contract, from the spike: it lists the notifications still in Notification Center, including ones the browser showed itself, each with `navigate`, its fragment included. Their `data` is `null`.
  - The tapped notification is never listed. Order is not relied on. It may fail or hang.
  - The tests' stand-in (`src/test/push.ts`) follows this contract, with options to fail and to hang.
- **The push subscription's secret** (`getKey("auth")`): an `ArrayBuffer` of 16 bytes, or `null`. The stand-in's subscriptions already answer `getKey`.

## How each scenario is verified

| Capability / scenario | Level | Why not an API acceptance test |
|---|---|---|
| account-check / The notification carries the new balance for the phone to keep (modified) | API acceptance | — |
| account-check / Each device's notification carries a check code of its own | API acceptance | — |
| account-check / A real payment brings the notification on the iPhone (modified) | manual, row rewritten | Only the real iPhone, Apple's push service and the Shortcut show the delay #91 was about |
| push-sending / both scenarios (text unchanged) | API acceptance, existing tests | — |
| push-display / A tap on a notification with a balance replaces the balance the phone keeps | frontend | The page reads its own address and the phone's store; no API is involved |
| push-display / A tap on a notification while the app is in the background replaces the balance the phone keeps | frontend | As above (`hashchange`) |
| push-display / Opening the app from its icon takes the balance of a notification still shown | frontend | The browser's notification list, a stand-in to its contract (§ Ports) |
| push-display / Coming back to the app takes the balance of a notification still shown | frontend | As above, at a return |
| push-display / Of several notifications, the balance read last is kept | frontend | As above; the newer one listed first, so a list order cannot pass it |
| push-display / A push with a balance replaces the balance the phone keeps (modified) | frontend, service worker stand-in | The service worker's push handler |
| push-display / A push with a balance read earlier than the kept one leaves it as it was (modified) | frontend | The phone's store and c015's rule |
| push-display / A push with a balance stores none on a phone that keeps none (modified) | frontend | As above |
| push-display / The app's address carries no balance once the app has read it | frontend | The page's own address |
| push-display / A push without a balance leaves the kept balance as it was (text unchanged) | frontend, existing test, the push in the new format | The service worker |
| push-display / A push with a balance of the wrong shape leaves the kept balance as it was (text unchanged) | frontend, existing test: a fragment with a valid code over a payload without `readAt` | The service worker |
| push-display / A balance without this phone's check code leaves the kept balance as it was | frontend | The page's check of its own address |
| push-display / A payment's notification on the iPhone opens the app on its balance (text unchanged) | manual, row rewritten | Only iOS shows that its push daemon hands the `#` to a tap |
| push-display / A payment's notification on the iPhone brings its balance to an opening from the icon | manual, new row | Only iOS lists its own notifications to the page |
| account-balance / A stored balance is grey and moving while the server wakes | frontend | The header's look; the server is the fake server |
| account-balance / A stored balance is grey and moving while an awake server answers | frontend | As above |
| account-balance / The balance turns ink when the server's balance arrives | frontend | As above |
| account-balance / Offline, the stored balance is grey and still | frontend | As above |
| account-balance / After a failed read, the stored balance is grey and still | frontend | As above |
| account-balance / A failed refresh turns the balance grey | frontend | As above |
| account-balance / A refresh keeps a confirmed balance in ink | frontend | As above |
| account-balance / Coming back to the app turns the balance grey until the answer | frontend | As above |
| account-balance / A grey balance is spoken as a balance in ink | frontend | The header's accessible text |
| account-balance / The grey balance moves in step with the waking-up bar | manual, new row | jsdom runs no animation; only the phone shows the two moving as one |
| account-balance / Under reduced motion the grey balance stands still | manual, new row | `prefers-reduced-motion` acts in CSS, which jsdom does not apply |

- **The iPhone rows** are run together, after the deploy, by the owner, on the owner's iPhone. The owner checks the fix by hand, with no replacement measurement (the owner, decision 6).
  - The opening-from-the-icon row needs a payment whose notification is left untapped.
  - The two motion rows need a sleeping server, so the first opening after a quiet spell, with Reduce Motion on for the second.
- **The M7 column** names the daughter's phone as before.

## Cross-cutting effects

- **API contract:** an endpoint is removed. `openapi.json` and `schema.d.ts` are regenerated (`npm --prefix tools/api-client run regenerate`), and no TS consumer is left (`arrivalReport.ts` goes).
- **AppHost and Azure:** no change: no resource, setting, secret or role. The Bicep stays.
- **Bank:** no change; ADR-0001 is not touched.
- **Logs:** one line fewer (`PushArrived`). Nothing new is logged. The guard tests of the account check's lines (c014 D15) keep finding no amount, and the fragment never reaches a log, since the server logs no push content.
- **Service worker update:** the new worker installs at each phone's next opening (`skipWaiting`, `clientsClaim`, c003 D9).

## Risks / Trade-offs

- **[iOS changes how it shows plain declarative pushes, or stops handing over `navigate`'s fragment]** → the manual rows check both after the deploy. The owner's plain messages have always arrived at once (ADR-0010). The worst case is the notification showing at once without its balance, and the server's read still giving it.
- **[iOS removes notifications before the app opens]** (seen once in the spike) → their balance is missed; the server's read is the truth.
- **[`background-clip: text` with `-webkit-text-fill-color` renders differently on an older iOS]** → it is inside `@supports`, and the fallback is the grey without the shine. The manual motion row checks it.
- **[The negative-delay phase drifts]** → it is pinned once per waiting episode to the timeline's zero, so any error is at most one frame, and the manual row checks it. If the bar and the shine ever disagree, only the look suffers.
- **[A replaced subscription makes older notifications' codes fail]** → their balances are ignored, a safe failure.
- **[A notification sent before the deploy]** carries `data` but no fragment → its balance is not taken in, a one-time gap closed by the next read.
- **[300 ms is too short on a slow phone]** → the intake still updates the screen when it ends (D6); the cap only bounds the wait for the kept balance.
- **[Per-device content costs more CPU]** → one HKDF and one HMAC per device per notification, microseconds, for at most a few devices.
- **Trade-off, two places that keep a notification's balance** (the page, and the service worker where it runs) → both call one function with one rule, `keepNotificationBalance`, in one IndexedDB transaction, so their order never matters (c015 D3).

## Bootstrap (before `/tdd-apply`)

None. No package, no setting, no table, no design asset to copy. The baseline holds one known exception, accepted once: the traceability check reports two kinds of finding until group 1 is done. First, this change's 20 new scenarios as not claimed, until group 1 claims them (the 5 modified ones keep their names, and so their claims). Second, the claims of the 11 removed scenarios as naming no scenario, until group 1 deletes those scenario tests (tasks.md 1.1). The removal of the code they tested follows in chapter C.

## Migration plan

1. **Merge and deploy** as one image: the server and the app change together.
2. **The first account notification after the deploy** is plain and carries the fragment. On the iPhone, iOS shows it at once, and the phone runs the new page at its next opening (the new worker installs at once, and the page reloads once to show it, c003 D9).
3. **A phone still on the old app** gets the new plain push shown by iOS. Its old page ignores the fragment until it updates, a gap of one opening.
4. **The owner's checks:** the manual rows, on the owner's iPhone, after the deploy (§ How each scenario is verified). They can only happen after the merge, so #91 stays open and names them, and the PR recording their results in `tests/manual-scenarios.md` closes it (CLAUDE.md § Project management, the exception for work on a real phone). This PR's description therefore says "for #91", never "closes".
5. **Rollback:** redeploy the previous image. The old server sends `mutable` again (#91 comes back) and accepts reports again. The old page ignores fragments, and nothing is lost: the kept record has the same shape.

## Open questions

None. The design-system wording (D14) is a step in the owner's design loop, and no code waits for it.
