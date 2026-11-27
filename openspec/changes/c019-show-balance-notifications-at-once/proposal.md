# Proposal: c019-show-balance-notifications-at-once

## TL;DR

- **What:** the account's notifications show on the iPhone at once again, and still bring their balance ([#91](https://github.com/jakubbohm/RevolutReader/issues/91)). They become plain declarative pushes (no `mutable`), so iOS shows them itself without waking the app's service worker. The balance travels in the notification's address, after the `#`, with a check code made for each device from its push subscription's secret. The app reads it from its own address after a tap, and from every notification still in Notification Center at every opening. It keeps it by c015's rule: only when the phone keeps a balance, and only when the notification's balance is not older than the kept one. The arrival reports built to measure #91 (c016) are removed. A balance the server has not confirmed in this opening is grey: it shines in step with the waking-up bar while the request runs, and stands still when offline or after a failed read.
- **Out of scope:** a new secret or signing key; any change to the lock-screen text; closing notifications from the app; a measurement to replace the reports (the owner checks the fix by hand on the iPhone); the design system's own list skeleton overflow.
- **Riskiest assumption:** that iOS keeps showing a plain declarative push at once and keeps handing the `#` of its `navigate` to the app. That held on iOS 27.2.1 in the #113 spike (2026-11-26/27), and the manual rows check it again after the deploy.
- **Added scenarios:**
  - `push-display`: A tap on a notification with a balance replaces the balance the phone keeps · A tap on a notification while the app is in the background replaces the balance the phone keeps · Opening the app from its icon takes the balance of a notification still shown · Coming back to the app takes the balance of a notification still shown · Of several notifications, the balance read last is kept · The app's address carries no balance once the app has read it · A balance without this phone's check code leaves the kept balance as it was · A payment's notification on the iPhone brings its balance to an opening from the icon.
  - `account-check`: Each device's notification carries a check code of its own.
  - `account-balance`: 11 scenarios for the grey look, listed in § What Changes.
