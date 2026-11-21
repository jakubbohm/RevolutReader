# Proposal: c016-add-push-arrival-reports

## TL;DR

- **What:** each device reports to the server when a push about the account reaches its service worker, and the server logs how many seconds after the bank read that was. The owner reads it for 1–2 weeks per account and device, to measure whether iOS holds the balance notifications (it held two for about an hour on 2026-11-21) before a fix is chosen. Frontend and API. A failed report is ignored; it never stops the notification or the kept balance.
- **Out of scope:** the fix itself (an issue of its own, with the data); whether the reports stay after it (decided there); any change to the notification's text, recipients or the check; reacting to a refused report.
- **Riskiest assumption:** that the iPhone's service worker, run in the background for a mutable push, can send a same-origin request with the app's login cookie before iOS ends it, also to a sleeping server. The manual row after the deploy is the first proof. Known cost: on the iPhone the notification shows once the report's request has ended (design.md D5).
- **Scenarios added** (`push-arrivals`, new): A push with a balance reports its arrival with the balance's read time (frontend) · A push with a balance reports its arrival on a phone that keeps no balance (frontend) · A push without a balance reports nothing (frontend) · A push with a balance of the wrong shape reports nothing (frontend) · A failed report still keeps the push's balance (frontend) · A failed report still shows the notification (frontend) · The notification is shown without waiting for the report (frontend) · A report records how long the push took to arrive · A report whose read time lies ahead records 0 seconds · A report without a read time is refused and records nothing · A payment's notification on the iPhone is reported within seconds (manual)

## Why

GitHub issue [#91](https://github.com/jakubbohm/RevolutReader/issues/91), use case **UC3** (kickoff ch. 5). This is not a roadmap step: since 2026-11-21 the owner tracks work after the initial development as GitHub issues only (§ What Changes, housekeeping).

On 2026-11-21, the first day after C9a's and C9b's deploys, most balance notifications reached the owner's iPhone within seconds of Revolut's own. Two were held by iOS for about 64 and 80 minutes and then appeared together with the next one. The server did its part every time: the check ran within a minute, and Apple accepted each push (`201`) in under a second. A plain test message (no `mutable`) sent in between arrived at once. The issue's reading, an inference not documented by Apple: the balance notifications are *mutable* Declarative Web Pushes (c014 design.md D14), so iOS starts the app's service worker before showing one, and when it does not let the worker run, it seems to hold the notification instead of showing the proposed one.

The daughter's phone is the one that matters, and nobody can watch it. So before choosing a fix, the app measures: for every balance notification, how long after the bank read it reached each device, for both allowed accounts. The owner watches for 1–2 weeks; the fix is then chosen with the data, in an issue of its own.

The decisions R1–R7 in #91 were Claude's defaults; the owner confirmed them one at a time at this propose (2026-11-21), with one correction found here: on the iPhone, a report the service worker waits for delays the notification until its request ends (design.md D5). This change is proposed directly from them, and its design.md becomes their home.

## What Changes

- **The service worker reports each arrival** (design.md D1, D2, D5): a push whose balance has the right shape (C9b's `pushedBalance`) also sends one report to `POST /api/push/arrivals`, carrying only the balance's `readAt` as the push gave it. It reports whether or not the phone keeps the balance, in every browser; a push without a balance (the owner's test messages) or with one of the wrong shape reports nothing. The report runs under the push event's `waitUntil`, beside the balance write; a failure is ignored and never retried.
- **The API records the delay** (D3, D4): a new endpoint for allowed, signed-in users answers 204 and logs one line, `PushArrived`, with the delay in whole seconds against the server's own clock (rounded down, never below 0). A body without a readable `readAt` answers 400 and logs nothing. The line holds no amount and no read time; since C14 its request carries the account, and the request's browser and OS tell the device.
- **Ready queries** (D6) in `docs/operations/deployment.md` § The account check: every report per account and device with its Prague time and delay; a summary per Prague day, account and device (count, median, maximum); every notification the server sent with the reports belonging to it, so a device that did not report stands out; and every notification with the requests each device made in the seconds after it, since an app loaded in the background marked most notifications not shown at once (#91's evening findings). A report's delay is when the worker ran, not necessarily when the notification appeared (design.md D2).
- **The API client is regenerated** for the new endpoint; the service worker imports its types only, never the client (c015 design.md D5).
- **One manual row** on the owner's iPhone after the deploy: a payment's notification, and its report in the query with a delay of seconds.
- **Housekeeping** (from #91): a software-factory lesson (iOS may hold mutable Declarative Web Pushes; measure delivery on the device; a service worker's network work delays Safari's proposed notification) and ADR-0010 § Notes; the owner's decision of 2026-11-21 that work after the initial development is a GitHub issue only, with no roadmap step, in CLAUDE.md § Project management and workflow.md § 9.

## Capabilities

### New Capabilities

- `push-arrivals`: a device reporting each push that brings a balance, the server recording how long after the bank read it arrived, and what never depends on the report (the notification and the kept balance).

### Modified Capabilities

- None. `push-display` keeps its requirements as they are: the report sits beside the balance write in the same push handler, and its rules live in `push-arrivals` so the fix's issue can keep or remove them as one capability (design.md D8).

## Non-goals

- **The fix** for held notifications (plain declarative pushes, the balance carried another way, or nothing): an issue of its own, chosen with this data (#91 § Afterwards).
- **Whether the reports stay after the fix** (R7): built to stay, with no switch and no end date; the fix's issue decides, since a fix without `mutable` would stop the iPhone's reports altogether (design.md D9).
- **The phone's own clock:** the server measures with its own (R2).
- **A report that outlives the service worker** (`keepalive`, no `waitUntil`): not chosen, since iOS may stop the worker before the request leaves (design.md D5).
- **Reacting to a refused report:** a 401 or 403 to the report changes nothing on the device; the next opening handles an ended login as today (c013, c015 design.md D7).
- **Linking a report to its push exactly:** no identifier and no read time in the log; a report is matched to its notification by time (design.md D4, D6).
- **The leftover registration of a removed Home Screen install** (#91 § Related finding): possibly an issue of its own.
- **Any change to the check, the notification's text or recipients, settings, secrets, the AppHost or Bicep.**

## Impact

- **Frontend:** `src/app/pushDisplay.ts` (the push listener sends the report; the worker's scope gains `fetch` in its small interface); a new `src/app/arrivalReport.ts` (the report itself, never rejects). `src/api/schema.d.ts` regenerated. No new package, no screen change.
- **API:** `src/RevolutReader.Api/Push/`: the endpoint, its request, a pure delay rule and a log line in `PushLog`. `openapi.json` regenerated. Since the review, `src/RevolutReader.Api/SignIn/SignInRegistration.cs`: a report never renews the login (design.md D3). No new setting, secret or table.
- **Tests:** frontend scenarios in `src/scenarios/push-arrivals.test.ts`, the service-worker stand-in gains `fetch` (to the fake server); API scenarios in `Scenarios/PushArrivals/`, with a driver reading the app copy's `PushArrived` lines; a telemetry guard in `Conventions/`; unit tests for the delay rule; one manual row.
- **Docs:** deployment.md (the queries), ADR-0010 § Notes, testing.md (the stand-in's `fetch`, the arrival lines as a scenario's channel), lessons.md, CLAUDE.md § Project management, workflow.md § 9.
- **No change** to the AppHost, settings, secrets, Bicep or the design system.
