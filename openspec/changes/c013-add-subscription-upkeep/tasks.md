# Tasks: c013-add-subscription-upkeep

Before this list: design.md § Bootstrap, committed as `[setup]`. It needs no package and no probe, only the baseline. That baseline holds one known exception, accepted once: the traceability check reports this change's 11 new scenarios as not claimed until group 1 claims them.

Run with `/tdd-apply c013-add-subscription-upkeep` (roadmap C8c; the owner picks the review mode at the start). The change has 11 scenarios: 10 frontend tests and 1 manual row (design.md D7). The frontend ones are sliced per scenario: slices 1–5 cover the openings, 6–8 the sign-out, 9 the login's end and 10 signing in again. C8b runs alongside: the last group waits for C8b's merge and joins the shared files by hand (design.md D8).

- Docs tasks are the orchestrator's; "Guided" tasks need the owner.
- **"Green"** means the full suite: `dotnet test` (Docker running, for Azurite) and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck` and `format:check`. The exception: this change's own scenarios stay red until their slice.
- **Green from the start, by design** (design.md D7): "Nothing is subscribed while notifications are not allowed" and "A failed sign-out keeps the subscription". The acceptance gate says so; their unit tests are red until their slice.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (the test-writer's, design.md § Public API sketch):
  - `src/test/push.ts`: the stand-in's `navigator.serviceWorker` gains `getRegistration()`, which settles with the registration, and with `undefined` under a new option `registered: false`, a browser with a service worker but none registered (Vite's dev server). `ready` stays as it is;
  - `src/scenarios/push-devices.test.tsx` with its helpers; anything the scenarios need from `src/test/server.ts`, e.g. a `signsInAgain(…)` helper over `answerWith(…)`;
  - `src/app/subscriptionUpkeep.ts` as signatures whose functions throw, and `watchReturns` in `src/app/refreshTriggers.ts`, likewise.

  Verify: the frontend checks pass, and every frontend test that was green stays green
- [x] 1.2 Acceptance: push-devices / The subscription is sent to the server again when the app opens (frontend)
- [x] 1.3 Acceptance: push-devices / The subscription is sent to the server again on every return to the app (frontend)
- [x] 1.4 Acceptance: push-devices / A subscription the phone has lost is replaced quietly (frontend)
- [x] 1.5 Acceptance: push-devices / A subscription made with another key is replaced quietly (frontend)
- [x] 1.6 Acceptance: push-devices / Nothing is subscribed while notifications are not allowed (frontend; green from the start)
- [x] 1.7 Acceptance: push-devices / Signing out asks the server to forget the phone and unsubscribes it (frontend)
- [x] 1.8 Acceptance: push-devices / A failed request to forget the phone does not fail the sign-out (frontend)
- [x] 1.9 Acceptance: push-devices / A failed sign-out keeps the subscription (frontend; green from the start)
- [x] 1.10 Acceptance: push-devices / A login that has ended unsubscribes the phone (frontend)
- [x] 1.11 Acceptance: push-devices / After signing in again, the phone subscribes without a tap (frontend)
- [x] 1.12 Acceptance: push-devices / After signing out and in again on the iPhone, a message arrives without a tap (manual): its row in `tests/manual-scenarios.md`. It is manual because only Apple's push service and the iPhone's Home Screen app can show it. First chance: after C8c's merge deploys, with a phone subscribed through C8b's card. Handover step M7; the date is left empty

## 2. [unit] Slice 1 — Finding the registration (`pushRegistration`)

- [x] 2.1 The registration is the one the browser has registered
- [x] 2.2 There is no registration where the browser cannot push
- [x] 2.3 There is no registration when no worker is registered, and nothing waits for one
- [x] 2.4 A failure to ask for the registration reads as none

## 3. [unit] Slice 1 — Sending the subscription again (`keepSubscriptionUp`)

- [x] 3.1 A subscription made with the server's key is sent again, and the phone keeps it
- [x] 3.2 A subscription whose key the browser does not name is sent again as it is, never replaced
- [x] 3.3 The upkeep reads the server's key before it compares, and its requests carry the given signal
- [x] 3.4 An answer the app cannot read, offline, or a refused subscription stops the upkeep quietly
- [x] 3.5 The upkeep never asks for the notification permission and never throws

## 4. [unit] Slice 1 — The upkeep at a launch (`useAccountScreen`)

- [x] 4.1 An upkeep starts once the server names a signed-in user, together with the balance read
- [x] 4.2 No upkeep starts for a visitor on the sign-in or the no-access screen
- [x] 4.3 A repeated question that finds a signed-in user starts an upkeep
- [x] 4.4 "Obnovit" and coming back online start no upkeep
- [x] 4.5 The upkeep's outcome changes nothing on the screen

## 5. [close] Slice 1 — The subscription is sent to the server again when the app opens

- [x] 5.1 Its acceptance test passes. Verify: it, and the full suite apart from this change's later scenarios, are green

## 6. [unit] Slice 2 — Only while notifications are allowed (`keepSubscriptionUp`)

- [x] 6.1 Nothing is asked, subscribed or sent while the permission is `default`, even with a subscription held
- [x] 6.2 Nothing is asked, subscribed or sent while the permission is `denied`
- [x] 6.3 Nothing is done where the browser cannot push, or no worker is registered

## 7. [close] Slice 2 — Nothing is subscribed while notifications are not allowed

- [ ] 7.1 Its acceptance test passes (green from the start, design.md D7). Verify: it, and the full suite, are green

## 8. [unit] Slice 3 — Returns (`watchReturns`)

- [ ] 8.1 A return to the screen calls back, every time
- [ ] 8.2 Leaving the screen and coming back online call nothing
- [ ] 8.3 The stop function ends the watch

## 9. [unit] Slice 3 — The upkeep at a return (`useAccountScreen`)

- [ ] 9.1 Every return while a user is signed in starts an upkeep
- [ ] 9.2 A return while an upkeep runs starts none
- [ ] 9.3 An upkeep with no answer after 60 s is aborted, and the next opening starts a new one

## 10. [close] Slice 3 — The subscription is sent to the server again on every return to the app

- [ ] 10.1 Its acceptance test passes. Verify: it, and the full suite, are green

## 11. [unit] Slice 4 — Subscribing again (`keepSubscriptionUp`)

- [ ] 11.1 A phone with no subscription subscribes with the server's key, visible pushes only, and sends the new one
- [ ] 11.2 A failed subscribe stops the upkeep quietly, and nothing is sent
- [ ] 11.3 A new subscription the server did not get is sent again at the next opening

## 12. [close] Slice 4 — A subscription the phone has lost is replaced quietly

- [ ] 12.1 Its acceptance test passes. Verify: it, and the full suite, are green

## 13. [unit] Slice 5 — Replacing a subscription made with another key (`keepSubscriptionUp`)

- [ ] 13.1 A subscription made with another key: the server forgets its push address first, then the phone unsubscribes it, subscribes with the server's key and sends the new one
- [ ] 13.2 A forget that does not answer "forgotten" leaves the phone's subscription untouched and sends nothing more
- [ ] 13.3 A failed unsubscribe stops the upkeep before it subscribes

## 14. [close] Slice 5 — A subscription made with another key is replaced quietly

- [ ] 14.1 Its acceptance test passes. Verify: it, and the full suite, are green

## 15. [unit] Slice 6 — Forgetting and unsubscribing this device (`forgetThisDevice`, `unsubscribeThisDevice`)

- [ ] 15.1 Forgetting this device sends the push address of the phone's subscription, and its requests carry the given signal
- [ ] 15.2 Forgetting sends nothing without a registration or a subscription
- [ ] 15.3 Unsubscribing this device unsubscribes the phone's subscription, and does nothing without one
- [ ] 15.4 Neither ever throws: a failed unsubscribe and a failure to ask for the registration are ignored

## 16. [unit] Slice 6 — The sign-out (`useAccountScreen`)

- [ ] 16.1 The sign-out asks the server to forget this device before its sign-out request, with the menu item busy from the tap
- [ ] 16.2 A confirmed sign-out unsubscribes the phone, together with forgetting the stored balance, before the signed-out screen shows
- [ ] 16.3 A forget with no answer after 60 s is given up, and the sign-out goes on

## 17. [close] Slice 6 — Signing out asks the server to forget the phone and unsubscribes it

- [ ] 17.1 Its acceptance test passes. Verify: it, and the full suite, are green

## 18. [unit] Slice 7 — A failed forget (`useAccountScreen`, `forgetThisDevice`)

- [ ] 18.1 A forget the server fails, refuses or does not answer still leads to the sign-out request
- [ ] 18.2 Forgetting this device never throws, whatever the server answers

## 19. [close] Slice 7 — A failed request to forget the phone does not fail the sign-out

- [ ] 19.1 Its acceptance test passes. Verify: it, and the full suite, are green

## 20. [unit] Slice 8 — A failed sign-out (`useAccountScreen`)

- [ ] 20.1 A sign-out the server fails leaves the phone's subscription
- [ ] 20.2 A sign-out that fails offline sends nothing and leaves the phone's subscription

## 21. [close] Slice 8 — A failed sign-out keeps the subscription

- [ ] 21.1 Its acceptance test passes (green from the start, design.md D7). Verify: it, and the full suite, are green

## 22. [unit] Slice 9 — The login's end (`useAccountScreen`)

- [ ] 22.1 A 401 or 403 to who is signed in, to a balance read or to the list's newest page unsubscribes the phone before the next screen shows
- [ ] 22.2 A 401 or 403 to one of the upkeep's own requests ends the login once, as the list's does
- [ ] 22.3 A failure to unsubscribe does not hold up the next screen

## 23. [unit] Slice 9 — The upkeep and the login's end (`keepSubscriptionUp`, design.md D6)

- [ ] 23.1 A 401 or 403 to the key, to the subscription it sends or to the forget answers "login ended", naming the refused account
- [ ] 23.2 An upkeep whose login ended while it ran stops at its next step, and unsubscribes a subscription it made
- [ ] 23.3 An upkeep whose login ended before it sends anything sends nothing

## 24. [close] Slice 9 — A login that has ended unsubscribes the phone

- [ ] 24.1 Its acceptance test passes. Verify: it, and the full suite, are green

## 25. [close] Slice 10 — After signing in again, the phone subscribes without a tap

- [ ] 25.1 Its acceptance test passes. Slices 4 and 6 should already make it green; a missing behaviour goes to the test-writer as a new unit test. Verify: it, and the full suite, are green

## 26. [close] Acceptance green

- [ ] 26.1 All 10 frontend scenarios of this change pass, and the full suite is green; the traceability check passes (the manual row included); the frontend checks and `dotnet format whitespace --verify-no-changes` are clean
- [ ] 26.2 Docs: the dated note in ADR-0010-web-push, item 4 (design.md D9). Verify: it matches design.md D1, D2 and D4
- [ ] 26.3 Docs: the software-factory lesson, and the push module's inventory row (design.md D9). Verify: each names the decision it records
- [ ] 26.4 `pm/progress.md`: C8c's row (status, the change link, notes). `CLAUDE.md` needs no change: no command changed. Verify: the row links the change

## 27. [close] Acceptance green after C8b's merge — the join

Waits for C8b's merge (design.md D8; C7, S10 item 4). C8c merges second.

- [ ] 27.1 Merge `main` with C8b into this branch. Join by hand the files design.md D8 lists: `useAccountScreen.ts` (C8b's two model callbacks and C8c's triggers, `endLogin` and `signOutFromMenu`), `App.tsx`, `src/test/server.ts`, `tests/manual-scenarios.md` and `pm/progress.md`. Verify: no conflict marker is left; both changes' rows, callbacks and helpers are there
- [ ] 27.2 Check the seams of design.md D5 and D8 as merged: C8b's card stays hidden while the permission is granted, and after the card turns notifications on, the next opening only sends the subscription again. A gap goes to the owner before any fix. Verify: the owner hears what was found
- [ ] 27.3 All of this change's and C8b's scenarios pass, and the full suite is green; the traceability check passes; the frontend checks are clean. Verify: the runs' counts go into `pm/progress.md`

## Workflow follow-up

- The push and a draft PR on the owner's go; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; `/opsx:archive` on the branch; the PR ready, CI green, squash merge (workflow.md § 6).
- After the merge, once the deploy runs: the iPhone check of the manual row (design.md § Migration plan, step 5). It needs C8c deployed, so it cannot run before this PR's merge (agreed with the owner, 2026-11-20). Its date goes into `tests/manual-scenarios.md` and its outcome into `pm/progress.md`, through a small docs PR.
