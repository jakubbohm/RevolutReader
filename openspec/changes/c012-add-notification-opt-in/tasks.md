# Tasks: c012-add-notification-opt-in

Before this list: design.md § Bootstrap, committed as `[setup]`: no package; the probe that a module shared by the page and the service worker compiles under both TypeScript projects and builds (D9), its typing into § Public API sketch; the baseline. A probe that contradicts design.md is shown to the owner before `/tdd-apply`.

Its baseline holds one known exception, accepted once: the traceability check reports this change's 22 new scenarios as not claimed, until group 1 claims them.

Run with `/tdd-apply c012-add-notification-opt-in` (roadmap C8b; the owner picks the review mode at the start). There are 22 new scenarios and 1 changed: 18 frontend tests, 4 manual rows (design.md D10, D11). The work is sliced per scenario: slices 1–14 the opt-in (`notification-opt-in`), slice 15 the changed `app-shell` scenario, slices 16–19 the service worker (`push-display`). Several slices only close, because an earlier slice already turned them green. C8a's apply split its agents per chapter of slices (c011 D17); this apply may do the same (slices 1–9, 10–15, 16–19).

- Docs tasks are the orchestrator's.
- **"Green"** means the full suite: `dotnet test` (Docker running; it holds the traceability check), and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck`, `format:check` and `run build` (the service worker changes). Exception: this change's scenario tests stay red until their slice.
- The design artifacts (`.claude/rules/design.md`): the orchestrator reads the design system's `NotificationOptIn` and `AppShell` (README, reference code, `bundle.css`) and the boards `notif-optin`, `notif-asking`, `notif-enabled`, `notif-blocked` and `notif-menu` into the scratchpad and hands their paths to the agents (design.md D1).

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (frontend), the test kit of design.md D10 and § Public API sketch, the test-writer's:
  - `src/test/serviceWorker.ts`: a stand-in for the service worker's side (its origin, `registration.showNotification` recording what was shown, `clients` with windows open or none recording `focus` and `openWindow`), with helpers that fire a push as a browser that reads Declarative Web Push (a `notification` on the event) or as one that does not, and a tap on a shown notification;
  - the remembered "Teď ne": `emptyThePhone()` also clears `localStorage`; `reopen()` keeps it; a helper remembers it before a launch;
  - `src/test/server.ts`: a failing answer to `PUT /api/push/subscription` where none exists yet.

  Verify: the existing frontend tests stay green
- [x] 1.2 Acceptance: notification-opt-in / The card offers notifications under the balance (frontend)
- [x] 1.3 Acceptance: notification-opt-in / The card also shows in a computer's browser (frontend)
- [x] 1.4 Acceptance: notification-opt-in / Nothing offers notifications where the browser cannot have them (frontend)
- [x] 1.5 Acceptance: notification-opt-in / Turning notifications on from the card asks the phone and says they are on (frontend)
- [x] 1.6 Acceptance: notification-opt-in / Nothing offers notifications once they are on (frontend)
- [x] 1.7 Acceptance: notification-opt-in / "Upozornění jsou zapnutá" is gone at the next opening (frontend)
- [x] 1.8 Acceptance: notification-opt-in / Declining the phone's question says where to turn notifications on (frontend)
- [x] 1.9 Acceptance: notification-opt-in / The card saying notifications are off is gone at the next opening (frontend)
- [x] 1.10 Acceptance: notification-opt-in / "Teď ne" hides the card for good on this device (frontend)
- [x] 1.11 Acceptance: notification-opt-in / The account menu offers notifications after "Teď ne" (frontend)
- [x] 1.12 Acceptance: notification-opt-in / Turning notifications on from the account menu shows the result in the card (frontend)
- [x] 1.13 Acceptance: notification-opt-in / The account menu, with notifications blocked, says where to turn them on (frontend)
- [x] 1.14 Acceptance: notification-opt-in / Turning notifications on offline says to try again online (frontend)
- [x] 1.15 Acceptance: notification-opt-in / Turning notifications on when the server fails says to try again later (frontend)
- [x] 1.16 Acceptance: notification-opt-in / The iPhone asks for permission when the card's button is tapped (manual): its row in `tests/manual-scenarios.md`, handover step M7 (design.md D11, row 1)
- [x] 1.17 Acceptance: notification-opt-in / The iPhone asks for permission when the account menu's item is tapped (manual): its row, the after-deploy check (D11, row 3)
- [x] 1.18 Acceptance: notification-opt-in / The card's path to the iPhone's Settings is right (manual): its row, the after-deploy check (D11, row 5)
- [x] 1.19 Acceptance: push-display / A push shows as a notification where the browser does not show it itself (frontend)
- [x] 1.20 Acceptance: push-display / A push the browser shows itself shows once (frontend)
- [x] 1.21 Acceptance: push-display / A tap on a notification opens the app at its page (frontend)
- [x] 1.22 Acceptance: push-display / A tap on a notification brings the open app to the front (frontend)
- [x] 1.23 Acceptance: push-display / A message sent to the account shows on the iPhone and a tap opens the app (manual): its row, handover step M7 (D11, row 2)
- [x] 1.24 Acceptance: app-shell / The account menu shows who is signed in (frontend): the existing test in `src/scenarios/app-shell.test.tsx` checked against the changed GIVEN (a browser that cannot have notifications); changed only if it does not already match

## 2. [unit] Slice 1 — What is offered

- [x] 2.1 A browser that cannot subscribe is offered nothing, card or menu item
- [x] 2.2 Nobody signed in is offered nothing
- [x] 2.3 A signed-in user never asked, with the balance on screen, gets the default card and no menu item
- [x] 2.4 Without the balance header, the default card is not shown and the menu item is

## 3. [unit] Slice 1 — The card

- [x] 3.1 The default card shows the bell, "Chceš vědět o každé platbě?", its sentence, "Zapnout upozornění" and "Teď ne"

## 4. [wiring] Slice 1 — The card under the balance

- [x] 4.1 `NotificationOptIn` (default state) as design.md D1 describes; `notificationOffer` as sketched; `useNotificationOptIn`, first part: the offer from `pushSupported`, `Notification.permission`, the signed-in user and the header; `AccountScreen` shows the card after the banner, under the header (D2); `App` composes the two hooks. Verify: groups 2–3 pass; the scenario runs against the app

## 5. [close] Slice 1 — The card offers notifications under the balance

- [x] 5.1 The scenario's test passes. Verify: green, including notification-opt-in / The card offers notifications under the balance

## 6. [close] Slice 2 — The card also shows in a computer's browser

- [x] 6.1 The scenario's test passes (feature detection, not standalone mode, D2). Verify: green, including notification-opt-in / The card also shows in a computer's browser

## 7. [close] Slice 3 — Nothing offers notifications where the browser cannot have them

- [x] 7.1 The scenario's test passes. Verify: green, including notification-opt-in / Nothing offers notifications where the browser cannot have them

## 8. [unit] Slice 4 — Turning on

- [x] 8.1 The phone is asked for permission before anything is awaited
- [x] 8.2 Once allowed, the app subscribes with the server's key, for visible pushes only, and sends the subscription
- [x] 8.3 The server keeping the subscription is "on"
- [x] 8.4 A declined question is "declined", and nothing is sent to the server
- [x] 8.5 A question closed without an answer is "undecided", and nothing is sent to the server

## 9. [unit] Slice 4 — What is offered while turning on

- [x] 9.1 While turning on, the enabling card and no menu item
- [x] 9.2 Once on in this opening, the enabled card and no menu item

## 10. [unit] Slice 4 — The card turning on

- [x] 10.1 Enabling: "Zapnout upozornění" spins beside its label, is busy and ignores taps; "Teď ne" is disabled
- [x] 10.2 Enabled: the ringing bell, "Upozornění jsou zapnutá", its sentence, no button, announced as a status

## 11. [wiring] Slice 4 — Turning on from the card

- [x] 11.1 `turnNotificationsOn` as sketched (design.md D3); `useNotificationOptIn.turnOn`, the card's `onEnable`; `NotificationOptIn`'s enabling and enabled states; `Button`'s disabled ghost keeps its transparent fill (D1). Verify: groups 8–10 pass; the scenario runs against the app

## 12. [close] Slice 4 — Turning notifications on from the card asks the phone and says they are on

- [x] 12.1 The scenario's test passes. Verify: green, including notification-opt-in / Turning notifications on from the card asks the phone and says they are on

## 13. [unit] Slice 5 — Once on

- [x] 13.1 A phone that allows notifications is offered nothing, card or menu item, when no result of this opening shows

## 14. [close] Slice 5 — Nothing offers notifications once they are on

- [x] 14.1 The scenario's test passes. Verify: green, including notification-opt-in / Nothing offers notifications once they are on

## 15. [unit] Slice 6 — Openings

- [x] 15.1 A return to the app after it was left while the enabled card showed clears the card
- [x] 15.2 A return to the app that comes while turning on leaves the result to show when it comes (the iOS prompt, D4)
- [x] 15.3 Coming back online is not an opening: the result stays
- [x] 15.4 Every opening reads the phone's permission again

## 16. [wiring] Slice 6 — The opening watch

- [x] 16.1 `useNotificationOptIn` watches the page's `visibilitychange`, clears a result at the first return after the app was left while it showed, and reads the permission again (D4). Verify: group 15 passes; the scenario runs against the app

## 17. [close] Slice 6 — "Upozornění jsou zapnutá" is gone at the next opening

- [x] 17.1 The scenario's test passes. Verify: green, including notification-opt-in / "Upozornění jsou zapnutá" is gone at the next opening

## 18. [unit] Slice 7 — Declining

- [x] 18.1 After a decline in this opening, the Denied card and no menu item
- [x] 18.2 A blocked phone with no result of this opening is offered the menu item, never a card
- [x] 18.3 The Denied card shows the crossed bell, "Upozornění jsou vypnutá", the path to Settings, no button, announced as a status

## 19. [wiring] Slice 7 — The Denied card

- [x] 19.1 The declined outcome gives the Denied card; `NotificationOptIn`'s denied state (D6). Verify: group 18 passes; the scenario runs against the app

## 20. [close] Slice 7 — Declining the phone's question says where to turn notifications on

- [x] 20.1 The scenario's test passes. Verify: green, including notification-opt-in / Declining the phone's question says where to turn notifications on

## 21. [close] Slice 8 — The card saying notifications are off is gone at the next opening

- [x] 21.1 The scenario's test passes (a launch starts afresh, D4). Verify: green, including notification-opt-in / The card saying notifications are off is gone at the next opening

## 22. [unit] Slice 9 — "Teď ne" remembered

- [x] 22.1 "Teď ne" remembered on the device reads back as remembered
- [x] 22.2 A storage that fails to read counts as not remembered
- [x] 22.3 A storage that fails to write is ignored
- [x] 22.4 With "Teď ne" remembered, no card and the menu item

## 23. [wiring] Slice 9 — "Teď ne"

- [x] 23.1 `notNowRemembered` and `rememberNotNow` on `localStorage` (D5); the card's `onDismiss` → `useNotificationOptIn.notNow`, the card gone at once; the choice read at every opening. Verify: group 22 passes; the scenario runs against the app

## 24. [close] Slice 9 — "Teď ne" hides the card for good on this device

- [x] 24.1 The scenario's test passes. Verify: green, including notification-opt-in / "Teď ne" hides the card for good on this device

## 25. [unit] Slice 10 — The menu's item

- [x] 25.1 With a handler for it, the account menu holds "Zapnout upozornění" with the bell above "Odhlásit se", in the same style
- [x] 25.2 Without one, the menu holds the one item "Odhlásit se"

## 26. [wiring] Slice 10 — The item in the menu

- [x] 26.1 `AccountMenu` and `AppShell` gain `onEnableNotifications` (D1, D7); `AccountScreen` passes the hook's `fromMenu` while `menuItem`. Verify: group 25 passes; the scenario runs against the app

## 27. [close] Slice 10 — The account menu offers notifications after "Teď ne"

- [x] 27.1 The scenario's test passes. Verify: green, including notification-opt-in / The account menu offers notifications after "Teď ne"

## 28. [unit] Slice 11 — Turning on from the menu

- [x] 28.1 Choosing "Zapnout upozornění" calls its handler within the selection and closes the menu
- [x] 28.2 Turning on from the menu asks the phone before anything is awaited
- [x] 28.3 With "Teď ne" remembered, the result of a turn-on from the menu shows in the card, and "Teď ne" stays remembered
- [x] 28.4 A result of this opening shows whether or not the balance header is on screen

## 29. [wiring] Slice 11 — The menu's turn-on

- [x] 29.1 `useNotificationOptIn.fromMenu` (D7); `AccountScreen` shows a result first in the content when there is no header (D2). Verify: group 28 passes; the scenario runs against the app

## 30. [close] Slice 11 — Turning notifications on from the account menu shows the result in the card

- [ ] 30.1 The scenario's test passes. Verify: green, including notification-opt-in / Turning notifications on from the account menu shows the result in the card

## 31. [unit] Slice 12 — The menu on a blocked phone

- [ ] 31.1 On a blocked phone, the menu's item asks nothing and gives the Denied card

## 32. [close] Slice 12 — The account menu, with notifications blocked, says where to turn them on

- [ ] 32.1 The scenario's test passes. Verify: green, including notification-opt-in / The account menu, with notifications blocked, says where to turn them on

## 33. [unit] Slice 13 — Failing offline

- [ ] 33.1 With the phone offline after the answer, nothing is sent and turning on fails as offline
- [ ] 33.2 A request with no answer makes turning on fail as offline
- [ ] 33.3 With no outcome 60 seconds after the phone's answer, the requests are given up and turning on fails as offline
- [ ] 33.4 A service worker not ready within 60 seconds makes turning on fail, not as offline
- [ ] 33.5 A subscription the browser refuses while the phone is offline fails as offline

## 34. [unit] Slice 13 — The failure on the screen

- [ ] 34.1 A failure to turn notifications on is the screen's one banner, in place of any other, offline included
- [ ] 34.2 A read that starts clears it
- [ ] 34.3 After a failure, the default card for the rest of this opening, even when the phone now allows notifications
- [ ] 34.4 A new turn-on clears its earlier failure, and only that

## 35. [wiring] Slice 13 — The failure banner

- [ ] 35.1 `Problem`'s `notifications failed`, ranked with the failed sign-out in `bannerOf`; `useAccountScreen.notificationsFailed` and `notificationsRetried`; `AccountScreen`'s banner "Upozornění se nepodařilo zapnout" with its two sentences and no action; the hook reports failures and retries (D8). Verify: groups 33–34 pass; the scenario runs against the app

## 36. [close] Slice 13 — Turning notifications on offline says to try again online

- [ ] 36.1 The scenario's test passes. Verify: green, including notification-opt-in / Turning notifications on offline says to try again online

## 37. [unit] Slice 14 — Failing later

- [ ] 37.1 A server error, a refused subscription or an unreadable answer makes turning on fail, not as offline
- [ ] 37.2 A 401 or 403 while turning on fails, not as offline (D8)
- [ ] 37.3 A subscription the browser refuses while online fails, not as offline
- [ ] 37.4 A subscription made with another key makes turning on fail, not as offline

## 38. [close] Slice 14 — Turning notifications on when the server fails says to try again later

- [ ] 38.1 The scenario's test passes. Verify: green, including notification-opt-in / Turning notifications on when the server fails says to try again later

## 39. [close] Slice 15 — The account menu shows who is signed in

- [ ] 39.1 The changed scenario's test passes. Verify: green, including app-shell / The account menu shows who is signed in

## 40. [unit] Slice 16 — Reading a push

- [ ] 40.1 A Declarative Web Push message gives its title, its text and the page it opens
- [ ] 40.2 A message without text gives no text
- [ ] 40.3 Anything else is no message: not an object, `web_push` other than 8030, no or an empty title, no `navigate`

## 41. [unit] Slice 16 — Showing a push

- [ ] 41.1 A push without the browser's own notification shows the message's title and text, keeping the page it opens
- [ ] 41.2 A push that is not a Declarative Web Push message shows nothing

## 42. [wiring] Slice 16 — The service worker's push handler

- [ ] 42.1 `src/app/pushDisplay.ts` as sketched (D9); `sw.ts` calls `listenForPushes(self)`. Verify: groups 40–41 pass; `npm run typecheck` and `npm run build` pass; the scenario runs against the handler

## 43. [close] Slice 16 — A push shows as a notification where the browser does not show it itself

- [ ] 43.1 The scenario's test passes. Verify: green, including push-display / A push shows as a notification where the browser does not show it itself

## 44. [unit] Slice 17 — The browser's own notification

- [ ] 44.1 A push that carries the browser's own notification shows nothing of the service worker's

## 45. [close] Slice 17 — A push the browser shows itself shows once

- [ ] 45.1 The scenario's test passes. Verify: green, including push-display / A push the browser shows itself shows once
- [ ] 45.2 Docs: ADR-0010's dated note on the service worker's rule and the tap (design.md § Cross-cutting effects). Verify: the note links this design's D9

## 46. [unit] Slice 18 — A tap opening the app

- [ ] 46.1 A tap closes the notification
- [ ] 46.2 With no window of the app open, a tap opens the message's page on the service worker's own origin
- [ ] 46.3 A page on another origin opens as its path on the service worker's own origin
- [ ] 46.4 A page that cannot be read opens the start page

## 47. [close] Slice 18 — A tap on a notification opens the app at its page

- [ ] 47.1 The scenario's test passes. Verify: green, including push-display / A tap on a notification opens the app at its page

## 48. [unit] Slice 19 — A tap with the app open

- [ ] 48.1 With a window of the app open, a tap focuses it and opens no other
- [ ] 48.2 A window on another origin does not count as the app

## 49. [close] Slice 19 — A tap on a notification brings the open app to the front

- [ ] 49.1 The scenario's test passes. Verify: green, including push-display / A tap on a notification brings the open app to the front
- [ ] 49.2 Docs: testing.md § Fake push service, the frontend's stand-ins: the service worker's stand-in and the remembered "Teď ne" emptied with the phone; the `.claude/rules/testing.md` mirror. Verify: both name `src/test/serviceWorker.ts`

## 50. [close] Acceptance green

- [ ] 50.1 All scenario tests of this change pass, and the full suite is green, including `npm run build`, `dotnet format whitespace RevolutReader.slnx --verify-no-changes` and the traceability check (every scenario claimed exactly once). Verify: the commands' output
- [ ] 50.2 The local check of design.md § Migration plan, step 2, with `aspire start --isolated` in Chrome, with the owner: everything before subscribing (D12, the owner's choice, 2026-11-20); subscribing, the first push and its tap wait for the deployed app (§ Migration plan, step 4). Verify: each step seen, recorded in `.tdd-state.md`
- [ ] 50.3 Docs: the software-factory lessons and inventory lines of design.md D14, at the next free numbers. Verify: a divergence names its full version
- [ ] 50.4 `pm/progress.md`: the C8b row, with Q9 marked as applied. `CLAUDE.md` checked against every command this change touched. Verify: the row links the change; `CLAUDE.md`'s commands run as written

## Workflow follow-up

A change's path after its `[close]` commit (workflow.md § 6):

- The push and a draft PR `feat: add the notification opt-in (C8b)`, closing #60, on the owner's go, opened by Claude.
- The owner runs `/code-review xhigh --comment` on the PR.
- `/triage-review <PR>` works through the findings (testing.md § Code review after the apply). The test-writer's and implementer's agent IDs in `.tdd-state.md` must be current, because its fix round resumes them.
- C8c (c013, #61) merges second and joins the shared files by hand (design.md D13). Should it land first after all: rebase on `main`, join `App.tsx`, `pm/progress.md` and the other shared files by hand, then the full suite.
- Archive with `/opsx:archive` on the branch, before the merge. The traceability check must pass first.
- The owner marks the PR ready and squash-merges it.
- After the merge (design.md § Migration plan, step 4):
  - the deploy;
  - in Chrome on the owner's computer at the production address: turning on, a test message through C8a's message endpoint on the owner's go, the notification and its tap;
  - on the owner's iPhone: manual rows 1, 2, 3 and 5, their dates in `tests/manual-scenarios.md`;
  - C8c's row 4 follows in C8c's last group.

  Findings go into `pm/progress.md`, through a small docs PR if they come after the archive.
