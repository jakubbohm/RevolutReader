# Design: c015-store-pushed-balance

## TL;DR

- **The push handler keeps the push's balance** (D1–D3): C8b's `listenForPushes` reads `balance` from the push. It looks in the browser's proposed notification's `data` first, because the W3C draft gives a mutable declarative push no raw data, and then in the push's own JSON (`notification.data.balance`, Chrome on a computer). It writes the balance into C7a's record (`last` in `tarjeta-papa` / `balance`).
- **It only replaces, never creates** (D3, the owner, 2026-11-21): written only when the phone keeps a balance of the right shape and the push's was not read earlier (by `readAt`). Read, compare and write happen in one IndexedDB transaction (idb-keyval's `update`). A push without a balance, or with one of the wrong shape, leaves the record alone (W2).
- **Writing never stops the notification** (D4): the write never rejects, and it runs inside the push event's `waitUntil`. Where the service worker shows the message, it shows it at once, beside the write.
- **The service worker never loads the API client** (D5): `balance.ts` pulls in `api/client.ts`, which reads `window` at load and would stop the service worker. `balanceOf` and `Balance` move into a new `balanceRecord.ts` with only a type import. The service worker's own typecheck (`WebWorker`, no `window`) guards it.
- **New or changed interfaces:** `pushedBalance(event)` (the balance a push carries), `keepPushedBalance(balance)` (the replace-only write), the module `balanceRecord.ts` (`balanceOf`, `Balance`, re-exported by `balance.ts`); `listenForPushes` keeps its signature. The test kit's service-worker stand-in models the draft's declarative event (D8).
- **Integration points:** C9a's push (N2; c014, alongside), C8b's handler, C7a's stored balance and start-up, C8c's unsubscribe. No API, settings, AppHost or Bicep change, and no screen change.
- **8 scenarios** (7 frontend, 1 manual on the iPhone after both deploys). 5 of the frontend ones pass before any code exists, because nothing writes yet, and each is proven by a mutation at its slice (D8).
- **Hard to reverse:** nothing new. The record's place and shape are C7a's (c009 D4), and the push's `balance` is fixed by N2.

## Context

- See proposal.md § Why. Every decision below was made with the owner in C9's explore (2026-11-20/21): the shared [N1–N4](https://github.com/jakubbohm/RevolutReader/issues/52#issuecomment-7052729352) on #52 and C9b's own W1–W6 on [#86](https://github.com/jakubbohm/RevolutReader/issues/86). This design copies each one it uses, citing its label, and is their home from now on. Two points were settled with the owner at this propose (2026-11-21), and details settled while writing it are marked *(propose)*.
- **What merged before**, read 2026-11-21 on `main` at `5898af9` (C14): nothing contradicts N1–N4 or W1–W6, so no explore was needed. What this change builds on:
  - **C7a's stored balance** (c009 D4, `src/app/storedBalance.ts`, ADR-0007 § Notes): one record `{ amount, readAt, czkPerEur }` under `last` in the database `tarjeta-papa`, store `balance`, through idb-keyval 6.3.0. A failing store reads as none, a failed write or delete is ignored, and a record of the wrong shape reads as none (`balanceOf` in `src/app/balance.ts`). It is written after every successful read and forgotten after a confirmed sign-out and on any 401 or 403 (`useAccountScreen`'s `endLogin`).
  - **C7a's start-up** (c009 D2): the stored balance shows at once, before `GET /api/me` answers, which is "safe only because a device without a login keeps none". The waking-up screen stands below it from 1.5 s on.
  - **C8b's push handler** (c012 D9, `src/app/pushDisplay.ts`, wired by `listenForPushes(self)` in `src/sw.ts`): a push whose event carries the browser's proposed notification is left alone, so Safari shows it once; elsewhere the handler shows the declarative message itself. The module is compiled under both `tsconfig.app.json` (`DOM`) and `tsconfig.sw.json` (`WebWorker`), so it names the service worker's members as small interfaces of its own (`PushWorker`, `PushLike`).
  - **C8c's lifecycle** (c013 D2, D4): at sign-out the server forgets the device first, and once the sign-out is confirmed the phone forgets its balance and unsubscribes, both together. On any 401 or 403 the phone does the same, without the server.
  - **The test kit** (c012 D10): `src/test/serviceWorker.ts` stands in for the service worker's side and fires pushes, as a browser that reads Declarative Web Push (`declarative: true`) or one that does not. `src/test/server.ts` has the phone's storage on `fake-indexeddb` (`phoneKeeps`, `phoneKeepsRecord`, `phoneStorageFails`, `keptBalance`, emptied before every test).
