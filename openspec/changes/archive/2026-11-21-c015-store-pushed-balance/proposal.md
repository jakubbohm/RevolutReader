# Proposal: c015-store-pushed-balance

## TL;DR

- **What:** UC3's part 2b, frontend only. When a push about the account arrives, the service worker writes the balance the push carries into the balance the phone keeps (ADR-0007, item 3). A tap on the notification then opens the app on the new balance at once, while the server wakes. A push replaces a kept balance only when one is kept and it was not read earlier. A push without a balance, or with one of the wrong shape, leaves it alone. A failing store never stops the notification.
- **Out of scope:** the check that sends these pushes, their text and recipients (C9a, c014, alongside); any backend, API or design change; what the notification shows (unchanged).
- **Riskiest assumption:** that Safari hands the service worker the push's `notification.data` on the event's proposed notification. The W3C draft gives a mutable declarative push no raw data of its own, and no test can show what Safari does. The manual row on the owner's iPhone (opened offline after a payment) is the first proof.
- **Scenarios added** (`push-display`): A push with a balance replaces the balance the phone keeps · A push with a balance read earlier than the kept one leaves it as it was · A push with a balance stores none on a phone that keeps none · A push without a balance leaves the kept balance as it was · A push with a balance of the wrong shape leaves the kept balance as it was · A push still shows its notification when the phone's storage fails · The app opened from a push's notification shows its balance while the server wakes · A payment's notification on the iPhone opens the app on its balance (manual)

## Why

Roadmap step **C9b** ([#86](https://github.com/jakubbohm/RevolutReader/issues/86)), use case **UC3** (kickoff ch. 5). It was split from C9 on 2026-11-21 for size, and C9a's PR records the split in `pm/roadmap.md`. C9a ([#52](https://github.com/jakubbohm/RevolutReader/issues/52), c014, alongside) sends a push whenever the account changes, and each push carries the new balance (#52's N2). Today the service worker ignores it, so a tap on the notification opens the app on the balance from its last read. The app then waits about 20 s for the server to wake, or shows that old balance offline. ADR-0007 (Q10) decided that the phone keeps the balance a push brings.

Every behaviour was decided with the owner in C9's explore (2026-11-20/21) and handed over in the issues: the shared N1–N4 in [#52's comment](https://github.com/jakubbohm/RevolutReader/issues/52#issuecomment-7052729352) and C9b's own W1–W6 on #86. Two points were settled with the owner at this propose (2026-11-21): W2's default (an older balance is left alone) was confirmed, and W5's check found a gap that a push now closes by never creating a kept balance (design.md D3, D7). This change is proposed directly from them, and its design.md becomes their home. Applies **Q10** (ADR-0007, item 3).

## What Changes

- **The service worker keeps a push's balance** (design.md D1–D3): a push from C9a's check carries `balance` (`amount`, `readAt`, `czkPerEur`, exactly as `GET /api/balance` answers it) in its notification's data. The push handler C8b built writes it into the record C7a keeps (`last` in the IndexedDB database `tarjeta-papa`, store `balance`), in every browser: where the browser shows the message itself (Safari on the iPhone) and where the service worker shows it (Chrome on a computer).
- **When the kept balance is left alone** (D3): a push without a balance (the owner's test messages); a balance of the wrong shape; a balance read earlier than the kept one (the owner, 2026-11-21); a phone that keeps no balance, so a balance forgotten at sign-out or on a 401 or 403 never comes back by a late push (the owner, 2026-11-21).
- **Writing never stops the notification** (D4): a failing store is ignored, and the notification shows as it would without this change.
- **The app opened from the notification** (D6): nothing new on the screen. C7a's screen shows the kept balance at once while the server wakes, and a scenario proves that it is the push's balance.
- **One manual row** on the owner's iPhone once C9a and C9b are both deployed (D9): with the app closed, a payment brings the notification, and a tap with the phone offline opens the app on the notification's balance. Again at M7 on the daughter's phone.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `push-display`: what the device does with a push gains keeping the balance the push carries, the cases where the kept balance is left alone, a store failure that never stops the notification, the app opened from the notification on that balance, and the iPhone check. Requirements are added; the existing ones stay as they are.

## Non-goals

- **The check and its pushes:** the trigger endpoint, the bank read, the two stored balances, the change rule, the notification's text and recipients, bursts, `"mutable": true` and the balance in the push (C9a, c014; N1, N2, N4).
- **What the notification shows:** unchanged. Safari shows the message itself, and the service worker shows it elsewhere, as C8b built (W1).
- **The page taking in a push while the app is open:** the open screen keeps its live read, and a return to the app reads again (C7a's refresh). Only the next opening shows the kept balance.
- **A login that ends while the app is closed:** the phone stays subscribed until its next opening, as C8c built, and the notifications keep coming; that opening forgets the kept balance as today (D7).
- **Any backend, API, settings, AppHost or Bicep change**, and any design change: no screen changes.

## Impact

- **Frontend:** the service worker's push handler (`src/app/pushDisplay.ts`) reads the push's balance and keeps it. The stored-balance module (`src/app/storedBalance.ts`) gains a write that only replaces a kept balance, in one IndexedDB transaction. The balance's shape check moves into a module of its own that the service worker can load without the API client (D5). No new package.
- **Tests:** new `push-display` scenarios in `src/scenarios/push-display.test.ts`. The test kit's service-worker stand-in models what the W3C draft says a browser that reads Declarative Web Push hands the event (D8). One manual row in `tests/manual-scenarios.md`.
- **Docs:** ADR-0007 (a dated note, as built), testing.md (the stand-in), software-factory lessons and inventory lines (D11).
- **Shared with C9a** (N1, N3; D10): no code file. Joined by hand by whichever merges second: C9b's row in `pm/progress.md`, ADR-0007's notes, and possibly `tests/manual-scenarios.md`, testing.md § Fake push service and the software-factory files, where each adds its own lines.
- **No change** to the API contract, `openapi.json`, the AppHost, settings, secrets or Bicep.
