# Tasks: c015-store-pushed-balance

Before this list comes design.md § Bootstrap, committed as `[setup]`: no package. Its probe shows that the service worker's typecheck refuses the API client (`window`) and accepts a shape check with only a type import, and that the build then carries no API client in `dist/sw.js` (D5). Then the baseline. A probe that contradicts design.md is shown to the owner before `/tdd-apply`.

Its baseline holds one known exception, accepted once: the traceability check reports this change's 8 new scenarios as not claimed, until group 1 claims them.

Run with `/tdd-apply c015-store-pushed-balance` (roadmap C9b; the owner picks the review mode at the start). There are 8 new scenarios, all in `push-display`: 7 frontend tests and 1 manual row (design.md D8, D9). The work is sliced per scenario. **Five scenarios pass before any code exists** (D8): earlier read, none kept, no balance, wrong shape, storage failing. They are accepted green at the acceptance gate as guards, and each slice's `[close]` proves its guard with a mutation. Slice 7 only closes, because C7a's start-up already shows a kept balance (D6).

- Docs tasks are the orchestrator's.
- **"Green"** means the full suite: `dotnet test` (Docker running; it holds the traceability check), and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck`, `format:check` and `run build` (the service worker changes). Exception: this change's scenario tests that are still red stay red until their slice.
- **A mutation** (a slice's `[close]`): the orchestrator breaks the slice's rule in the production code by hand, runs the scenario's test and sees it red, then restores the code with `git restore` and sees it green. Nothing of the mutation is committed; `.tdd-state.md` records what was broken and the red result.
- No UI changes, so no design artifact is read (design.md D6).

## 1. [acceptance] Acceptance tests

- [ ] 1.1 Foundation (frontend), the test kit of design.md D8 and § Public API sketch, the test-writer's: in `src/test/serviceWorker.ts`, with `declarative: true` and a declarative message, the proposed notification also carries the message's `notification.data` as its `data`, and the event's own `data` is null (the W3C draft); every other push as before. In `src/scenarios/push-display.test.ts`, a helper builds a push as C9a sends it (`"mutable": true`, `notification.data.balance`, design.md D1). Verify: the existing frontend tests stay green, C8b's `declarative: true` test among them
- [ ] 1.2 Acceptance: push-display / A push with a balance replaces the balance the phone keeps (frontend)
- [ ] 1.3 Acceptance: push-display / A push with a balance read earlier than the kept one leaves it as it was (frontend; green from the start, a guard, design.md D8)
- [ ] 1.4 Acceptance: push-display / A push with a balance stores none on a phone that keeps none (frontend; green from the start, a guard)
- [ ] 1.5 Acceptance: push-display / A push without a balance leaves the kept balance as it was (frontend; green from the start, a guard)
- [ ] 1.6 Acceptance: push-display / A push with a balance of the wrong shape leaves the kept balance as it was (frontend; green from the start, a guard)
- [ ] 1.7 Acceptance: push-display / A push still shows its notification when the phone's storage fails (frontend; green from the start, a guard)
- [ ] 1.8 Acceptance: push-display / The app opened from a push's notification shows its balance while the server wakes (frontend)
- [ ] 1.9 Acceptance: push-display / A payment's notification on the iPhone opens the app on its balance (manual): its row in `tests/manual-scenarios.md`, handover step M7, first chance once C9a and C9b are both deployed, with the phone taken offline before the tap (design.md D9)

## 2. [unit] Slice 1 — Keeping a push's balance

- [ ] 2.1 The balance comes from the data of the browser's proposed notification when the push event carries one
- [ ] 2.2 The balance comes from the push's own JSON where the browser proposes no notification
- [ ] 2.3 A pushed balance replaces the one the phone keeps, with only its three fields
- [ ] 2.4 A push with a balance is kept also where the service worker shows the notification itself, and the message still shows

## 3. [wiring] Slice 1 — A shape check the service worker can load

- [ ] 3.1 `balanceOf` and `Balance` moved unchanged into `src/app/balanceRecord.ts` (only the type-only schema import), re-exported by `balance.ts`, imported from there by `storedBalance.ts` (design.md D5). Verify: `balance.test.ts` and `storedBalance.test.ts` unchanged and green; `npm run typecheck`
- [ ] 3.2 `listenForPushes` keeps the push's balance under the event's `waitUntil`, before it shows or leaves the message, in the same turn (D4). Verify: `npm run typecheck` (the service worker's project included) and `npm run build`; the built `dist/sw.js` contains no `window.location`

## 4. [close] Slice 1 — A push with a balance replaces the balance the phone keeps

- [ ] 4.1 The scenario's test passes. Verify: green, including push-display / A push with a balance replaces the balance the phone keeps
- [ ] 4.2 Docs: testing.md § Fake push service, the service worker's stand-in: what a browser that reads Declarative Web Push hands the push event (no data of its own, the proposed notification with the message's `data`; design.md D8). Verify: the paragraph names the W3C draft and `src/test/serviceWorker.ts`

## 5. [unit] Slice 2 — A balance read earlier

- [ ] 5.1 A pushed balance read earlier than the kept one leaves the kept one
- [ ] 5.2 A pushed balance read at the same moment as the kept one replaces it
- [ ] 5.3 Read times are compared as moments, whatever their offsets

## 6. [close] Slice 2 — A push with a balance read earlier than the kept one leaves it as it was

- [ ] 6.1 The scenario's test passes and is proven by a mutation: with the `readAt` comparison removed, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 7. [unit] Slice 3 — Only a kept balance is replaced

- [ ] 7.1 A pushed balance is not stored on a phone that keeps none
- [ ] 7.2 A pushed balance is not stored over a kept record of the wrong shape
- [ ] 7.3 A balance forgotten when a login ended is not written back by a later push

## 8. [close] Slice 3 — A push with a balance stores none on a phone that keeps none

- [ ] 8.1 The scenario's test passes and is proven by a mutation: with a write when nothing is kept, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 9. [unit] Slice 4 — A balance of the wrong shape

- [ ] 9.1 A balance without its read time is no balance, in the proposed notification and in the push's JSON
- [ ] 9.2 A balance whose amount or rate is not a number, or whose read time is no date, is no balance

## 10. [close] Slice 4 — A push with a balance of the wrong shape leaves the kept balance as it was

- [ ] 10.1 The scenario's test passes and is proven by a mutation: with the push's balance kept without its shape check, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 11. [unit] Slice 5 — A push without a balance

- [ ] 11.1 A declarative message with no data in its notification carries no balance, as the owner's messages
- [ ] 11.2 A proposed notification whose data is not an object, or has no balance, carries no balance
- [ ] 11.3 A push with no data at all, or of text that is not JSON, carries no balance

## 12. [close] Slice 5 — A push without a balance leaves the kept balance as it was

- [ ] 12.1 The scenario's test passes and is proven by a mutation: with the kept balance forgotten for a push that carries none, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 13. [unit] Slice 6 — A failing store

- [ ] 13.1 A failing store still lets the service worker show the message
- [ ] 13.2 A failing store never makes the push event's work reject where the browser shows its own notification
- [ ] 13.3 The message is shown without waiting for the balance to be written

## 14. [close] Slice 6 — A push still shows its notification when the phone's storage fails

- [ ] 14.1 The scenario's test passes and is proven by a mutation: with a write whose failure passes on, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 15. [close] Slice 7 — The app opened from a push's notification shows its balance while the server wakes

- [ ] 15.1 The scenario's test passes: C7a's start-up shows the kept balance, now the push's (design.md D6). If it is still red here, the orchestrator stops and reports. Verify: green, including the scenario

## 16. [close] Acceptance green

- [ ] 16.1 All scenario tests of this change pass, and the full suite is green, including `npm run build` with no `window.location` in `dist/sw.js`, `dotnet format whitespace RevolutReader.slnx --verify-no-changes` and the traceability check (every scenario claimed exactly once). Verify: the commands' output
- [ ] 16.2 Docs: ADR-0007's dated note, as built (design.md § Cross-cutting effects): where the service worker finds a push's balance, when it replaces the kept one, and that writing never stops the notification. Verify: the note cites this change's design.md D2–D4
- [ ] 16.3 Docs: the software-factory lessons and inventory lines of design.md D11, at the next free numbers. Verify: each lesson names the decision it comes from
- [ ] 16.4 `pm/progress.md`: C9b's row, with Q10 marked as applied (ADR-0007, item 3). `CLAUDE.md` checked against every command this change touched. Verify: the row links the change; `CLAUDE.md`'s commands run as written

## Workflow follow-up

A change's path after its `[close]` commit (workflow.md § 6):

- The push and a draft PR `feat: keep the balance a push brings (C9b)`, closing #86, on the owner's go, opened by Claude.
- The owner runs `/code-review xhigh --comment` on the PR.
- `/triage-review <PR>` works through the findings (testing.md § Code review after the apply). The test-writer's and implementer's agent IDs in `.tdd-state.md` must be current, because its fix round resumes them.
- Whichever of C9a (c014, #52) and C9b merges second joins the shared files by hand (design.md D10): C9b's row in `pm/progress.md` and ADR-0007's notes, and any lines both added to `tests/manual-scenarios.md`, testing.md and the software-factory files; then the full suite.
- Archive with `/opsx:archive` on the branch, before the merge. The traceability check must pass first.
- The owner marks the PR ready and squash-merges it.
- After the merge (design.md § Migration plan, step 4):
  - the deploy;
  - once C9a is deployed too, the manual row on the owner's iPhone, its date in `tests/manual-scenarios.md`; again at M7 on the daughter's phone.

  Until the row passes, C9b's row in `pm/progress.md` stays `in progress` and names it; the results go in through a small docs PR, as C8b's and C8c's did.
