# Tasks: c016-add-push-arrival-reports

Before this list comes design.md § Bootstrap: no package and no probe, only the baseline. Its baseline holds one known exception, accepted once: the traceability check reports this change's 11 new scenarios as not claimed, until group 1 claims them.

Run with `/tdd-apply c016-add-push-arrival-reports` (GitHub issue #91, no roadmap step; the owner picks the review mode at the start). There are 11 new scenarios, all in the new capability `push-arrivals`: 3 API acceptance tests, 7 frontend tests and 1 manual row (design.md D7, D10). The work is sliced per scenario, the API first, so the regenerated client gives the service worker the report's type before the frontend slices. **Five frontend scenarios pass before any code exists** (D7): no balance, wrong shape, a failed report keeping the balance, a failed report showing the notification, and the notification not waiting. They are accepted green at the acceptance gate as guards, and each slice's `[close]` proves its guard with a mutation.

- Docs tasks are the orchestrator's.
- **"Green"** means the full suite: `dotnet test` (Docker running; it holds the traceability check), and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck`, `format:check` and `run build` (the service worker changes). Exception: this change's scenario tests that are still red stay red until their slice.
- **A mutation** (a slice's `[close]`): the orchestrator breaks the slice's rule in the production code by hand, runs the scenario's test and sees it red, then restores the code with `git restore` and sees it green. Nothing of the mutation is committed; `.tdd-state.md` records what was broken and the red result.
- No UI changes, so no design artifact is read (design.md § Context).

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (API), the test kit of design.md D7 and § Public API sketch, the test-writer's: `Drivers/ArrivalDriver` (reports through the signed-in test browser, as `PushDriver` registers a device; `readAt` relative to the app copy's `FakeTimeProvider`, written as System.Text.Json writes a `DateTimeOffset`; a body with no `readAt`; the recorded delays from a capture of the app copy's `PushArrived` lines), `Dsl/ArrivalDsl` as `AcceptanceTest.Arrivals`, `Dsl/ReportAnswer`; stubs that throw `NotImplementedException`. Verify: the build passes and every existing acceptance test stays green
- [x] 1.2 Foundation (frontend), the test-writer's: in `src/test/serviceWorker.ts`, the worker gains `fetch`, handed to the fake server; in `src/test/server.ts` (a block marked "c016"), `POST /api/push/arrivals` answers 204 by default or any `Trouble`, and its bodies show in `bodiesSent()`; in `src/scenarios/push-arrivals.test.ts`, a helper building a push as the account check sends it (`pushWithBalance`, as in `push-display.test.ts`). Verify: the existing frontend tests stay green
- [x] 1.3 Acceptance: push-arrivals / A report records how long the push took to arrive
- [x] 1.4 Acceptance: push-arrivals / A report whose read time lies ahead records 0 seconds
- [x] 1.5 Acceptance: push-arrivals / A report without a read time is refused and records nothing
- [x] 1.6 Acceptance: push-arrivals / A push with a balance reports its arrival with the balance's read time (frontend)
- [x] 1.7 Acceptance: push-arrivals / A push with a balance reports its arrival on a phone that keeps no balance (frontend)
- [x] 1.8 Acceptance: push-arrivals / A push without a balance reports nothing (frontend; green from the start, a guard, design.md D7)
- [x] 1.9 Acceptance: push-arrivals / A push with a balance of the wrong shape reports nothing (frontend; green from the start, a guard)
- [x] 1.10 Acceptance: push-arrivals / A failed report still keeps the push's balance (frontend; green from the start, a guard)
- [x] 1.11 Acceptance: push-arrivals / A failed report still shows the notification (frontend; green from the start, a guard)
- [x] 1.12 Acceptance: push-arrivals / The notification is shown without waiting for the report (frontend; green from the start, a guard)
- [x] 1.13 Acceptance: push-arrivals / A payment's notification on the iPhone is reported within seconds (manual): its row in `tests/manual-scenarios.md`, first chance after this change deploys, on the owner's iPhone, with the app opened once after the deploy before the payment (design.md § How each scenario is verified)

## 2. [unit] Slice 1 — The delay

- [x] 2.1 The delay is the server's time minus the read time, in whole seconds
- [x] 2.2 A delay with a fraction of a second is rounded down
- [x] 2.3 A delay of an hour is 3600 seconds
- [x] 2.4 The earliest read time and the latest server time still give a delay

## 3. [wiring] Slice 1 — The endpoint

- [x] 3.1 `ArrivalReportRequest`, `ArrivalReportEndpoint` (`POST /api/push/arrivals`, the default policy, `Accepts<ArrivalReportRequest>(JSON)`, 204, 400, 401, 403 `RefusedProblem`), `RecordArrivalHandler` (`TimeProvider`, `ArrivalDelay`), `PushLog.PushArrived` and the handler's registration in `AddPush`, as design.md D3, D4 and § Public API sketch say; `ArrivalDriver`'s report and its reading of the recorded delays. Verify: group 1.3 runs to its assertions; `AnonymousEndpointsTests` green (the endpoint is not anonymous)
- [x] 3.2 Regenerate the TS client: `npm --prefix tools/api-client run regenerate` (FastEndpoints' OpenAPI export → `src/RevolutReader.Api/openapi.json` → `src/RevolutReader.Web/src/api/schema.d.ts`), both committed. Verify: the description lists `POST /api/push/arrivals` with `readAt` and its four answers; `schema.d.ts` has `RevolutReaderApiPushArrivalReportRequest`; `npm run typecheck` green

## 4. [close] Slice 1 — A report records how long the push took to arrive

- [x] 4.1 The scenario's test passes. Verify: green, including push-arrivals / A report records how long the push took to arrive
- [x] 4.2 Docs: testing.md, the arrival lines as a scenario's channel (`Drivers/ArrivalDriver` reads the app copy's `PushArrived` lines; design.md D7), and the `.claude/rules/testing.md` mirror if its harness line needs it. Verify: the paragraph names design.md D7
- [x] 4.3 Docs: deployment.md § The account check, a subsection "Push arrivals (c016)" after "The checks and what they came to": the three read-only queries of design.md D6 (every report; per Prague day, account and device; per notification with the reports belonging to it) and the notes beside them (D2's reading, #91's caveats, to be confirmed on the first real report). Verify: each query runs once read-only against the workspace with the owner's login and parses (no rows before the deploy)

## 5. [unit] Slice 2 — A read time ahead

- [x] 5.1 A read time ahead of the server's time records 0 seconds
- [x] 5.2 A read time at the server's own time records 0 seconds

## 6. [close] Slice 2 — A report whose read time lies ahead records 0 seconds

- [x] 6.1 The scenario's test passes. Verify: green, including push-arrivals / A report whose read time lies ahead records 0 seconds

## 7. [wiring] Slice 3 — A report the server cannot read

- [x] 7.1 `ArrivalReportEndpoint` refuses a report without `readAt` (missing or `null`) with FastEndpoints' validation problem naming `readAt`, and records nothing (design.md D3); `ArrivalDriver`'s report with no read time. Verify: group 1.5 runs to its assertions
- [x] 7.2 Wiring edge test (the implementer's, `tests/RevolutReader.IntegrationTests/Wiring/Push/`): a report whose `readAt` is `"yesterday"` answers 400 `Bad Request` as `application/problem+json` and logs no `PushArrived` line (design.md D3, D7). Verify: the test passes

## 8. [close] Slice 3 — A report without a read time is refused and records nothing

- [x] 8.1 The scenario's test passes. Verify: green, including push-arrivals / A report without a read time is refused and records nothing

## 9. [unit] Guards

- [x] 9.1 A report's lines hold no read time in any written form and no email address (`Conventions/PushArrivalTelemetryTests`, design.md D4)

## 10. [unit] Slice 4 — Reporting an arrival

- [x] 10.1 A report is one POST to `/api/push/arrivals` on the worker's own origin, as JSON with only `readAt`, with same-origin credentials
- [x] 10.2 A push's arrival is reported with the read time from the data of the browser's proposed notification
- [x] 10.3 A push's arrival is reported with the read time from the push's own JSON where the browser proposes no notification
- [x] 10.4 The report runs under the push event's `waitUntil`

## 11. [wiring] Slice 4 — The service worker reports

- [x] 11.1 `src/app/arrivalReport.ts` (`reportArrival`, its only import the type-only schema) and `PushWorker` gains `fetch`; `listenForPushes` reports beside the balance write, in the same turn, before it shows or leaves the message (design.md D5, § Public API sketch). Verify: `npm run typecheck` (the service worker's project included) and `npm run build`; the built `dist/sw.js` contains no API client (`window.location`)

## 12. [close] Slice 4 — A push with a balance reports its arrival with the balance's read time

- [x] 12.1 The scenario's test passes. Verify: green, including push-arrivals / A push with a balance reports its arrival with the balance's read time
- [x] 12.2 Docs: testing.md § Fake push service, the service worker's stand-in (its `fetch`, handed to the fake server) and the fake server's answer to `POST /api/push/arrivals` (design.md D7). Verify: the paragraph names `src/test/serviceWorker.ts` and `src/test/server.ts`

## 13. [unit] Slice 5 — Reporting whatever the phone keeps

- [x] 13.1 A push's arrival is reported on a phone that keeps no balance
- [x] 13.2 A push's arrival is reported when the phone keeps a newer balance than the push's

## 14. [close] Slice 5 — A push with a balance reports its arrival on a phone that keeps no balance

- [ ] 14.1 The scenario's test passes. Verify: green, including push-arrivals / A push with a balance reports its arrival on a phone that keeps no balance

## 15. [unit] Slice 6 — No balance, no report

- [x] 15.1 A declarative message with no data in its notification reports nothing, as the owner's messages
- [x] 15.2 A proposed notification whose data has no balance, and a push with no data or of text that is not JSON, report nothing

## 16. [close] Slice 6 — A push without a balance reports nothing

- [ ] 16.1 The scenario's test passes and is proven by a mutation: with a report sent for every push, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 17. [unit] Slice 7 — A balance of the wrong shape

- [x] 17.1 A balance without its read time, or whose amount or rate is not a number, reports nothing

## 18. [close] Slice 7 — A push with a balance of the wrong shape reports nothing

- [ ] 18.1 The scenario's test passes and is proven by a mutation: with a report sent from the push's raw `readAt` without the shape check, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 19. [unit] Slice 8 — A failed report

- [x] 19.1 A report resolves when the request fails (offline)
- [x] 19.2 A report resolves when the server answers 401, 403 or 500
- [x] 19.3 A failed report is never sent again

## 20. [close] Slice 8 — A failed report still keeps the push's balance

- [ ] 20.1 The scenario's test passes and is proven by a mutation: with a report whose failure passes on, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 21. [unit] Slice 9 — The notification after a failed report

- [x] 21.1 A failed report still lets the service worker show the message

## 22. [close] Slice 9 — A failed report still shows the notification

- [ ] 22.1 The scenario's test passes and is proven by a mutation: with the message shown only after a successful report, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 23. [unit] Slice 10 — Not waiting for the report

- [x] 23.1 The message is shown without waiting for the report's answer

## 24. [close] Slice 10 — The notification is shown without waiting for the report

- [ ] 24.1 The scenario's test passes and is proven by a mutation: with the message shown after the report has ended, it fails. Verify: green, including the scenario; the mutation's red result in `.tdd-state.md`

## 25. [close] Acceptance green

- [ ] 25.1 All automated scenario tests of this change pass, and the full suite is green, including `npm run build` with no API client in `dist/sw.js`, `dotnet format whitespace RevolutReader.slnx --verify-no-changes`, the traceability check (every scenario claimed exactly once, the manual row the 11th), and `openapi.json` and `schema.d.ts` current (a fresh regeneration leaves them unchanged). Verify: the commands' output
- [ ] 25.2 Docs: ADR-0010 § Notes, dated (design.md D11): the arrival reports, #91's observation (two mutable pushes held about an hour, a plain one at once), and that work under `waitUntil` delays Safari's proposed notification, linking #91. Verify: the note cites this change's design.md D1, D3–D5
- [ ] 25.3 Docs: the owner's decision of 2026-11-21 (design.md D11): work after the initial development is a GitHub issue only, with no roadmap step, in CLAUDE.md § Project management and workflow.md § 9, the roadmap wording there kept for the initial plan only. Verify: both say it the same way, and neither asks for a roadmap entry or a `pm/progress.md` row for new work
- [ ] 25.4 Docs: the software-factory lessons and inventory lines of design.md D12, at the next free numbers. Verify: each lesson names the decision it comes from
- [ ] 25.5 `CLAUDE.md` checked against every command this change touched (none expected); no `pm/progress.md` row (design.md D11). Verify: `CLAUDE.md`'s commands run as written

## Workflow follow-up

A change's path after its `[close]` commit (workflow.md § 6):

- The push and a draft PR `feat: report when pushes reach the phones`, referring to #91 without closing it, on the owner's go, opened by Claude.
- The owner runs `/code-review xhigh --comment` on the PR.
- `/triage-review <PR>` works through the findings (testing.md § Code review after the apply). The test-writer's and implementer's agent IDs in `.tdd-state.md` must be current, because its fix round resumes them.
- Archive with `/opsx:archive` on the branch, before the merge. The traceability check must pass first.
- The owner marks the PR ready and squash-merges it.
- After the merge (design.md § Migration plan, step 4):
  - the deploy;
  - the owner opens the app on the iPhone once, signed in, so the new service worker installs;
  - the manual row on the owner's iPhone, with Claude running the queries read-only and confirming their columns;
  - its date recorded through a small docs PR that closes #91; the 1–2 weeks of measuring follow, and the fix gets an issue of its own, which also decides whether the reports stay (design.md D9).
