# Proposal: c017-add-daily-koruna-rate

## TL;DR

- **What:** the koruna value next to every euro amount uses the Czech National Bank's (CNB) daily rate instead of the constant 24.3 from 2026-11-08 ([#39](https://github.com/jakubbohm/RevolutReader/issues/39)). The server keeps the CNB's latest rate in one table row. From 08:00 UTC on the next weekday it asks the CNB again, on every request and alongside the bank read, with a 2 s limit, until a rate for a newer day comes. A failed ask leaves the kept rate. With nothing kept yet, it falls back to the code's own rate, 24.47 for 2026-11-20. Server only: the API contract, the frontend and the design stay as they are.
- **Out of scope:** naming the CNB as the source (a private app, the owner's choice); each transaction at its own day's rate; a scheduler; Czech holidays; summer time; a currency converter (#9).
- **Riskiest assumption:** that the CNB's API keeps the JSON shape and keyless access verified on 2026-11-21. If it changes, the app quietly keeps its last rate and logs a warning per request.
- **Scenarios added** (`koruna-rate`): Monday's rate replaces Friday's and is not asked for again that day · A rate for an earlier day than the kept one is ignored · Friday's rate is not asked for again over the weekend · From 08:00 UTC on Monday every request asks until Monday's rate comes · A CNB that answers with an error leaves the kept rate · A CNB that does not answer within 2 s leaves the kept rate · With no rate kept and the CNB failing, the app's own rate of 24.47 is answered
- **Modified:** `account-balance` · The balance comes with the time it was read and the koruna rate; `account-transactions` · The newest transactions come live with the koruna rate; `account-check` · Money out is notified with the new balance · Money in is notified with the new balance · The notification carries the new balance for the phone to keep (kept unchanged: An unchanged balance sends nothing)

## Why

Issue [#39](https://github.com/jakubbohm/RevolutReader/issues/39). Work after the initial development, so it has no roadmap step: the issue is its only tracker (`CLAUDE.md` § Project management). It touches **UC2** (the balance and the transactions with their koruna values, kickoff ch. 5) and **UC3** (the notification's koruna value).

Since C13 (2026-11-08) the server answers a constant, 24.3 CZK per euro, dated 2026-11-08. On 2026-11-21 the CNB's rate is 24.47 (valid for 2026-11-20): the screen's koruna values are 0.7% low, about 48 Kč on a balance of 286.40 €. The transaction sheet also keeps saying "orientační kurz z 8. 11. 2026", a date that only gets older. Every behaviour was decided with the owner in this change's explore (2026-11-21), and design.md is their home.

## What Changes

- **The rate comes from the CNB** (design.md D1, D6): its public JSON API, `GET https://api.cnb.cz/cnbapi/exrates/daily`, keyless and free. The euro's `rate / amount`, with the day the CNB gives it for (`validFor`, which on a weekend is Friday's). The sheet's "orientační kurz z …" then shows the CNB's day.
- **It is kept** (D2): one row in a new table, so it outlives the app's sleep. It is replaced only by a rate for a later day.
- **When the CNB is asked** (D3, D4): not before 08:00 UTC on the first weekday (Monday to Friday) after the kept rate's day. From then on every request that answers a rate asks, alongside its own bank or storage read, until a rate for a newer day comes. Requests arriving together share one ask, and each ask has a 2 s limit. Czech holidays are not told apart.
- **When the CNB fails** (D5, D6): no answer within 2 s, a network error, any status but 200, or an answer without a readable euro rate. The answer carries the kept rate, the request never fails because of the rate, and nothing is retried: the next request asks again. A rate for an earlier day than the kept one is ignored.
- **With nothing kept** (D5): when the first ask after the deploy fails, the answer carries the code's own rate, 24.47 CZK per euro for 2026-11-20 (the CNB's latest when this change was proposed), never written to the table.
- **Logs** (D7): one Information line per new rate kept, one Warning per failed ask with its kind. Nothing for an ask that returns the rate already kept.
- **The three answers that carry a rate** (D8): `GET /api/balance` and the account check through `ReadBalanceHandler`, and both transaction pages. Their fields and shapes stay as they are. **Modifies** the scenarios of `account-balance`, `account-transactions` and `account-check` that pin 24.3 or 2026-11-08: each now states the CNB's rate it expects.
- **Records** (D11): ADR-0011-koruna-rate (an outside service and its terms, workflow.md § 2), testing.md (the fake CNB, scenarios on a weekday), configuration.md, deployment.md, a software-factory lesson.

## Capabilities

### New Capabilities

- `koruna-rate`: the euro's rate in koruna that the app converts with: where it comes from, how it is kept, when the CNB is asked again, what a failed ask leaves, and the app's own rate when nothing is kept.

### Modified Capabilities

- `account-balance`: "The API reads the balance live" names `czkPerEur` as the rate of spec koruna-rate, and its scenario states the CNB's rate it expects.
- `account-transactions`: "The API answers the newest transactions live" names `czkPerEur` and `rateDate` as the rate and day of spec koruna-rate, and its scenario states the CNB's rate and day it expects.
- `account-check`: "A change since the last notification is notified" and "The notification carries the new balance" name the rate of spec koruna-rate, and their scenarios state the CNB's rate they expect.

## Non-goals

- **Naming the CNB as the rate's source.** The CNB's terms ask for "Source: the CNB". The owner chose not to, since the app is private (explore, 2026-11-21; ADR-0011). So no design change.
- **Each transaction at its own day's rate.** Every answer carries one rate, today's, as it does now.
- **A scheduler or a fetch at start.** No clock exists, and a start must not depend on an outside service.
- **Czech public holidays.** On one, the app keeps asking and keeps getting the previous rate.
- **Summer time.** 08:00 UTC is 9:00 in Prague in winter and 10:00 in summer, which starts after the planned operating period.
- **An explicit check against the real CNB** (the owner): the fake's answer is a copy of the real one, and the deployed app is looked at after the deploy.
- **A currency converter** ([#9](https://github.com/jakubbohm/RevolutReader/issues/9)), which could later reuse this rate.

## Impact

- **Backend:** a new `Rate/` folder: the rate value with the app's own fallback, the service that keeps and refreshes it, the rule for when to ask, the CNB client and its settings, the kept rate's port, and the log lines. The kept rate's Table adapter goes in `Storage/`. `Account/KorunaRate` (the constant) is removed. The three account handlers take the rate from the service. `Program.cs` registers it, and `appsettings.json` gains the `Cnb` section (the address and the 2 s limit) and the `KorunaRates` section (the table's name).
- **API contract:** none. Fields, types and descriptions stay, so `openapi.json` and `schema.d.ts` are not regenerated.
- **Frontend and design:** none.
- **Infrastructure:** `infra/platform.bicep` gains the `korunarates` table, under the app's existing table role on the storage account. No new role, secret or setting in Azure.
- **Outside service:** the app calls `api.cnb.cz` over HTTPS, outbound only, at most once per request while a newer rate may be due.
- **Tests:** a fake CNB on loopback for every acceptance app copy (so no test reaches the real CNB); a table of each app copy's own for the kept rate; a scenario calendar step that moves the clock to a named weekday and time; the kept rate's contract tests on Azurite; the integration tests' made-up settings point the CNB at an unreached loopback port.
- **After c016:** c016 merged as #92, and `main` was merged into this branch before the apply (design.md D12).
