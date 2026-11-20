# Design: c012-add-notification-opt-in

## TL;DR

- **The card** (`NotificationOptIn`) sits under the balance header wherever the browser can subscribe, by feature detection, not only in the Home Screen app (D2, B2: a deliberate difference from the design system). Its states: default, enabling, enabled, denied (D3, D4, D6).
- **Turning on** asks `Notification.requestPermission()` synchronously in the tap, then waits for the service worker, reads C8a's key, subscribes and sends the subscription, all within 60 s (D3, D8). **"On" means the phone allows notifications;** C8c's upkeep completes a subscription a failure left behind (D8).
- **A result goes at the first opening after it was shown** (a launch, or a return), so an iOS prompt that hides the page cannot clear it early (D4). **"Teď ne" is remembered in `localStorage`** (D5).
- **The account menu's "Zapnout upozornění"** shows while notifications are off and no card is on screen; it asks from `onSelect` synchronously, or brings back the Denied card when the phone blocks them (D7). **A failure** becomes the screen's one banner, like a failed sign-out (D8).
- **The service worker** leaves a push whose event carries the browser's own `notification` (Safari), and shows the message itself elsewhere; a tap focuses an open window or opens the message's page on its own origin (D9).
- **22 new scenarios and 1 changed:** 18 frontend tests, 4 manual rows on the iPhone (D10, D11). **The local check** stops before subscribing, because the dev server runs no service worker; subscribing and the first push are checked on the deployed app (D12, the owner's choice).
- **New public interfaces:** `notificationOffer` (what is offered), `useNotificationOptIn` (the sequence), `turnNotificationsOn`, the remembered "Teď ne" (`notNowRemembered`, `rememberNotNow`), `listenForPushes` (the service worker's push and tap handling); the `NotificationOptIn` component; `AppShell` and `AccountMenu` gain `onEnableNotifications`; `useAccountScreen` gains two callbacks for the failure banner; the test kit's service worker stand-in.
- **Integration points:** C8a's push module and its three endpoints, unchanged; the browser's `Notification`, `PushManager`, service worker and `localStorage`; Safari's Declarative Web Push. No API, settings, AppHost or Bicep change.
- **Hard to reverse:** the `localStorage` key of the remembered "Teď ne" (a renamed key shows the card again on every device that dismissed it).

## Context

- See proposal.md § Why. Every decision below was made with the owner in C8's explore (2026-11-08/09) and handed over in the issues' comments: the shared [S1–S12](https://github.com/jakubbohm/RevolutReader/issues/51#issuecomment-6728682809) on #51, C8a's [A1–A8](https://github.com/jakubbohm/RevolutReader/issues/51#issuecomment-6728684372) for the pieces C8b uses, and C8b's own B1–B11 on [#60](https://github.com/jakubbohm/RevolutReader/issues/60). This design copies each one it uses, citing its label, and is their home from now on. Details settled while writing it are marked *(propose)*.
- **What merged before** (S1), read 2026-11-20: c011's (C8a) and c009's (C7a) archived design.md, c010's (C7b) where the screen changed, and `main` at `a33b40f`. Nothing contradicts S1–S12 or B1–B11, so no explore was needed. One gap, found here: the dev server runs no service worker, so B10's local check cannot subscribe through `aspire start` (D12). What this change builds on:
  - **C8a's push module** (`src/app/push.ts`, c011 D8): `pushSupported`, `readPushKey`, `subscribe`, `sendSubscription`, `currentSubscription`, `madeWith`; the API calls never throw and answer a kind (`offline`, `signed out`, `refused`, `unexpected`, …), the browser's calls pass their failures on. The test kit's stand-ins (`src/test/push.ts`) model `Notification` (permission, `requestPermission`, its answer), `PushManager` (`subscribe` with C8a's rules, `getSubscription`), the registration behind `navigator.serviceWorker.ready`, and the browser without them; `src/test/server.ts` answers the key and the two subscription calls.
  - **C8a's messages** (c011 D2): Declarative Web Push JSON, `{"web_push":8030,"notification":{"title","body"?,"navigate"}}`, `navigate` the app's own address (`Push:Subject`) plus the page, no `mutable`. Locally `Push:Subject` is `https://localhost`, so a local `navigate` is not the Vite address (c011 D5's heads-up; D9 answers it).
  - **C7a's screen** (c009 D2–D7, c010 D8): `useAccountScreen` builds `Facts`; `shown` (`screenState.ts`) makes the one banner (a failed sign-out replaces any other; then offline; then the reads' problems by precedence) and the body; `AccountScreen` renders the header, the banner, then the list slot. The account menu shows once `GET /api/me` named the user. Every new read clears the screen's problem when it starts (c009 D7 c). A return to the app (`visibilitychange` to visible) and coming back online repeat the reads (`watchRefreshTriggers`).
  - **The account menu** (`AccountMenu`, c009 D6): a Radix `DropdownMenu`, `modal={false}`, one item; the sign-out keeps the menu open while it runs.
  - **The service worker** (`src/sw.ts`, c003 D9): workbox precaching only, built by vite-plugin-pwa (`injectManifest`), compiled by its own `tsconfig.sw.json` with the `WebWorker` library; `tsconfig.app.json` compiles everything else under `src/` with `DOM` and excludes `sw.ts`. Off in the dev server (`vite.config.ts`).
- **The design** (B1): the design system at version `1794170226-d59d` and the Screens design at `1794170674-1c7a`, the versions B1 checked; read again 2026-11-20 through the Artifact tool, which named newer version ids (`1795177183-743f`, `1795177182-c452`), but every file read has the hash the listing gives for the B1 version, and the Screens design's pinned copy of the design system is `1794170226-d59d` with the same `tokens.json` and `bundle.css`. So no design loop is pending.

## Goals / Non-Goals

**Goals:**

- The 22 new scenarios and the changed one, each verified at the level § How each scenario is verified gives.
- One place that decides what is offered (`notificationOffer`), pure, so the card, the menu item and the screen never disagree.
- Nothing that needs C8c: C8b works alone, and C8c's upkeep only makes it better (D13).

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- **No change to C8a's push module or its stand-ins' rules:** C8b calls them as they are; the test kit gains only what C8b's scenarios need (D10).
- **No React state library, no router:** the card's sequence is one hook beside `useAccountScreen`, its rules pure beside it.
- **No storing of the balance from a push:** C9 (ADR-0007, item 5; ADR-0010).

## Decisions

### D1 — The design (B1)

- **Boards implemented** (Screens design, read 2026-11-20): `Notifications / Opt-in / Card` (`notif-optin.dc.html`), `… / Asking (iOS prompt)` (`notif-asking`), `… / Enabled` (`notif-enabled`), `… / Blocked` (`notif-blocked`), and `Notifications / Account menu / Zapnout upozornění` (`notif-menu`). On each, the card sits between `BalanceHeader` and the day groups. **Not here:** the two lock-screen boards (options A and B), C9's (Q8).
- **Design-system parts:**
  - **`NotificationOptIn`** (new in the app, rebuilt with Tailwind from the design system's component, `.claude/rules/design.md`): a card (`color-surface`, `color-border` hairline, `radius-card`, `shadow-card`, `spacing-gutter` padding, 8 px gap, the gutter as side margin) whose head is a 40 px disc and a `text-headline` title, then a `text-body` sentence in `color-ink-muted`:
    - default: `bell` on `color-accent-soft` / `color-accent`, "Chceš vědět o každé platbě?", "Hned uvidíš, když přijdou peníze nebo když zaplatíš kartou.", then the block primary "Zapnout upozornění" and the block ghost "Teď ne", 4 px apart, 8 px under the text;
    - enabling: the primary in its loading state (spinner beside the kept label, `aria-busy`), "Teď ne" disabled;
    - enabled: `bell-ring` on `color-incoming-soft` / `color-incoming`, "Upozornění jsou zapnutá", "Když se na účtu něco změní, přijde ti upozornění.", `role="status"`, no button;
    - denied: `bell-off` on `color-surface-muted` / `color-ink-muted`, "Upozornění jsou vypnutá", "Zapneš je v Nastavení → Oznámení → Tarjeta Papá.", no button. *(propose)* `role="status"` as the enabled state has, so VoiceOver reads the result after the prompt; the design gives it no role, and this adds no visual.
  - **`AppShell`'s `onEnableNotifications`** (B1, the design loop of 2026-11-08): the menu's `Zapnout upozornění` with Lucide `bell`, above `Odhlásit se`, after the separator, in the same style (44 pt, `text-body`, 20 px icon); shown only while the prop is passed. The app passes it through to `AccountMenu`.
  - **`Button`** *(propose)*: a disabled ghost keeps a transparent fill, as the design system's `.tp-btn-ghost:disabled` does; today the app's disabled look gives every variant `color-surface-muted`. Only "Teď ne" while enabling uses it.
- **No new token:** every colour, size, radius, shadow and duration above is already in `styles/theme.css` (checked against the design system's `bundle.css`, 2026-11-20). The design system's guideline text ("ask for permission only from a tap") is followed by D3 and D7.

### D2 — Where the card can appear (B2)

- **Wherever the browser can subscribe** (C8a's `pushSupported`: a service worker, `PushManager` and `Notification`), not only in the Home Screen app. On the iPhone that is the same thing: a Safari tab cannot subscribe, and C3 shows only the install hint there. On a computer an ordinary tab can, so the owner can test it and get messages on the laptop. **A deliberate difference** from the design system's `NotificationOptIn` "When: only in standalone mode": behaviour, so the spec wins (`.claude/rules/design.md`); no design loop.
- *(propose)* **Its place on the screen:** only on the account screen, once the server has named a signed-in user (the menu's own rule, c009 D2), and only under the balance header, the balance or its placeholder: the roadmap's "card under the balance". DOM order: the header, the screen's one banner, the card, then the list slot (the boards draw no banner with the card; the banner stays where C7a put it, under the header). With no header (the whole-screen offline or waking-up states, a banner alone), the default card is not shown, and the account menu offers notifications instead (D7).
- *(propose)* A result the user asked for (enabling, enabled, denied, or the default card after a failure, D8) shows where the card goes, or first in the content when there is no header, so a tap from the menu always shows its result.

### D3 — The default card and turning on (B3)

- "Chceš vědět o každé platbě?" with "Zapnout upozornění" and "Teď ne".
- **"Zapnout upozornění" calls `Notification.requestPermission()` directly in the tap** (iOS asks only from a gesture): `turnNotificationsOn` is an `async` function whose first statement asks, so the question goes out before the function returns its promise. A unit test pins it: the permission was asked before anything was awaited.
- **Once allowed** *(propose, the order)*: the service worker's registration (`navigator.serviceWorker.ready`), C8a's key (`readPushKey`), the subscription (C8a's `subscribe`, `userVisibleOnly`, the key as bytes), then `sendSubscription`. The key is read only after the permission, so the tap's question never waits for the network. The card is in its `enabling` state from the tap until the outcome; "Teď ne" is disabled meanwhile (the design's enabling state).
- **Its outcomes:** `on` (the server answered 204) → enabled (D4); `declined` (`denied`) → the Denied card (D6); `undecided` (`default`: a browser prompt closed without an answer, which Chrome allows; iOS has only Allow and Don't Allow) → the card returns to what it was, with no banner; `failed` → D8.

### D4 — Enabled, and what an opening is (B4, B8)

- "Upozornění jsou zapnutá" stays until the app is next opened, then never shows again: from then on the phone allows notifications, and nothing is offered (D8, "On").
- **An opening** (B8) is a launch, or a return to the app from another one, as C7a's refresh on return: the page's `visibilitychange` to `visible`. Coming back online is not an opening. A launch starts the hook afresh, so nothing of the last session's results is left.
- *(propose)* **A result goes at the first opening after it was shown:** the enabled card, the Denied card and the default card after a failure (D8) are cleared on a return only when the app was left while that result was on screen. Why: iOS's permission alert may hide the page and show it again (not documented either way); without this rule, the return that follows the alert would clear the card it was about to show. A unit test covers a return during `enabling`. Manual row 1 shows the card stays on the iPhone.
- *(propose)* At every opening the hook reads `Notification.permission` again, so a change made in the phone's Settings while the app was away shows at once (nothing offered once allowed; the menu item once blocked).

### D5 — "Teď ne" remembered on the device (B3)

- **"Teď ne" hides the card for good on that device;** it does not come back by itself (a 7-day return was considered in explore and replaced by the menu item, B5).
- *(propose)* **Where:** `localStorage`, key `tarjeta-papa.notifications.not-now`, value `"1"`, read synchronously when the screen renders, so the card never flashes before the choice is known. Not IndexedDB, where the stored balance lives (c009 D4): the service worker does not need this choice, and idb-keyval opens one store per database, so a second store in `tarjeta-papa` would need its own database or a version upgrade. A failing storage (a private window, storage blocked) reads as not remembered and a failed write is ignored; the card still hides for the session.
- **Not account data:** ADR-0007 limits *bank data* on the phone ("nothing else of the bank data"), so it is unchanged. The choice is the device's, not an account's: it stays after sign-out and for whoever signs in next, as the design's "on that device" says.

### D6 — Denied (B6)

- "Upozornění jsou vypnutá. Zapneš je v Nastavení → Oznámení → Tarjeta Papá." Shown right after the user declines the phone's question, and when chosen from the account menu while the phone blocks notifications; gone at the next opening (D4).
- **No reminder at every opening, no close button, no timer** (B6): the owner first asked for a reminder at each opening (closable, hiding after 30 s), then dropped it once the menu item covered the blocked case.
- Nothing is sent to the server after a decline: no key read, no subscription.

### D7 — The account menu's "Zapnout upozornění" (B5)

- **Shown whenever notifications are off and no card is on screen; never once they are on.** In `notificationOffer`'s terms: a browser that can subscribe, a signed-in user, the phone not allowing notifications, and no card shown (remembered "Teď ne", a blocked phone, or no balance header, D2).
- **After "Teď ne"** (the phone not asked yet): `onSelect` calls the hook's `fromMenu`, which asks `Notification.requestPermission()` synchronously, inside Radix's `onSelect`, so iOS sees the gesture; the card comes back to show the result (D2). The remembered "Teď ne" stays: after the next opening the card does not come back, and the menu item offers again if notifications are still off. *(propose)*
- **When the phone has blocked notifications:** it asks nothing and brings back the card in its Denied state, which says where to turn them on in iOS Settings (the web cannot ask again).
- *(propose)* The menu closes on select, as any Radix item does (no `preventDefault`, unlike the sign-out): the result shows in the card. While a sign-out runs the item still shows, and choosing it does what it always does.

### D8 — A failure while turning on, and what "on" means (B7)

- **The banner:** offline or a server error shows C7a's single banner, the error "Upozornění se nepodařilo zapnout" with "Zkus to znovu, až budeš online." or "Zkus to prosím za chvíli.", and no action (the card's button is right there), the shape of C7a's failed sign-out (c009 D6). The card returns to its default state for the rest of this opening, whatever the phone's permission now is, so the user can try again.
- **Which banner wins** (B7: C7a's and C7b's rule): *(propose)* the failure is the screen's one problem, set like a failed sign-out: it replaces any other banner, offline included, because it answers the user's latest action. It goes when the next action starts: the next turn-on (which clears only this failure), or any read, which clears the screen's problem as it always does (c009 D7 c). `useAccountScreen` gains `notificationsFailed(offline)` and `notificationsRetried()`; `screenState`'s `Problem` gains `{ kind: "notifications failed"; offline: boolean }`, ranked with the failed sign-out in `bannerOf`.
- *(propose)* **Offline or not:** offline when a request found the phone offline or got no answer (C8a's kinds, C7a's rule, c009 D2), or when the browser's `subscribe` failed while `navigator.onLine` is false; every other failure is "later": a 400, a 5xx, an unreadable answer, a `subscribe` the browser refused.
- *(propose)* **A 401 or 403 while turning on** counts as a failure ("Zkus to prosím za chvíli."), not as an ended login: the next read on return routes it to the sign-in or no-access screen (C7a). The precedent is C7b's older pages, where the owner declined to route a 401 or 403 from a secondary request (c010 triage of #65). C8c owns what an ended login does to the subscription.
- *(propose)* **A 60 s limit** on everything after the phone's answer, as C7a's refresh (c009 D3): the requests share one `AbortController` aborted after 60 s, so an unanswered request ends as offline; a service worker not ready within the same 60 s fails as "later". Without it, a missing service worker would spin the card for ever. Unit-tested, no scenario: it guards a fault, not a behaviour the owner asked for (the owner may ask for one).
- *(propose)* **"On" means the phone allows notifications** (`Notification.permission === "granted"`): nothing is offered then (spec "Nothing offers notifications once they are on"). A failure can leave the phone allowing notifications without a subscription the server holds; for the rest of that opening the default card stays (above), and at the next opening C8c's upkeep subscribes and sends it quietly (#61, C1). Until C8c merges, such a device stays without a subscription and is offered nothing; C9 needs both merged anyway (roadmap). Weighed and not chosen: "on" as the browser holding a subscription (`getSubscription`, asynchronous, so the card would flash before it is known, and it still could not say whether the server has it).
- *(propose)* **A subscription made with another key** makes `subscribe` fail (`InvalidStateError`, as C8a's stand-in models); C8b counts it as a failure and leaves replacing it to C8c (#61, C1), which owns old keys.

### D9 — The service worker showing a push (B9)

- **The push handler** (`listenForPushes`, wired in `sw.ts`) for the declarative JSON (S3, c011 D2): where the browser already shows the declarative notification (Safari), it leaves it as it is; elsewhere it shows the notification from the same JSON (`title`, `body` when there is one; the `navigate` address kept in the notification's `data`).
- *(propose)* **How it tells:** by the push event's `notification` member, the "proposed notification" a browser that reads Declarative Web Push gives the event. When it is there, the handler shows nothing: the browser shows its own. When it is missing (`undefined` or `null`, an older browser such as Chrome on a computer), the handler shows the message itself. Research, 2026-11-20 ([W3C Push API draft](https://w3c.github.io/push-api/), [WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)): the draft fires the push event for a declarative message only with `"mutable": true`, and WebKit's post says it fires whenever a service worker is installed; both say the event carries the proposed notification, which the browser shows unless the handler shows a replacement; the draft's attribute is `PushEvent.notification` (read from a summary of the draft, not its IDL text). The rule holds either way: if Safari fires the event, the handler leaves its notification; if it does not, nothing runs. If Safari named the member differently, the handler would show the same message, which replaces Safari's: one notification still, no harm.
- *(propose)* A push whose content is not a declarative message with a title shows nothing: every push the app sends is one (spec push-sending), and only the server holds the signing key.
- **`notificationclick`** opens or focuses the app at the message's page. *(propose)* It closes the notification, then: a window of the app already open (`clients.matchAll({ type: "window", includeUncontrolled: true })`, on the service worker's own origin) is focused, not navigated: the app has one page, and its return refresh shows what is new (c009 D3). With none open, it opens `navigate`'s path, query and fragment **on the service worker's own origin**. So a `navigate` naming another site can never be opened (S3: always a page of the app), and locally, where `navigate` is `https://localhost/` (c011 D5), the tap opens the dev server's own page.
- **Where the code lives** *(propose)*: `src/app/pushDisplay.ts`, imported by `sw.ts` and by the tests. It is compiled twice, under `tsconfig.app.json` (`DOM`) and, through `sw.ts`, under `tsconfig.sw.json` (`WebWorker`), so it declares the few members it uses as its own small interfaces (`PushWorker`: `addEventListener` for `push` and `notificationclick`, `registration.showNotification`, `clients`, `location.origin`), which both `ServiceWorkerGlobalScope` and the test kit's stand-in satisfy. The bootstrap probes that both projects compile it (§ Bootstrap).
- **Tested as plain functions** (S9): the scenario tests give `listenForPushes` the test kit's stand-in for the service worker's side and fire its events.
- **C9 later** hooks into the same handler to store the balance, and must add `"mutable": true` to its pushes if it needs the handler on the iPhone (c011 D2, ADR-0010); it never touches the stored balance for a message that carries none (ADR-0007).

### D10 — Capabilities and scenarios (B10)

- **Two new capabilities,** each a behaviour later changes extend: `notification-opt-in` (what the app offers and how it turns notifications on; C8c builds on its subscription) and `push-display` (what the device does with a push; C9 adds storing the balance). One changed: `app-shell`'s account-menu requirement, which said "one item … Nothing else goes in it".
- **22 new scenarios and 1 changed**, against B10's 14 behaviours and 4 manual rows (about 15 estimated, a guide):

  | B10 | Scenarios |
  |---|---|
  | 1 | The card offers notifications under the balance; The card also shows in a computer's browser (B2's difference, pinned so the card is not gated on the Home Screen) |
  | 2 | Nothing offers notifications where the browser cannot have them |
  | 3 | Turning notifications on from the card asks the phone and says they are on |
  | 4 | "Upozornění jsou zapnutá" is gone at the next opening |
  | 5 | "Teď ne" hides the card for good on this device |
  | 6 | The account menu offers notifications after "Teď ne" |
  | 7 | Turning notifications on from the account menu shows the result in the card |
  | 8 | Declining the phone's question says where to turn notifications on |
  | 9 | The account menu, with notifications blocked, says where to turn them on |
  | 10 | Nothing offers notifications once they are on (the card too, not only the menu item) |
  | 11 | The card saying notifications are off is gone at the next opening |
  | 12 | Turning notifications on offline says to try again online; … when the server fails says to try again later |
  | 13 | A push shows as a notification where the browser does not show it itself; A push the browser shows itself shows once |
  | 14 | A tap on a notification opens the app at its page; A tap on a notification brings the open app to the front |
  | manual 1, 3, 5 | The iPhone asks for permission when the card's button is tapped; … when the account menu's item is tapped; The card's path to the iPhone's Settings is right |
  | manual 2 | A message sent to the account shows on the iPhone and a tap opens the app |
  | — | app-shell: The account menu shows who is signed in (changed: its GIVEN names a browser that cannot have notifications, so "the one item" still holds) |

- **Not scenarios** (unit tests): the 60 s limit and the undecided prompt (D3, D8); a return during `enabling` (D4); a failing `localStorage` (D5); a 401 or 403 while turning on (D8); a push that is not a declarative message, and a `navigate` on another origin (D9).
- **The test kit** *(propose)*, the test-writer's (`src/test/`):
  - `serviceWorker.ts`, a stand-in for the service worker's side: its own origin, `registration.showNotification` (recording what was shown), `clients` (windows open or none, recording `focus` and `openWindow`), and helpers that fire a push (as a browser that reads Declarative Web Push, with a `notification` on the event, or as one that does not) and a tap on a shown notification;
  - the remembered "Teď ne": `emptyThePhone()` also clears `localStorage`, `reopen()` keeps it (the phone keeps it), and a helper sets it before a launch;
  - `server.ts` already answers the key and the subscription (c011 D8); a test that needs a failing `PUT` sets its answer.

### D11 — Manual rows (B10)

In `tests/manual-scenarios.md`, on the owner's iPhone after C8b's deploy; rows 1 and 2 again at M7 on the daughter's phone (handover step M7):

1. *notification-opt-in / The iPhone asks for permission when the card's button is tapped:* the iOS prompt appears on the tap, and the card shows "Upozornění jsou zapnutá" (and stays, D4).
2. *push-display / A message sent to the account shows on the iPhone and a tap opens the app:* Claude Code sends one through C8a's message endpoint (S8, c011 D6, on the owner's go); it shows on the lock screen and a tap opens the app. The only proof that Apple accepts C8a's token and encryption (S9, ADR-0010).
3. *notification-opt-in / The iPhone asks for permission when the account menu's item is tapped:* after "Teď ne", the iOS prompt appears from the menu.
4. *(C8c's row: back after signing in again.)*
5. *notification-opt-in / The card's path to the iPhone's Settings is right:* after "Don't Allow", the card says where to turn them on, and that path matches the real iOS Settings.

Production's `Push:Subject` is the app's own `https://` address, so c011 D5's localhost caveat for Apple does not arise.

### D12 — The local check (the owner, 2026-11-20)

- **The gap:** B10 planned a local check in Chrome on the owner's computer through `aspire start`. The dev server registers no service worker (`vite.config.ts`, "Off in the dev server"; c009 moved its offline-reopen check to the deployed app for the same reason). Without one, `navigator.serviceWorker.ready` never settles, so the card cannot subscribe locally: it ends, after D8's 60 s, in the failure banner.
- **Decided (the owner, 2026-11-20):** the local check covers everything before subscribing, through `aspire start --isolated`: the card under the balance; Chrome's own permission question from the card's tap; "Block" giving the Denied card; "Teď ne" and the menu item after it, also after a reload; the menu item while blocked; the card's look against the boards, light and dark. Subscribing, the first push, the notification Chrome shows and its tap are checked on the deployed app, in Chrome on the owner's computer, before the iPhone rows (§ Migration plan, step 4). It changes no tooling and follows C7a's precedent. Locally, "Allow" ends after 60 s in the banner "Zkus to prosím za chvíli." (D8): expected, not a finding.
- **Not chosen (the owner, 2026-11-20):**
  - *The dev server's service worker* (vite-plugin-pwa's `devOptions`): a full local check, and later a local check for C9's handler too. But it reverses C3's "off in the dev server" (c003 D9), may need `sw.ts` to cope with a dev precache list (whether `createHandlerBoundToURL("index.html")` finds its page is unknown), and a service worker in development can serve a stale page. A probe and a lesson, about half an hour more.
  - *The built app locally* (the AppHost running `vite preview` of the build, or the image): the real service worker, but a second way to run the app, or the image with real sign-in secrets.
- The choice changes no scenario: only § Migration plan and the local-check task in tasks.md's last group.

### D13 — Side by side with C8c (B11, S10)

- **C8b owns the screens:** the card, the account menu's item, the banner's use, the service worker showing a push. **C8c** (c013, [#61](https://github.com/jakubbohm/RevolutReader/issues/61), in another session) **owns the lifecycle:** what happens at every opening, at sign-out and on a 401 or 403.
- **Shared, joined by hand by whichever merges second** (the owner, 2026-11-20): the wiring in `App.tsx` and the rows in `pm/progress.md`. Neither adds an endpoint, so no generated API file is merged.
- **The seams, agreed with the C8c session** (its message of 2026-11-20, sent at the owner's request; c013 design.md D5, D8):
  - **C8c merges second** and joins the shared files by hand: its last task group waits for C8b's merge anyway. C8b does not wait for C8c.
  - **C8c's lifecycle:** at every opening (a launch, or a return) with a signed-in user and the permission `granted`, it reads the server's key and the phone's subscription, sends it again, subscribes again quietly when the phone has none, and replaces one made with another key; it never asks for permission and shows nothing. At sign-out it asks the server to forget the device before the sign-out request and unsubscribes once the sign-out is confirmed; on any 401 or 403 it unsubscribes inside `useAccountScreen`'s `endLogin`.
  - **"Off" comes from the permission,** not the subscription (D8), on both sides: while the permission is `granted` nothing is offered, even with no subscription on the phone; C8c re-subscribes quietly. If iOS turns out to refuse a quiet subscribe, the owner decides then whether "granted but no subscription" counts as off.
  - **Nothing awaits `navigator.serviceWorker.ready` at an opening.** C8b awaits it only after a tap, within D8's 60 s; at an opening C8b reads only `Notification.permission` and `localStorage`. C8c reads the registration with `getRegistration()` (its `pushRegistration()` in `src/app/subscriptionUpkeep.ts`).
  - **Files both may touch:** `App.tsx`; `useAccountScreen.ts` (C8b adds `notificationsFailed` and `notificationsRetried`, D8; C8c changes `endLogin` and `signOutFromMenu` and adds its triggers); `src/test/server.ts`; `tests/manual-scenarios.md` (C8b's rows 1, 2, 3 and 5; C8c's row 4); `pm/progress.md` (each its own row). C8c's test-writer adds `getRegistration()` and a `registered: false` option to `src/test/push.ts`; C8b leaves that file alone. C8b's test kit is a new `src/test/serviceWorker.ts`, the remembered "Teď ne" in `server.ts`'s `emptyThePhone()` and a helper, and a failing `PUT` answer if `server.ts` has none.
  - **Capabilities and files kept apart:** C8c adds 8 requirements to `push-devices` with `src/scenarios/push-devices.test.tsx`; C8b's are `notification-opt-in` and `push-display` in their own files, and C8b modifies `app-shell`'s "The top bar holds the account menu", which C8c leaves alone.
  - **Openings:** C8c adds `watchReturns(onReturn)` to `refreshTriggers.ts` (a return only, not online). C8b's opening watch stays inside `useNotificationOptIn`, because D4 needs the leaving as well as the return; the two stay separate (C8c's confirmation, 2026-11-20).
  - **A turn-on and C8c's opening can overlap:** if the page returns while iOS asks (D4) and the permission is by then `granted`, C8c's opening and C8b's turn-on may both subscribe and send. Harmless: `subscribe` with the same key answers the same subscription, and the server's `PUT` replaces the device by its push address (c011 D11).
- **What C8b assumes of C8c:** nothing for its own scenarios. C8c's upkeep completes a subscription a failure left behind (D8) and replaces one made with an old key (D8).
- **C8c's last task group,** the iPhone check of row 4, waits for C8b's merge (S10, item 4): it needs a phone subscribed through C8b's card.

### D14 — Software-factory records *(propose)*

At the next free numbers when written (R-79 was the last on 2026-11-20; C8c may take some first):

- *(New)* Asking for notification permission on iOS: from a tap, synchronously (the card's button, a menu item's `onSelect`); one offer on screen and one fallback in a menu instead of reminders; a result that survives the page hiding behind the system prompt (D3, D4, D7).
- *(New)* A service worker for Declarative Web Push that stays backwards compatible: leave the push when the event carries the browser's proposed notification, show it otherwise; open a tapped notification's page on the worker's own origin only (D9).
- *(New)* Code shared by the page and the service worker, compiled under both the `DOM` and `WebWorker` libraries, with small interfaces of its own (D9).
- *(Divergence)* The local check stops before subscribing because the dev server runs no service worker (D12, the owner's choice, 2026-11-20); the full version gives local development the real service worker (D12's alternatives), so a push can be checked end to end before a merge.
- Inventory lines: the service worker's stand-in in the frontend test kit (template), the opt-in card and its offer rules (example).

## Public API sketch

```ts
// ---- src/RevolutReader.Web/src/app/notificationOffer.ts (D2, D7, D8) — pure ----

/** The card's state, as the design names it. */
export type CardState = "default" | "enabling" | "enabled" | "denied";

/** Where turning on stands in this opening (D3, D4, D8). */
export type Step = "idle" | "enabling" | "enabled" | "denied" | "failed";

export interface OfferFacts {
  supported: boolean;                 // pushSupported (C8a): a service worker, PushManager and Notification
  signedIn: boolean;                  // the server named a signed-in user (the menu shows)
  underBalance: boolean;              // the balance header, or its placeholder, is on screen
  permission: NotificationPermission; // Notification.permission, read at every opening
  notNow: boolean;                    // "Teď ne" remembered on the device (D5)
  step: Step;
}

export interface Offer {
  /** The card to show, or none. */
  card: CardState | null;
  /** Whether the account menu holds "Zapnout upozornění". */
  menuItem: boolean;
}

/**
 * What is offered (D2, D7, D8). Not supported or not signed in: nothing. A step under way or a result of this
 * opening: its card (enabling, enabled, denied; default after a failure), wherever the screen is, and no menu item.
 * Otherwise: allowed → nothing; blocked → the menu item; never asked → the default card under the balance, unless
 * "Teď ne" is remembered or there is no balance header, then the menu item.
 */
export function notificationOffer(facts: OfferFacts): Offer;

// ---- src/RevolutReader.Web/src/app/notNow.ts (D5) ----
export const NOT_NOW_KEY = "tarjeta-papa.notifications.not-now";
/** Whether "Teď ne" is remembered on this device; a failing storage reads as not. */
export function notNowRemembered(storage?: Storage): boolean;
/** Remembers "Teď ne"; a failure is ignored. */
export function rememberNotNow(storage?: Storage): void;

// ---- src/RevolutReader.Web/src/app/turnOn.ts (D3, D8) ----
export type TurnOnOutcome =
  | { kind: "on" }                                  // the server keeps the subscription (204)
  | { kind: "declined" }                            // the phone said no: "denied"
  | { kind: "undecided" }                           // the prompt closed without an answer: "default"
  | { kind: "failed"; offline: boolean };           // D8: offline, or "later"

/** How long everything after the phone's answer may take (D8). */
export const TURN_ON_LIMIT_MS = 60_000;

/**
 * Turns notifications on (D3): asks Notification.requestPermission() as its first statement, so a tap that calls it
 * asks within the gesture; once allowed, waits for the service worker's registration, reads the key (readPushKey),
 * subscribes (subscribe) and sends the subscription (sendSubscription), all within TURN_ON_LIMIT_MS on one
 * AbortController (a setTimeout, so the test clock drives it). Never throws: every failure is an outcome.
 */
export function turnNotificationsOn(browser?: Window): Promise<TurnOnOutcome>;

// ---- src/RevolutReader.Web/src/app/useNotificationOptIn.ts (D3–D8) ----
export interface NotificationOptInModel extends Offer {
  /** The card's "Zapnout upozornění": asks synchronously (turnNotificationsOn), the card enabling until the outcome. */
  turnOn(): void;
  /** "Teď ne": remembered (rememberNotNow), the card gone. */
  notNow(): void;
  /** The menu's item: blocked → the Denied card, asking nothing; otherwise as turnOn, synchronously in onSelect. */
  fromMenu(): void;
}

/**
 * The opt-in's sequence (D3–D8): the step of this opening; the permission and the remembered "Teď ne" read at every
 * opening (a launch, or visibilitychange to visible), a result cleared at the first opening after the app was left
 * while it showed (D4). A failure tells the screen through onFailed(offline), and a new turn-on through onRetried().
 */
export function useNotificationOptIn(options: {
  signedIn: boolean;
  underBalance: boolean;
  onFailed: (offline: boolean) => void;
  onRetried: () => void;
}): NotificationOptInModel;

// ---- src/RevolutReader.Web/src/app/screenState.ts (D8) ----
// Problem gains { kind: "notifications failed"; offline: boolean }; bannerOf returns it, as the failed sign-out,
// ahead of any other problem.

// ---- src/RevolutReader.Web/src/app/useAccountScreen.ts (D8) ----
// AccountScreenModel gains:
//   notificationsFailed(offline: boolean): void   // the screen's one problem becomes the failure, replacing any other
//   notificationsRetried(): void                  // clears that failure only (any read still clears every problem)

// ---- src/RevolutReader.Web/src/app/pushDisplay.ts (D9) — imported by sw.ts and by the tests ----

/** A Declarative Web Push message as the service worker shows it. */
export interface DeclarativeMessage { title: string; body?: string; navigate: string }

/** The message in a push's JSON: "web_push": 8030, a notification with a non-empty title and a navigate string; else null. */
export function declarativeMessage(json: unknown): DeclarativeMessage | null;

/** The members of the service worker's global scope this module uses (both ServiceWorkerGlobalScope and the stand-in fit). */
export interface PushWorker {
  location: { origin: string };
  registration: {
    showNotification(title: string, options?: { body?: string; data?: unknown }): Promise<void>;
  };
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<readonly WindowLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: "push", listener: (event: PushLike) => void): void;
  addEventListener(type: "notificationclick", listener: (event: NotificationClickLike) => void): void;
}
export interface WindowLike { url: string; focus(): Promise<unknown> }
export interface PushLike {
  data: { json(): unknown } | null;
  notification?: unknown;               // the browser's proposed notification (Declarative Web Push), when it reads the format; undefined or null otherwise
  waitUntil(work: Promise<unknown>): void;
}
export interface NotificationClickLike {
  notification: { data: unknown; close(): void };
  waitUntil(work: Promise<unknown>): void;
}

/**
 * Listens for pushes and taps (D9): a push with the browser's own notification is left alone; otherwise its
 * declarative message is shown (title, body, navigate in data). A tap closes the notification and focuses an open
 * window of the app on the worker's origin, or opens navigate's path, query and fragment on that origin.
 */
export function listenForPushes(worker: PushWorker): void;

// sw.ts gains: import { listenForPushes } from "./app/pushDisplay"; … listenForPushes(self);
// Settled by the bootstrap's probe (2026-11-20): with sw.ts's `declare let self: ServiceWorkerGlobalScope`, `self` is
// passed as it is, no cast and no wrapper: WebWorker's ServiceWorkerGlobalScope satisfies PushWorker exactly as typed
// above (its generic addEventListener covers both overloads, its generic clients.matchAll the window-only signature,
// WorkerLocation the origin). The module compiles under tsconfig.app.json (DOM) on its own and under tsconfig.sw.json
// (WebWorker) through sw.ts; a member the scope lacks fails `tsc -b` in sw.ts (checked); `npm run build` bundles it
// into dist/sw.js, and oxlint passes.

// ---- src/RevolutReader.Web/src/components (D1) ----
// NotificationOptIn({ state: CardState, onEnable, onDismiss })   — the card, as D1 describes
// AppShell({ …, onEnableNotifications? })   AccountMenu({ …, onEnableNotifications? })   — the item while passed
// Button: a disabled ghost keeps its transparent fill
// AccountScreen({ …, optIn: NotificationOptInModel }) — the card after the banner, under the header (D2); the menu's
//   item through AppShell while optIn.menuItem
// App: useNotificationOptIn beside useAccountScreen (signedIn: the menu's account named; underBalance: a header shown)

// ---- src/RevolutReader.Web/src/test (the test-writer's) ----
// serviceWorker.ts: installServiceWorkerStandIn({ declarative?: boolean, openWindows?: string[], origin? }) →
//   { worker: PushWorker; deliverPush(json): Promise<void>; tapNotification(index?): Promise<void>;
//     shownNotifications(): { title; body?; data }[]; openedWindows(): string[]; focusedWindows(): string[] }
// server.ts / setup.ts: localStorage emptied with the phone; a helper that remembers "Teď ne" before a launch.
```

## Rule ownership

| Rule (spec, ADR or convention) | Enforced by |
|---|---|
| The card shows wherever the browser can subscribe, under the balance, for a signed-in user never asked | `notificationOffer` (with C8a's `pushSupported`); `AccountScreen` (the place) |
| Nothing is offered where the browser cannot subscribe, or once the phone allows notifications | `notificationOffer` |
| The permission is asked from the tap, synchronously | `turnNotificationsOn` (its first statement); `useNotificationOptIn.turnOn`, `.fromMenu`; `AccountMenu` (`onSelect`) |
| Once allowed: subscribe with the server's key and send the subscription | `turnNotificationsOn` (C8a's `readPushKey`, `subscribe`, `sendSubscription`) |
| Enabling: the button spins, "Teď ne" disabled | `NotificationOptIn` (`enabling`) |
| Enabled and Denied go at the first opening after they showed | `useNotificationOptIn` |
| Declining sends nothing to the server | `turnNotificationsOn` |
| "Teď ne" remembered on the device | `rememberNotNow`, `notNowRemembered`; `useNotificationOptIn.notNow` |
| The menu item while off and no card on screen; above "Odhlásit se" | `notificationOffer`; `AccountMenu`, `AppShell` |
| The menu, when blocked, brings back the Denied card without asking | `useNotificationOptIn.fromMenu` |
| A failure: the one banner, offline or later; the card back to default | `turnNotificationsOn` (offline or not); `useAccountScreen.notificationsFailed`; `shown`'s `bannerOf`; `AccountScreen` (the text); `notificationOffer` (`failed`) |
| The menu holds nothing else (app-shell) | `AccountMenu` |
| A push the browser shows itself is left; otherwise shown with its title and text | `listenForPushes` (`declarativeMessage`) |
| A tap focuses the open app, or opens the page on the app's own origin | `listenForPushes` |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected outcomes | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `turnNotificationsOn` | `{ kind: "on" }` | `declined`, `undecided`, `failed` (offline or later: a request's kind, a `subscribe` the browser refused, the 60 s limit) | none; never throws |
| `notificationOffer` | `Offer` | — | none (pure) |
| `notNowRemembered`, `rememberNotNow` | the choice | a failing storage reads as not remembered; a failed write is ignored | none |
| `declarativeMessage` | the message | `null` for anything else | none |
| push handler | a notification shown, or none | a push with the browser's own notification, or no declarative message: nothing shown | `showNotification`'s failure passes to `waitUntil` |
| tap handler | a window focused or opened | — | `focus`'s or `openWindow`'s failure passes to `waitUntil` |

No backend operation and no Result union: the change is frontend only.

## Ports and contracts

None new or changed. C8a's push module (`src/app/push.ts`) and the API's three push endpoints are used as c011 D8 and D9 describe them. The browser's features are reached directly: `Notification`, `PushManager` through C8a's module, `navigator.serviceWorker.ready`, `localStorage`, and the service worker's own scope through `PushWorker`; the tests use C8a's stand-ins, the new service worker stand-in and jsdom's `localStorage`. These are the browser's own APIs, not ports of the app, so there are no contract tests.

## How each scenario is verified

| Scenarios | Level | Why |
|---|---|---|
| `notification-opt-in`: the 14 automated ones, "The card offers notifications under the balance" through "Turning notifications on when the server fails says to try again later" | frontend tests in `src/scenarios/notification-opt-in.test.tsx`, through the whole app (`renderApp`), with C8a's push stand-ins and the fake server | the card, the menu and the banner are what the page shows; the permission, the subscription and the requests are what the stand-ins and the fake server record |
| `notification-opt-in`: "The iPhone asks for permission when the card's button is tapped", "… when the account menu's item is tapped", "The card's path to the iPhone's Settings is right" | manual rows in `tests/manual-scenarios.md` (D11) | only iOS shows its permission question and only after a real tap; the path is iOS's Settings |
| `push-display`: the 4 automated ones | frontend tests in `src/scenarios/push-display.test.ts`, calling `listenForPushes` with the service worker stand-in (S9: the push handling tested as plain functions) | jsdom runs no service worker and there are no browser tests ([divergences.md R-19](../../../docs/software-factory/divergences.md)); the handler's events are its public channel |
| `push-display`: "A message sent to the account shows on the iPhone and a tap opens the app" | manual row (D11) | the only proof that Apple accepts C8a's push (S9, ADR-0010) |
| `app-shell`: "The account menu shows who is signed in" (changed) | its existing frontend test in `src/scenarios/app-shell.test.tsx`, checked against the changed GIVEN | it installs no push stand-ins, so its browser cannot have notifications, and it already asserts the one item: the test should need no change |

## Cross-cutting effects

- **API contract / TS client:** none. No endpoint, no `openapi.json` or `schema.d.ts` change.
- **Bicep, AppHost, settings, secrets:** none.
- **ADRs:** ADR-0010 gets a dated note: the service worker leaves a push carrying the browser's proposed notification and shows the message itself elsewhere; a tap opens the page on the app's own origin (D9). ADR-0007 is unchanged (D5).
- **Conventions:** testing.md § Fake push service (the frontend's stand-ins): the service worker's stand-in and the remembered "Teď ne" emptied with the phone; its `.claude/rules/testing.md` mirror.
- **Tests:** `tests/manual-scenarios.md` gains the four rows (D11), handover step M7 for rows 1 and 2, otherwise the after-deploy check.
- **Design:** read only; no change (D1, D2).
- **Software factory:** D14.
- **CLAUDE.md:** nothing (no command changes; D12 keeps the dev server as it is).

## Risks / Trade-offs

- **[iOS does not ask, or does not let the app subscribe, after the asynchronous steps that follow the tap]** → the permission is asked synchronously in the tap (D3, D7); subscribing needs no gesture once allowed (WebKit's own pattern: ask, then subscribe). Manual rows 1 and 3 check it; if subscribing needs the gesture too, the fix is to read the key before the tap and subscribe right after the answer.
- **[Apple refuses C8a's push, or shows nothing]** → C8a's tests checked RFC 8291 and 8292 with their own decryption; manual row 2 is the first proof. Fallback: c011 D1's own implementation behind `IPushDelivery`.
- **[The iOS prompt hides and shows the page, and the return clears the result]** → D4's rule clears a result only when the app was left while it showed; manual row 1 checks that the card stays.
- **[`PushEvent.notification` is named differently in Safari]** → the handler then shows the same message, which replaces Safari's: still one notification (D9).
- **[The card spins for ever]** (no service worker, a request with no answer) → the 60 s limit ends it as a failure (D8).
- **[A failure leaves the phone allowing notifications without a subscription the server holds]** → the card stays for that opening; C8c's upkeep completes it at the next opening; before C8c merges, such a device gets no pushes and is offered nothing (D8). Only test messages reach a device before C9.
- **[The card appears on the daughter's phone with the deploy, before the owner's iPhone check]** → harmless: before C9 only the owner's test messages to a named account are sent, so turning on early costs nothing, and a broken flow shows only its failure banner. The owner may tell her to wait for M7.
- **[The local check misses a subscribing bug]** (D12) → subscribing is checked on the deployed app in Chrome, then on the iPhone, before the change is called done; a fix is a small follow-up PR.
- **[C8c's edits to the same files]** (`App.tsx`, `useAccountScreen.ts`, the test kit) → small and in different places; the second to merge joins them by hand and runs the whole suite (D13).
- **[22 slices make a long `/tdd-apply`]** → several slices only close, because earlier ones turned them green (tasks.md); the apply may split its agents per chapter, as C8a's did (c011 D17).

## Bootstrap (before `/tdd-apply`, committed as `[setup]`)

1. **Packages:** none.
2. **Probe,** throwaway, deleted afterwards: a module under `src/app/` with its own small interfaces, imported by `sw.ts` and called as `listenForPushes(self)`, passes `npm run typecheck` (both `tsconfig.app.json` with `DOM` and `tsconfig.sw.json` with `WebWorker`) and `npm run build`; its typing goes into § Public API sketch (D9).
3. **Baseline:** the full suite green, except the traceability check naming this change's 22 new scenarios.

## Migration plan

1. **Before `/tdd-apply`:** the bootstrap.
2. **During it,** after the last frontend slice, the local check of D12 with `aspire start --isolated` in Chrome: the card under the balance; Chrome's permission question from the card's tap; "Block" gives the Denied card, gone after a reload; "Teď ne" and the menu item after it, still after a reload; the menu item while blocked; the card's look against the boards, light and dark, and under reduced motion (the button's spinner stands still). Between steps the site's notification permission is reset in Chrome's site settings; "Allow" ends in the failure banner after 60 s (D12).
3. **Before the merge** (workflow.md § 6, a change's path): the push and a draft PR on the owner's go, closing #60; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; the archive on the branch. C8c merges second and joins the shared files by hand (D13); should it land first after all, C8b rebases and joins them instead.
4. **After the merge:**
   - the deploy runs;
   - in Chrome on the owner's computer at the production address: turning on from the card; with the owner's go, Claude sends a test message to the owner's account through C8a's message endpoint (c011 D6), which answers one delivered; Chrome shows it; a tap brings the app to the front, or opens it when closed;
   - on the owner's iPhone, the Home Screen app: manual rows 1, 3 and 5, and row 2 with a test message sent the same way;
   - the dates in `tests/manual-scenarios.md`; C8c's row 4 follows in C8c's last group.

   Findings go into `pm/progress.md` through a small docs PR if they come after the archive.
5. **Rollback:** revert the merge. The card, the menu item and the service worker's handlers disappear. Devices already registered stay in the table; Safari still shows a declarative push without the service worker, and Chrome falls back to its own notice. Harmless.

## Open questions

- None. The last one, the local check, was decided by the owner on 2026-11-20 (D12).