- **C9a** (c014, [#52](https://github.com/jakubbohm/RevolutReader/issues/52), in the main checkout) runs alongside. Its session was told about this change (the owner's request) and confirmed the push's shape on 2026-11-21 (D1).

## Goals / Non-Goals

**Goals:**

- The 8 scenarios, each verified at the level § How each scenario is verified gives.
- One rule, in one place, for when a push's balance replaces the kept one (`keepPushedBalance`), applied in the same IndexedDB transaction as the write.
- Nothing that needs C9a's code: the tests feed the handler a push directly (W6), so either can merge first (N3).

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- **No limit of our own on the write** (D4): the browser bounds a push event that does not settle.
- **No change to the page's own write** (`storeBalance` after a read): a live read always replaces the record, as C7a built. The `readAt` rule is the push's alone (D3).
- **No screen work:** C7a's start-up shows the kept balance as it is (W4, D6).

## Decisions

### D1 — The contract with C9a (N2)

- **Every push the check sends** carries `"mutable": true` at the top level, next to `web_push` and `notification`, so that Safari fires the push event (ADR-0010, item 2). In `notification.data` it carries `balance` exactly as `GET /api/balance` answers it: `amount` (a JSON number), `readAt` (an ISO 8601 string with its offset, as System.Text.Json writes a `DateTimeOffset`) and `czkPerEur` (a JSON number), written by the same serializer rules, so the same values give the same text. `data` holds only `balance`. C9a's session confirmed this shape twice on 2026-11-21, checked against the W3C draft's declarative-push parser. It is c014 design.md D14, and C9a's acceptance tests pin it. C9a also agreed to keep `balance` inside `notification.data`, the one place a mutable declarative push hands the service worker (D2).
- **The title, the text and `navigate`** are the check's (N4: "Odešlo 3,80 €", "Zůstatek 45,20 € (≈ 1 098 Kč)", the start page `/`). This change shows them exactly as C8b does.
- **The owner's messages** (`POST /api/push/messages`) carry neither `mutable` nor `data`. C9a pins that with a push-sending scenario of its own ("The owner's message carries no balance").
- **The balance in a push is the check's *last seen*** (C9a's K2, K9): a check whose bank read fails still notifies from an earlier read, so a push's balance can be older than one the app read in the meantime. D3's `readAt` rule answers that.
- **Hard to reverse, but fixed by N2:** the name `balance`, its place in `notification.data` and its three fields. If C9a's apply changes any of them, its session tells this one first (its message of 2026-11-21).

### D2 — Where the handler finds the balance (W1) *(propose)*

- **Research** (2026-11-21; [W3C Push API editor's draft](https://w3c.github.io/push-api/), which shows no date; [WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), 2025-03-27):
  - For a declarative message with `mutable` true, the browser fires the push event "given registration, null, and a new Notification object representing notification" ("Receiving a push message", step 5.4.4.1). So **the event's `data` is null**: the raw JSON never reaches the handler in a browser that reads the format.
  - The parser carries the message's `notification.data` into the notification it proposes ("If notificationInput["data"] exists, then set notificationOptions["data"] to …", step 23; `data` is "any JSON value"). So **`event.notification.data` holds it.** The last hop, from the options to the `Notification`'s `data` attribute, comes from the Notifications spec, which was not read: an inference.
  - A browser that does not read the format (Chrome on a computer) fires an ordinary push event: `data` is the push's JSON and there is no proposed notification.
- **The rule:** `pushedBalance(event)` takes `balance` first from the proposed notification's `data`, when the event carries one, then from the push's own JSON (`notification.data.balance`). It keeps the balance only when `balanceOf` gives one. Reading both covers the draft, Chrome, and a Safari that might also hand over the raw data. If Safari hands over neither, nothing is written, and only the manual row (D9) can tell (§ Risks).
- **`balanceOf` is the one shape check** (c009 D4): the amount and the rate as numbers, the read time a string that parses as a date, and only those three fields kept. It is the same check as for the API's answer and the kept record, so a push's balance is valid exactly when the app would show it.

### D3 — When the kept balance is replaced (W1, W2, W5)

- **Replaced** when all of these hold:
  - the push carries a balance of the right shape (D2; W2's first and second points: the owner's test messages carry none, ADR-0010 Consequences);
  - the phone keeps a balance of the right shape: **a push only replaces, never creates** (the owner, 2026-11-21, from W5's check, D7). A phone that keeps none, a record of the wrong shape, or a store that cannot be read all mean nothing is written;
  - the push's balance was **not read earlier** than the kept one: W2's third point, Claude's default, **confirmed by the owner on 2026-11-21**. `readAt` is compared as moments (`Date.parse`), never as strings, so two offsets for the same moment compare equal. A balance read at the same moment replaces the kept one, which is harmless (the same read).
- **Only the three fields** are written, as `storeBalance` writes them.
- **One transaction** *(propose)*: `keepPushedBalance` reads, compares and writes in a single IndexedDB `readwrite` transaction through idb-keyval's `update(key, updater, store)`. Its source (6.3.0, read on unpkg 2026-11-21) runs the `get` and the `put` on one transaction. IndexedDB orders `readwrite` transactions on the same store, so the page's `set` after a read and its `del` at a login's end can never fall between the compare and the write. When the push does not replace, the updater returns what was there, unchanged; for a phone that keeps nothing, idb-keyval then writes `undefined` under `last`, which reads as nothing kept (`balanceOf`), the same as no record.
- **Never rejects:** any failure (opening the database, the transaction) is caught and ignored, as C7a's writes are (W3, D4).
- **Not chosen:**
  - *Writing every valid push* (W2's third point dropped): simpler, but an older push could put back an older balance, shown at the next opening until the live read lands.
  - *Writing even when nothing is kept* (W5's gap accepted): a push C9a sent just before a sign-out could arrive after the balance was forgotten and leave one on a phone without a login (D7).
  - *A `get`, then a `set`*: two transactions, so a page's write or a sign-out's delete could land between them (idb-keyval's README calls that pattern "risky … non-atomic").

### D4 — Writing never stops the notification (W3)

- **In the push listener** *(propose, the order)*: first the balance (`pushedBalance`), and, when there is one, `event.waitUntil(keepPushedBalance(balance))`. Then, as C8b built it: with the browser's own notification nothing more; otherwise `showNotification` with its own `waitUntil`. Both start in the same turn, so the message is never held back by the write.
- **Why `waitUntil`:** without it the browser may end the service worker as soon as the listener returns, before IndexedDB has written.
- **Where the browser shows its own notification** (Safari): the draft shows the proposed notification once the event's `waitUntil` promises have settled and the handler showed none ("To fire a push event", step 3.1; "Receiving a push message", step 5.5). It also shows it when a promise rejects (step 3.2), but the write never rejects anyway. So on the iPhone the write delays the notification by its own time, an IndexedDB write of milliseconds.
- **A store that never answers** *(propose)*: no limit of our own. Where the service worker shows the message, it is already shown. Where the browser shows its own, the browser bounds the event: WebKit's post says "If the event handler fails to display a replacement notification in time, the fallback is used", with no duration given. A timer of our own racing the write was weighed: it would end the event early and could lose the write, for a fault never seen with this store.
- **A failing store** (W3) is ignored: the notification shows as it would without this change, and the kept balance stays as it was, or as nothing.

### D5 — The service worker never loads the API client *(propose, found while writing this design)*

- **The hazard:** `storedBalance.ts` imports `balanceOf` from `balance.ts`, which imports `api/client.ts`, and that module runs `createClient<paths>({ baseUrl: window.location.origin })` when it loads. A service worker has no `window`, so importing `storedBalance.ts` into `pushDisplay.ts` as it is would throw at the service worker's start. That would lose the precache (opening offline) and every push handler, not just this change.
- **The fix:** `balanceOf` and the `Balance` type move, unchanged, into `src/app/balanceRecord.ts`, whose only import is the type-only `components` from `../api/schema` (erased at build). `balance.ts` re-exports both, so its importers (`screenState.ts`, `useAccountScreen.ts`, the tests) stay as they are. `storedBalance.ts` imports from `balanceRecord.ts`. idb-keyval opens its database lazily, on first use (its `createStore` returns a function that opens on demand), and `indexedDB` exists in a worker.
- **The guard:** `tsconfig.sw.json` compiles `sw.ts` and every module it imports with the `WebWorker` library, which declares no `window`. So any import chain from the service worker that reaches the client fails `npm run typecheck` (`tsc -b`), and the build with it. The bootstrap's probe shows the guard bites (§ Bootstrap), and the slice-1 wiring task checks that the built `dist/sw.js` carries no API client.

### D6 — The app opened from the notification (W4)

- **Nothing new to build:** on Safari the browser opens `navigate` (`/`) when its own notification is tapped. Elsewhere C8b's `notificationclick` focuses or opens the app. Either way C7a's start-up (c009 D2) shows the kept balance at once, now the push's, with its freshness line ("Aktualizováno před 1 min"), and the waking-up screen below it from 1.5 s on while the server wakes. One scenario proves that what shows is the push's balance.
- **An app already open when a push arrives** keeps what it shows: the screen loads the kept balance only at its start, and its live read is newer anyway. The next return to the app reads again (c009 D3). Not a scenario.
- **Design:** no screen changes. The boards in play are C7a's "Account / Detail / Waking up, balance stored" and "Shell / Offline / Balance stored", implemented as they are. No design-system part or token is new.

### D7 — After a login ends (W5)

- **What W5 assumed:** C8c unsubscribes the device at sign-out and on every 401 or 403, so a device without a login gets no pushes, and ADR-0007's rule (a device without a login holds no bank data) holds.
- **The check found two gaps** (2026-11-21):
  1. **A late push.** At sign-out the server forgets the device, then the sign-out runs, then the phone forgets its balance and unsubscribes. A push C9a sent before the server forgot the device can still arrive after the phone forgot its balance. On a 401 or 403 the server still holds the device until its push service reports it gone, so a push can land just after the phone forgot its balance. Either way, writing it would leave a balance on a phone without a login, shown at once at its next opening until `GET /api/me` answers and the app forgets it again. **Closed** by D3's "only replaces, never creates" (the owner, 2026-11-21): once the balance is forgotten, no push brings it back, whatever the timing.
  2. **A login that ends while the app is closed** (30 days unused, c007): the phone stays subscribed until its next opening, the only moment the app learns that the login ended. Until then the check's notifications keep arriving and show the balance on the lock screen (N4's text), and this change keeps replacing the record that was already there from the last read. **Left as it is** *(propose; shown to the owner with gap 1 on 2026-11-21)*: the notification itself carries the balance, so C9b adds no new exposure. The record was there before this change, and the next opening forgets it as today. A fix would belong to C9a or C8c (the server would have to know when a device's login ends, which a cookie login does not tell it).
- **Otherwise nothing else is needed:** a device whose account leaves the allowlist gets no more pushes, and the sender deletes its devices (ADR-0010, item 3).

### D8 — Scenarios and the test kit (W6)

- **One capability,** `push-display` (C8b named it for this: "C9 adds storing the balance", c012 D10). **8 scenarios** against W6's 6 and its manual row (about 5–6 estimated, a guide). The extra one is W5's decision:

  | W6 | Scenario |
  |---|---|
  | 1 | A push with a balance replaces the balance the phone keeps |
  | 2 | A push without a balance leaves the kept balance as it was |
  | 3 | A push with a balance of the wrong shape leaves the kept balance as it was |
  | 4 | A push with a balance read earlier than the kept one leaves it as it was |
  | — (W5, D7) | A push with a balance stores none on a phone that keeps none |
  | 5 | A push still shows its notification when the phone's storage fails |
  | 6 | The app opened from a push's notification shows its balance while the server wakes |
  | manual | A payment's notification on the iPhone opens the app on its balance (D9) |

- **How they read:** each frontend scenario feeds `listenForPushes` a push through the stand-in, as C9a would send it (W6: no C9a code), then opens the app through `renderApp` and reads the screen. Offline it shows the kept balance (C7a's "Jsi offline" state) or nothing; for the last one, the server wakes for 20 s. The phone's storage is real idb-keyval code on `fake-indexeddb`.
- **Which browser:** the scenarios that write use the iPhone's kind (`declarative: true`), where the balance comes from the proposed notification (D2). The storage-failure scenario uses the other kind, where the service worker shows the notification, and so does the tap in the last scenario. A unit test covers writing from the push's own JSON.
- **Green from the start:** five scenarios pass before any code exists, because nothing writes yet: earlier read, none kept, no balance, wrong shape, storage failing. They are guards: each turns red as soon as a write ignores its rule. Accepted at the acceptance gate as such. At each one's `[close]`, the orchestrator proves it with a mutation: it breaks that rule in the code (an unconditional write; no shape check; a write that rejects), sees the scenario go red, and restores it. Precedents: c008's two acceptance claims green from the start, c013's slices green on arrival, each proven by a mutation.
- **The stand-in** *(propose)*, the test-writer's (`src/test/serviceWorker.ts`): for `declarative: true` and a declarative message, the proposed notification also carries the message's `notification.data` as its `data`, and the event's own `data` is null, as the draft says (D2). Every other push stays as it is. Firing for a message without `mutable` stays too (C8b's model; the draft and WebKit's post differ there, and the handler does not depend on it). C8b's one test with `declarative: true` returns before it reads any data, so it is unaffected. testing.md § Fake push service says so.
- **Not scenarios** (unit tests): the balance read from the push's JSON where the browser proposes no notification; `readAt` compared as moments across offsets; a balance read at the same moment replaces the kept one; a forgotten balance is not written back; a proposed notification whose `data` is not an object; a push with no data or of text that is not JSON; the message shown without waiting for the write; a failing store never makes the event's work reject where the browser shows its own notification.

### D9 — The manual row (W6)

- **In `tests/manual-scenarios.md`,** on the owner's iPhone **once C9a and C9b are both deployed** (N3), and again at M7 on the daughter's phone:
  - *push-display / A payment's notification on the iPhone opens the app on its balance:* with the Home Screen app closed, a real payment brings the app's notification to the lock screen. *(propose)* The phone is then put in airplane mode, and a tap opens the app showing the notification's balance, with "Jsi offline".
- **Why offline** *(propose)*: C9a's check has just woken the server, so online the live read lands within a second and could hide whether the first frame showed the push's balance. Offline, nothing but the kept record can show it, so the row proves that the push wrote it on the iPhone, which is D2's riskiest assumption. W6's "at once" is covered by the frontend scenario (D6).
- **If it fails** (the old balance shows): Safari hands the service worker neither the proposed notification's `data` nor the raw data (§ Risks). The fix is a follow-up, decided then.

### D10 — Side by side with C9a (N1, N3)

- **Either merges first** (N3). If C9a merges first, C8b's handler finds the notification Safari proposes and shows nothing of its own, and it ignores the data. If C9b merges first, until C9a ships the only pushes are the owner's test messages, which carry no balance, so the kept balance is left alone. The manual row waits until both are deployed.
- **No shared code file** (N1): C9a's code is the server's, and C9b's is the frontend's.
- **Joined by hand by whichever merges second** (N1; the C9a session agreed, 2026-11-21): C9b's row in `pm/progress.md` (C9a's PR splits C9 in `pm/roadmap.md` and `pm/progress.md`; this change adds only its own row there) and ADR-0007's notes. Also `tests/manual-scenarios.md`, where each adds a row (C9a's: account-check / A real payment brings the notification on the iPhone). Possibly testing.md § Fake push service, where C9a may describe its `mutable` push; C9a also writes § Fake bank and § Time and the background job, which this change leaves alone. And the software-factory lessons and inventory, where each takes the next free numbers when written.
- **Change numbers:** c014 is C9a's, c015 this one.

### D11 — Software-factory records *(propose)*

At the next free numbers when written (R-87 was the last on 2026-11-21; C9a may take some first):

- *(New)* Data from a Declarative Web Push in the service worker: a mutable declarative push gives the event no raw data (W3C draft), so the handler reads the proposed notification's `data` first and the raw JSON second. The work goes inside `waitUntil` and never rejects, and the browser shows its own notification once that work settles (D2, D4).
- *(New)* A push only replaces data the device keeps, never creates it, so a record forgotten when a login ends cannot come back by a push that was already on its way. The compare and the write share one IndexedDB transaction (D3, D7).
- *(New)* Code shared by the page and the service worker must not import a module with load-time side effects that need `window`. The worker's own TypeScript project (`WebWorker`, no `window`) is the guard (D5).
- Inventory lines: the service worker's push handling (`pushDisplay.ts`, now keeping the balance) and its stand-in (the draft's declarative event), both rows updated.

## Public API sketch

```ts
// ---- src/RevolutReader.Web/src/app/balanceRecord.ts (new, D5) — only a type import, so the service worker can load it ----
import type { components } from "../api/schema";

/** The balance as the API answers it and as the phone keeps it (c009 design.md D1, D4): `readAt` in ISO 8601. */
export type Balance = components["schemas"]["RevolutReaderApiAccountBalanceResponse"];

/**
 * The balance, when the value has its shape: the amount and the rate as numbers, the read time as a date and time; only
 * those three. For the API's answer, the record the phone keeps and a push's balance (moved unchanged from balance.ts).
 */
export function balanceOf(body: unknown): Balance | null;

// ---- src/RevolutReader.Web/src/app/balance.ts (D5) ----
// export { balanceOf, type Balance } from "./balanceRecord";   — its importers stay as they are; readBalance unchanged.

// ---- src/RevolutReader.Web/src/app/storedBalance.ts (D3) ----
// imports balanceOf and Balance from "./balanceRecord" (no longer "./balance"); loadStoredBalance, storeBalance and
// forgetStoredBalance unchanged.

/**
 * Keeps a balance a push brought in place of the one the phone keeps (c015 design.md D3): only when the phone keeps a
 * balance of the right shape and the pushed one was not read earlier (`readAt` compared as moments); read, compared and
 * written in one IndexedDB transaction (idb-keyval's `update`), only the three fields. Never rejects: a failure is ignored.
 */
export function keepPushedBalance(pushed: Balance): Promise<void>;

// ---- src/RevolutReader.Web/src/app/pushDisplay.ts (D2, D4) — imported by sw.ts and by the tests ----

/**
 * The balance a push carries (D2): `balance` in the data of the browser's proposed notification when the event carries
 * one (a mutable Declarative Web Push gives the event no data of its own, W3C draft), else in the push's own JSON
 * (`notification.data.balance`); kept only when `balanceOf` gives one. Null when there is none or it has the wrong shape.
 */
export function pushedBalance(event: PushLike): Balance | null;

// PushLike, PushWorker, NotificationClickLike, WindowLike, DeclarativeMessage and declarativeMessage unchanged.
// listenForPushes(worker: PushWorker): void — same signature; its push listener now (D4):
//   1. const balance = pushedBalance(event); if (balance !== null) event.waitUntil(keepPushedBalance(balance));
//   2. then as before: the browser's own notification → nothing more; else the declarative message shown
//      (showNotification under its own waitUntil), in the same turn, never after the write.
// sw.ts unchanged: listenForPushes(self).

// ---- src/RevolutReader.Web/src/test (the test-writer's, D8) ----
// serviceWorker.ts: with `declarative: true`, a declarative message's proposed notification also carries the message's
//   `notification.data` as `data`, and the event's own `data` is null (W3C draft); every other push as before.
// server.ts: unchanged; the scenarios use phoneKeeps(kept(…)), phoneKeepsRecord, phoneStorageFails, keptBalance,
//   goOffline, renderApp and the test clock.
// push-display.test.ts: a helper building a push as C9a sends it:
//   { web_push: 8030, mutable: true,
//     notification: { title, body?, navigate: `${ORIGIN}/`, data: { balance: { amount, readAt, czkPerEur } } } }
```

## Rule ownership

| Rule (spec, ADR or decision) | Enforced by |
|---|---|
| A push's balance is found in the proposed notification's data, else in the push's JSON | `pushedBalance` |
| A balance of the wrong shape, or none, is no balance | `pushedBalance` (`balanceOf`) |
| A push only replaces a kept balance of the right shape, never creates one | `keepPushedBalance` |
| A balance read earlier than the kept one leaves it | `keepPushedBalance` |
| Only the three fields are kept | `balanceOf`, `keepPushedBalance` |
| The compare and the write never interleave with the page's writes or deletes | `keepPushedBalance` (one `readwrite` transaction, idb-keyval's `update`) |
| A failing store is ignored; the write never rejects | `keepPushedBalance` |
| The service worker lives until the write is done; the message is never held back by it | `listenForPushes` (`waitUntil`, the order) |
| The notification shows as before (Safari's own, or the service worker's) | `listenForPushes` (C8b's rule, unchanged) |
| The app opened shows the kept balance at once, while the server wakes | `useAccountScreen` (C7a, unchanged) |
| The service worker loads no module that needs `window` | `tsconfig.sw.json` (`WebWorker`), through `npm run typecheck` |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected outcomes | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `pushedBalance` | the balance | `null` for no balance, the wrong shape, no data, data that is not JSON | none; never throws (the JSON read is caught, as `pushJson` does) |
| `keepPushedBalance` | — | the kept balance replaced, or left as it was | none; never rejects (a failing store is ignored) |
| push listener | the balance kept, the notification shown | as C8b's | `showNotification`'s failure passes to `waitUntil`, as before |

No backend operation and no Result union: the change is frontend only.

## Ports and contracts

None new or changed. The stored balance is the app's own module over idb-keyval, not a port. Its tests run the real code on `fake-indexeddb`, as C7a's do (c009 D4). The service worker's scope is reached through C8b's small interfaces (`PushWorker`, `PushLike`), and the tests use the stand-in. These are the browser's own APIs, so there are no contract tests.

## How each scenario is verified

| Scenarios | Level | Why |
|---|---|---|
| `push-display`: the 7 automated ones, "A push with a balance replaces the balance the phone keeps" through "The app opened from a push's notification shows its balance while the server wakes" | frontend tests in `src/scenarios/push-display.test.ts`: `listenForPushes` fed a push through the service worker stand-in, then the app opened through `renderApp` (offline, or with the server waking), on `fake-indexeddb` and the test clock | jsdom runs no service worker and there are no browser tests ([divergences.md R-19](../../../docs/software-factory/divergences.md)); the handler's events and the app's screen are the public channels (c012 D10, W6) |
| `push-display`: "A payment's notification on the iPhone opens the app on its balance" | manual row in `tests/manual-scenarios.md` (D9), once C9a and C9b are deployed; again at M7 | only Safari on the iPhone shows what it hands a mutable declarative push's service worker (D2), and only C9a sends such a push |

## Cross-cutting effects

- **API contract / TS client:** none. No endpoint, and no `openapi.json` or `schema.d.ts` change.
- **Bicep, AppHost, settings, secrets:** none.
- **ADRs:** ADR-0007 gets a dated note, as built: the service worker writes a push's balance only over a kept one of the right shape and not when it was read earlier, from the proposed notification's data or the push's JSON, never failing the notification (D2–D4). ADR-0010 is unchanged: its Consequences ("never touch the stored balance for a message that carries none") hold, and C9a owns item 2's `mutable` (D10).
- **Conventions:** testing.md § Fake push service, the service worker's stand-in (D8). Its `.claude/rules/testing.md` mirror names the stand-in's file only, so it needs no change.
- **Tests:** one row in `tests/manual-scenarios.md` (D9).
- **Design:** read only, no change (D6).
- **Software factory:** D11.
- **CLAUDE.md:** nothing (no command changes).

## Risks / Trade-offs

- **[Safari hands the service worker neither the proposed notification's `data` nor the raw data]** → nothing is written on the iPhone, and the notification still shows. The draft says the proposed notification carries it, with the last hop inferred (D2), and the handler also reads the raw data in case Safari gives it. The manual row is the proof (D9). If it fails, a follow-up decides, for example reading the notification Safari shows through `registration.getNotifications()`, or C9a carrying the balance elsewhere in the declarative message.
- **[Safari does not fire the push event for a mutable message]** → nothing is written, and the notification shows as today. ADR-0010 item 2 and the draft say it does; the manual row would show it.
- **[A store that never answers holds the iPhone's notification]** → the write is milliseconds, and the browser bounds the event, then shows its own notification (D4, WebKit's post). Where the service worker shows the message, it is not held at all.
- **[The page's write and a push's write cross]** → one `readwrite` transaction each, ordered by IndexedDB (D3). A live read that lands after a newer push replaces it, as the page always does. That needs a check and a read within the same second, and the next read corrects it.
- **[Five scenarios pass before any code exists]** → named here as guards and proven by a mutation at their `[close]` (D8), so a passing test is never mistaken for a weak one.
- **[Moving `balanceOf`]** → a pure move with a re-export, so `balance.test.ts` and every importer still compile and pass; the build proves the service worker no longer reaches the client (D5).
- **[C9a's apply changes the push's shape]** → its session tells this one first (D1), and the stand-in helper in `push-display.test.ts` is the one place to change.

## Bootstrap (before `/tdd-apply`, committed as `[setup]`)

1. **Packages:** none.
2. **Probe,** throwaway, reverted afterwards: `pushDisplay.ts` importing `storedBalance.ts` as it is today fails `npm run typecheck` under `tsconfig.sw.json` with "Cannot find name 'window'" from `api/client.ts`, which shows that D5's guard bites. Then, with `balanceOf` in a module whose only import is the type-only schema, the same import passes `npm run typecheck` and `npm run build`, and `dist/sw.js` contains no `openapi-fetch` client. The result goes into § Public API sketch.
3. **Baseline:** the full suite green, except the traceability check naming this change's 8 new scenarios.

## Migration plan

1. **Before `/tdd-apply`:** the bootstrap.
2. **During it:** no local check in the browser. The dev server runs no service worker (c012 D12, the owner's choice of 2026-11-20), and the handler is covered by the stand-in. The production build must pass (`npm run build`) and its `dist/sw.js` must carry no API client (D5).
3. **Before the merge** (workflow.md § 6, a change's path): the push and a draft PR on the owner's go, closing #86; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; the archive on the branch. Whichever of C9a and C9b merges second joins the shared files by hand (D10).
4. **After the merge:**
   - the deploy runs; the app's first start after it, read-only: the revision healthy and the service worker updating as C3 built (a new version shows on the first open);
   - once C9a is deployed too: the manual row on the owner's iPhone (D9), its date in `tests/manual-scenarios.md`; again at M7 on the daughter's phone. Until then this step's row in `pm/progress.md` stays `in progress` and names the row (workflow.md § 6, the one exception).
5. **Rollback:** revert the merge. The service worker stops writing a push's balance, and the notification shows as before. A balance it wrote stays as the kept record and is replaced by the next read. Harmless.

## Open questions

- None. W2's third point and W5's gap were decided by the owner on 2026-11-21 (D3, D7).