- **Modified:**
  - `push-display`: A push with a balance replaces the balance the phone keeps (now the service worker's path only) · A push with a balance read earlier than the kept one leaves it as it was (now by a tap) · A push with a balance stores none on a phone that keeps none (now by a tap).
  - `account-check`: The notification carries the new balance for the phone to keep · A real payment brings the notification on the iPhone (within a minute).
  - Requirement texts only, around unchanged scenarios: `push-sending`, and push-display's "A push without a valid balance leaves the kept balance alone" and "A payment's notification brings its balance to the iPhone".
- **Removed:** the whole of `push-arrivals`, 5 requirements and their 11 scenarios.

## Why

[Issue #91](https://github.com/jakubbohm/RevolutReader/issues/91). This is work after the initial development, with no roadmap step, so the issue is its only tracker (`CLAUDE.md` § Project management). It touches **UC1** (the balance, and how fresh it looks) and **UC3** (the notification of a change and the balance it brings; kickoff ch. 5). It applies **Q10** again ([ADR-0007](../../../docs/adr/0007-offline-balance.md): the phone keeps the last balance) and decides no open question.

- **iOS holds or loses the account's notifications.** On the first day of the account check, iOS held two of its notifications for about 64 and 80 minutes, while a plain declarative push sent in between arrived at once ([ADR-0010](../../../docs/adr/0010-web-push.md), note of 2026-11-21).
  - The cause, found in [#91's cause comment](https://github.com/jakubbohm/RevolutReader/issues/91#issuecomment-7189303142): the check's pushes carry `"mutable": true`, so iOS must wake the app's service worker before it shows them. When that start fails, iOS holds the push for hours or drops it.
  - The fix found there sends them plain, without `mutable`, so iOS shows them at once.
- **A plain push no longer runs the service worker,** so the phone would lose the pushed balance that c015 keeps.
  - The #113 spike ([spikes/notification-balance/README.md](../../../spikes/notification-balance/README.md), on the owner's iPhone, iOS 27.2.1, 2026-11-26/27; [verdict](https://github.com/jakubbohm/RevolutReader/issues/91#issuecomment-7205626856)) settled where the balance can come back from.
  - It cannot come from the notification's `data`: iOS drops it from every notification it shows itself.
  - It can come from the `#` of the notification's `navigate` address, in two ways. After a tap it is in the app's own address. At any opening it is in every notification still in Notification Center, which `registration.getNotifications()` lists with its full `navigate`.
- **The app's own address can come from any link,** so a balance there needs proof that the server made it for this phone. The owner chose a check code made from a secret the phone and the server already share: the push subscription's `auth` secret.
- **The arrival reports have done their job.** They were built only to measure #91 (c016 design.md D9), and the cause is now known. A report would also need the service worker, which a plain push no longer runs.
- **A balance that may be old should look it.** The phone now shows balances the server has not confirmed more often: a notification's balance, and a stored one while the server wakes. The owner asked for such a balance to be grey, with its motion in step with the bar under "Server se probouzí", until the server's answer arrives. The design loop drew it (design system and Screens design, 2026-11-26).

Every behaviour below was decided by the owner in this change's explore (2026-11-26 and 2026-11-27).

## What Changes

- **The account's notifications are plain declarative pushes** (design.md D1). They carry no `mutable` and no `data`. iOS shows them through its own push daemon, at once, and the app's service worker never runs for them. The owner's messages were already sent this way.
- **The balance in the notification's address** (D2, D3, D4):
  - `navigate` is the app's start page with `#balance=<payload>.<code>`. The payload is the balance exactly as `GET /api/balance` writes it (`amount`, `readAt`, `czkPerEur`), as JSON in base64url.
  - The check code is HMAC-SHA-256 over the payload, under a key that HKDF derives from the device's push subscription `auth` secret, with this app's own label (domain separation). The server stores that secret, and the page and the service worker can read it. No new secret or setting.
  - So each device gets a push of its own. A message without a balance is still built once for all devices.
- **The app takes in a notification's balance** (D5, D6):
  - **Where it finds one:** in its own address, when a tap opens it (`location.hash` at the start) or a tap brings it back (`hashchange`); and in the `navigate` address of every notification `getNotifications()` lists, at every opening (a launch, or a return to the app).
  - **Which one counts:** only a balance whose check code this phone's subscription accepts counts, and of those the one read last. It is kept by c015's rule: only when the phone keeps a balance, and only when it was not read earlier than the kept one, in one IndexedDB transaction. So a day-old notification never overwrites a newer read. The app's own read still always replaces.
  - **What else happens:** the screen then shows the kept balance, and the app removes the balance from its own address.
  - At a launch, the kept balance waits for this, at most 300 ms (D6).
- **The service worker, where it still gets the push** (D7), in a browser that does not show declarative pushes itself, such as Chrome on a computer: it reads the same `#` from the push's `navigate`, checks the code with its own subscription and keeps the balance by the same rule. It never waits to show the notification. Its arrival report is gone.
- **The arrival reports are removed** (D10): spec `push-arrivals`, `POST /api/push/arrivals`, the service worker's report, the `PushArrived` log line, the queries in `deployment.md`, and their tests and conventions tests. `openapi.json` and the TypeScript client are regenerated.
- **The grey look** (D8, D9), from the design system's new `BalanceHeader` state `live | waiting | stale`:
  - **Live, in ink:** only a balance the server confirmed in this opening.
  - **Waiting, grey with a shine:** a balance the server has not confirmed while a request for it runs. The shine is a band of ink crossing the amount on the waiting clock (`duration-wait`, 1.5 s, with `ease-standard`), shared with the waking-up bar.
  - **Stale, grey and still:** offline, and after any failed read, a failed "Obnovit" included.
  - Every return to the app is an opening, so the balance is grey until the answer. "Obnovit" on a live balance keeps it in ink with "Obnovuji…".
  - A balance that turns live fades in over 200 ms. Under reduced motion there is no shine and no fade, but the grey stays. Nothing extra is spoken, and the koruna and freshness lines do not change.
  - The waking-up bar moves to the same clock: a new token `--duration-wait` and the design system's waiting utilities, kept in phase by one helper, the design's `syncWaitClock` pinned by a negative `animation-delay` instead of a `startTime` write (design.md D9).
- **The leftover test record is deleted** (D11): at the start, the app removes the #113 spike's `localStorage` key `tarjeta-papa.notification-test.record`.
- **Records** (D13):
  - ADR-0010 and ADR-0007 get dated notes.
  - Lessons R-107 and R-108.
  - `deployment.md`, `testing.md`, `tests/manual-scenarios.md` (two rows changed, three added, the arrivals row removed), and the agents' and rules' mentions of the reports.

The added scenarios of `account-balance`:

- A stored balance is grey and moving while the server wakes.
- A stored balance is grey and moving while an awake server answers.
- The balance turns ink when the server's balance arrives.
- Offline, the stored balance is grey and still.
- After a failed read, the stored balance is grey and still.
- A failed refresh turns the balance grey.
- A refresh keeps a confirmed balance in ink.
- Coming back to the app turns the balance grey until the answer.
- A grey balance is spoken as a balance in ink.
- The grey balance moves in step with the waking-up bar (manual).
- Under reduced motion the grey balance stands still (manual).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `push-sending`: "Every push is a Declarative Web Push message". No push carries `mutable` or `data` any more. A notification about the account carries its balance in `navigate`'s fragment, with a check code made for each device. Its scenarios are unchanged.
- `account-check`:
  - "The notification carries the new balance": the balance is in the address, with a check code per device, not marked for the service worker. One scenario is modified and one added.
  - "The notification reaches the iPhone": the notification shows within a minute.
- `push-display`:
  - "A push's balance replaces the balance the phone keeps": the sources, the newest balance and the address cleaned up; six scenarios added and three rewritten.
  - "A push without a valid balance leaves the kept balance alone": the check code; one scenario added.
  - "A payment's notification brings its balance to the iPhone": one manual scenario added, for an opening from the icon.
- `push-arrivals`: all 5 requirements removed. The capability goes with the archive (design.md D10).
- `account-balance`: a new requirement, "The header shows whether the server confirmed the balance", with 11 scenarios.

## Non-goals

- **A separate signing key** (option b) and **accepting the risk of a made-up balance** (option c): the owner chose the subscription's secret (a) (design.md D3).
- **Keeping `data` beside the address** for a computer's browser: the balance travels once (the owner, decision 4b).
- **Closing the notifications the app took a balance from,** or reading the ones the service worker showed on a computer (that service worker already kept their balances).
- **Any change to the notification's title or text** (Q8 stays as decided in c014).
- **A measurement to replace the arrival reports:** the owner checks the fix by hand on the iPhone (the manual rows).
- **Changing when "Obnovuji…" shows:** the freshness line keeps its rules (design.md D8).
- **The design system's own skeleton overflow** (about 11 px in its reference component only; the app's card clips it).

## Impact

- **Backend** (`src/RevolutReader.Api/Push/`):
  - `PushMessages` builds `navigate` with the balance fragment and drops `mutable` and `data`.
  - A new `BalanceInAddress` holds the fragment and the check code (HKDF and HMAC-SHA-256 on .NET's own cryptography).
  - `SendPushHandler` builds each device's push when the message carries a balance.
  - The arrival report's endpoint, request, handler, delay and log line are deleted, and so is their registration.
- **API contract:** `POST /api/push/arrivals` is removed. `openapi.json` and `src/RevolutReader.Web/src/api/schema.d.ts` are regenerated.
- **Frontend** (`src/RevolutReader.Web/src/`):
  - A new `app/notificationBalance.ts` reads and checks the address; it is shared by the page and the service worker.
  - A new `app/notificationIntake.ts` runs the page's intake at every opening and on `hashchange`.
  - `pushDisplay.ts` keeps the address's balance and sends no report; `arrivalReport.ts` is deleted.
  - `storedBalance.ts`: `keepPushedBalance` becomes `keepNotificationBalance`, with the same rule.
  - `screenState.ts` and `useAccountScreen.ts` work out the header's state, with every return as an opening.
  - `BalanceHeader` gets its `state`, and `WakingUp` joins the waiting clock.
  - A new `components/waitClock.ts` holds the waiting clock's phase (`waitClockDelay`, `useWaitClock`).
  - `styles/theme.css` gets `--duration-wait` and the waiting utilities.
  - The leftover `localStorage` record is removed at start.
- **Tests:**
  - The push test kit reads the balance from `navigate` and checks its code with the test device's own secret.
  - A known-answer vector is pinned in both the .NET and the frontend tests.
  - The arrival tests are deleted: scenarios, conventions, drivers, the DSL, wiring and unit tests.
  - `tests/manual-scenarios.md` is updated.
- **Docs:**
  - ADR-0010 and ADR-0007 notes; `docs/operations/deployment.md` § Push arrivals removed; `docs/conventions/testing.md`.
  - The arrival reports' mentions in `.claude/agents/runner.md`, `.claude/agents/test-writer.md` and `.claude/rules/testing.md`.
  - `docs/software-factory/lessons.md` R-107 and R-108; `creating-handover-package.md` if its inventory names the reports.
- **Infrastructure and configuration:** none. No new setting, secret, table or resource. The `PushArrived` lines already in telemetry age out.
- **Users:**
  - The phones take the new app and service worker at their next opening (vite-plugin-pwa, `skipWaiting`).
  - The check code does not depend on the app version, so a notification sent before a phone updates still carries a balance the new app can check.
  - A notification sent before the deploy, `mutable` with `data`, carries no balance in its address, so its balance is not taken in.
