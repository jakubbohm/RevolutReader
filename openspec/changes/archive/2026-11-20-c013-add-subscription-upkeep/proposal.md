# Proposal: c013-add-subscription-upkeep

## TL;DR

- **What:** keeps a device's push subscription right, frontend only. At every opening (launch or return) with a signed-in user and notifications allowed, the app sends the subscription to the server again. It subscribes again quietly when the phone has lost it, and replaces it quietly when it was made with another key. At sign-out it asks the server to forget the device first, then unsubscribes the phone once the server confirms the sign-out. A failed sign-out keeps it. A 401 or 403 unsubscribes the phone. After signing in again the phone subscribes without a tap.
- **Out of scope:** the card, the menu item, the failure banner and the service worker showing a push (C8b); asking for the permission (only C8b, from a tap); account notifications (C9); any endpoint (C8a's three are used as they are).
- **Riskiest assumption:** that iOS subscribes again without a tap once the permission was granted (C1, "assumed, not verified"); the manual row checks it on the iPhone after the merge. Second: that Safari names the key a subscription was made with. MDN's compatibility data lists support but not the value, so if Safari does not name it, a subscription with an unknown key is kept as it is (design.md D1).
- **Scenarios added** (`push-devices`): The subscription is sent to the server again when the app opens · The subscription is sent to the server again on every return to the app · A subscription the phone has lost is replaced quietly · A subscription made with another key is replaced quietly · Nothing is subscribed while notifications are not allowed · Signing out asks the server to forget the phone and unsubscribes it · A failed request to forget the phone does not fail the sign-out · A failed sign-out keeps the subscription · A login that has ended unsubscribes the phone · After signing in again, the phone subscribes without a tap · After signing out and in again on the iPhone, a message arrives without a tap (manual)
- **Modified, removed:** none.

## Why

Roadmap step **C8c** ([#61](https://github.com/jakubbohm/RevolutReader/issues/61)), use case **UC3** (kickoff ch. 5): the owner's daughter gets a push notification when the account changes. C8a (merged 2026-11-10) lets the server send a push to every device registered under an account. Nothing yet keeps that registration right after the device first registers. A browser can drop or replace a subscription without telling the page reliably. A replaced server key makes an old subscription useless (ADR-0010 promises it heals itself, and that promise depends on this change). A signed-out phone would keep getting pushes, from C9 on with the balance, which the service worker would write back onto the phone (ADR-0007: deleted on sign-out). Without this change, pushes stop silently or reach the wrong phone. Every behaviour was decided with the owner in C8's explore (2026-11-08/09) and handed over in the comments of #51 (shared S1–S12) and #61 (C1–C7). This change is proposed directly from them, and its design.md becomes their home. One clash between C2 and C3 was settled by the owner on 2026-11-20 (design.md D2). Applies **Q9** (on iOS, Web Push works only in the Home Screen app, which keeps the permission across sign-outs).

## What Changes

- **At every opening** (design.md D1): a launch, or a return to the app from another one, while a user is signed in and notifications are allowed. The app reads the server's key and the phone's subscription:
  - made with the server's key: the subscription is sent to the server again, which also moves it to the account signed in now;
  - none: the phone subscribes again quietly with the server's key, and the new subscription is sent;
  - made with another key: the old one is unsubscribed and forgotten on the server, then the phone subscribes again with the current key and the new one is sent.

  All quietly: no permission prompt, no tap, nothing on screen, and any failure waits for the next opening. Where notifications are not allowed, it neither asks nor subscribes.
- **Sign-out** (D2, D3): before C7a's sign-out request, the app asks the server to forget this device, as a best effort. Once the server confirms the sign-out, the phone unsubscribes. A failed request to forget never fails the sign-out. A failed sign-out keeps the phone's subscription.
- **A 401 or 403** (D4): wherever C7a and C7b forget the stored balance because the login has ended, the phone also unsubscribes.
- **After signing in again** (D5): the return from Microsoft's sign-in is a launch, so the first opening subscribes again without a tap.
- **Side by side with C8b** (D8): C8c owns the lifecycle, C8b the screens. C8c's last task group waits for C8b's merge and then joins the shared files by hand.
- **Records:** a dated note in ADR-0010-web-push (D9); a software-factory lesson and an inventory line (D9); the manual row in `tests/manual-scenarios.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `push-devices`: gains the device side of the registration. The app keeps the phone's subscription right at every opening, removes it at sign-out and when the login has ended, and brings it back after signing in again. Eight requirements are added, one behaviour each; the existing five, all about the API, are unchanged.

## Non-goals

- **The screens:** the card under the balance, the account menu's "Zapnout upozornění", the failure banner, and the service worker showing a push and opening the app on a tap are C8b's (#60). Nothing in C8c asks for the notification permission or shows anything.
- **Account notifications:** C9 (#52).
- **Any API change:** C8c uses C8a's key, register and forget endpoints as they are, so no generated API file changes (S10).
- **Re-subscribing after a failed sign-out:** not needed. The phone keeps its subscription (D3), and if the server had already forgotten it, the next opening sends it again.
- **Telling the server about a device whose login has ended:** the server accepts no request from it. The device is deleted when its push service reports it gone (spec push-sending).
- **A local end-to-end check:** Vite's dev server registers no service worker, and before C8b nothing in the app grants the permission. The proof is the frontend scenarios and the iPhone check after the merge (design.md § Migration plan).

## Impact

- **Frontend:** a new module `src/app/subscriptionUpkeep.ts` with unit tests. `useAccountScreen.ts` runs the upkeep at every opening, asks the server to forget the device before the sign-out request, and unsubscribes the phone wherever the login ends. `refreshTriggers.ts` gains a watch for returns alone.
- **Test kit (the test-writer's):** the push stand-in gains `navigator.serviceWorker.getRegistration()`; a new scenario file `src/scenarios/push-devices.test.tsx`.
- **Backend, API contract, AppHost, settings, Bicep, CI:** none.
- **Docs:** ADR-0010 (a dated note), `tests/manual-scenarios.md` (one row), the software-factory lesson and inventory line, `pm/progress.md`.
- **Joined by hand with C8b at its merge:** `useAccountScreen.ts`, `App.tsx`, the test kit's `server.ts`, `tests/manual-scenarios.md` and `pm/progress.md`, as agreed with the C8b session (design.md D8).
