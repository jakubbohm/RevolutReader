# Tasks: c019-show-balance-notifications-at-once

Before this list: design.md § Bootstrap (none) and the baseline. The baseline holds one known exception, accepted once: the traceability check reports the 20 new scenarios as not claimed, and the removed scenarios' tests as claiming no scenario, until group 1 is done.

Run with `/tdd-apply c019-show-balance-notifications-at-once` (GitHub issue #91, no roadmap step; the owner picks the review mode at the start). The change's scenarios (design.md § How each scenario is verified):

- **2 API acceptance tests** in `account-check`: 1 modified, 1 new.
- **22 frontend scenario tests:**
  - 13 in `push-display`: 7 new, 3 modified, and 3 whose text is unchanged but whose push or opening is rewritten for the address;
  - 9 new in `account-balance`.
- **5 manual rows:** 3 new, 2 rewritten.
- **11 removed** (`push-arrivals`): their tests go in 1.1.

The work is sliced per scenario. Slice 1 builds the server's whole path, and slice 3 the page's intake. Slice 13 builds the header's state.

Expected green on arrival, each accepted as a guard and proven by a mutation at its `[close]`:

- **Slice 2** (a code per device) follows from slice 1's push per device.
- **Slices 8 and 9** (older, none kept) follow from c015's rule in `keepNotificationBalance`.
- **Slice 11** (a code not made for this phone) follows from slice 3's check.
- **Slices 16 and 17** (offline, a failed first read) follow from slice 13's derivation.
- **Slice 19** ("Obnovit" keeps ink) follows from slice 14.
- **Slice 21** (spoken the same) follows from `BalanceHeader` adding no text.

Suggested chapters, which `/tdd-apply` confirms at the acceptance gate:

- **Chapter A:** group 1 alone.
- **Chapter B:** slices 1–2, the server: the balance in the address and a push per device (`BalanceInAddress`, `PushMessages`, `SendPushHandler`, the push kit).
- **Chapter C:** the removal of the arrival reports (no scenario; server, contract, frontend, docs).
- **Chapter D:** slices 3–11 and the spike's leftover, the page's intake (`notificationBalance`, `notificationIntake`, `storedBalance`, `useAccountScreen`).
- **Chapter E:** slice 12, the service worker (`pushDisplay`).
- **Chapter F:** slices 13–21, the grey look (`screenState`, `useAccountScreen`, `BalanceHeader`, `WakingUp`, `waitClock`, `theme.css`).

Conventions for the run:

- Docs tasks are the orchestrator's. Deleting a test is the test-writer's, and deleting production code the implementer's.
- **"Green"** means the full suite: `dotnet test` (Docker running; it holds the traceability check), and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck` and `format:check`. Exception: this change's acceptance tests that are still red stay red until their slice.
- **A mutation** (a guard slice's `[close]`): the orchestrator breaks the named rule in the production code by hand, runs the scenario's test and sees it red, then restores the code with `git restore` and sees it green. Nothing of it is committed; `.tdd-state.md` records what was broken and the red result.
- **UI slices (13–21):** the implementer gets the design files saved from the artifacts (design.md D9, D14; `/tdd-apply` § 0). From the design system 1795729428-c64a: `project/README.md`, `project/tokens.json`, `project/tailwind/theme.css`, `project/components/BalanceHeader/README.md`, `project/components/WakingUp/README.md` and `project/components/src/index.tsx`. From the Screens design 1795730957-a463: `account-waking-stored.dc.html`, `account-opening-stored.dc.html`, `shell-offline-cached.dc.html`, `account-error-bank.dc.html` and `account-refreshing.dc.html`. Read them again by link if a newer version exists.

## 1. [acceptance] Acceptance tests

- [x] 1.1 The removed scenarios' tests deleted (design.md D10), the test-writer's: `tests/RevolutReader.AcceptanceTests/Scenarios/PushArrivals/` and `src/RevolutReader.Web/src/scenarios/push-arrivals.test.ts`. The code they tested stays until chapter C. Verify: the build passes; the traceability check reports no claim naming a removed scenario
- [x] 1.2 Foundation (API), the push kit of design.md D12 and § Public API sketch, the test-writer's:
  - `PushReceived` gains `CarriesData`, `CheckCodeAccepted` and `BalanceFragment`;
  - `Balance` is read from `navigate`'s `#balance=<payload>.<code>`, and `Navigate` is the address without that fragment;
  - the receiving test device checks the code with its own secret, using the kit's own HKDF-SHA-256 (salt `"tarjeta-papa"`, info `"notification balance check code v1"`) and HMAC-SHA-256, compared in constant time;
  - `PhoneForPush.Accepts(PushReceived)`;
  - a `data` or a `mutable` is read, never a failed step, so a scenario can pin its absence.

  Verify: the build passes; every acceptance test that was green stays green, but for the one that reads `Balance` (1.4's): the old push carries no fragment, so it is red until slice 1, as expected
- [x] 1.3 Foundation (frontend), the test-writer's:
  - `src/test/push.ts`'s registration gains `getNotifications()` listing what the test shows (`{ title, body, navigate }`), with `getNotificationsFails` and `getNotificationsWaits`;
  - the service worker stand-in's `registration.pushManager.getSubscription()`;
  - a new `src/test/notificationBalance.ts`: `balanceAddress(balance, secret)` and `wrongCode(…)`, with Node's `crypto`, never the production module;
  - `renderApp` starting at an address with a fragment, and a background tap (set `location.hash`, then the existing return);
  - `balanceLook()` reading `data-balance` as "grey, moving", "grey, still" or "ink".

  Each helper has its own test next to it. Verify: those tests pass; the frontend checks are clean
- [x] 1.4 Acceptance: account-check / The notification carries the new balance for the phone to keep (modified: in the address, with a code the phone accepts; no `mutable`, no `data`)
- [x] 1.5 Acceptance: account-check / Each device's notification carries a check code of its own
- [x] 1.6 Acceptance: push-display / A tap on a notification with a balance replaces the balance the phone keeps (frontend)
- [x] 1.7 Acceptance: push-display / The app opened from a push's notification shows its balance while the server wakes (frontend; text unchanged, rewritten: the tap opens the app at the notification's address)
- [x] 1.8 Acceptance: push-display / A tap on a notification while the app is in the background replaces the balance the phone keeps (frontend)
- [x] 1.9 Acceptance: push-display / Opening the app from its icon takes the balance of a notification still shown (frontend)
- [x] 1.10 Acceptance: push-display / Coming back to the app takes the balance of a notification still shown (frontend)
- [x] 1.11 Acceptance: push-display / Of several notifications, the balance read last is kept (frontend; the newer one listed first)
- [x] 1.12 Acceptance: push-display / A push with a balance read earlier than the kept one leaves it as it was (frontend; modified: by a tap)
- [x] 1.13 Acceptance: push-display / A push with a balance stores none on a phone that keeps none (frontend; modified: by a tap)
- [x] 1.14 Acceptance: push-display / The app's address carries no balance once the app has read it (frontend)
- [x] 1.15 Acceptance: push-display / A balance without this phone's check code leaves the kept balance as it was (frontend)
- [x] 1.16 Acceptance: push-display / A push with a balance replaces the balance the phone keeps (frontend; modified: the service worker in a browser that does not show the message itself, the balance in `navigate`)
- [x] 1.17 Acceptance: push-display / A push with a balance of the wrong shape leaves the kept balance as it was (frontend; text unchanged, rewritten: a valid code over a payload without `readAt`)
- [x] 1.18 Acceptance: push-display / A push still shows its notification when the phone's storage fails (frontend; text unchanged, rewritten: the balance in `navigate`)
- [x] 1.19 Acceptance: account-balance / A stored balance is grey and moving while an awake server answers (frontend)
- [x] 1.20 Acceptance: account-balance / The balance turns ink when the server's balance arrives (frontend)
- [x] 1.21 Acceptance: account-balance / A stored balance is grey and moving while the server wakes (frontend)
- [x] 1.22 Acceptance: account-balance / Offline, the stored balance is grey and still (frontend)
- [x] 1.23 Acceptance: account-balance / After a failed read, the stored balance is grey and still (frontend)
- [x] 1.24 Acceptance: account-balance / A failed refresh turns the balance grey (frontend)
- [x] 1.25 Acceptance: account-balance / A refresh keeps a confirmed balance in ink (frontend)
- [x] 1.26 Acceptance: account-balance / Coming back to the app turns the balance grey until the answer (frontend)
- [x] 1.27 Acceptance: account-balance / A grey balance is spoken as a balance in ink (frontend)
- [x] 1.28 Acceptance: account-check / A real payment brings the notification on the iPhone (manual; the row rewritten: within a minute of Revolut's own notification, the app closed)
- [x] 1.29 Acceptance: push-display / A payment's notification on the iPhone opens the app on its balance (manual; the row rewritten for the address: no service worker any more, the new app opened once after the deploy)
- [x] 1.30 Acceptance: push-display / A payment's notification on the iPhone brings its balance to an opening from the icon (manual; a new row)
- [x] 1.31 Acceptance: account-balance / The grey balance moves in step with the waking-up bar (manual; a new row: the first opening after a quiet spell)
- [x] 1.32 Acceptance: account-balance / Under reduced motion the grey balance stands still (manual; a new row: Reduce Motion on, a sleeping server)

## 2. [unit] Slice 1 — The balance in the address

- [x] 2.1 The fragment of the known-answer vector is exactly the pinned one. The test-writer makes the vector once with Node's `crypto.hkdfSync` and `createHmac` (secret 0x00–0x0f, the balance of design.md D12) and records it in `.tdd-state.md` for slice 3
- [x] 2.2 The payload is the base64url of the JSON `GET /api/balance` writes for the same balance
- [x] 2.3 The check code is 43 base64url characters, and another secret gives another code
- [x] 2.4 A secret not of 16 bytes is refused with an `ArgumentException` naming it, never its value

## 3. [unit] Slice 1 — The push and the sender

- [x] 3.1 A message with a balance has no `mutable` and no `data`; its `navigate` is the start page with `#` and the fragment for the given secret. The c014 tests that pinned `mutable` and `data.balance` are rewritten by the test-writer to pin their absence
- [x] 3.2 The balance's fragment takes the place of a fragment the page has
- [x] 3.3 `Check` measures a message with a balance with its fragment: one just under 3993 bytes without it and over with it is refused as too long
- [x] 3.4 A message without a balance is written as before, and a secret given with it is not read
- [x] 3.5 The sender hands each device a content whose code is made with that device's own secret (`StubPushDelivery`'s record per device)
- [x] 3.6 The sender hands every device the same content for a message without a balance

## 4. [wiring] Slice 1 — Building the push per device

- [x] 4.1 `Push/BalanceInAddress.cs` (design.md D2, D3; .NET's `HKDF` and `HMACSHA256`); `PushMessages.DeclarativeJson` and `Check` (D1, D2). Verify: group 2 and 3.1–3.4 green
- [x] 4.2 `SendPushHandler.Send` builds one `OutgoingPush` per device when the message has a balance (D4), decoding `Auth` with `StrictBase64Url`. Verify: 3.5 and 3.6 green; every push-sending and account-check acceptance test green

## 5. [close] Slice 1 — The notification carries the new balance for the phone to keep

- [x] 5.1 The scenario's test passes. Verify: green, including account-check / The notification carries the new balance for the phone to keep
- [x] 5.2 Docs:
  - **ADR-0010**, a dated note (design.md D13): plain pushes; the fragment and its per-device code; a push per device; item 2's `mutable` statement holds for every push again.
  - **`testing.md`** § the push kit: the fragment, the test device's own check and the known-answer vector, mirrored in `.claude/rules/testing.md` where it names the kit.
  - **lessons.md R-108** (D3, D13).

  Verify: each names design.md; no balance of the real account in any of them

## 6. [close] Slice 2 — Each device's notification carries a check code of its own

- [x] 6.1 The scenario's test passes, as expected after slice 1, and is proven by a mutation: with `SendPushHandler` using the first device's secret for every device, it fails. Verify: green, including account-check / Each device's notification carries a check code of its own; the mutation's red result in `.tdd-state.md`

## 7. [wiring] Removal — the server's reports

- [x] 7.1 Deleted (design.md D10): `ArrivalReportEndpoint`, `ArrivalReportRequest`, `RecordArrivalHandler`, `ArrivalDelay`, `PushLog.PushArrived` and their registration in `PushRegistration`; `SignInRegistration.NeverRenewForAnArrivalReport` and its call. Verify: the build passes
- [x] 7.2 Their tests deleted, by the test-writer:
  - `Conventions/PushArrivalLoginTests.cs` and `PushArrivalTelemetryTests.cs`;
  - `Drivers/ArrivalDriver.cs`, `Dsl/ArrivalDsl.cs` and `ReportAnswer.cs`, and the arrival members of `AcceptanceTest`, `CapturedTelemetry`, `FakeBank`, `FakeCnb` and `FakePushService`;
  - `IntegrationTests/Wiring/Push/UnreadableArrivalReportTests.cs` and the arrival members of `BankOnWireMock` and `SubscriptionEndpointApp`;
  - `UnitTests/Push/ArrivalDelayTests.cs`.

  Verify: `dotnet test` green; `git grep -i arrival -- src tests` finds nothing outside comments that name c016's history. `PushArrivalLoginTests` held the one exemption from renewing the login, so no request is exempt any more, and sign-in's own scenarios stay green

## 8. [wiring] Removal — the contract and the frontend

- [x] 8.1 Regenerate the TS client: `npm --prefix tools/api-client run regenerate`, then commit `openapi.json` and `schema.d.ts`. Verify: neither names `arrivals` or `ArrivalReportRequest`; CI's drift check would pass
- [x] 8.2 The frontend: `app/arrivalReport.ts` deleted; `pushDisplay.ts` sends no report and `PushWorker` has no `fetch`. The test-writer deletes `arrivalReport.test.ts`, `pushDisplay.test.ts`'s report tests, and the service worker stand-in's `fetch` hand-off and `src/test/server.ts`'s arrival answers, where nothing else uses them. Verify: the frontend suite, `lint`, `typecheck` and `format:check` green; `git grep -i arrival -- src/RevolutReader.Web/src` finds nothing

## 9. [close] Removal — the arrival reports gone

- [x] 9.1 The full suite is green and the traceability check passes with no claim of `push-arrivals`. Verify: `dotnet test` and the frontend suite green
- [x] 9.2 Docs (design.md D10):
  - `docs/operations/deployment.md` § Push arrivals (c016) and every link to it removed;
  - `docs/conventions/testing.md` (§ the captured log lines, § the worker's own requests), `.claude/rules/testing.md`, `.claude/agents/runner.md` and `.claude/agents/test-writer.md` lose the reports' mentions;
  - `tests/manual-scenarios.md` loses the push-arrivals row;
  - `docs/software-factory/creating-handover-package.md`'s rows for `pushDisplay.ts` and the stand-in describe them without the report;
  - ADR-0010's note (5.2) gains the removal.

  Verify: `git grep -i -E "push-arrivals|/api/push/arrivals|PushArrived" -- docs .claude tests src` finds only dated history in ADR-0010 and lessons

## 10. [unit] Slice 3 — Reading and checking an address

- [x] 10.1 The known-answer vector's address gives its balance (the fragment pinned in 2.1)
- [x] 10.2 `carriesBalance` is true for `#balance=…`, whatever follows, and false for no fragment or another one
- [x] 10.3 A fragment that is not `<payload>.<code>` in base64url, or whose payload is not JSON, gives no balance
- [x] 10.4 A payload whose shape `balanceOf` refuses gives no balance
- [x] 10.5 No secret, or a `crypto.subtle` that throws, gives no balance and never rejects

## 11. [unit] Slice 3 — The launch's intake

- [x] 11.1 `keepNotificationBalance` (renamed from `keepPushedBalance`; the c015 tests renamed by the test-writer) resolves whether it replaced
- [x] 11.2 `takeInNotificationBalances({ fromAddress: true })` keeps the page address's valid balance and reports `kept`
- [x] 11.3 No registration, no subscription or no `auth` key means nothing is kept, and it never rejects
- [x] 11.4 At a launch the kept balance is loaded after the intake has ended (design.md D6)
- [x] 11.5 An intake still running after 300 ms lets the kept balance show, and the screen shows the newer one when the intake ends (the tests' clock)

## 12. [wiring] Slice 3 — The intake at a launch

- [x] 12.1 `app/notificationBalance.ts`, `app/notificationIntake.ts` (D5, D6; `pushRegistration`, `currentSubscription`); `storedBalance.keepNotificationBalance`, its callers renamed. Verify: groups 10 and 11 green; `typecheck` green under `tsconfig.sw.json` (the module loads no API client, c015 D5)
- [x] 12.2 `useAccountScreen`'s start runs the intake with the page's address, then loads the kept balance, within `LAUNCH_INTAKE_LIMIT_MS`. Verify: 11.4 and 11.5 green

## 13. [close] Slice 3 — A tap on a notification with a balance replaces the balance the phone keeps

- [x] 13.1 The scenario's test and 1.7's pass. Verify: green, including push-display / A tap on a notification with a balance replaces the balance the phone keeps, and push-display / The app opened from a push's notification shows its balance while the server wakes
- [x] 13.2 Docs:
  - **ADR-0007**, a dated note on item 3 (design.md D13).
  - **lessons.md R-107** (D1, D5, D13), and R-107 named in the Lessons column of `docs/software-factory/creating-handover-package.md`'s rows for `pushDisplay.ts` and the service worker stand-in (chapter B's review, B-1).
  - **`testing.md`** § the frontend kit: `getNotifications`, the address helpers and `balanceLook`.

  Verify: each names design.md

## 14. [unit] Slice 4 — A tap in the background

- [x] 14.1 `watchAddress` calls back on every `hashchange` and stops when asked
- [x] 14.2 A `hashchange` runs the intake with the page's address, and the screen shows the kept balance after it

## 15. [wiring] Slice 4 — The address watched

- [x] 15.1 `useAccountScreen` watches the address while the screen is on the page. Verify: group 14 green

## 16. [close] Slice 4 — A tap on a notification while the app is in the background replaces the balance the phone keeps

- [x] 16.1 The scenario's test passes. Verify: green, including push-display / A tap on a notification while the app is in the background replaces the balance the phone keeps

## 17. [unit] Slice 5 — The list at a launch

- [x] 17.1 `takeInNotificationBalances({ fromList: true })` reads each listed notification's `navigate` and keeps a valid balance
- [x] 17.2 A listed notification without a string `navigate` is skipped; a `getNotifications` that fails gives no candidate and never rejects
- [x] 17.3 A launch's intake reads the list as well as the address

## 18. [wiring] Slice 5 — The list read

- [x] 18.1 `notificationIntake` reads `registration.getNotifications()`; `useAccountScreen`'s launch asks for both sources. Verify: group 17 green

## 19. [close] Slice 5 — Opening the app from its icon takes the balance of a notification still shown

- [x] 19.1 The scenario's test passes. Verify: green, including push-display / Opening the app from its icon takes the balance of a notification still shown

## 20. [unit] Slice 6 — The intake at a return

- [ ] 20.1 Every return to the screen runs the intake with both sources, and the screen then shows the newer of what it showed and what the phone keeps (design.md D6)
- [x] 20.2 A return's intake that keeps nothing leaves the shown balance as it was

## 21. [wiring] Slice 6 — Returns take in notifications

- [ ] 21.1 `useAccountScreen` runs the intake at every return (`watchReturns`), beside the read the return repeats. Verify: group 20 green

## 22. [close] Slice 6 — Coming back to the app takes the balance of a notification still shown

- [ ] 22.1 The scenario's test passes. Verify: green, including push-display / Coming back to the app takes the balance of a notification still shown

## 23. [unit] Slice 7 — The newest counts

- [ ] 23.1 `newest` gives the balance read last, `readAt` compared as moments (two offsets of the same moment are equal)
- [ ] 23.2 The intake keeps only the newest valid candidate, whatever the order of the list and the address

## 24. [wiring] Slice 7 — The newest kept

- [ ] 24.1 `notificationIntake` keeps `newest` of the valid candidates. Verify: group 23 green

## 25. [close] Slice 7 — Of several notifications, the balance read last is kept

- [ ] 25.1 The scenario's test passes. Verify: green, including push-display / Of several notifications, the balance read last is kept

## 26. [close] Slice 8 — A push with a balance read earlier than the kept one leaves it as it was

- [ ] 26.1 The scenario's test passes, as expected after slice 3 (c015's rule), and is proven by a mutation: with the intake keeping by `storeBalance`, it fails. Verify: green, including push-display / A push with a balance read earlier than the kept one leaves it as it was; the mutation's red result in `.tdd-state.md`

## 27. [close] Slice 9 — A push with a balance stores none on a phone that keeps none

- [ ] 27.1 The scenario's test passes, as expected after slice 3, and is proven by a mutation: with `replacesKept` answering true when nothing is kept, it fails. Verify: green, including push-display / A push with a balance stores none on a phone that keeps none; the mutation's red result in `.tdd-state.md`

## 28. [unit] Slice 10 — The address cleaned

- [ ] 28.1 After the intake, an address with a balance fragment, valid or not, keeps its path and query and loses the fragment, by `history.replaceState`
- [ ] 28.2 An address with another fragment, or none, is left as it is

## 29. [wiring] Slice 10 — Cleaning the address

- [ ] 29.1 `notificationIntake` cleans the page's address when it read it. Verify: group 28 green

## 30. [close] Slice 10 — The app's address carries no balance once the app has read it

- [ ] 30.1 The scenario's test passes. Verify: green, including push-display / The app's address carries no balance once the app has read it

## 31. [unit] Slice 11 — A code not made for this phone

- [ ] 31.1 A code made with another secret, a code one character off, and a fragment without a code each give no balance. These are expected green after slice 3, and 32.1's mutation proves them

## 32. [close] Slice 11 — A balance without this phone's check code leaves the kept balance as it was

- [ ] 32.1 The scenario's test passes, as expected after slice 3, and is proven by a mutation: with `balanceInAddress` skipping the `verify`, it and group 31 fail. Verify: green, including push-display / A balance without this phone's check code leaves the kept balance as it was; the mutation's red result in `.tdd-state.md`

## 33. [unit] The spike's leftover record (design.md D11, no scenario)

- [ ] 33.1 `removeSpikeLeftovers` removes `tarjeta-papa.notification-test.record` and nothing else
- [ ] 33.2 A `localStorage` that throws is ignored

## 34. [wiring] The spike's leftover record

- [ ] 34.1 `app/leftovers.ts`, called once at the app's start (`main.tsx`), before the first render. Verify: group 33 green; the frontend suite green

## 35. [unit] Slice 12 — The service worker's balance

- [ ] 35.1 `pushedBalance` reads `navigate`'s fragment from the push's JSON, checked with the worker's subscription secret. The c015 tests that read `data.balance` are rewritten by the test-writer for the address
- [ ] 35.2 With the browser's proposed notification, `pushedBalance` reads its `navigate` first
- [ ] 35.3 No subscription, or a code that does not verify, gives no balance
- [ ] 35.4 The balance is kept with `keepNotificationBalance` under the event's `waitUntil`, and the notification starts in the same turn, never waiting for it

## 36. [wiring] Slice 12 — The worker reads the address

- [ ] 36.1 `pushDisplay.ts` (design.md D7): `PushWorker.registration.pushManager`, `pushedBalance(event, secret)`, the listener; `sw.ts` unchanged but for its comment. Verify: group 35 green; `typecheck` green under `tsconfig.sw.json`; the built `dist/sw.js` carries no API client (c015 D5's check)

## 37. [close] Slice 12 — A push with a balance replaces the balance the phone keeps

- [ ] 37.1 The scenario's test, 1.17's and 1.18's pass. 1.17 is proven by a mutation: with `balanceOf` accepting a missing `readAt`, it fails. Verify: green, including push-display / A push with a balance replaces the balance the phone keeps, / A push with a balance of the wrong shape leaves the kept balance as it was, and / A push still shows its notification when the phone's storage fails; the mutation's red result in `.tdd-state.md`

## 38. [unit] Slice 13 — The header's state

- [ ] 38.1 `headerOf` gives `live` when `confirmed`; `waiting` when not, while who is signed in is asked or a balance read runs; `stale` otherwise
- [ ] 38.2 A placeholder header has no state
- [ ] 38.3 `BalanceHeader` marks the amount and `data-balance` with its `state` (default `live`), and the koruna line and the freshness line do not change with it

## 39. [wiring] Slice 13 — The state shown

- [ ] 39.1 `theme.css`:
  - the token `--duration-wait: 1500ms`;
  - the keyframes `wait-bar`, `wait-shine` and `live-settle`;
  - the utilities `animate-wait-bar`, `amount-waiting`, `amount-stale` and `amount-live`, with their reduced-motion forms;
  - `animate-progress-indeterminate` gone (design.md D9).

  Verify: the frontend build passes; the classes exist in the built CSS
- [ ] 39.2 `Facts.confirmed` (false for now), `BalanceState`, the header's `state`; `AccountScreen` passes it to `BalanceHeader`; `BalanceHeader` maps it. Verify: group 38 green

## 40. [close] Slice 13 — A stored balance is grey and moving while an awake server answers

- [ ] 40.1 The scenario's test passes. Verify: green, including account-balance / A stored balance is grey and moving while an awake server answers

## 41. [unit] Slice 14 — Confirmed by a read

- [ ] 41.1 A successful balance read makes the shown balance confirmed
- [ ] 41.2 A balance the intake shows in place of the confirmed one is not confirmed

## 42. [wiring] Slice 14 — Confirming

- [ ] 42.1 `useAccountScreen` keeps `confirmed` (D8). Verify: group 41 green

## 43. [close] Slice 14 — The balance turns ink when the server's balance arrives

- [ ] 43.1 The scenario's test passes. Verify: green, including account-balance / The balance turns ink when the server's balance arrives

## 44. [unit] Slice 15 — The waiting clock

- [ ] 44.1 `waitClockDelay(t)` is `-(t mod 1500)ms`, with `document.timeline.currentTime` as `t` by default
- [ ] 44.2 `useWaitClock` sets the delay on its element when `active` turns on, and keeps it through renders while it stays on
- [ ] 44.3 `WakingUp`'s bar runs `animate-wait-bar` with the delay set at mount; `BalanceHeader`'s amount gets the delay when `waiting` begins

## 45. [wiring] Slice 15 — One clock

- [ ] 45.1 `components/waitClock.ts`; `WakingUp` and `BalanceHeader` use it. Verify: group 44 green; `WakingUp`'s tests green

## 46. [close] Slice 15 — A stored balance is grey and moving while the server wakes

- [ ] 46.1 The scenario's test passes. Verify: green, including account-balance / A stored balance is grey and moving while the server wakes

## 47. [close] Slice 16 — Offline, the stored balance is grey and still

- [ ] 47.1 The scenario's test passes, as expected after slice 13, and is proven by a mutation: with `headerOf` answering `waiting` when nothing is out, it fails. Verify: green, including account-balance / Offline, the stored balance is grey and still; the mutation's red result in `.tdd-state.md`

## 48. [close] Slice 17 — After a failed read, the stored balance is grey and still

- [ ] 48.1 The scenario's test passes, as expected after slice 13, and is proven by the same mutation as 47.1. Verify: green, including account-balance / After a failed read, the stored balance is grey and still; the mutation's red result in `.tdd-state.md`

## 49. [unit] Slice 18 — A failed read

- [ ] 49.1 A read that ends offline, with a bank problem, with an unexpected answer or at the 60 s limit clears `confirmed`
- [ ] 49.2 A login that ends clears it with everything else, as today

## 50. [wiring] Slice 18 — Failing reads

- [ ] 50.1 `useAccountScreen.readTheBalance` clears `confirmed` on every outcome but a read. Verify: group 49 green

## 51. [close] Slice 18 — A failed refresh turns the balance grey

- [ ] 51.1 The scenario's test passes. Verify: green, including account-balance / A failed refresh turns the balance grey

## 52. [close] Slice 19 — A refresh keeps a confirmed balance in ink

- [ ] 52.1 The scenario's test passes, as expected after slice 14, and is proven by a mutation: with `readTheBalance` clearing `confirmed` when it starts, it fails. Verify: green, including account-balance / A refresh keeps a confirmed balance in ink; the mutation's red result in `.tdd-state.md`

## 53. [unit] Slice 20 — Every return is an opening

- [ ] 53.1 A return to the screen clears `confirmed` before the read it repeats, so the balance is `waiting` until it answers
- [ ] 53.2 "Obnovit" and coming back online are no openings and leave `confirmed` as it is

## 54. [wiring] Slice 20 — Returns

- [ ] 54.1 `useAccountScreen` clears `confirmed` at every return (`watchReturns`). Verify: group 53 green

## 55. [close] Slice 20 — Coming back to the app turns the balance grey until the answer

- [ ] 55.1 The scenario's test passes. Verify: green, including account-balance / Coming back to the app turns the balance grey until the answer

## 56. [close] Slice 21 — A grey balance is spoken as a balance in ink

- [ ] 56.1 The scenario's test passes, as expected after slice 13, and is proven by a mutation: with `BalanceHeader` adding a hidden "neověřeno" when not live, it fails. Verify: green, including account-balance / A grey balance is spoken as a balance in ink; the mutation's red result in `.tdd-state.md`

## 57. [close] Acceptance green

- [ ] 57.1 All 24 scenario tests of this change pass and the full suite is green. The traceability check passes, `dotnet format whitespace --verify-no-changes` and the frontend checks are clean, and `openapi.json` and `schema.d.ts` match the regeneration. Verify: each command's output
- [ ] 57.2 Local check with `aspire start --isolated` (from the worktree; the Mock ASPSP), the owner looking:
  - the stored balance is grey and shining at an opening, and turns ink when the balance arrives;
  - with the browser offline, it is grey and still with "Jsi offline";
  - a return to the tab is grey until the answer;
  - `/#balance=` with a made-up code shows nothing new, and the address loses it.

  Verify: the owner sees each
- [ ] 57.3 `CLAUDE.md` checked against every command this change touched (none expected); no `pm/progress.md` row (issue-only work). Verify: `CLAUDE.md`'s commands run as written

## Workflow follow-up

A change's path after its `[close]` commit (workflow.md § 6):

- The push and a draft PR `fix: show the account's notifications at once with their balance`, naming #91 without closing it (design.md § Migration plan, step 4), on the owner's go. If `main` has moved on, merge it first.
- The owner runs `/code-review xhigh --comment` on the PR; `/triage-review <PR>` works through the findings.
- Archive with `/opsx:archive` on the branch, before the merge. The traceability check must pass first. If the archive leaves `openspec/specs/push-arrivals/` without requirements, remove the folder in the same commit.
- The owner marks the PR ready and squash-merges it.
- After the deploy, the owner runs the five iPhone rows (1.28–1.32) on the owner's iPhone. The PR recording their results in `tests/manual-scenarios.md` closes #91.
- Separately, the owner's design loop for the design system's BalanceHeader wording (design.md D14); no code waits for it.
