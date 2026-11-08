# Tasks: c006-harden-bank-adapter

Before this list: design.md § Bootstrap, committed as `[setup]`: the rebase on `main` (done 2026-11-08, onto PR #26), the two packages and a green full suite. Also before it: the user's answers to design.md § Open questions, which may change tasks 9.1, 9.2 and 9.4. Its baseline holds one known exception, accepted once: the traceability check reports this change's two new scenarios as not claimed. Group 1 claims them.

Run with `/tdd-apply c006-harden-bank-adapter` (roadmap C12). Two new scenarios, so the work is not sliced (`openspec/config.yaml` § tasks). Docs tasks are the orchestrator's; the "Guided" task needs the owner. "Green" below means the full suite (`dotnet test` and the frontend tests), except this change's two acceptance tests, which wait for group 11.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation: the fake bank's answer for a gateway's maintenance page (503, `text/html`, no Enable Banking error code), written from a typical gateway page with a comment saying the Mock ASPSP cannot produce it, and the DSL fact `Bank.GatewayAnswersWithMaintenancePage()` (design.md § Public API sketch). Verify: build passes; every acceptance test that was green stays green
- [x] 1.2 Acceptance: bank-reads / A browser name with an accent reaches the bank with a question mark
- [x] 1.3 Acceptance: bank-reads / A gateway's error page reads as bank unavailable

## 2. [unit] Present user

- [x] 2.1 A present user without an IP address is rejected
- [x] 2.2 A present user with a null, empty or whitespace user agent is rejected
- [x] 2.3 A present user keeps the IP address and the user agent as given

## 3. [unit] User headers

- [x] 3.1 An accented letter in the user agent is sent as a question mark, and the length stays the same
- [x] 3.2 A control character in the user agent (0x01, a tab, 0x7F) is sent as a question mark
- [x] 3.3 A line break or a NUL in the user agent is sent as a question mark
- [x] 3.4 A user agent of printable ASCII is sent unchanged

## 4. [unit] Transaction mapping: the sign

- [x] 4.1 A booked transaction with a negative amount is an error whose message quotes no amount
- [x] 4.2 A pending transaction with a negative amount is an error
- [x] 4.3 A spent transaction of zero comes out as zero, not as a negative zero
- [x] 4.4 A cancelled transaction with a negative amount is only left out, its amount unread

## 5. [unit] Transaction pages: the cap

- [x] 5.1 A read whose 20th page still carries a key is an error naming the cap, and no 21st page is requested
- [x] 5.2 A read of exactly 20 pages, the last without a key, returns the transactions of every page

## 6. [unit] Error code shape

- [x] 6.1 Enable Banking's codes have the code shape (e.g. `EXPIRED_SESSION`, `ASPSP_RATE_LIMIT_EXCEEDED`, `PAYMENT_SUBMISSION_NOT_SUPPORTED`)
- [x] 6.2 A value of 64 capital letters and underscores has the code shape, one of 65 does not
- [x] 6.3 A value with a lower-case letter, a digit, a space, a slash or a colon does not have the code shape
- [x] 6.4 A value starting with an underscore, an empty value and no value do not have the code shape

## 7. [wiring] Error answers decided by their status

- [x] 7.1 `EnableBankingClient` reads an error answer's `error` value through the code shape: an unreadable body, a non-string or missing `error` and a value of another shape all mean no code, so the status decides (design.md D3, D7). In `IntegrationTests/Wiring/EnableBanking/`: `ErrorAnswerTests`' unreadable-body test now expects bank unavailable for its 503 cases, and gets a 400 case with an HTML page that is an error quoting nothing from the body; new edge tests: a 429 with an HTML page is rate limited, a 503 with `{"error":"Service Unavailable"}` is bank unavailable, a 404 with an `error` text holding a path is an error that quotes neither the text nor the account id. Verify: those edge tests green; acceptance test 1.3 passes; green
- [x] 7.2 The log line's error code is the code as received, `none` without a value, `unrecognised` for a value of another shape; a `BankReadException` for an error answer names the status and the code, "no error code" or "an unrecognised error value" (design.md § Public API sketch). Verify: edge tests with a capturing logger in `IntegrationTests/Wiring/EnableBanking/`; `Conventions/BankTelemetryTests` green; green

## 8. [wiring] The log line: a reason, on every end

- [x] 8.1 Both log lines carry `Reason`: the `BankReadException`'s message for an unexpected end, `none` otherwise (design.md D8 a). Verify: edge tests with a capturing logger; green
- [x] 8.2 Any other exception ending a read writes the line at `Error` as unexpected, with the exception's type name as `Reason`, and passes on unchanged (design.md D6). Verify: an edge test reading with a default `ReadTrigger` sees the line and the original exception; green
- [x] 8.3 The page cap through the client: a fake bank that answers 20 pages, each with a new key, ends the read as an error after exactly 20 requests, and the line's `Reason` names the cap (design.md D4). Verify: an edge test in `IntegrationTests/Wiring/EnableBanking/`; green

## 9. [wiring] Application Insights

- [x] 9.1 ServiceDefaults adds the Azure Monitor exporter for traces and logs only, not metrics (design.md D10), with the managed-identity credential for `AZURE_CLIENT_ID`, only when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, and refuses to start when it is set without `AZURE_CLIENT_ID`, naming that setting, never a value (design.md D8 b, § Public API sketch). `appsettings.json` declares both keys, empty, with their provenance comments. Verify: edge tests in `IntegrationTests/Wiring/` (no Azure Monitor exporter without the connection string; none for metrics with it; start refused without the client ID); `Conventions/BankTelemetryTests` green; green
- [x] 9.2 Bicep (design.md § Cross-cutting effects): the workspace-based Application Insights resource `appi-revolutreader` with local authentication off; `Monitoring Metrics Publisher` for `id-revolutreader-app` on it; the two environment variables on the container app; the workspace's daily cap 0.16 GB (design.md D9). Verify: `az bicep lint --file infra/main.bicep` shows no warning; the read-only preview ([deployment.md § Previewing a change to the Bicep](../../../../docs/operations/deployment.md#previewing-a-change-to-the-bicep-read-only)) lists exactly the new resource, the new role assignment, the changed container app and the changed workspace cap
- [x] 9.3 Guided (the owner, before the merge): the deploy identity's role condition gets `Monitoring Metrics Publisher` (design.md D8 b). Claude writes the PowerShell 7 block: the role's ID looked up by name, then the Role Based Access Control Administrator assignment deleted and created again with the five role IDs, as azure-prerequisites.md step 5 describes. The owner runs it. Verify: Claude reads the assignment back (read-only) and its condition lists the five IDs
- [x] 9.4 Docs: azure-prerequisites.md step 5 (five roles, the date and the command); deployment.md (the Application Insights resource in the resources table, the 0.16 GB cap, the identity's second role); workflow.md § 5 (Application Insights in v1, the resource list, the 0.16 GB cap); configuration.md (the two settings, their standard names, read in ServiceDefaults). Verify: nothing contradicts design.md D8–D10; the links resolve
- [x] 9.5 Docs: ADR-0009-application-telemetry, as design.md D11 lists its content, in the format of the existing ADRs; a row in `docs/adr/README.md`; workflow.md § 5 links it. Verify: it states the decision, the alternatives and the consequences D8 b, D9 and D10 record, and contradicts none of them

## 10. [wiring] Ready queries and the lesson

- [x] 10.1 deployment.md § Checks: the two ready queries in PowerShell 7 (`az monitor app-insights query` or the workspace query, with `--subscription`): every bank read in a given period that did not end as read (time, who, outcome, status, error code, reason), and the same counted by reason, against the Application Insights tables (design.md D8 c), marked as confirmed once the first real bank lines arrive (C7). Verify: the queries follow the columns Microsoft documents for OpenTelemetry logs in Application Insights (link and date in the doc)
- [x] 10.2 lessons.md: the two lessons (R-53 and R-54, or the next free numbers when written; design.md § Cross-cutting effects): the app's telemetry in Application Insights (D8–D10) and where personal data, bank data and secrets may go, public against private (D13's software-factory rule). Verify: their options, choices and "Generalizes" lines match design.md D8–D10 and D13, in the file's current entry format

## 11. [close] Acceptance green

- [x] 11.1 Both acceptance tests of this change pass (`dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/BankReadsScenarios/*"`), and the full suite, `dotnet format whitespace RevolutReader.slnx --verify-no-changes` and the traceability check are green
- [x] 11.2 `pm/progress.md`: C12's status, date and notes, and its follow-ups: after the merge, a read-only query showing the app's start lines in `AppTraces` and a request in `AppRequests`; the ready queries' columns with C7's first bank lines; #17 with the metrics volume (design.md § Risks). `CLAUDE.md` needs no change unless a command changed. Verify: the row links the change folder

## Workflow follow-up

- The PR (`feat: harden the bank adapter (C12)`) merges only after task 9.3; its deploy creates Application Insights, the role and the two variables.
- `/opsx:archive` updates the main `bank-reads` spec with the four modified requirements.
