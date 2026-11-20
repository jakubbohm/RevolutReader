# Design: c013-add-subscription-upkeep

## TL;DR

- **At every opening** (a launch, or a return to the app) with a signed-in user and notifications allowed, the app reads the server's key and the phone's subscription. It sends the subscription again when it was made with that key, or when the browser does not say which key it was made with. It subscribes again when the phone has none. It replaces one made with another key: the server forgets the old address, the phone unsubscribes it, subscribes again and sends the new one. All quietly, one upkeep at a time, at most 60 s; any failure waits for the next opening (D1).
- **Sign-out** (the owner's order, 2026-11-20): the server is asked to forget the device before C7a's sign-out request, as a best effort; the phone unsubscribes only once the server has confirmed the sign-out. A failed sign-out keeps the phone's subscription (D2, D3).
- **A 401 or 403** to any of the app's requests, the upkeep's own included, unsubscribes the phone wherever C7a and C7b already forget the stored balance (D4). **Signing in again** is a launch, so the subscription comes back with no tap (D5).
- **The registration** comes from `navigator.serviceWorker.getRegistration()`, never `ready`, which never settles where no worker is registered (Vite's dev server) and would hang a sign-out (D1).
- **An upkeep never outlives its login:** one that finds the login ended removes any subscription it made (D6).
- **11 scenarios** in `push-devices`: 10 frontend, 1 manual on the iPhone after the merge (D7). Frontend only: no endpoint, no setting, no screen.
- **New public interfaces:** `src/app/subscriptionUpkeep.ts` (`pushRegistration`, `keepSubscriptionUp`, `forgetThisDevice`, `unsubscribeThisDevice`); `watchReturns` in `refreshTriggers.ts`; the push stand-in's `getRegistration()`.
- **Integration points:** C8a's three endpoints and push module, unchanged; C7a's `useAccountScreen` (`endLogin`, `signOutFromMenu`); the browser's Push API and permission.
- **Hard to reverse:** nothing new. The order at sign-out is a behaviour C9 relies on (a signed-out phone gets no pushes).

## Context

- See proposal.md § Why. Every decision below was made with the owner in C8's explore (2026-11-08/09) and handed over in the comments of [#51](https://github.com/jakubbohm/RevolutReader/issues/51#issuecomment-6728682809) (shared S1–S12) and [#61](https://github.com/jakubbohm/RevolutReader/issues/61) (C1–C7). This design copies each one it uses, citing its label, and is their home from now on. Details settled while writing it are marked *(propose)*.
- **What merged before** (S1), read 2026-11-20: the archived design.md of c009 (C7a) and c011 (C8a), and `main` at `a33b40f`. Nothing contradicts S1–S12 or C1–C7, so no explore. One clash inside the decisions themselves: C2 (unsubscribe before the sign-out request) against C3 (a failed sign-out keeps the subscription). The owner settled it on 2026-11-20 (D2).
- **What this change builds on:**
  - **C8a's push module** `src/app/push.ts` (c011 D8): `readPushKey`, `sendSubscription`, `forgetSubscription` never throw and answer a kind through `askTheApi` (offline without sending while the phone says so; 401 `signed out`; 403 `refused`). `pushSupported`, `currentSubscription`, `subscribe`, `unsubscribe`, `keyOf`, `madeWith` pass the browser's failures on.
  - **C8a's endpoints** (c011 D9): `GET /api/push/key`; `PUT /api/push/subscription` stores or moves the device by its push address; `DELETE /api/push/subscription` forgets it, 204 also when never stored. All for signed-in, allowed users only.
  - **C7a's sequence** `useAccountScreen.ts` (c009 D2–D6, c010 D8):
    - `endLogin(next)` runs for a sign-out the server confirmed and for every 401 or 403 (to who is signed in, a balance read, the list's newest page through `endLoginFromTheList`). It forgets the stored balance before the sign-in or no-access screen shows.
    - `signOutFromMenu` is busy from the tap, calls `signOut()` (which fails at once, sending nothing, while the phone says offline) and keeps everything on a failure.
    - `watchRefreshTriggers` fires on a return and on coming back online; `REFRESH_LIMIT_MS` is 60 s.
  - **The test kit** (the test-writer's): `src/test/push.ts`, stand-ins for `Notification`, `PushManager` and a registration behind `navigator.serviceWorker.ready`, with a subscription made with a given key, a permission and its answer, and what `subscribe` was asked. The fake server answers the three push addresses, records `bodiesSent()` and the `timeline()`, and answers 401 to everything after a sign-out until `answerWith(…)` sets new answers.
  - **The service worker** is registered by `registerSW` in `main.tsx` on every launch of the built app. Vite's dev server registers none (no `devOptions`; c009 D2's note).
- **Design artifacts:** none. C8c changes no screen and no text; the screens are C8b's.

## Goals / Non-Goals

**Goals:**

- The 11 scenarios of the delta spec, each verified as § How each scenario is verified says.
- A phone that holds a subscription exactly while it is signed in with notifications allowed, and the server told about it at every opening.
- Nothing C8c does is ever seen or felt: no prompt, no banner, no delay to the account screen or to a sign-out beyond one small request.

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- **No state of its own:** nothing is stored on the phone. Every opening reads the server's key and the phone's subscription afresh.
- **No retries inside an upkeep:** the next opening is the retry.
- **No change to C8a's module or endpoints:** C8c composes them.

## Decisions

### D1 — At every opening (C1, S7)

- **An opening** (C1, B8) is a launch, or a return to the app from another one. *(propose)* In code:
  - **the launch:** the moment the screen learns that a user is signed in: the first answer to who is signed in, or a repeated one after the phone was offline or got an unexpected answer (c009 D3). The upkeep starts with the balance read, so it wakes nothing that is not already awake (C1's cost note);
  - **a return:** the page's `visibilitychange` to `visible`, while a user is signed in (`watchReturns`, new beside `watchRefreshTriggers`). Coming back online and "Obnovit" are no openings, so they run no upkeep.
- **When:** a user is signed in, the browser can push (`pushSupported`), a service worker is registered, and `Notification.permission` is `granted`. Otherwise nothing is asked, nothing is subscribed and nothing is sent (spec "Nothing is subscribed while notifications are not allowed"). The upkeep never calls `Notification.requestPermission()`: iOS asks only from a gesture, and the design system's README asks for the permission only from a tap (C8b's card and menu item).
- **The registration** *(propose)*: `pushRegistration()` asks `navigator.serviceWorker.getRegistration()`, which settles with none when no worker is registered. Never `navigator.serviceWorker.ready`: it never settles without a worker (Vite's dev server registers none), so an upkeep would hang for good, and a sign-out waiting for it would never end. `getRegistration` is in Safari since 11.1 (MDN's compatibility data, read 2026-11-20).
- **The steps** (C1, S7):
  1. read the server's key (`readPushKey`);
  2. read the phone's subscription (`currentSubscription`);
  3. **there is one, made with the server's key:** send it again (`sendSubscription`, C8a's `PUT`). The server updates it and moves it to the account signed in now (spec push-devices, "Registering the same device again …");
  4. **there is none** (permission granted, subscription gone, e.g. after a reinstall, iOS revoking it, or a sign-out): subscribe with the key (`subscribe`), then send the new one;
  5. **made with another key** (S7): replace it. *(propose)* First ask the server to forget the old push address (`forgetSubscription`). Only once the server has answered that it forgot it, unsubscribe the old one on the phone, then subscribe with the current key and send the new one.
     - Why forget first: a push signed with the new key to an address made with the old one may be refused by the push service as unauthorised rather than reported gone (not checked against each push service's documents; the cheap step makes the answer not matter). The sender counts such a refusal as failed and keeps the device (c011 D3), so an old address left on the server would fail on every message, for good.
     - Why only once forgotten: a failed forget leaves the phone untouched, and the next opening tries the whole replacement again with the old address still known.
     - Why before the new one is sent: a browser that hands back the same push address still ends with the new keys on the server.
- **A key the browser does not name** *(propose)*: when `keyOf` answers `null`, the subscription is sent again as it is, never replaced. MDN's compatibility data lists `PushSubscriptionOptions.applicationServerKey` in Safari from 16 and on iOS from 16.4, but not what it returns (read 2026-11-20). Replacing on `null` would churn the subscription at every opening, and every quiet `subscribe` is a chance for iOS to refuse one without a gesture. Cost: on such a browser a replaced server key does not heal by itself (§ Risks).
- **Quietly** (C1): no prompt, no tap, nothing on screen. An upkeep's outcome is never shown. *(propose)* What ends it:
  - an answer of 401 or 403 to any of its requests ends the login, as a 401 or 403 to any of the screen's reads does (D4; the list's precedent, c010 D8);
  - anything else stops it quietly and waits for the next opening: offline, an unexpected answer, a refused subscription (400), a failure of the browser's `subscribe` or `unsubscribe`, the time limit.
- **One upkeep at a time** *(propose)*: an opening while one runs is ignored, not queued. Each upkeep has the refresh's 60 s limit (`REFRESH_LIMIT_MS`, c009 D3), through an `AbortSignal` its requests honour, so a request with no answer cannot block the next opening's upkeep. The browser's own calls (reading the subscription, subscribing, unsubscribing) take no signal, so the upkeep stops waiting for one when the limit fires and ends "stopped": a quiet `subscribe` that iOS leaves hanging cannot block every later opening either (found by the test-writer in `/tdd-apply`, 2026-11-20). A subscription that settles after that is kept, and the next opening sends it again.
- **Cost:** two small requests at each opening (the key, then the subscription), not C1's estimate of one. The key must be read to compare it (S7), and C8c adds no endpoint that could return it together with the subscription (S10). Both go out together with the balance read, to a server that is already awake.
- **Not chosen** (C1): sending the subscription only once, when notifications are turned on. A browser can drop or replace a subscription without telling the page reliably, and pushes would then stop silently.

### D2 — Sign-out (C2, as settled by the owner on 2026-11-20)

- **The order:**
  1. at the tap, the menu item is busy, as today (c009 D6);
  2. **ask the server to forget this device** (`forgetThisDevice`, C8a's `DELETE`), as a best effort, while the login still allows the request. It reads the phone's subscription for its push address; with no registration or no subscription it sends nothing. Its outcome is ignored, and it has the 60 s limit *(propose)*;
  3. **C7a's sign-out request** (`signOut()`), unchanged;
  4. **once the server has confirmed the sign-out:** unsubscribe on the phone, inside `endLogin` (D4), with the stored balance, before the signed-out screen shows.
- **Why this order** (the owner's choice between three, 2026-11-20). C2 as first written unsubscribed the phone before the sign-out request, which clashes with C3 whenever the sign-out then fails: no answer, or a server error.
  - Unsubscribing only after the confirmation keeps C3 in every case.
  - It keeps C2's purpose: every confirmed sign-out unsubscribes the phone, so a signed-out phone gets no more pushes even when the server never heard the request to forget it.
  - The forget must still come first, because the server accepts it only with the login.
  - Not chosen: C2 as written, where C3 would hold only when the phone says it is offline. And C2 with a re-subscribe after a failed sign-out: more code, and requests that would likely fail just as the sign-out did.
- **The push part never makes a sign-out fail** (C2): `forgetThisDevice` and `unsubscribeThisDevice` never throw, and the forget's answer, whatever it is, is ignored. If the server keeps the device, the next push to it gets "gone" from the push service, and the server deletes it (S4, c011 D3).
- **Offline:** while the phone says it is offline, the forget sends nothing (`askTheApi`) and `signOut()` fails at once, so nothing is touched (D3).

### D3 — A failed sign-out (C3)

- A sign-out that fails, offline or with a server error, keeps the phone's subscription, as C7a keeps the stored balance: the user is still signed in.
- When the forget went through and the sign-out then failed, the server no longer knows the device. The next opening sends the subscription again (D1, step 3). *(propose)* Accepted: the device gets no pushes until then, at most until the user next returns to the app.

### D4 — A 401 or 403 (C4)

- Wherever the server answers 401 or 403, C7a forgets the stored balance (`endLogin`, c009 D4; the list's newest page, c010 D8). The app also unsubscribes the phone there (`unsubscribeThisDevice`). *(propose)* The same applies to a 401 or 403 to the upkeep's own requests (D1), through the same path as the list's: the login ends once on a screen.
- No request to forget: the server would refuse it, since the device has no allowed login. The server's record goes when a push to it is reported gone (S4). For an account taken off the allowlist, it goes at the next message to that account (c011 D3).
- *(propose)* `endLogin` unsubscribes and forgets the balance together, and both finish before the sign-in or no-access screen shows. A failure to unsubscribe is ignored.

### D5 — Back after signing in again (C5)

- iOS keeps the permission across a sign-out. Signing in is a page navigation to Microsoft and back (c007 D2), so the return is a launch: D1, step 4, subscribes again quietly at the first opening after the sign-in. The owner taps nothing.
- **No card** (C5): C8b decides "notifications are off" from `Notification.permission` alone (c012 design.md D8, confirmed by the C8b session on 2026-11-20). While the permission is granted there is no card and no menu item, even when the phone holds no subscription. The permission stays granted across a sign-out, so the card does not come back.
- That iOS subscribes without a tap once the permission was granted is **assumed, not verified** (C1). The manual row checks it on the iPhone (§ Risks has the fallback).

### D6 — An upkeep never outlives its login *(propose)*

- An upkeep can still be running when the login ends: the user signs out while a quiet `subscribe` is under way, or a balance read answers 401.
- **The rule:** the upkeep checks after every step that the login it started under is still on (`stillSignedIn`, from the screen's count of ended logins, c009's `loginsEnded`). If it has ended, the upkeep stops, and if it made a subscription, it unsubscribes it. So a signed-out phone never keeps a subscription, whatever the timing.
- **What the server keeps:** if the new subscription was sent before the login ended, the server keeps that address until a push reports it gone (S4). Harmless: the phone no longer holds it.
- Unit-tested, no scenario: an ordering between the phone's calls and the server's answers that no user can bring about on purpose.

### D7 — Capability and scenarios (C6) *(propose)*

- **Where:** added to `push-devices`, whose purpose is a device's push registration with the app. C8a filled it from the server's side, and C8c adds the device's side. One behaviour per requirement, eight requirements; the existing five are unchanged.
- **11 scenarios** against C6's estimate of about 8:
  - C6's item 1 becomes two, a launch and a return, because a return reaches the upkeep by its own path (`watchReturns`);
  - a guard, "Nothing is subscribed while notifications are not allowed": C1's "when notifications are allowed" is what keeps a quiet upkeep from ever asking iOS outside a tap;
  - the manual row (C6, "Manual row 4").
- **Green from the start, by design:**
  - "A failed sign-out keeps the subscription": today's sign-out never touches the subscription. It guards D2's order against a future change.
  - "Nothing is subscribed while notifications are not allowed": nothing subscribes today.

  The acceptance gate says so, as c008's two scenarios did.

### D8 — Side by side with C8b (C7, S10)

- **C8c owns the lifecycle:** the upkeep at every opening, the forget before the sign-out request, the unsubscribe wherever the login ends. **C8b owns the screens:** the card, the menu item, the banner's use, the service worker showing a push.
- **C8c merges second:** its last task group waits for C8b's merge (C7, S10 item 4), so C8c merges `main` with C8b into its branch and joins by hand.
- **Agreed with the C8b session** (2026-11-20, at the owner's request; c012 design.md D13 records C8b's side). Who touches which files:
  - `src/app/useAccountScreen.ts`: C8c adds the upkeep's triggers and changes `endLogin` and `signOutFromMenu`. C8b adds two callbacks to the model (`notificationsFailed(offline)`, `notificationsRetried()`) and does not touch `endLogin` or `signOutFromMenu`;
  - `src/app/screenState.ts`: C8b only (the problem `notifications failed`, ranked with the failed sign-out in `bannerOf`);
  - `src/App.tsx`: wherever C8b wires its card or menu item (S10);
  - the test kit: `src/test/push.ts` is C8c's only (`getRegistration()`, `registered: false`). In `src/test/server.ts`, C8b's `emptyThePhone()` also clears `localStorage`, C8b adds a helper that remembers "Teď ne", and a failing `PUT /api/push/subscription` answer if there is none. C8b's `src/test/serviceWorker.ts` is new;
  - `tests/manual-scenarios.md`: C8b's rows 1, 2, 3 and 5, C8c's row 4;
  - `pm/progress.md`: each change its own row;
  - specs: C8b's capabilities are its own (`notification-opt-in`, `push-display`), and it modifies `app-shell`'s "The top bar holds the account menu", which C8c leaves alone. C8b adds nothing to `push-devices`.
- **Neither adds an endpoint** (S10), so no generated API file is merged.
- **Openings:** C8b's own opening watch stays inside its `useNotificationOptIn`, because its D4 needs the leaving as well as the return. C8c's `watchReturns` stays in `refreshTriggers.ts`. The join may unify them, but doesn't have to.
- **Checked at the join, as merged:** C8b's card stays hidden while the permission is granted (D5). After C8b's card turns notifications on, the next opening only sends the subscription again (D1, step 3).

### D9 — Records *(propose)*

- **ADR-0010-web-push,** a dated note to item 4, "A lost or replaced key heals itself". C8c builds it as D1 says: the old address is forgotten on the server first, and a subscription whose key the browser does not name is kept as it is. At sign-out the phone unsubscribes after the server confirms, and on every 401 or 403 (D2, D4). No new ADR: nothing here is cross-cutting beyond ADR-0010.
- **ADR-0007:** no change. Its item 4, the stored balance deleted on sign-out, is the reason for D2, not changed by it.
- **Software factory:**
  - *(New)* keeping a PWA's push subscription right. Send it again at every opening; make it again when it is lost; replace it when it was made with another key, forgetting the old address on the server first; at sign-out, ask the server to forget it while the login allows, and unsubscribe only after the sign-out is confirmed; unsubscribe on every 401 or 403. Ask for the service worker registration with `getRegistration()`, never `ready`. The next free number when written (R-79 was the last on 2026-11-20).
  - The inventory row of the push module and its stand-ins (`creating-handover-package.md`, Frontend) gains the upkeep and the stand-in's `getRegistration()`.

## Public API sketch

```ts
// ---- src/RevolutReader.Web/src/app/subscriptionUpkeep.ts (new) ----

/**
 * The service worker registration push needs (D1): `null` when the browser cannot push (`pushSupported`), when no
 * worker is registered (Vite's dev server), or when asking fails. Asks `navigator.serviceWorker.getRegistration()`,
 * never `ready`, which never settles without a worker. Never throws.
 */
export function pushRegistration(browser?: Window): Promise<ServiceWorkerRegistration | null>;

/** What one upkeep came to (D1, D6). Only "login ended" changes the screen. */
export type UpkeepOutcome =
  | { kind: "sent again" }                                        // step 3: made with the server's key, or with a key not named
  | { kind: "subscribed again" }                                  // step 4: the phone had none
  | { kind: "replaced" }                                          // step 5: made with another key
  | { kind: "not allowed" }                                       // no push, no worker, or the permission not granted: nothing done
  | { kind: "login ended"; ended: { kind: "signed out" } | { kind: "refused"; email: string | null } }   // a 401 or 403 (D4)
  | { kind: "dropped" }                                           // the login ended elsewhere while it ran (D6); what it made is unsubscribed
  | { kind: "stopped" };                                          // offline, unexpected, a refused subscription, a browser failure, the limit

/**
 * One upkeep (D1): the key, the phone's subscription, then send it again, subscribe again or replace it. Never asks for
 * the permission, never throws. `stillSignedIn` is checked after every step (D6); `signal` is the 60 s limit, passed to
 * every request.
 */
export function keepSubscriptionUp(options: {
  stillSignedIn: () => boolean;
  signal?: AbortSignal;
  browser?: Window;
}): Promise<UpkeepOutcome>;

/**
 * Before the sign-out request (D2): asks the server to forget the push address of the phone's subscription, if there is
 * one. Its answer is ignored; never throws.
 */
export function forgetThisDevice(options?: { signal?: AbortSignal; browser?: Window }): Promise<void>;

/** Wherever the login ends (D2 step 4, D4): unsubscribes the phone's subscription, if there is one; never throws. */
export function unsubscribeThisDevice(options?: { browser?: Window }): Promise<void>;

// Uses C8a's push module as it is: readPushKey, sendSubscription, forgetSubscription, pushSupported, currentSubscription,
// subscribe, unsubscribe, keyOf, madeWith.

// ---- src/RevolutReader.Web/src/app/refreshTriggers.ts (gains) ----

/** A return to the screen alone (`visibilitychange` to `visible`), every time (D1); returns the stop function. */
export function watchReturns(onReturn: () => void, page?: Document): () => void;

// ---- src/RevolutReader.Web/src/app/useAccountScreen.ts (changes; its model, AccountScreenModel, is unchanged) ----
// - runUpkeep(): one at a time (a ref), the 60 s limit; stillSignedIn compares the count of ended logins at its start
//   with the count now, and that the screen is still on the page; its "login ended" goes through the path the list's
//   uses (endLoginFromTheList, generalised: the login ends once on a screen).
// - runs when `signedIn` becomes true (an effect on it), and on every return while signed in (watchReturns).
// - endLogin(next): forgetStoredBalance() and unsubscribeThisDevice() together, before the next screen shows (D4).
// - signOutFromMenu(): busy, then forgetThisDevice({ signal: the 60 s limit }), then signOut(), as before (D2).
```

```ts
// ---- src/RevolutReader.Web/src/test (the test-writer's) ----
// push.ts: the stand-in's navigator.serviceWorker gains getRegistration(), which settles with the registration (and with
//   undefined under a new option, `registered: false`, for a browser with a service worker but none registered, as on
//   Vite's dev server). `ready` stays for C8b.
// server.ts: nothing new is needed. bodiesSent() shows the PUT and DELETE bodies, timeline() the order of the forget and
//   the sign-out, and answerWith(…) after a sign-out models signing in again (it clears the signed-out state); a
//   `signsInAgain(…)` helper only if the test-writer wants the scenario to read better.
// renderApp's reopen() is the launch after a sign-in; returnToApp() the return.
// src/scenarios/push-devices.test.tsx: the 10 frontend scenarios, `scenario("push-devices", "<name>", …)`.
```

## Rule ownership

| Rule (spec, ADR or convention) | Enforced by |
|---|---|
| At every opening, with a signed-in user and notifications allowed: sent again, made again or replaced | `useAccountScreen` (when: a signed-in user becomes known, and `watchReturns`); `keepSubscriptionUp` (what) |
| Quietly: no permission prompt, nothing shown, failures wait for the next opening | `keepSubscriptionUp` (never calls `requestPermission`, never throws); `useAccountScreen` (shows no outcome) |
| Nothing while notifications are not allowed, the browser cannot push, or no worker is registered | `keepSubscriptionUp`, `pushRegistration` |
| Replaced only when the browser names another key; the old address forgotten first | `keepSubscriptionUp` (with C8a's `keyOf`, `madeWith`) |
| One upkeep at a time, at most 60 s | `useAccountScreen` (`runUpkeep`) |
| Sign-out: forget first, unsubscribe only after the confirmation; the forget never fails it | `useAccountScreen` (`signOutFromMenu`, `endLogin`); `forgetThisDevice`, `unsubscribeThisDevice` (never throw) |
| A failed sign-out keeps the subscription | `useAccountScreen` (`signOutFromMenu` leaves it on a failure) |
| A 401 or 403 anywhere unsubscribes the phone | `useAccountScreen` (`endLogin`; the upkeep's own through the list's path) |
| A signed-out phone never keeps a subscription an upkeep made | `keepSubscriptionUp` (`stillSignedIn` after every step) |
| Every scenario claimed exactly once | `TraceabilityTests` (frontend claims and the manual row) |

## Error model

| Operation | Value | Expected outcomes | Exceptions |
|---|---|---|---|
| `pushRegistration` | the registration | `null` (no push, no worker, a failure) | none; never throws |
| `keepSubscriptionUp` | `UpkeepOutcome` | every kind of it; the browser's and the API's failures become `stopped`, a 401 or 403 `login ended` | none; never throws |
| `forgetThisDevice` | — | — (its answer is ignored) | none; never throws |
| `unsubscribeThisDevice` | — | — | none; never throws |
| `watchReturns` | the stop function | — | — |

No backend operation changes, and no Result union is added.

## Ports and contracts

None new or changed. The browser's Push API is reached through C8a's push module, and the server through C8a's three endpoints, both unchanged. The unit tests use the test kit's stand-ins for `Notification`, `PushManager` and the registration (c011 D7), and the fake server. These are not contract fakes, so there is no `[integration]` group.

## How each scenario is verified

| Scenarios | Level | Why |
|---|---|---|
| `push-devices`: the 10 scenarios from "The subscription is sent to the server again when the app opens" to "After signing in again, the phone subscribes without a tap" | frontend tests in `src/scenarios/push-devices.test.tsx`, with the push stand-ins and the fake server | what the phone holds, whether it asked for the permission, and what it sent to the server only the page can show; jsdom has no Push API, so the stand-ins play it (S9) |
| `push-devices`: "After signing out and in again on the iPhone, a message arrives without a tap" | manual, a row in `tests/manual-scenarios.md` (handover step M7), checked first by the owner after C8c's merge and deploy | it checks C1's assumption that iOS subscribes again without a tap, and only Apple's push service and the iPhone's Home Screen app can show it (C6, "Manual row 4") |

The existing six `push-devices` scenarios stay API acceptance tests, unchanged.

## Cross-cutting effects

- **API contract / TS client:** none.
- **Bicep, AppHost, settings, CI:** none.
- **ADRs:** a dated note in ADR-0010 (D9).
- **Conventions:** none. testing.md's frontend section already covers the stand-ins and the fake server; the stand-in's new `getRegistration()` is described in `src/test/push.ts` itself.
- **Operations:** none. Sending the iPhone check's message follows deployment.md § Sending a test message (c011 D6), on the owner's go.
- **Software factory:** D9.

## Risks / Trade-offs

- **[iOS refuses a quiet `subscribe` without a gesture]** (C1's assumption) → the manual row checks it after the merge. If it fails, the phone has no subscription after a sign-out and sign-in while the permission stays granted, and C8b's card stays hidden (D5). The fallback is a decision for the owner then: C8b's "notifications are off" would also count "permission granted but no subscription", so the menu item offers a tap.
- **[Safari does not name the key a subscription was made with]** → such a subscription is sent again, never replaced (D1). A replaced server key then does not heal by itself on the iPhone: pushes fail, and the message endpoint's answer counts them as failed. The heal is to sign out and in again on the phone (D2, D5). A rotated key is rare: the production keys never expire (c011 D5).
- **[The push service accepts the old address with the new key after all]** → harmless: D1's forget-first only removes a row that would otherwise fail.
- **[An upkeep's `subscribe` under way when the user signs out]** → D6. The server may keep the new address until a push reports it gone.
- **[C8b's turn-on and C8c's upkeep subscribe at once]** (pointed out by the C8b session): the page returns while iOS asks for the permission, and the answer is "granted" by then. Harmless: the same key gives the same subscription, and the server's `PUT` replaces the device by its push address.
- **[Two small requests at every opening, not one]** → both go out with the balance read to an awake server; the cost is a few milliseconds.
- **[The forget delays the sign-out]** → by one small request, or at most the 60 s limit when the network hangs. That is the same hang the sign-out request would meet, and the menu item is busy throughout.
- **[No local end-to-end check]** → Vite's dev server registers no service worker, so the upkeep does nothing locally, by design (D1). The frontend scenarios are the proof, then the iPhone after the merge.
- **[C8b's files and C8c's collide at the join]** → C8c merges second and joins by hand (D8). The shared files are listed, and the full suite runs after the join.
- **[11 scenarios against an estimate of 8]** → a guide, never a limit (S11); D7 gives the reasons.

## Bootstrap (before `/tdd-apply`, committed as `[setup]`)

1. No package, no probe: everything C8c uses is on `main` (C8a's module, the stand-ins, the fake server).
2. **Baseline:** the full suite green, except the traceability check naming this change's 10 frontend scenarios. The manual one is claimed by its row, which group 1 adds.

## Migration plan

1. **Before `/tdd-apply`:** the baseline.
2. **During it:** the slices; no local check (§ Risks).
3. **After C8b's merge** (the last task group; C7, S10 item 4): merge `main` with C8b into this branch, join the files of D8 by hand, then the full suite and checks.
4. **Before the merge** (workflow.md § 6, a change's path): the push and a draft PR on the owner's go; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; the archive on the branch.
5. **After the merge**, once the deploy runs: the iPhone check of the manual row. The owner turns notifications on through C8b's card in the Home Screen app (if C8b's own checks have not already done so), signs out from the account menu and signs in again. Claude Code sends a message to the owner's account through the message endpoint, on the owner's go (c011 D6), and it shows on the iPhone with nothing tapped. Its date goes into `tests/manual-scenarios.md`, and the outcome into `pm/progress.md`, through a small docs PR. It needs C8c deployed, so it cannot run before this PR's merge; agreed with the owner on 2026-11-20, in place of #61's "last task group, the iPhone check".
6. **Rollback:** revert the merge. Phones keep the subscriptions they hold; nothing re-sends them at an opening, and a sign-out no longer forgets or unsubscribes them. The server's sender still deletes devices reported gone. Harmless until C9 sends account data.

## Open questions

None.
