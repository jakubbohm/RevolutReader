# Tasks: c009-add-account-balance

Before this list: design.md § Bootstrap, committed as `[setup]`. It needs C13 merged first, and covers:

- C13's merged names in the sketch;
- the three packages;
- the `X-Forwarded-For` probe;
- the baseline.

Its baseline holds one known exception, accepted once: the traceability check reports this change's 31 new scenarios as not claimed. Group 1 claims them.

Run with `/tdd-apply c009-add-account-balance` (roadmap C7a; the user picks the review mode at the start). There are 31 scenarios: 7 API and 24 frontend, so the work is sliced per scenario. Slices 1–7 are the API, slices 8–31 the screen, in an order where each builds on the last. Several slices only close, because an earlier slice already turned them green.

- Docs tasks are the orchestrator's.
- **"Green"** means the full suite: `dotnet test`, and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck` and `format:check`. The exception: this change's acceptance tests stay red until their slice.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (API), as signatures whose members throw `NotImplementedException`, exactly as design.md § Public API sketch:
  - `Drivers/BalanceDriver`;
  - `Dsl/BalanceDsl` and `Dsl/BalanceReading`;
  - `Dsl/ProblemDescription` gains `Type` (default `null`) and the values `BankAccessExpired`, `BankRateLimited`, `BankUnavailable` and `InternalServerError`;
  - `AcceptanceTest.Balance`.

  Verify: build passes; every acceptance test that was green stays green
- [x] 1.2 Foundation (frontend), the test kit of design.md § Public API sketch:
  - `fake-indexeddb` in `src/test/setup.ts`, a fresh database per test;
  - `src/test/server.ts`:
    - the balance answers (one per read in order, the last repeating), `after: <ms>` on any answer;
    - requests honour their `AbortSignal` (written `aborted …` in the timeline);
    - `GET /health` answers 200;
    - `goOffline()` and `goOnline()`, `leaveApp()` and `returnToApp()`;
    - `phoneKeeps(balance)` and `keptBalance()`;
  - `renderApp`'s `reopen()`;
  - a short note in each helper on using it with fake timers.

  Verify: the existing frontend tests stay green
- [x] 1.3 Acceptance: account-balance / The balance comes with the time it was read and the koruna rate
- [x] 1.4 Acceptance: account-balance / The bank sees the signed-in user's address and browser
- [x] 1.5 Acceptance: account-balance / A balance request without a browser name reads nothing at the bank
- [x] 1.6 Acceptance: account-balance / Expired bank access answers its own problem
- [x] 1.7 Acceptance: account-balance / A reached bank limit answers its own problem
- [x] 1.8 Acceptance: account-balance / A bank that does not answer is its own problem
- [x] 1.9 Acceptance: api-errors / An unexpected failure answers with a problem description that reveals nothing
- [x] 1.10 Acceptance: account-balance / The account screen shows the balance, its koruna value and when it was read (frontend)
- [x] 1.11 Acceptance: account-balance / Tapping "Obnovit" reads the balance again (frontend)
- [x] 1.12 Acceptance: account-balance / Coming back to the app reads the balance again (frontend)
- [x] 1.13 Acceptance: app-shell / Offline with nothing stored says the balance loads once online (frontend)
- [x] 1.14 Acceptance: app-shell / Offline with a stored balance shows it with the offline banner (frontend)
- [x] 1.15 Acceptance: account-balance / A balance read replaces the one the phone keeps (frontend)
- [x] 1.16 Acceptance: app-shell / Coming back online loads what was waiting (frontend)
- [x] 1.17 Acceptance: app-shell / A stored balance shows at once while the server wakes (frontend)
- [x] 1.18 Acceptance: app-shell / A sleeping server shows the waking-up screen after 1.5 seconds (frontend)
- [x] 1.19 Acceptance: app-shell / A slow wake offers to try again after 30 seconds (frontend)
- [x] 1.20 Acceptance: account-balance / A bank that does not answer shows a banner with a retry (frontend)
- [x] 1.21 Acceptance: account-balance / Too many refreshes shows a warning with no action (frontend)
- [x] 1.22 Acceptance: account-balance / Expired bank access asks to let Dad know (frontend)
- [x] 1.23 Acceptance: account-balance / An unexpected answer to the balance read shows a banner with a retry (frontend)
- [x] 1.24 Acceptance: app-shell / An unexpected answer to who is signed in shows a banner with a retry (frontend)
- [x] 1.25 Acceptance: app-shell / A refresh with no answer for 60 seconds counts as offline (frontend)
- [x] 1.26 Acceptance: account-balance / Signing out forgets the balance on the phone (frontend)
- [x] 1.27 Acceptance: account-balance / A login that has ended forgets the balance on the phone (frontend)
- [x] 1.28 Acceptance: sign-in / A login that ends while the app is open shows the sign-in screen (frontend)
- [x] 1.29 Acceptance: sign-in / A sign-out that fails offline says to try again online (frontend)
- [x] 1.30 Acceptance: sign-in / A sign-out the server fails says to try again later (frontend)
- [x] 1.31 Acceptance: sign-in / The menu shows the sign-out under way (frontend)
- [x] 1.32 Acceptance: app-shell / The app keeps the server awake while it is on the screen (frontend)
- [x] 1.33 Acceptance: app-shell / The app lets the server sleep after 30 minutes without use (frontend)
- [x] 1.34 Docs:
  - testing.md: fake timers and `fake-indexeddb` for frontend scenarios that wait or store, and the fake server's delays and abort;
  - its `.claude/rules/` mirror;
  - R-15's inventory row: the test kit's new helpers.

  Verify: no statement contradicts design.md D8

## 2. [unit] Slice 1 — Reading the balance

- [x] 2.1 The balance comes with the clock's time and the koruna rate
- [x] 2.2 The read is made as the given present user
- [x] 2.3 Expired bank access comes back as access expired
- [x] 2.4 A reached bank limit comes back as rate limited
- [x] 2.5 A bank that does not answer comes back as unavailable
- [x] 2.6 A balance in another currency throws, and the message names neither the amount nor the currency

## 3. [wiring] Slice 1 — The balance endpoint

- [x] 3.1 `AccountBalance`, `ReadBalanceHandler` and `AddBalance()` in `src/RevolutReader.Api/Account/`, registered in `Program.cs` after `AddEnableBanking()`. Verify: build passes; the unit tests of group 2 pass
- [x] 3.2 `BalanceEndpoint` (`GET /api/balance`, default policy) and `BalanceResponse`: the present user from C13's `PresentUserFromRequest`, then the handler, then 200. Its OpenAPI description: 200, 401, 403 and 500, plus C13's `ProducesBankProblems()` (400, 429, 503). `BalanceDriver.AskForBalance` and `Now` replace their stubs. Verify: the scenario runs against the app
- [x] 3.3 Regenerate the TS client: `npm --prefix tools/api-client run regenerate`; `openapi.json` and `schema.d.ts` committed. Verify: a second run leaves no diff; frontend checks green

## 4. [close] Slice 1 — The balance comes with the time it was read and the koruna rate

- [x] 4.1 The scenario's test passes, including the exact shape of the answer. Verify: green, including account-balance / The balance comes with the time it was read and the koruna rate

## 5. [close] Slice 2 — The bank sees the signed-in user's address and browser

- [x] 5.1 The scenario's test passes: the address arrives through `X-Forwarded-For` as from the ingress, the browser as `User-Agent`. If it does not, a `[wiring]` task is added here first (design.md § Risks). Verify: green, including account-balance / The bank sees the signed-in user's address and browser

## 6. [wiring] Slice 3 — A request naming no browser

- [x] 6.1 `BalanceEndpoint`: no present user → C13's `BankAnswers.NoPresentUser()` (400), the handler never called; `BalanceDriver.AskForBalanceNamingNoBrowser` replaces its stub. Verify: the scenario runs against the app; the bank's request log stays empty
- [x] 6.2 Docs: README.md § Backend code, the case → status table's 400 row: its Scenario column names account-balance / A balance request without a browser name reads nothing at the bank for the no-present-user case. Verify: the row names the scenario exactly

## 7. [close] Slice 3 — A balance request without a browser name reads nothing at the bank

- [x] 7.1 The scenario's test passes. Verify: green, including account-balance / A balance request without a browser name reads nothing at the bank

## 8. [wiring] Slice 4 — The bank's failures

- [x] 8.1 `BalanceEndpoint` answers the three failures with C13's rules; the driver reads the problem's status, `type` and title and returns them only when they agree. Regenerate the TS client if the description changed. Verify: the three failure scenarios run against the app
- [x] 8.2 Docs: README.md § Backend code: the case → status table's bank rows (C13's) name these three scenarios in their Scenario column. Verify: each row names its scenario exactly

## 9. [close] Slice 4 — Expired bank access answers its own problem

- [x] 9.1 The scenario's test passes. Verify: green, including account-balance / Expired bank access answers its own problem

## 10. [close] Slice 5 — A reached bank limit answers its own problem

- [x] 10.1 The scenario's test passes. Verify: green, including account-balance / A reached bank limit answers its own problem

## 11. [close] Slice 6 — A bank that does not answer is its own problem

- [x] 11.1 The scenario's test passes, after the bank's own error on every retry. Verify: green, including account-balance / A bank that does not answer is its own problem

## 12. [wiring] Slice 7 — The 500

- [x] 12.1 `app.UseExceptionHandler()` with no arguments, directly after `app.UseStatusCodePages()` and before `app.UseAppPages()` (design.md D1); `BalanceDriver.BankAnswersAnErrorNoCaseFits` and the 500's shape check replace their stubs. Verify: the scenario runs against the app; `BankTelemetryTests` and `SignInTelemetryTests` stay green; the 404, 401, 403 and 400 scenarios and guards stay green
- [x] 12.2 Docs: README.md § Backend code: the 500 row in the case → status table and the exception handler's place (after `UseStatusCodePages`, not FastEndpoints' handler). Verify: they match design.md D1

## 13. [close] Slice 7 — An unexpected failure answers with a problem description that reveals nothing

- [x] 13.1 The scenario's test passes. Verify: green, including api-errors / An unexpected failure answers with a problem description that reveals nothing

## 14. [unit] Slice 8 — Czech formats

- [x] 14.1 An amount shows in euros with a decimal comma and a no-break space before `€` (`286,40 €`)
- [x] 14.2 A four-digit amount groups its thousands with a no-break space (`2 486,40 €`)
- [x] 14.3 The koruna value is the amount times the rate, rounded to whole crowns, after `≈` (`≈ 6 960 Kč`)
- [x] 14.4 The koruna value of a negative amount shows its size without a sign
- [x] 14.5 The spoken koruna value reads `přibližně 6 960 Kč`
- [x] 14.6 A balance read under a minute ago is `Aktualizováno právě teď`
- [x] 14.7 A balance read 2 minutes ago is `Aktualizováno před 2 min`
- [x] 14.8 A balance read 2 hours ago is `Aktualizováno před 2 h`
- [x] 14.9 A balance read earlier today is `Aktualizováno v 9:05`
- [x] 14.10 A balance read yesterday is `Aktualizováno včera v 14:05`
- [x] 14.11 A balance read on another day this year is `Aktualizováno 3. 11. v 14:05`, and in another year its year follows the month

## 15. [unit] Slice 8 — Reading the balance

- [ ] 15.1 A balance answer reads as the balance
- [ ] 15.2 A success whose body is not a balance reads as unexpected
- [ ] 15.3 The access-expired problem reads as bank access expired
- [ ] 15.4 The rate-limited problem reads as bank rate limited
- [ ] 15.5 The bank-unavailable problem reads as bank unavailable
- [ ] 15.6 A 503 with any other `type` reads as unexpected
- [ ] 15.7 A 401 reads as signed out, and a 403 as refused with the email its problem names
- [ ] 15.8 A hosting error page in plain text reads as unexpected
- [ ] 15.9 With the phone offline, nothing is sent and the read is offline
- [ ] 15.10 A request that gets no answer reads as offline
- [ ] 15.11 An aborted read reads as offline

## 16. [unit] Slice 8 — What the screen shows, the balance

- [ ] 16.1 Before any answer, with nothing stored, the account screen is empty and has no menu
- [ ] 16.2 A signed-in user with a read balance gets the header, the menu and the list slot
- [ ] 16.3 A first read on an awake server, with nothing stored, shows the balance placeholder

## 17. [unit] Slice 8 — The balance header

- [ ] 17.1 The header shows "Na účtu máš" as the page's heading, the amount, the koruna value and the freshness line
- [ ] 17.2 The koruna value is spoken as `přibližně …`
- [ ] 17.3 The freshness line is announced politely when it changes

## 18. [wiring] Slice 8 — The balance on the screen

- [ ] 18.1 `Button`'s `secondary` and `ghost` variants and its leading icon; `BalanceHeader`; `Skeleton` (`balance`), as design.md D10 describes. Verify: lint, typecheck and the unit tests pass
- [ ] 18.2 `session.ts`: `unknown` becomes `unexpected` and `offline` (the existing sign-in behaviour unchanged); `balance.ts`, `format.ts` and `screenState.ts` as sketched. Verify: groups 14–16 pass; the existing frontend tests stay green
- [ ] 18.3 `useAccountScreen`, first part: `GET /api/me`, then the balance for a signed-in user. `AccountScreen` renders what `shown` says; `App` uses the hook; the freshness line re-renders every minute. Verify: the scenario runs against the app

## 19. [close] Slice 8 — The account screen shows the balance, its koruna value and when it was read

- [ ] 19.1 The scenario's test passes. Verify: green, including account-balance / The account screen shows the balance, its koruna value and when it was read

## 20. [unit] Slice 9 — Refresh

- [ ] 20.1 While a refresh reads, the header shows the balance in its refreshing state
- [ ] 20.2 "Obnovit" in the refreshing state reads "Obnovuji…", spins and ignores taps
- [ ] 20.3 A refresh asked for while a read is under way sends no second request

## 21. [wiring] Slice 9 — "Obnovit"

- [ ] 21.1 `useAccountScreen.refresh` (one read at a time) wired to "Obnovit". Verify: the scenario runs against the app

## 22. [close] Slice 9 — Tapping "Obnovit" reads the balance again

- [ ] 22.1 The scenario's test passes. Verify: green, including account-balance / Tapping "Obnovit" reads the balance again

## 23. [unit] Slice 10 — Refresh triggers

- [ ] 23.1 Coming back to the screen asks for a refresh
- [ ] 23.2 Leaving the screen asks for nothing
- [ ] 23.3 After the stop function, nothing asks for a refresh

## 24. [wiring] Slice 10 — Return to the app

- [ ] 24.1 `watchRefreshTriggers` (return only so far), started and stopped by `useAccountScreen`. Verify: the scenario runs against the app

## 25. [close] Slice 10 — Coming back to the app reads the balance again

- [ ] 25.1 The scenario's test passes. Verify: green, including account-balance / Coming back to the app reads the balance again

## 26. [unit] Slice 11 — Offline, nothing stored

- [ ] 26.1 With the phone offline, asking who is signed in sends nothing and reads as offline
- [ ] 26.2 Asking who is signed in with no answer reads as offline
- [ ] 26.3 A server error or a hosting error page to who is signed in reads as unexpected, not offline
- [ ] 26.4 Offline with nothing stored, the whole screen says so, with no header and no banner

## 27. [wiring] Slice 11 — The offline screen

- [ ] 27.1 `EmptyState` (title, sentence, icon; and the `note` variant), as design.md D10 describes; the offline screen in `AccountScreen`. Verify: the scenario runs against the app

## 28. [close] Slice 11 — Offline with nothing stored says the balance loads once online

- [ ] 28.1 The scenario's test passes. Verify: green, including app-shell / Offline with nothing stored says the balance loads once online

## 29. [unit] Slice 12 — The stored balance

- [ ] 29.1 With nothing stored, loading gives none
- [ ] 29.2 A stored balance loads back as it was stored
- [ ] 29.3 Storing replaces the balance stored before
- [ ] 29.4 A stored record of the wrong shape loads as none
- [ ] 29.5 A store that fails loads as none, and storing or forgetting into it does not throw
- [ ] 29.6 After forgetting, loading gives none
- [ ] 29.7 Offline with a stored balance, the screen shows its header, the offline banner and the note in the list's place
- [ ] 29.8 A warning banner is announced as a status, an error banner as an alert
- [ ] 29.9 A banner's action is a button under its text, and a loading action ignores taps

## 30. [wiring] Slice 12 — The stored balance offline

- [ ] 30.1 `storedBalance.ts` on `idb-keyval`, its own database and store (design.md D4); `useAccountScreen` loads it at start. Verify: group 29's storage tests pass
- [ ] 30.2 `Banner`'s info and warning tones, `action` and `icon` (design.md D10); the offline banner with "Zkusit znovu" and the note. Verify: the scenario runs against the app
- [ ] 30.3 Docs: ADR-0007, a dated note: the rate in the record, `idb-keyval`, no owner, no expiry, a failing store as none (deletion on 401/403 follows in slice 25). Verify: it matches design.md D4

## 31. [close] Slice 12 — Offline with a stored balance shows it with the offline banner

- [ ] 31.1 The scenario's test passes. Verify: green, including app-shell / Offline with a stored balance shows it with the offline banner

## 32. [wiring] Slice 13 — Keeping what was read

- [ ] 32.1 `useAccountScreen` stores the balance after every successful read. Verify: the scenario runs against the app

## 33. [close] Slice 13 — A balance read replaces the one the phone keeps

- [ ] 33.1 The scenario's test passes. Verify: green, including account-balance / A balance read replaces the one the phone keeps

## 34. [unit] Slice 14 — Back online

- [ ] 34.1 Coming back online asks for a refresh
- [ ] 34.2 Back online while who is signed in was unanswered asks it again, not the balance

## 35. [wiring] Slice 14 — Back online

- [ ] 35.1 `watchRefreshTriggers` gains the `online` event; `useAccountScreen` repeats what was under way, and the offline banner's "Zkusit znovu" does it at once. Verify: the scenario runs against the app

## 36. [close] Slice 14 — Coming back online loads what was waiting

- [ ] 36.1 The scenario's test passes. Verify: green, including app-shell / Coming back online loads what was waiting

## 37. [unit] Slice 15 — Waiting for the server

- [ ] 37.1 Under 1.5 s with a stored balance, the header shows it in its default state and the list slot is empty
- [ ] 37.2 From 1.5 s with a stored balance, the waking-up screen stands in the list's place
- [ ] 37.3 From 1.5 s with nothing stored, the waking-up screen is the whole screen
- [ ] 37.4 After a wake, the waking-up screen stays until the balance arrives, never a placeholder
- [ ] 37.5 The waking-up screen is announced as a status, and its bar stands still under reduced motion

## 38. [wiring] Slice 15 — The waking-up screen

- [ ] 38.1 `WakingUp` on Radix `Progress` (`value={null}`), as design.md D10 describes; the 1.5 s mark in `useAccountScreen`. Verify: the scenario runs against the app; the oxlint rule keeps Radix inside `src/components/`

## 39. [close] Slice 15 — A stored balance shows at once while the server wakes

- [ ] 39.1 The scenario's test passes. Verify: green, including app-shell / A stored balance shows at once while the server wakes

## 40. [close] Slice 16 — A sleeping server shows the waking-up screen after 1.5 seconds

- [ ] 40.1 The scenario's test passes, the balance taking the waking-up screen's place once the server answers. Verify: green, including app-shell / A sleeping server shows the waking-up screen after 1.5 seconds

## 41. [unit] Slice 17 — A slow wake

- [ ] 41.1 From 30 s, the waking-up screen is the slow one
- [ ] 41.2 The slow waking-up screen offers "Zkusit znovu" as a secondary button

## 42. [wiring] Slice 17 — Trying again

- [ ] 42.1 The 30 s mark; "Zkusit znovu" sends the first request again and starts the 30 s over, without reloading the page. Verify: the scenario runs against the app

## 43. [close] Slice 17 — A slow wake offers to try again after 30 seconds

- [ ] 43.1 The scenario's test passes. Verify: green, including app-shell / A slow wake offers to try again after 30 seconds

## 44. [unit] Slice 18 — The bank's failures on the screen

- [ ] 44.1 A bank failure keeps the balance shown and adds its banner
- [ ] 44.2 A new read clears the banner of the one before

## 45. [wiring] Slice 18 — The bank banners

- [ ] 45.1 The three bank banners with their wording (design.md D5); "Zkusit znovu" on "Banka teď neodpovídá" reads the balance again. Verify: the scenario runs against the app

## 46. [close] Slice 18 — A bank that does not answer shows a banner with a retry

- [ ] 46.1 The scenario's test passes. Verify: green, including account-balance / A bank that does not answer shows a banner with a retry

## 47. [close] Slice 19 — Too many refreshes shows a warning with no action

- [ ] 47.1 The scenario's test passes. Verify: green, including account-balance / Too many refreshes shows a warning with no action

## 48. [unit] Slice 20 — A bank failure with nothing to show

- [ ] 48.1 A bank failure with no balance to show gives the banner alone, without the header

## 49. [close] Slice 20 — Expired bank access asks to let Dad know

- [ ] 49.1 The scenario's test passes. Verify: green, including account-balance / Expired bank access asks to let Dad know

## 50. [wiring] Slice 21 — An unexpected answer to the balance read

- [ ] 50.1 "Zůstatek se nepodařilo načíst" / "Zkus to prosím za chvíli." with "Zkusit znovu", which reads the balance again (design.md D5). Verify: the scenario runs against the app

## 51. [close] Slice 21 — An unexpected answer to the balance read shows a banner with a retry

- [ ] 51.1 The scenario's test passes. Verify: green, including account-balance / An unexpected answer to the balance read shows a banner with a retry

## 52. [unit] Slice 22 — An unexpected answer to who is signed in

- [ ] 52.1 An unexpected answer to who is signed in gives the error banner, below a stored balance if there is one, and no menu

## 53. [wiring] Slice 22 — Asking again

- [ ] 53.1 "Zkusit znovu" after an unexpected answer to who is signed in asks it again; C6's empty frame on an error is gone. Verify: the scenario runs against the app

## 54. [close] Slice 22 — An unexpected answer to who is signed in shows a banner with a retry

- [ ] 54.1 The scenario's test passes. Verify: green, including app-shell / An unexpected answer to who is signed in shows a banner with a retry

## 55. [unit] Slice 23 — The 60 s limit

- [ ] 55.1 A refresh with no answer after 60 s ends as offline, the balance kept
- [ ] 55.2 The first load has no 60 s limit

## 56. [wiring] Slice 23 — The 60 s limit

- [ ] 56.1 The limit in `useAccountScreen`: `setTimeout` with an `AbortController` (design.md D3). Verify: the scenario runs against the app

## 57. [close] Slice 23 — A refresh with no answer for 60 seconds counts as offline

- [ ] 57.1 The scenario's test passes. Verify: green, including app-shell / A refresh with no answer for 60 seconds counts as offline

## 58. [wiring] Slice 24 — Forgetting on sign-out

- [ ] 58.1 After a sign-out the server confirmed, `useAccountScreen` forgets the stored balance before the sign-in screen shows. Verify: the scenario runs against the app

## 59. [close] Slice 24 — Signing out forgets the balance on the phone

- [ ] 59.1 The scenario's test passes. Verify: green, including account-balance / Signing out forgets the balance on the phone

## 60. [wiring] Slice 25 — Forgetting when the login has ended

- [ ] 60.1 A 401 or 403 to who is signed in or to a balance read forgets the stored balance. Verify: the scenario runs against the app
- [ ] 60.2 Docs: ADR-0007's note gains the deletion on 401 and 403 (extending item 4). Verify: it matches design.md D4

## 61. [close] Slice 25 — A login that has ended forgets the balance on the phone

- [ ] 61.1 The scenario's test passes. Verify: green, including account-balance / A login that has ended forgets the balance on the phone

## 62. [wiring] Slice 26 — A login that ends while the app is open

- [ ] 62.1 A 401 to a balance read shows the sign-in screen without the signed-out note; a 403, the no-access screen naming the account. Verify: the scenario runs against the app

## 63. [close] Slice 26 — A login that ends while the app is open shows the sign-in screen

- [ ] 63.1 The scenario's test passes. Verify: green, including sign-in / A login that ends while the app is open shows the sign-in screen

## 64. [unit] Slice 27 — A failed sign-out

- [ ] 64.1 With the phone offline, the sign-out sends nothing and fails as offline
- [ ] 64.2 A sign-out that gets no answer fails as offline
- [ ] 64.3 A sign-out the server answers with an error fails as not offline
- [ ] 64.4 A failed sign-out keeps the screen and the stored balance and gives its banner, offline or not

## 65. [wiring] Slice 27 — The failed sign-out

- [ ] 65.1 `SignOutFailed`; the "Odhlášení se nepovedlo" banner with its two sentences (design.md D6); the bare `return` in `App` is gone; the no-access screen's "Zkusit jiný účet" is unchanged. Verify: the scenario runs against the app; the existing sign-in scenarios stay green

## 66. [close] Slice 27 — A sign-out that fails offline says to try again online

- [ ] 66.1 The scenario's test passes. Verify: green, including sign-in / A sign-out that fails offline says to try again online

## 67. [close] Slice 28 — A sign-out the server fails says to try again later

- [ ] 67.1 The scenario's test passes. Verify: green, including sign-in / A sign-out the server fails says to try again later

## 68. [unit] Slice 29 — The busy menu item

- [ ] 68.1 While signing out, "Odhlásit se" shows a spinner beside its label and is marked busy
- [ ] 68.2 Selecting "Odhlásit se" while signing out keeps the menu open and calls nothing

## 69. [wiring] Slice 29 — The sign-out under way

- [ ] 69.1 `AccountMenu`'s `signingOut` (Radix `onSelect` with `preventDefault`), passed through `AppShell` from `useAccountScreen`; a tap outside closes the menu and the result still shows. Verify: the scenario runs against the app

## 70. [close] Slice 29 — The menu shows the sign-out under way

- [ ] 70.1 The scenario's test passes. Verify: green, including sign-in / The menu shows the sign-out under way

## 71. [unit] Slice 30 — Keeping the server awake

- [ ] 71.1 Coming on screen asks the health check at once
- [ ] 71.2 On screen, it asks again every 4 minutes
- [ ] 71.3 Off screen, it asks nothing, and asks at once on coming back
- [ ] 71.4 With the phone offline, it asks nothing
- [ ] 71.5 After the stop function, it asks nothing

## 72. [wiring] Slice 30 — The keep-alive

- [ ] 72.1 `keepServerAwake` and `pingServer`, started on every screen but the install hint. Vite's dev server forwards `/health` as it forwards `/api` (`vite.config.ts`). Verify: the scenario runs against the app; with `aspire start --isolated`, `GET /health` through the dev server answers `Healthy`
- [ ] 72.2 Docs: ADR-0006, a dated note: the keep-alive while on screen, why visible only, and that the first open after a quiet spell still waits about 20 s (#18). Verify: it matches design.md D9

## 73. [close] Slice 30 — The app keeps the server awake while it is on the screen

- [ ] 73.1 The scenario's test passes. Verify: green, including app-shell / The app keeps the server awake while it is on the screen

## 74. [unit] Slice 31 — The idle cap

- [ ] 74.1 After 30 minutes without a tap or key press, it stops asking
- [ ] 74.2 A tap after the stop asks at once and starts the 4-minute rhythm again
- [ ] 74.3 A key press counts as use, like a tap

## 75. [close] Slice 31 — The app lets the server sleep after 30 minutes without use

- [ ] 75.1 The scenario's test passes. Verify: green, including app-shell / The app lets the server sleep after 30 minutes without use

## 76. [close] Acceptance green

- [ ] 76.1 All acceptance tests of this change pass, and the full suite is green. That includes `dotnet format whitespace RevolutReader.slnx --verify-no-changes`, the frontend build, and the traceability check (every scenario claimed exactly once). Verify: the commands' output
- [ ] 76.2 The local check of design.md § Migration plan, step 2, with `aspire start --isolated`. Verify: each step seen, recorded in `.tdd-state.md`
- [ ] 76.3 Docs: the software-factory lessons of design.md § Cross-cutting effects, at the next free numbers. Verify: each names its full version where the project runs a cut-down one
- [ ] 76.4 `pm/progress.md`: the C7a row, with Q6 and Q10 marked as applied. `CLAUDE.md` checked against every command this change touched. Verify: the row links the change; `CLAUDE.md`'s commands run as written

## Workflow follow-up

A change's path after its `[close]` commit (workflow.md § 6, from #56):

- The push and a draft PR `feat: add the account balance (C7a)`, closing #41, on the owner's go, opened by Claude.
- The owner runs `/code-review xhigh --comment` on the PR.
- `/triage-review <PR>` works through the findings (testing.md § Code review after the apply). The test-writer's and implementer's agent IDs in `.tdd-state.md` must be current, because its fix round resumes them.
- Archive with `/opsx:archive` on the branch, before the merge. The traceability check must pass first.
- The owner marks the PR ready and squash-merges it. C7b rebases on it afterwards (roadmap § Working in parallel, item 4).
- After the merge (design.md § Migration plan, step 4):
  - the deploy and its checks;
  - the balance at the production address;
  - the owner's one comparison with the Revolut app;
  - C12's ready queries against the first real bank lines;
  - the keep-alive on Azure.

  Findings go into `pm/progress.md`, through a small docs PR if they come after the archive.
