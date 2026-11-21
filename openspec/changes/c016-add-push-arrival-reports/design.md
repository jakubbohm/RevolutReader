# Design: c016-add-push-arrival-reports

## TL;DR

- **The service worker reports each arrival** (D1, D2): a push whose balance passes C9b's shape check also sends `POST /api/push/arrivals` with only `{ readAt }`, as the push gave it, whether or not the phone keeps the balance; no balance, no report. It runs under the push event's `waitUntil`, beside the balance write, never rejects and is never retried (D5).
- **On the iPhone the notification waits for the report** (D5, the owner's choice of 2026-11-21): Safari shows its proposed notification once all `waitUntil` work has settled, so it shows after the report's request ends: a fraction of a second on time; for a push iOS held, up to the server's ~20 s wake-up or iOS's own limit. Fire-and-forget was weighed and not chosen: iOS may stop the worker before the request leaves.
- **The server records the delay** (D3, D4): the endpoint, for allowed signed-in users, answers 204 and logs `PushArrived` with `DelaySeconds`, the server's own time minus `readAt`, rounded down, never below 0; a missing or unreadable `readAt` answers 400 and logs nothing. The line holds no amount and no read time; the request carries the account (C14) and the device (its browser and OS).
- **The owner reads it** through four ready queries in deployment.md (D6): every report per account and device, a daily summary (count, median, maximum), every notification sent with the reports belonging to it, and every notification with the requests each device made in the seconds after it (an app loaded in the background, a second signal). The delay is when the worker ran, not necessarily when the notification appeared (D2).
- **New public interfaces:** `POST /api/push/arrivals` (in the API description); `ArrivalReportEndpoint`, `ArrivalReportRequest`, `RecordArrivalHandler`, `ArrivalDelay`, `PushLog.PushArrived`; `reportArrival` in the new `src/app/arrivalReport.ts`; `PushWorker` gains `fetch`. DSL `ArrivalDsl`, driver `ArrivalDriver`.
- **Integration points:** C9b's push handler and shape check; C14's account on request telemetry; the generated API client (types only in the worker, c015 D5); Application Insights. No setting, secret, table, AppHost or Bicep change.
- **Hard to reverse:** little. The address and the field name are read by every installed service worker until it updates (a revert's 404s are harmless). Kept after the analysis unless the fix's issue removes it (D9).

## Context

- See proposal.md § Why. The decisions R1–R7 in [#91](https://github.com/jakubbohm/RevolutReader/issues/91) were Claude's defaults; the owner confirmed them one at a time at this propose (2026-11-21), and this design copies each, citing its label, and is their home from now on. Details settled while writing it are marked *(propose)*.
- **What merged before**, read 2026-11-21 on `main` at `cb305f8`: nothing contradicts #91. What this change builds on:
  - **C9b's push handler** (c015 design.md D2–D5, `src/app/pushDisplay.ts`): `pushedBalance(event)` takes `balance` from the proposed notification's `data`, else from the push's JSON, and keeps it only when `balanceOf` gives one, a record of `amount`, `readAt` (the push's string, unchanged) and `czkPerEur`. The listener puts `keepPushedBalance` under `event.waitUntil` first, then, in the same turn, leaves the browser's proposed notification alone or shows the message itself. The module compiles under `DOM` and `WebWorker` and imports nothing that needs `window` (D5 there).
  - **What Safari does with `waitUntil`** (c015 design.md D4, from the [W3C Push API draft](https://w3c.github.io/push-api/), read 2026-11-21): for a mutable declarative push it shows the proposed notification once the event's `waitUntil` promises have settled and the handler showed none ("To fire a push event", step 3.1; "Receiving a push message", step 5.5), and also when one rejects (step 3.2). WebKit's post: "If the event handler fails to display a replacement notification in time, the fallback is used", with no duration ([Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)).
  - **The account check's pushes** (c014 design.md D10, D14): every notification carries `balance` = *last seen*, whose `readAt` is the check's bank read, about 1–2 s before the push goes out; a check whose own read fails can still send a change an earlier check kept, with that earlier `readAt`. The check logs `CheckEnded` and `ChangeSent` (D15 there: never an amount, a balance, a time read, an email address or a key).
  - **User endpoints** (c011 design.md D9, `SubscriptionEndpoint`, `ForgetSubscriptionEndpoint`): the default policy `AllowedUser` (401 without a login, 403 for an account not on the allowlist, before the endpoint runs), the cross-site write rule (`CrossSiteWrites`: `Sec-Fetch-Site` `same-origin` or `none` passes), `Accepts<T>(JSON)` (a request without a JSON body gets the catch-all's 404), optional request members so a missing one is the endpoint's refusal naming it, FastEndpoints' errors as problem descriptions (`Errors.UseProblemDetails`).
  - **The login cookie** `__Host-session` is `SameSite=Lax` (c007), so a same-origin request carries it.
  - **Telemetry** (ADR-0009, C14): every API request of an allowed signed-in user carries its email in `UserAuthenticatedId`; request telemetry keeps the browser; a log line joins its request through `OperationId`. deployment.md's queries print Prague times as plain text.
  - **The server sleeps** about 8 minutes after its last request and wakes in about 20 s (ADR-0006; C7a's after-merge note).
- **No design board:** nothing on any screen changes, so the design system and the Screens design are not involved.

## Goals / Non-Goals

**Goals:**

- The 11 scenarios (§ How each scenario is verified).
- A delay per notification, account and device that the owner can read for 1–2 weeks without help, including which device did not report.
- Nothing about the report can stop the notification or the kept balance.

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- **No exact link between a report and its push:** no identifier is added to the push, and no read time is logged (D4); the queries match by time (D6).
- **No retry, no queue of unsent reports** on the phone.
- **No limit of our own on the report's request** (D5).

## Decisions

### D1 — What reports, and when (R1)

- **A push reports when `pushedBalance` gives a balance:** exactly the pushes whose balance passes C9b's shape check, which today are the account check's notifications. A push without a balance (the owner's test messages) or with one of the wrong shape reports nothing.
- **Independent of the balance write** (the owner, 2026-11-21): the report does not depend on whether `keepPushedBalance` replaces the kept balance. A phone that keeps none, or keeps a newer one, still reports, so a report means only this: the service worker ran for this push.
- **Every browser:** where the browser shows its own notification (Safari on the iPhone) and where the service worker shows it (Chrome on a computer). The desktops are the control: they get the same push at once.
- **One report per push event.** On the iPhone a report can only come from a run of the worker, so a notification the server sent with no report from a device is itself a signal: iOS did not run the worker for it (or the report failed, § Risks). The third query (D6) shows it.

### D2 — What the report carries (R2)

- **Only `readAt`, as the push gave it** (`balanceOf` keeps the string unchanged), never the amount or the rate. Body: `{ "readAt": "2026-11-21T09:14:03.5123456+00:00" }`.
- **The server's clock measures** (D4): the delay is its own time when the report arrives minus `readAt`, so the phone's clock plays no part.
- **Reading the numbers** (recorded for the queries, D6):
  - **A sleeping server adds its wake-up.** A push iOS held for an hour reports to a server that went to sleep, so its delay includes about 20 s of wake-up; next to an hour that is noise. An on-time push always finds the server awake (the check ran a second earlier), so the wake-up never makes an on-time push look held.
  - **An older `readAt`, rarely:** a check whose own bank read fails sends a change an earlier check kept (c014 D10, item 4), with that earlier read's time; its delay looks longer by the gap. Its `CheckEnded` says `BankReadFailed`.
  - **The delay is when the worker ran, not necessarily when the notification appeared** (added at the apply, the owner, 2026-11-21): whether iOS can run the worker on time and still hold the notification is not known. #91's evening findings hint that it may get a run while holding one (an app loaded in the background 1–2 s after 3 of 4 notifications not shown at once). If it can, a held notification reports a delay of seconds. So the delays are read beside what the phone showed and beside the fourth query (D6). Whether the phone was in use is not in the data at all; the owner's notes are its only source. The first held notification after the deploy settles it: a report with seconds, a report with the hold, or none.
  - **`readAt` names the push:** every account's copy of one notification carries the same value. It is not logged (D4), so the queries group by time instead.
- **Not chosen:** the phone also sending its own arrival time. It would separate "the worker ran late" from "the report took long to reach the server", but adds a field, and the question (an hour against seconds) does not need it.

### D3 — The endpoint (R3)

- **`POST /api/push/arrivals`**, body `{ "readAt": … }`, answering **204** with no content. `ArrivalReportEndpoint`, beside the other push endpoints, in the pattern of `ForgetSubscriptionEndpoint`.
- **Allowed, signed-in users only:** no `AllowAnonymous`, so the default policy answers 401 and 403 before the endpoint runs, and C14 records the account on the request. Not on the anonymous-endpoint list (`AnonymousEndpointsTests` keeps it so).
- **A report the server cannot read** answers **400** with FastEndpoints' validation problem (`Bad Request`) and logs nothing (the owner, 2026-11-21: the API's usual answer, and a broken worker then shows in the request telemetry, where a silent 204 would hide it):
  - *(propose)* **`readAt` missing or `null`:** `ArrivalReportRequest.ReadAt` is optional (`DateTimeOffset?`), as `SubscriptionRequest`'s members are, so a missing one reaches the endpoint, which refuses it naming `readAt` (`AddError`, `Send.ErrorsAsync`, as `SubscriptionEndpoint` refuses), and never becomes `0001-01-01`, a delay of two thousand years.
  - **`readAt` not a date and time** (e.g. `"yesterday"`): FastEndpoints cannot bind it and answers the same 400 problem before the endpoint runs (`Errors.UseProblemDetails`; spec api-errors). No test pins this for a JSON body yet, so a wiring edge test does (D7).
  - A request without a JSON body gets the catch-all's 404, as for the other endpoints with a body (c011 D9).
- **The cross-site write rule applies** and lets the worker's request through: a service worker's request to its own origin carries `Sec-Fetch-Site: same-origin`.
- **The login cookie travels** (`SameSite=Lax`, same origin, the request's `credentials: "same-origin"`). **One assumption only the iPhone can prove:** that the Home Screen app's service worker uses the app's own cookie store, where the login lives. If it does not, every iPhone report gets a 401, visible at once in the request telemetry as 401s on this address, and the manual row fails (§ Risks).
- **In the API description**, like the other user endpoints: `Accepts<ArrivalReportRequest>(JSON)`, 204, 400, 401 and 403 (`RefusedProblem`). The client is regenerated, so `src/api/schema.d.ts` gives the worker the body's type; the worker imports that type only, never the client (c015 D5).
- **Not scenarios:** the 401 and 403 (#91's scenario 7). Sign-in's "Only allowed accounts use the API" covers every API address, and the push endpoints have no per-endpoint scenario for it either; `AnonymousEndpointsTests` keeps this one off the anonymous list.

### D4 — The log line (R4)

- **One line per report,** `PushLog.PushArrived`, at Information: "A push reached a device {DelaySeconds} s after its balance was read". Nothing else: no amount, no read time, no push address, no account.
- **The delay** (`ArrivalDelay.Seconds(readAt, now)`, pure): `now − readAt` in whole seconds, **rounded down, never below 0** (the owner, 2026-11-21). `now` comes from `TimeProvider`. A negative delay can only come from a broken or forged `readAt`, or a split-second clock difference between two app copies during a deploy; clamped, the latter reads as 0. *(propose)* A `long`, so any `DateTimeOffset` fits.
- **c014 design.md D15 is unchanged:** no line holds a time read. The delay together with the line's own timestamp gives `readAt` to the second; that is accepted (the owner, 2026-11-21), because a read time is the server's own clock, not bank data in CLAUDE.md's sense (balances, amounts, counterparties, transaction texts, account identifiers), and the telemetry already shows it: every check is a `POST /api/account/check` request with its own time.
- **Who and which device come from the request:** C14's account (`UserAuthenticatedId`) and the request's browser and OS (`ClientBrowser`, `ClientOS`), joined to the line through `OperationId` (D6).
- **The guard** *(propose)*: `Conventions/PushArrivalTelemetryTests` captures every line the app copy writes while an allowed user reports, and finds no `readAt` in any written form (the ISO text as sent, its date and time in UTC and in Prague time) and no email address of the allowlist; it first checks that the `PushArrived` line was written.
- **Not chosen:** logging `readAt` (exact grouping per push, but it reverses D15's rule for a convenience the time match gives anyway); the delay as a tag on the request's activity, so one `AppRequests` row would hold account, device and delay (it departs from the log-line pattern and its guards, for a join the query does in one line).

### D5 — Never stopping the notification, and why it waits on the iPhone (R5)

- **The listener's order** *(propose)*, all in the same turn: `const balance = pushedBalance(event)`; when there is one, `event.waitUntil(keepPushedBalance(balance))` and `event.waitUntil(reportArrival(worker, balance.readAt))`; then, as before, nothing more with the browser's proposed notification, or `showNotification` under its own `waitUntil`.
- **`reportArrival` never rejects** (offline, 401, 403, 5xx, an answer of any kind), ignores the answer and is **never retried**. *(propose)* No `AbortSignal` and no `keepalive`.
- **Where the service worker shows the message** (Chrome on a computer), it shows it at once, beside the report: the notification never waits for it.
- **Where the browser shows its own** (Safari, § Context), the notification waits for the report's request (a correction found at this propose; #91's R5 said "never delays"):
  - **on time:** the server is awake, so a fraction of a second;
  - **a push iOS held:** the server is likely asleep, so up to its ~20 s wake-up, or less when iOS's own time limit runs out first; iOS then shows the notification anyway and may end the worker, and the report with it;
  - **offline:** the request fails at once, no wait.
- **The observer effect is larger than "a little":** a worker waiting for a sleeping server is longer background work, with some chance of changing what iOS does (§ Risks).
- **Chosen: A, under `waitUntil` with no limit of our own** (the owner, 2026-11-21): every report that can reach the server does, the wait is short when on time, and it only adds to a push that is already late.
- **Not chosen:**
  - **B, a limit of our own** (e.g. 3 s): the notification waits at most that long, but a report to a sleeping server is cut off, losing exactly the held pushes' reports.
  - **C, not under `waitUntil` ("fire and forget", `void fetch(…)`)**, asked about by the owner: the notification never waits, but iOS may stop the worker right after the balance write (milliseconds), before a new connection is even made. The [Fetch Standard](https://fetch.spec.whatwg.org/)'s `keepalive` lets a request outlive its global, but whether WebKit honours it in a background service worker is undocumented ([WebKit bug 202142](https://bugs.webkit.org/show_bug.cgi?id=202142) and [commit ff2e4e4](https://github.com/WebKit/WebKit/commit/ff2e4e4e8cb42ef46e35ac2e45a86f6143cd0a20) on stopping workers do not answer it; searched 2026-11-21). A missing report would then mean nothing, and the held pushes' reports, which meet a sleeping server, would be the most at risk.

### D6 — The queries (R6)

- **In `docs/operations/deployment.md` § The account check,** a new subsection "Push arrivals (c016)" after "The checks and what they came to", in its style: PowerShell 7, read-only, Prague times as plain text (`format_datetime`), the period in UTC.
- **The device is the request's browser and OS** (`ClientOS`, `ClientBrowser`), as § Requests per account uses them, so the owner's iPhone and desktops stay apart (the owner, 2026-11-21: grouping by account alone would mix the iPhone's held pushes with the desktops' on-time ones).
- **Four queries** (the fourth added at the apply, the owner, 2026-11-21, after #91's evening findings):
  1. **Every report:** Prague time, account, device, `DelaySeconds`, newest first (`AppTraces` with the `PushArrived` line, joined to `AppRequests` on `OperationId`).
  2. **Per Prague day, account and device:** reports, median and maximum delay.
  3. **Per notification:** every `ChangeSent` line (Prague time), with the reports belonging to it: those whose time minus their delay falls within about 30 s before the `ChangeSent` *(propose: the read precedes the send by 1–3 s)*, each with account, device and delay. A notification with no report from a device stands out (D1). A notification sent from an older read (D2) matches nothing and shows as unreported; its `CheckEnded` says `BankReadFailed`.
  4. **Per notification, the requests each device made from 2 s before to 10 s after it**, besides the check and the report: an app the iPhone loaded in the background, as an opening does, though nobody opened it. #91's [evening findings](https://github.com/jakubbohm/RevolutReader/issues/91#issuecomment-7066364366) saw such a load after 3 of the day's 4 balance notifications not shown at once and after none of the 3 on time; run read-only on that day's data, the query listed exactly those. A second signal beside the reports (D2), not proof: a tap that opens the app looks the same.
- **Written from the code, confirmed on the first real report** (the manual row), as C9a's and C14's were; corrected then if a column differs (e.g. the device from `Properties`' `user_agent.original` if `ClientOS` is empty for the worker's request).
- **Notes beside them:** the reading of D2 (wake-up, older reads) and #91's caveats: a missing report is not a missing notification (offline, a login that ended); on iOS a plain push (the owner's test messages) never reports; the report itself is a little more background work (D5).

### D7 — Tests *(propose)*

- **Frontend:** `src/scenarios/push-arrivals.test.ts`, feeding `listenForPushes` a push through the service-worker stand-in, as C9b's do (`pushWithBalance`).
  - **The stand-in gains `fetch`** (the test-writer's, `src/test/serviceWorker.ts`): it hands the request to the fake server (`globalThis.fetch`, installed by `setup.ts`), so a report shows in the timeline and in `bodiesSent()`. The scenarios that read reports start the stand-in on the page's origin (its `origin` option) or the fake server learns the worker's; the test-writer's choice.
  - **The fake server** (`src/test/server.ts`, a block marked "c016") answers `POST /api/push/arrivals` with 204 by default, or any `Trouble` (`server error`, `no connection`, `no answer yet`).
  - **"Without waiting"** is tested as C9b's unit test "The message is shown without waiting for the balance to be written" is: the delivery is not awaited while the report's answer is held, and the shown notification is read meanwhile.
- **API:** `Scenarios/PushArrivals/PushArrivalsScenarios.cs`.
  - **The record is this capability's public channel:** the owner reads arrivals only through the telemetry (D6), so the scenarios read the `PushArrived` lines of the app copy, as the `Conventions/` guards capture them (a logger provider in its container, event name and structured values). testing.md says so.
  - **`Drivers/ArrivalDriver`:** posts through the signed-in test browser, as `PushDriver` registers a device; writes `readAt` relative to the app copy's `FakeTimeProvider` (75 s earlier, 30 s ahead) as System.Text.Json writes a `DateTimeOffset`; a body without `readAt`; reads the recorded delays.
  - **A wiring edge test** (`IntegrationTests/Wiring/Push/`, the implementer's, after the implementation): a body whose `readAt` is `"yesterday"` answers 400 `Bad Request` as `application/problem+json` and logs no `PushArrived` (D3).
- **Unit tests:** `ArrivalDelay` (rounded down, clamped at 0, exactly 0, an hour, the extremes of `DateTimeOffset`); `reportArrival` (one POST to the worker's origin, JSON with only `readAt`, same-origin credentials; resolves on a failed request, on 401, 403 and 5xx; never sends twice); the listener (both browser kinds; the report from the proposed notification's data and from the push's JSON; the report under `waitUntil`; nothing reported for a push the browser proposes without a balance).
- **Green from the start:** five frontend scenarios pass before any code exists, because nothing reports yet: "A push without a balance reports nothing", "A push with a balance of the wrong shape reports nothing", "A failed report still keeps the push's balance", "A failed report still shows the notification" and "The notification is shown without waiting for the report". They are guards, accepted at the acceptance gate as such, and each is proven by a mutation at its slice's `[close]` (a report for every push; a report that rejects; a report awaited before the balance write or the message), as C9b's were (c015 D8).

### D8 — One new capability, `push-arrivals` *(propose)*

- **Why not `push-display`,** where #91's guide put the frontend scenarios: the report's rules span the device and the server, read best in one place, and the fix's issue may keep or remove them as one capability (D9). `push-display` keeps its requirements unchanged; the report sits beside the balance write in the same handler.

### D9 — Kept after the analysis (R7)

- **Built to stay:** no switch and no end date (the owner, 2026-11-21). Keeping it costs the iPhone's short wait (D5) and a little background work; the telemetry is a few lines a day, far inside the daily cap (ADR-0009 item 5).
- **The fix's issue decides keep or remove,** with this point: a fix that drops `mutable` (#91 § Afterwards, option 1) means iOS never runs the worker for a balance notification, so the iPhone sends no reports at all and only the desktops still report. When that issue is written, it names the question.

### D10 — Scenarios, and what #91's guide became *(propose)*

| #91's guide | Here |
|---|---|
| 1. A push with a balance sends one report, carrying its `readAt` and nothing else | A push with a balance reports its arrival with the balance's read time |
| — (R1: independent of the write) | A push with a balance reports its arrival on a phone that keeps no balance |
| 2. A push without a balance sends no report | A push without a balance reports nothing |
| 3. A balance of the wrong shape sends no report | A push with a balance of the wrong shape reports nothing |
| 4. A failing report still shows the notification and keeps the balance | two scenarios, one behaviour each: A failed report still keeps the push's balance · A failed report still shows the notification |
| 5. The notification never waits for the report | The notification is shown without waiting for the report (where the service worker shows it, D5) |
| 6. A report answers 204 and logs one line with the delay | A report records how long the push took to arrive |
| — (R4: clamped at 0) | A report whose read time lies ahead records 0 seconds |
| 7. Without a login 401; a refused account 403 | not scenarios (D3) |
| 8. A report without a readable `readAt` | A report without a read time is refused and records nothing (the unreadable value: a wiring edge test, D7) |
| 9. The line holds no amount, no time read, no address | a convention test (D4) |
| manual row | A payment's notification on the iPhone is reported within seconds |

**11 scenarios:** 7 frontend, 3 API, 1 manual.

### D11 — Records *(propose)*

- **ADR-0010 § Notes,** dated: the arrival reports (D1, D3, D4), #91's observation that iOS held two mutable pushes for about an hour while a plain one arrived at once, and that work under `waitUntil` delays Safari's proposed notification (D5), linking #91.
- **testing.md:** § Fake push service (the stand-in's `fetch`, the fake server's arrivals answer), and the arrival lines as a scenario's channel (D7). Its `.claude/rules/testing.md` mirror gains a few words if the stand-in's line there names its members.
- **deployment.md:** the queries (D6).
- **Housekeeping** (#91): the owner's decision of 2026-11-21, work after the initial development is a GitHub issue only, with no roadmap step, in CLAUDE.md § Project management and workflow.md § 9 (the roadmap wording kept for the initial plan only). So this change adds **no row to `pm/progress.md`**.
- **`tests/manual-scenarios.md`:** one row (§ How each scenario is verified).
- **CLAUDE.md § Commands:** nothing changes (the regeneration command exists).

### D12 — Software-factory records *(propose)*

At the next free numbers when written (R-94 was the last on 2026-11-21):

- *(New)* iOS may hold a mutable Declarative Web Push for about an hour and release it with the next one, while a plain declarative push arrives at once (#91; an inference, not documented by Apple). Server-side success (the push service's `201`) says nothing about the lock screen: measure delivery on the device, per account and device, with a desktop as the control, before choosing a fix.
- *(New)* In a service worker, work under `waitUntil` delays the browser's own notification of a mutable declarative push, and work outside it may never run: a worker can be stopped as soon as nothing is pending, and `keepalive` in a background worker is undocumented on iOS. Choose deliberately between a waiting notification and lost data (D5).
- *(New)* After the initial development, work is tracked as GitHub issues only; the roadmap stays the record of the initial plan (the owner, 2026-11-21).
- **Inventory lines:** the service worker's push handling (`pushDisplay.ts`, now reporting) and its stand-in (`fetch` to the fake server), both rows updated.

## Public API sketch

```csharp
// ---- src/RevolutReader.Api/Push/ ----

/// <summary>A push's arrival on this device (D2, D3): optional, so a missing readAt is the endpoint's refusal naming it.</summary>
[Description("A push's arrival on this device, named by the read time its balance carried")]
public sealed record ArrivalReportRequest {
  [Description("When the server read the balance the push carried, exactly as the push gave it")]
  public DateTimeOffset? ReadAt { get; init; }
}

/// <summary>
/// POST /api/push/arrivals (spec push-arrivals, D3): no AllowAnonymous, so AllowedUser answers 401/403 first; the
/// cross-site rule first too. ReadAt null → 400 FastEndpoints' validation problem naming "readAt", nothing logged; else
/// handler.Record(readAt), 204. Description: Accepts<ArrivalReportRequest>(JSON), 204, 400, 401, 403 (RefusedProblem).
/// An unreadable readAt never reaches it (FastEndpoints' 400 problem).
/// </summary>
public sealed class ArrivalReportEndpoint(RecordArrivalHandler handler) : Endpoint<ArrivalReportRequest>;

/// <summary>The delay a report records (D4), pure: now − readAt in whole seconds, rounded down, never below 0.</summary>
public static class ArrivalDelay {
  public static long Seconds(DateTimeOffset readAt, DateTimeOffset now);
}

/// <summary>Records an arrival (D4): ArrivalDelay.Seconds(readAt, clock.GetUtcNow()), logged as PushLog.PushArrived.</summary>
public sealed class RecordArrivalHandler(TimeProvider clock, ILogger<RecordArrivalHandler> logger) {
  public void Record(DateTimeOffset readAt);
}

// PushLog (changed): [LoggerMessage(EventName = "PushArrived", Level = LogLevel.Information,
//   Message = "A push reached a device {DelaySeconds} s after its balance was read")]
//   public static partial void PushArrived(ILogger logger, long delaySeconds);
// PushRegistration.AddPush (changed): services.AddScoped<RecordArrivalHandler>();
```

```ts
// ---- src/RevolutReader.Web/src/app/arrivalReport.ts (new) — only a type import, so the service worker can load it (c015 D5)
import type { components } from "../api/schema";

/** The report's body, from the API description: `{ readAt }`. */
export type ArrivalReport = components["schemas"]["RevolutReaderApiPushArrivalReportRequest"];

/** The members of the service worker's scope a report needs (ServiceWorkerGlobalScope and the stand-in fit). */
export interface ReportingWorker {
  location: { origin: string };
  fetch(input: string, init: RequestInit): Promise<unknown>;
}

/**
 * Reports a push's arrival (D1–D3, D5): one POST of `{ readAt }` as JSON to `/api/push/arrivals` on the worker's own
 * origin, with same-origin credentials, no time limit and no keepalive. Ignores the answer; never rejects (offline, any
 * status); never sends again.
 */
export function reportArrival(worker: ReportingWorker, readAt: string): Promise<void>;

// ---- src/RevolutReader.Web/src/app/pushDisplay.ts (changed, D5) ----
// PushWorker gains fetch(input: string, init: RequestInit): Promise<unknown> (so it is a ReportingWorker).
// listenForPushes(worker): same signature; its push listener:
//   const balance = pushedBalance(event);
//   if (balance !== null) { event.waitUntil(keepPushedBalance(balance)); event.waitUntil(reportArrival(worker, balance.readAt)); }
//   then as before: the browser's own notification → nothing more; else showNotification under its own waitUntil.
```

```csharp
// ---- tests ----
// UnitTests/Push/ArrivalDelayTests.cs.
// AcceptanceTests/Drivers/ArrivalDriver: POST /api/push/arrivals through the signed-in test browser (as PushDriver);
//   readAt from the app copy's FakeTimeProvider (earlier, ahead) as System.Text.Json writes it; a body with no readAt;
//   the recorded delays from the app copy's PushArrived lines (a capture in its container).
// AcceptanceTests/Dsl/ArrivalDsl.cs — AcceptanceTest.Arrivals, calling only the driver:
public sealed class ArrivalDsl(ArrivalDriver driver) {
  public Task<ReportAnswer> PhoneReportsAPushReadEarlier(TimeSpan age);        // the signed-in visitor's phone
  public Task<ReportAnswer> PhoneReportsAPushReadAhead(TimeSpan ahead);
  public Task<ReportAnswer> PhoneReportsAnArrivalWithNoReadTime();
  public IReadOnlyList<long> RecordedDelays();                                 // seconds, in the order recorded
}
// Dsl/ReportAnswer: Accepted, or the problem (ProblemDescription).
// Conventions/PushArrivalTelemetryTests (D4). IntegrationTests/Wiring/Push/: the unreadable readAt (D7).
```

```ts
// ---- src/RevolutReader.Web/src/test (the test-writer's, D7) ----
// serviceWorker.ts: the worker gains fetch, handed to the fake server (globalThis.fetch).
// server.ts: POST /api/push/arrivals answers 204 by default, or a Trouble; reports show in the timeline and bodiesSent().
// scenarios/push-arrivals.test.ts: pushWithBalance as in push-display.test.ts.
```

## Rule ownership

| Rule (spec, ADR or decision) | Enforced by |
|---|---|
| A push whose balance passes the shape check reports; none otherwise | `listenForPushes` (`pushedBalance`) |
| The report is independent of the balance write | `listenForPushes` (two `waitUntil`s, neither waiting for the other) |
| The report carries only `readAt`, as the push gave it | `reportArrival` |
| A failed report is ignored and never sent again | `reportArrival` |
| The worker lives until the report is done; the message is never held back by it where the worker shows it | `listenForPushes` (`waitUntil`, the order) |
| The report goes to the app's own origin with the login | `reportArrival` (`worker.location.origin`, `credentials: "same-origin"`) |
| Only allowed, signed-in users; writes from other sites refused | the default policy `AllowedUser`; `CrossSiteWrites`; `AnonymousEndpointsTests` |
| A missing `readAt` → 400, nothing recorded | `ArrivalReportEndpoint` |
| An unreadable `readAt` → 400, nothing recorded | FastEndpoints' binding (`Errors.UseProblemDetails`); the wiring edge test |
| The delay: server time − `readAt`, whole seconds rounded down, never below 0 | `ArrivalDelay` |
| One line per report, the delay only | `RecordArrivalHandler`, `PushLog.PushArrived`; guarded by `PushArrivalTelemetryTests` |
| In the API description; the client regenerated | `ArrivalReportEndpoint` (`Accepts`, `Produces`); CI's drift check |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected outcomes | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `ArrivalDelay.Seconds` | whole seconds | — | none (any two `DateTimeOffset`s fit a `long`) |
| `RecordArrivalHandler.Record` | — | — | the logger's, none expected |
| `POST /api/push/arrivals` | 204 | 400 (missing or unreadable `readAt`), 401, 403 (the policy), 403 (a write from another site), 404 (no JSON body, the catch-all) | → 500 problem description (C7a's handler) |
| `reportArrival` | — | resolves after any answer or a failed request | none; never rejects |

- **No Result union:** the endpoint has no expected failure beyond its 400, which is FastEndpoints' validation problem, and README.md's case → status table gains no row.

## Ports and contracts

None new or changed. The report uses the browser's own `fetch`, reached through the worker's small interface (`ReportingWorker`, `PushWorker`) and the stand-in in tests; the endpoint uses `TimeProvider` and logging only.

## How each scenario is verified

| Scenarios | Level | Why |
|---|---|---|
| `push-arrivals`: the 4 of "A device reports each push that brings a balance" and the 3 of "A report never stops the notification or the kept balance" | frontend tests in `src/scenarios/push-arrivals.test.ts`: `listenForPushes` fed a push through the service-worker stand-in; the report read from the fake server; the notification from the stand-in; the kept balance by opening the app offline (`renderApp`, `fake-indexeddb`) | jsdom runs no service worker and there are no browser tests ([divergences.md R-19](../../../docs/software-factory/divergences.md)); the handler's events, the requests it sends and the app's screen are the public channels (c012 D10, c015 D8) |
| `push-arrivals`: "A report records how long the push took to arrive", "A report whose read time lies ahead records 0 seconds", "A report without a read time is refused and records nothing" | API acceptance tests in `Scenarios/PushArrivals/PushArrivalsScenarios.cs` | the default level; the record is read from the app copy's `PushArrived` lines (D7) |
| `push-arrivals`: "A payment's notification on the iPhone is reported within seconds" | manual row in `tests/manual-scenarios.md`, on the owner's iPhone after the deploy; the daughter's phone is then read only through the data (D6) | only Safari on the iPhone shows whether its background worker sends the report with the login (D3), and only a real payment fires the check |

**The manual row:** before the payment, the app was opened on the iPhone, signed in, at least once after the deploy, so it runs the new service worker (a new version installs on the first open, c015 § Migration plan). With the Home Screen app closed, a real payment brings the notification to the lock screen within seconds; Claude then runs the first query (D6), read-only: a report from the owner's iPhone (iOS, Safari) with a delay of seconds. If none came, look for 401s or 403s on `POST /api/push/arrivals` (the cookie store, D3), then for the request at all.

## Cross-cutting effects

- **API contract / TS client:** a new endpoint. `npm --prefix tools/api-client run regenerate` writes `openapi.json` and `src/api/schema.d.ts`; both committed; CI's drift check guards them. No existing contract changes, so no consumer changes.
- **Bicep, AppHost, settings, secrets:** none.
- **Telemetry:** one Information line per report; a few a day.
- **Design:** none (no screen change).
- **ADRs, conventions, operations, CLAUDE.md:** D11. **Software factory:** D12.

## Risks / Trade-offs

- **[The iPhone's worker sends no login, or its request is refused]** → every iPhone report is a 401 (or 403), and the data has no iPhone. Visible at once as such answers on the address in `AppRequests`; the manual row catches it. A follow-up decides (e.g. why the cookie is missing).
- **[On the iPhone the notification waits for the report]** → chosen (D5): a fraction of a second on time; for a held push, up to the wake-up or iOS's limit.
- **[iOS ends the worker before a held push's report reaches a sleeping server]** → that push shows as unreported in the third query; a held push's report that does arrive includes the wake-up (D2). Holds then read as "no report" rather than "a long delay"; the owner's own observation on the phone tells them apart.
- **[The observer effect]** → the report is more background work, longer when the server sleeps, and could change iOS's behaviour; the desktops are the control, and the owner sees Revolut's own notification for comparison.
- **[A missing report is not a missing notification]** → offline, or after a login ended, the notification may still show (#91 § Caveats). Noted beside the queries.
- **[On iOS a plain push never reports]** → by design: only the mutable path is measured.
- **[A notification sent from an older read matches no report]** → rare (D2); its `CheckEnded` shows `BankReadFailed`.
- **[An allowed user forges a report]** → it skews the data; only the two allowed accounts can send one. Accepted.
- **[FastEndpoints answers an unreadable `readAt` in another shape]** → the wiring edge test pins the 400 problem (D7).
- **[Five frontend scenarios pass before any code]** → guards, proven by a mutation at their close (D7).

## Bootstrap (before `/tdd-apply`)

No package and no probe: everything this change builds on is merged and was probed (C8b's and C9b's push handler and stand-in, C8a's endpoint pattern and the cross-site rule, C14's account on requests). The baseline: the full suite green, except the traceability check naming this change's 11 new scenarios.

## Migration plan

1. **Before `/tdd-apply`:** the baseline.
2. **During it:** the API client regenerated once the endpoint's description exists, before the frontend slices that import its type. No local browser check: the dev server runs no service worker (c012 D12), and the stand-in covers the handler; the production build must pass (`npm run build`) and its `dist/sw.js` must carry no API client (c015 D5).
3. **Before the merge** (workflow.md § 6, a change's path): the push and a draft PR on the owner's go, referring to #91 without closing it; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; the archive on the branch.
4. **After the merge:**
   - the deploy runs; the new revision starts;
   - the owner opens the app on the iPhone once, signed in, so the new service worker installs;
   - the manual row (§ How each scenario is verified), with Claude running the queries read-only and confirming their columns (D6);
   - its date recorded through a small docs PR that closes #91 (workflow.md § 6, the exception for work on a real phone); the 1–2 weeks of measuring follow, and the fix gets an issue of its own with the data.
5. **Rollback:** revert the merge. The endpoint disappears; a service worker not yet updated keeps reporting and gets the catch-all's 404, ignored, until its next update. Nothing stored.

## Open questions

None. R1–R7 were confirmed by the owner on 2026-11-21.
