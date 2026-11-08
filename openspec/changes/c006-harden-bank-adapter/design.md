# Design: c006-harden-bank-adapter

## TL;DR

- **Paging stops at 20 pages** (a constant): a runaway bank fails the read after about 10 s instead of looping forever (D4).
- **A negative amount from the bank is an error:** Revolut sends none today (0 of 116), so a minus would be a change of unknown meaning; nothing wrong reaches C7's stored history (D2).
- **Only a value shaped like an Enable Banking code is a code** (`^[A-Z][A-Z_]{0,63}$`); otherwise the HTTP status decides, so a gateway's error page on a 5xx is "bank unavailable" (D3, D7).
- **The browser name is cleaned when the header is built:** outside printable ASCII → `?`; a present user needs an address and a non-blank user agent (D5, D1 g).
- **Every end of a read writes its one log line, with a `Reason`**; an unrecognised error value is logged as `unrecognised`, never quoted (D6, D8 a, D7).
- **Application Insights,** workspace-based on the existing workspace, fed by the deployed app through `Azure.Monitor.OpenTelemetry.Exporter` with its logs and traces, not its metrics (the platform's metrics cover them, D10), writing with the app's managed identity (local authentication off); local runs and tests export nothing new (D8 b). Ready queries in deployment.md (D8 c).
- **Changed public interfaces:** `PresentUser` (checked when created), `PsuHeaders.For` (cleans), `TransactionPages.MOST_PAGES` (new), `EnableBankingErrorCode.HasCodeShape` (new), the two log lines (`Reason`); settings `APPLICATIONINSIGHTS_CONNECTION_STRING` and `AZURE_CLIENT_ID` (the standard names, empty locally); DSL fact `Bank.GatewayAnswersWithMaintenancePage()`.
- **The workspace's daily cap matches the free allowance:** 0.16 GB a day (5 GB a month ÷ 31), up from 0.1 GB; Application Insights data counts against the same allowance (D9).
- **Integration points:** Enable Banking (unchanged calls, a cleaned header); Azure: Application Insights, a `Monitoring Metrics Publisher` role for the app's identity, two environment variables, the workspace's cap; the deploy identity's role condition widened by hand, once (guided task).
- **Hard to reverse:** nothing in code. The widened role condition stays until someone narrows it again by hand.
- **A new ADR, ADR-0009-application-telemetry,** holds the telemetry decisions (D8 b, D9, D10) and C4's workspace (D11).
- **Still open, to settle before `/tdd-apply`:** one choice (§ Open questions).

## Context

- See proposal.md § Why. Every decision below was made with the user in `/opsx:explore`, one at a time (2026-11-07, one addition 2026-11-08).
- **The review and its assessment.** A whole-codebase review (2026-11-07, run in another session, nothing changed) found 15 issues. Five are in the bank adapter built by C5 ([c004 design.md](../archive/2026-11-07-c004-add-enable-banking-adapter/design.md)), which nothing calls yet; C7 is its first caller. They were assessed in `/opsx:explore` on 2026-11-07. Line numbers below refer to `main` at `4b1d91f`. The assessment checked them against the code and C5's notes and ran three independent checks:
  - a runtime experiment on .NET 11 RC3 (`HttpClient` and default Kestrel with non-ASCII, control and line-break characters in a header);
  - Enable Banking's docs on amount signs, paging and user headers, read 2026-11-07;
  - an audit of every way the two reads can end, and whether each writes its one log line (c004 D5).
- **Parallel work.** The review's other ten, minor findings were fixed directly on the branch `fix/review-findings`, merged as [PR #26](https://github.com/jakubbohm/RevolutReader/pull/26) on 2026-11-07. It also validates the API address (an absolute http or https address), so this change leaves that out. This branch is rebased on it (2026-11-08, `890e47c`). What it changed that this change builds on: the acceptance DSL's default present user is now `198.51.100.23` with a full Safari browser string, different from every user a scenario names (the new scenario's `203.0.113.7` included); `BankDsl.ReadTransactionsFor(user, from)` exists; the telemetry guard (`BankTelemetryTests`) now also checks that the present user's **browser** never appears in logs or exported traces, with its own made-up user, because every incoming request's server span records its browser (`user_agent.original`). C6 is explored in parallel in its own worktree; this change took the number c006, so C6 becomes c007 (the C6 session was told, 2026-11-08).
- **The adapter today** (c004 design.md § Public API sketch): `IBankAccount` with `ReadBalance` and `ReadTransactions`; `EnableBankingClient` sends signed `GET`s with the user headers from `PsuHeaders`, classifies error answers with `BankErrorClassification`, follows pages with `TransactionPages`, maps with `TransactionMapping` and `BalanceSelection`, and logs one line per read for a result, a `BankReadException` or the caller's cancellation. `PresentUser` is a positional record without checks.
- **Telemetry today:** ServiceDefaults configures OpenTelemetry (ASP.NET Core and HTTP-client instrumentation, the bank's requests excluded, D5 of c004) and exports OTLP only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (Aspire, locally). In production the app writes the default console format to the Container Apps environment's Log Analytics workspace `log-revolutreader` (c005 design.md D6), two output lines per entry.
- **Azure today** ([deployment.md](../../../docs/operations/deployment.md)): the deployment stack `revolutreader` in `rg-revolutreader` (`infra/main.bicep`, `platform.bicep`, `features.bicep`): the workspace (30 days, 0.1 GB daily cap), Key Vault, the app's user-assigned identity `id-revolutreader-app` with Key Vault Secrets User, the environment and the container app `tarjeta-papa`. The deploy identity holds Contributor and Role Based Access Control Administrator on the group, the latter limited by a condition to four roles ([azure-prerequisites.md](../../../docs/operations/azure-prerequisites.md) step 5).

## Goals / Non-Goals

**Goals:**

- The two new `bank-reads` scenarios and the four modified requirements, verified through the port (§ How each scenario is verified).
- The adapter as C7 and C9 will call it: no endless read, no flipped sign, the right result for a gateway's error page, any browser name sendable, a log line for every read that says why it failed.
- Production telemetry in Application Insights, written by the app's own identity, with queries that list every failed bank read.

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- No in-memory fake of the port and no `[integration]` group, as in C5: the acceptance tests use the real adapter against the fake bank.
- No change to the port's signatures, the result cases or the request timeout.
- No new acceptance outcome for errors: as in C5, an error (an exception) is covered by unit tests and adapter edge-case tests, not by scenarios; the requirement texts state it.
- No sampling, live metrics or profiler; no alert rules.

## Bootstrap (done before `/tdd-apply`, not in tasks.md)

The test-writer may add only signatures to production code. So, as in C1, C3 and C5, Claude prepares a green starting point on the change branch once the user approves these artifacts, committed as `[setup]`. None of it is behaviour.

1. **Rebase** the branch on `main` once `fix/review-findings` has merged (§ Context), and run the full suite. *The rebase is done (2026-11-08, onto `890e47c`, PR #26); the full suite runs with step 2.*
2. **Packages** (verified on nuget.org, 2026-11-08), in `Directory.Packages.props`, referenced by `RevolutReader.ServiceDefaults`:
   - `Azure.Monitor.OpenTelemetry.Exporter` 1.10.0 (stable; needs `OpenTelemetry.Extensions.Hosting` ≥ 1.18.0, the project has 1.20.1);
   - `Azure.Identity` 1.21.0, for the managed-identity credential.
3. The setup build and the full suite are green. The only accepted red is the traceability check reporting this change's two new scenarios as not claimed; group 1 claims them.

## Decisions

> Started in `/opsx:explore` (2026-11-07): each decision is recorded here right after the user's yes.

### D1 — Scope: five review findings and two found while assessing them

Decided with the user (2026-11-07, explore).

**In:**

| | Item | Source | What changes |
|---|---|---|---|
| a | **Page cap** | review finding 1, `TransactionPages.cs:20` | After a set number of pages the read ends as an error, with its log line, instead of following new continuation keys forever. The review's reason (Revolut's 4 unattended reads a day) does not hold: paging within one read does not count against the limit (ADR-0001 § Request limits), and most reads carry user headers (ADR-0008). The real harm is a read that never ends, with unlimited requests and growing memory. Enable Banking documents no page limit and says an empty page that carries a key must be followed, so a cap is the only guard that fits its contract. |
| b | **Sign rule** | review finding 2, `TransactionMapping.cs:86` | A negative amount marked as money spent can no longer come out as money received. Enable Banking's OpenAPI schema allows a minus on `AmountType.amount`, and its docs never say a transaction amount is unsigned (read 2026-11-07); Berlin Group banks sign amounts natively, STET and UK Open Banking do not. C7 stores settled transactions, so a wrong sign would persist. Already noted as "not pinned" in C5 (`.tdd-state.md`, group 7). The rule itself: D2. |
| c | **A 5xx with an unreadable error body** | review finding 3, `EnableBankingClient.cs:202` | An HTML or plain-text error page on a 5xx (typically a gateway in front of Enable Banking) reads as bank unavailable, as a 5xx with an empty body already does. Flagged by C5 for the owner's decision (`.tdd-state.md` § Disputes and decisions, item 11; open point in PR #24); locked today by `ErrorAnswerTests.An_error_body_that_cannot_be_read_is_an_error_that_does_not_quote_it`. |
| d | **Clean the browser name before sending** | review finding 4, `PsuHeaders.cs:14` | Verified on .NET 11 RC3: default Kestrel hands the app a valid UTF-8 "é" in `User-Agent`; `HttpClient` then refuses to send the header (`HttpRequestException` "Request headers must contain only ASCII characters.", no bytes sent), which the client reports as "bank unavailable; network failure", on every read of that user. Control characters 0x01 and 0x7F pass Kestrel and are sent raw. The adapter cleans the value, so every caller (C7, the phone-triggered check of C9) is covered. Was a heads-up for C7 (c004 D2). |
| e | **A log line on every end of a read** | review finding 5, `EnableBankingClient.cs:53-62`, `:82-91` | Every outcome from a bank answer or a normal browser writes its line today; only exceptions other than `BankReadException` and cancellation escape without it (a default `ReadTrigger`, a null address, a failing logging provider, …). They still write the read's line, as unexpected, and pass on. |
| f | **The error code is logged only when it looks like one** | found in the assessment, `BankReadException.cs:22`, `EnableBankingClient.cs:137` | The bank's `error` value goes verbatim and with no length limit into the exception message and the log line. Enable Banking's codes are fixed words, but any JSON error body with a string `error` passes: the audit's probe carried `"Not found: /accounts/<id>/balances"` through. Only a value shaped like a code is quoted; anything else is logged as unrecognised (c004 D5: no identifiers in logs). |
| g | **The present user is checked when created, as c004 D2 says** | found in the assessment, `ReadTrigger.cs:12` | c004 D2 says the present-user form rejects a null or blank user agent; the code has no check, so a null one goes out as an empty header and a null address throws `NullReferenceException` without a log line. |

**Out:**

- An API address with another scheme than http or https: fixed on `fix/review-findings` (see Context).
- Small edges, accepted and not changed: an error body that starts with a UTF-8 byte-order mark reads as unexpected (the error path parses a byte span, the success path a stream); the "left out" count in the log line is 0 when the mapping throws; the page counter includes a request that was never sent when the caller had already cancelled; a race of microseconds between our timeout and the caller's cancellation can give the other of the two log labels. None of them produces wrong data or a wrong result.

### D2 — A negative transaction amount is an error

Decided with the user (2026-11-07, explore).

- **The evidence:** Revolut, through Enable Banking, sends unsigned transaction amounts today and gives the direction only in `credit_debit_indicator`. In the M1 history file (116 settled transactions, `spikes/enable-banking/secrets/`), counted 2026-11-07 with nothing printed but counts: 13 `CRDT` and 103 `DBIT`, none with a minus or a plus; one `DBIT` with amount 0. A minus would therefore mean the bank changed its answer, with a meaning we cannot know (signed amounts, or for example a refund written as a negative debit).
- **The rule:** a kept (booked or pending) transaction whose amount is negative is a `BankReadException` (c004 D4 "everything else"), with a fixed message that quotes no amount (c004 D5). The read fails as a whole and writes its log line as unexpected. A leading plus stays accepted, as today. Transactions left out by their status are still not read (c004 D3), so their amounts are not checked.
- **Zero stays zero:** the zero-amount debit must come out as 0, never as a negative zero; a test pins it.
- **The balance is unchanged:** a balance has no credit/debit indicator, so a negative balance is a real value (Enable Banking's `AmountType` allows the minus for it).
- **Why an error:** C7 stores settled transactions, so a wrong sign would persist without any signal, which is worse than a visible outage in an app about money. It also matches c004 D3's rule for an unknown status: when the bank changes its answer, the read fails visibly instead of guessing. Once the log shows the case, the fix is small.
- **Rejected: the size of the amount with the sign from the indicator** (spent −|amount|, received +|amount|). Never breaks the screen and is right if the bank only switched to signed amounts, but it would store a refund written as a negative debit as spending, without any signal.

### D3 — Only a value shaped like an Enable Banking code is a code; otherwise the status decides

Decided with the user (2026-11-07, explore). Changes c004 D4's table for error answers; C5 had flagged it for the owner's decision (c004 `.tdd-state.md` § Disputes and decisions, item 11).

- **The rule:** an error answer's `error` value counts as a code only when it has the shape of an Enable Banking code (the shape: D7). Anything else counts as no code, and the status decides, as c004 D4 already does for an empty body:

  | Error body | Counts as | Outcome |
  |---|---|---|
  | a known code (`EXPIRED_SESSION`, `ASPSP_ERROR`, …) | that code | its case, unchanged |
  | an unknown value shaped like a code | an unknown code | an error, unchanged |
  | HTML, plain text, JSON of another shape, `error` not a string | no code | the status decides |
  | an `error` text not shaped like a code (e.g. a gateway's `"Service Unavailable"`) | no code | the status decides |
  | empty, JSON `null`, a blank or missing `error` | no code | the status decides, unchanged |

  The status decides as before: 5xx and 408 are bank unavailable, 429 is rate limited, any other status is an error naming the status and no code.
- **Why:** the same 503 read as bank unavailable when empty and as an error when it carried a gateway's HTML page. Gateways in front of an API answer outages with such pages, in HTML or in their own JSON, so the old rule would have shown C7's generic error instead of "Banka teď neodpovídá" with a retry. A new code that Enable Banking itself sends still fails visibly.
- **Side effects:** a gateway's HTML 429 is rate limited; a 4xx with an HTML page stays an error, now named by its status with no code. The error never quotes the body (c004 D5).
- **Tests:** `ErrorAnswerTests.An_error_body_that_cannot_be_read_is_an_error_that_does_not_quote_it` changes: its 503 cases become bank unavailable, and a 400 case with an HTML page keeps the check that nothing from the body is quoted.
- **Rejected: only 502, 503 and 504 with an unreadable body as bank unavailable.** Narrower, but a gateway's JSON error and an HTML 429 would still read as errors.

### D4 — The page cap: 20 pages, a constant

Decided with the user (2026-11-07, explore). Implements D1 a.

- **The rule:** a transactions read requests at most 20 pages. When the 20th page still carries a continuation key, the read ends as a `BankReadException` (c004 D4 "everything else") with a fixed message naming the cap, and writes its log line as unexpected, with that message as its `Reason` (D8). The repeated-key check (c004 D7) stays as it is.
- **Why 20:** Revolut sends about 50 transactions a page (the M1 history: 50, 50, 16; Check 2: 127 in 3 pages), so 20 pages hold about 1,000 transactions. C7's 31-day window is about 40 transactions (one page) and Revolut's longest read, 90 days, about 3 pages. A runaway bank answers a page in about 0.5 s (Check 2), so the read fails after about 10 s instead of keeping the user waiting. Enable Banking says page sizes vary per bank and over time; if Revolut shrank its pages to 10, 20 pages would still hold about 5 times the 31-day window.
- **A constant in code,** not a setting: a safety limit nobody tunes, and a setting would also need a deploy, since `appsettings.json` is inside the image.
- **The whole read's duration is the caller's:** C7 passes a cancellation token with its own deadline if it needs one; the adapter adds no time limit of its own beyond the per-request timeout (c004 D4).
- **Rejected: 100 pages,** as Check 2 uses: a runaway would keep the user waiting about 50 s. **Rejected: a cap on transactions with a page cap as a backstop:** independent of the page size, but two limits for a case 20 pages already covers; a cap on transactions alone would not stop a bank that keeps sending empty pages with new keys, which Enable Banking documents as normal.
- **The spec changes:** `bank-reads` § "Every page is read" says "however long the period"; it gets the cap.

### D5 — The browser name is cleaned when the header is built: printable ASCII, anything else as `?`

Decided with the user (2026-11-07, explore): option a, Claude's recommendation. Implements D1 d.

- **The rule:** when the user headers are built (`PsuHeaders`), every character of the user agent outside printable ASCII (space to `~`, 0x20 to 0x7E) is replaced with `?`; the length stays the same. `Mozilla/5.0 (café)` goes out as `Mozilla/5.0 (caf?)`.
- **What it covers:** non-ASCII characters (which `HttpClient` refuses to send, D1 d), control characters that Kestrel passes and `HttpClient` sends raw (0x01, 0x7F, tab), and line breaks or NUL, which make `HttpHeaders.Add` throw `FormatException` before anything is sent (one of the exits without a log line, D1 e).
- **Where:** the cleaning belongs to building the HTTP header; the check that a present user has an address and a non-blank user agent belongs to creating the present user (D1 g).
- **Rejected:** dropping such characters (hides that anything was there); transliterating (`café` → `cafe`; more code, and other scripts still need the replacement); sending the header as UTF-8 bytes (`SocketsHttpHandler.RequestHeaderEncodingSelector`, which worked against a local server; unknown whether Enable Banking or Revolut accept it, and a refusal would fail every read of that user).

### D6 — Every end of a read writes its line

Follows from D1 e and D8 a; no choice of its own.

- **The rule:** besides a result, a `BankReadException` and the caller's cancellation, which write their line today, any other exception ending `ReadBalance` or `ReadTransactions` writes the read's line as unexpected, at `Error`, with the exception's type name as its `Reason` (never its message), and passes on unchanged.
- **What it covers:** the exits the assessment found without a line, all of them programming errors, settings the start-up check misses, or infrastructure faults: a default `ReadTrigger`, a failure while signing the token, a misused `HttpClient`, and the defensive guards. D1 g and D5 remove two of them (a null address; a line break in the user agent).
- **Not covered:** a logging provider that throws while the line is written, and running out of memory; the host's own handling sees those.

### D7 — The shape of an Enable Banking code

Decided with the user (2026-11-07, explore). Used by D1 f and D3.

- **The shape:** a capital letter, then capital letters and underscores, at most 64 characters in all (`^[A-Z][A-Z_]{0,63}$`, ordinal). Enable Banking's OpenAPI file (`ErrorCode`, downloaded 2026-11-07) defines 43 codes, the longest 32 characters, all of capital letters and underscores, none with a digit.
- **A value of that shape** is a code: known codes keep their case (c004 D4), an unknown one is an error that names it (D3), and the log line and the exception quote it as received.
- **Any other value** is logged as `unrecognised`, never quoted, and counts as no code, so the HTTP status decides (D3). An empty or missing `error` stays `none` in the log.
- **Why no digits:** an account or session id is a GUID; written without dashes and in capitals, it would pass a shape that allows digits. A path, a URL or a sentence fails the shape on its `/`, `:`, space or lower-case letters.
- **Rejected:** allowing digits (a little more future-proof, but an id could slip into the log); only the 43 documented codes (a new code Enable Banking adds would lose its name in the log, which is what D8 wants to show early).

### D8 — Every failed bank read is easy to find: the reason in the log line, Application Insights, ready queries

Decided with the user (2026-11-07, explore). Added to D1's scope at the user's request: early on, every error in the communication with the bank should be easy to search and filter, to find the cases nothing covers yet. Revisits c005 design.md D6 ("Application Insights … can come later if C7 needs it").

**What was found (2026-11-07):**

- Every read writes one line (c004 D5) with its outcome, HTTP status and error code, but an unexpected end does not say why: which of the adapter's reasons (unreadable body, unknown status, negative amount, page cap, …) is only in the exception, which C7's error handling would log apart, as a stack trace.
- Production logs are the default console text format, two output lines per entry, and Container Apps stores each output line as its own row in `ContainerAppConsoleLogs_CL` (seen read-only in the workspace, 2026-11-07). Level and category sit on another row than the message, and no field is a column.
- Local runs already send structured logs to the Aspire dashboard (OTLP, `ServiceDefaultsExtensions.cs:60`), where level, category and every field can be filtered.

**The decision:**

- **a. The log line says why.** Both read lines get a `Reason` field: for an unexpected end, the `BankReadException`'s message (fixed texts that quote nothing, c004 D5; their only variable parts are the status, a code-shaped error code after D7 and a page count); for any other exception (D1 e), only its type name, since a framework message could contain anything; `none` for every other outcome.
- **b. Application Insights, fed by the app through Microsoft's Azure Monitor exporter:**
  1. a workspace-based Application Insights resource on the existing workspace `log-revolutreader`: the same billing (the first 5 GB a month per billing account free) and the same 0.1 GB daily cap (*raised to 0.16 GB by D9*);
  2. `Azure.Monitor.OpenTelemetry.Exporter` (1.10.0, stable, read 2026-11-07) added to ServiceDefaults' OpenTelemetry setup, only when the Application Insights connection string is set (`APPLICATIONINSIGHTS_CONNECTION_STRING`): only the deployed app exports to Azure; local runs (the Aspire dashboard) and the tests are unchanged. It exports logs, traces and metrics (*logs and traces only since D10*). It only adds a destination: the instrumentation and the filters that keep the bank's requests out of the traces (c004 D5) stay as they are;
  3. ingestion authorised by the app's managed identity (`id-revolutreader-app`, the user-assigned identity C4 created for Key Vault), not by the connection string's key: local authentication off on the resource, and the app's identity holds `Monitoring Metrics Publisher` on it, created by the deployment stack like the identity's Key Vault role. The connection string then only says where to send. *Added 2026-11-08 (the user, after the choice between this and the key was shown):* the deploy identity may create role assignments for four roles only ([azure-prerequisites.md](../../../docs/operations/azure-prerequisites.md) step 5, set up in M3), and `Monitoring Metrics Publisher` is not one of them. So a **guided manual task** adds it to that condition before the change's merge deploys: Claude writes the PowerShell block (delete the deploy identity's Role Based Access Control Administrator assignment and create it again with the role's ID added), the owner runs it (memory `azure-grants-run-by-owner`), Claude checks it read-only, and step 5 of azure-prerequisites.md lists five roles. Rejected: the connection string's key (no manual step, but anyone holding the connection string could send telemetry);
  4. the console output unchanged, as the safety net for a failure at start, before OpenTelemetry runs.
- **c. Ready queries** in `docs/operations/deployment.md` § Checks, against the Application Insights tables: every bank read that did not end as read (who, outcome, status, error code, reason), and the same counted by reason, to spot new cases. The exact columns are confirmed once real data arrives.

**Rejected:**

- **JSON console output** (`Logging__Console__FormatterName=json`, tried in a scratch app on .NET 11 RC3: one JSON line per entry, the fields and the exception inside): no new resource, but every query unpacks the JSON from a text column, and requests, exceptions and log lines are not linked.
- **The Container Apps managed OpenTelemetry agent** (announced generally available in May 2025; its Learn page, updated 2026-06-04, still says "preview" in the description): no code change, since ServiceDefaults already exports OTLP when the agent's address is injected. But Application Insights receives no metrics through it, it runs as one copy with no health signal, and it requires Application Insights to accept the connection string's key (local authentication).
- **The Microsoft OpenTelemetry Distro** (`Microsoft.OpenTelemetry` 1.2.0; first stable in May 2026): Microsoft's headline recommendation for new apps, with live metrics, the profiler and sampling. But it installs its own HTTP-client tracing with its own filter, which would collide with the filter that keeps the account id out of traces (c004 D5), and none of its extras is needed by one small app. It is built on the same exporter.

**Consequences:** the exporter's settings (the connection string and the client ID of the app's user-assigned identity, which the identity credential needs) are declared in `appsettings.json` with their provenance, empty there so that local runs and tests export nothing, and set in production as environment variables authored in Bicep (configuration.md); neither is a secret. `docs/conventions/workflow.md` § 5 ("No Application Insights in v1") and the resource list change; a `docs/software-factory/lessons.md` entry, since this reverses c005 D6's deferral the way its lesson R-49 foresaw ("reverses toward an application monitoring service when … traces are needed"). How the simple and the mature options were weighed is the user's call: Claude first recommended the managed agent for needing no code change, and the user chose the mature path once both were shown (memory `simplicity-vs-maturity-is-users-call`).

Sources for D8 (read 2026-11-07): [Enable OpenTelemetry in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable?tabs=aspnetcore) (updated 2026-10-09); [OpenTelemetry with Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-options); [Azure Monitor Exporter readme](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/Monitor.OpenTelemetry.Exporter-readme); [Container Apps managed OpenTelemetry agent](https://learn.microsoft.com/en-us/azure/container-apps/opentelemetry-agents); [Microsoft.OpenTelemetry on NuGet](https://www.nuget.org/packages/Microsoft.OpenTelemetry); [Azure Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/).

### D9 — The daily cap matches the free allowance: 0.16 GB a day

Decided with the user (2026-11-08, after propose): "We should set up our data limit to match that one." Changes c005 design.md D6's 0.1 GB.

- **The free allowance (read 2026-11-08):** the first 5 GB a month per billing account of Analytics Logs ingestion are free ([Azure Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/)). Workspace-based Application Insights is billed by the workspace that holds its data ([Microsoft Learn: Azure Monitor Logs cost calculations](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs), updated 2026-09-02), and the pricing page names no separate grant for it, so its data counts against the same 5 GB. Included retention: 31 days for Analytics Logs, 90 days for Application Insights data.
- **The cap:** 5 GB ÷ 31 days ≈ **0.16 GB a day** (`dailyQuotaGb` in `platform.bicep`). The workspace's cap covers the Application Insights tables too, since they live in it; the Application Insights resource keeps its own default cap.
- **Where the match is not exact:** the allowance belongs to the billing account, so any other workspace on the same billing account shares it (the subscription had none before C4, c005 D6); the cap stops collection with a short delay, so some overshoot is billed ([Microsoft Learn: daily cap](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap)); a month that reaches the cap every day ends near 5 GB.
- **Retention stays 30 days** for the workspace; the Application Insights tables follow it. Keeping them 90 days would cost nothing extra but was not asked for.
- **Consequences:** deployment.md's resources table and workflow.md § 5 say 0.16 GB; the lesson mentions the change (c005's lesson R-49 records C4's 0.1 GB as it was).

### D10 — Application Insights gets the app's logs and traces, not its metrics

Decided with the user (2026-11-08, open question 2), after comparing what each source shows.

- **What the platform already shows, free:** the Container Apps metrics page (requests, error requests, response time, replicas, CPU, memory, network in and out; Azure Monitor platform metrics, outside the workspace and its 5 GB).
- **What the other sources cover:** traces give every request as a row in `AppRequests` (route, status, duration, exception); the adapter's one log line per read gives the bank reads (outcome, status, code, reason, duration).
- **What the app's metrics would add:** .NET internals (garbage collection, heap size, thread pool, exception counts) and per-minute sums by route, which matter when hunting a leak or a slowdown inside the app, unlikely for an app that runs minutes at a time for one user. Their cost is small (an estimate, not measured: a few dozen series a minute while the app runs, a few MB on an active day), but so is their gain.
- **The rule:** the Azure Monitor exporter is registered for traces and logs only (§ Public API sketch); the app's metrics stay local (the Aspire dashboard) and are not exported in production.
- **Rejected: all three signals,** the more complete default for a long-lived app (D8 as first decided). Switching it on later is a one-line change in ServiceDefaults.

### D12 — The two telemetry settings keep their standard names

Decided with the user (2026-11-08, open question 3: "ok" to Claude's lean).

- **The names:** `APPLICATIONINSIGHTS_CONNECTION_STRING` (Microsoft's documented name for the Application Insights connection string) and `AZURE_CLIENT_ID` (Azure.Identity's name for a user-assigned identity's client ID). ServiceDefaults reads them as it reads `OTEL_EXPORTER_OTLP_ENDPOINT`; `appsettings.json` declares both at its top level, empty, with provenance comments (configuration.md: every setting is declared).
- **Where the values come from:** Bicep, from the resources themselves (§ Cross-cutting effects): `features.bicep` refers to Application Insights and the identity as `existing` and writes the two environment variables; nothing is copied by hand or looked up by the app.
- **Side effect, kept in mind for C6:** Azure.Identity's `DefaultAzureCredential` picks up `AZURE_CLIENT_ID` on its own, so C6's storage access could use the same identity without more wiring; this change itself uses an explicit `ManagedIdentityCredential`.
- **Rejected: a project-style section** (`ApplicationInsights:ConnectionString`, `ManagedIdentity:ClientId`, environment variables with `__`), the shape of the `EnableBanking` section: consistent with the project's options, at the cost of a small settings class, and names nobody outside the project knows.

### D11 — The telemetry decisions get an ADR: ADR-0009-application-telemetry

Decided with the user (2026-11-08, open question 1). The project rule records decisions with a lasting, cross-cutting effect as ADRs (workflow.md § 2); C4 had kept the log destination in its design and workflow.md § 5 only (c005 D6).

- **What it holds:** the context (a scale-to-zero app whose output would vanish with a stopped copy; the platform's own metrics; the free 5 GB a month); the decision: the Log Analytics workspace as the environment's log destination (from c005 D6), Application Insights on it fed by the app's in-app exporter with logs and traces only, written with the app's managed identity and local authentication off, and the daily cap matched to the free allowance; the alternatives rejected in D8 and D10; the consequences (the deploy identity's fifth role, the settings, #17).
- **Number:** 0009, the next free one on 2026-11-08 (C6's worktree has none newer); if another ADR lands first, the next free number when written.
- **Where it is linked:** `docs/adr/README.md` (the index), workflow.md § 5, `pm/progress.md` (C11's notes), the lesson. D8–D10 stay in this design as the trail of how it was decided.
- **Rejected: no ADR,** as C4 did. Simpler, but the telemetry setup spans decisions in two changes and outlives both; an archived design is a folder few will open, also for the D1 reinstatement guide.

## Public API sketch

The adapter (`src/RevolutReader.Api/Bank/`). Only what changes; everything else stays as c004 design.md § Public API sketch has it.

```csharp
namespace RevolutReader.Api.Bank;

/// <summary>The user's real values, checked when created (D1 g; spec bank-reads § Who triggers a read).</summary>
public sealed record PresentUser {
  /// <exception cref="ArgumentNullException">No address.</exception>
  /// <exception cref="ArgumentException">A null, empty or whitespace user agent.</exception>
  public PresentUser(IPAddress ipAddress, string userAgent);

  public IPAddress IpAddress { get; }
  public string UserAgent { get; }      // as given; cleaned only when the header is built (D5)
}

public static class PsuHeaders {
  /// <summary>
  /// Psu-Ip-Address and Psu-User-Agent for a present user, every character of the user agent outside 0x20–0x7E sent as
  /// '?' (same length, D5); none for an unattended read.
  /// </summary>
  public static IReadOnlyList<KeyValuePair<string, string>> For(ReadTrigger trigger);
}

public static class TransactionPages {
  /// <summary>The most pages one read requests (D4).</summary>
  public const int MOST_PAGES = 20;

  /// <summary>
  /// As before (every key followed, an empty page too; a repeated key → BankReadException; a failed page fails the read),
  /// and a 20th page that still carries a key → BankReadException naming the cap, with no 21st request (D4).
  /// </summary>
  public static Task<BankResult<JoinedPages>> ReadAll(Func<string?, Task<BankResult<EbTransactionPage>>> readPage);
}

public static class TransactionMapping {
  /// <summary>
  /// As before, and a kept (booked or pending) transaction with a negative amount → BankReadException that quotes no
  /// amount (D2). A zero amount comes out as zero, never as a negative zero. Left-out transactions stay unread.
  /// </summary>
  public static MappedTransactions Map(IEnumerable<EbTransaction> transactions);
}

/// <summary>The shape of an Enable Banking error code (D7).</summary>
public static class EnableBankingErrorCode {
  /// <summary>A capital letter, then capital letters and underscores, 64 characters at most (^[A-Z][A-Z_]{0,63}$, ordinal).</summary>
  public static bool HasCodeShape(string? value);
}
```

`EnableBankingClient` keeps its signature. Inside:

- **Reading an error answer (D3, D7):** the body's `error` value is the code only when it has the code shape. An empty body, JSON `null`, a missing, blank or non-string `error`, a body that is not JSON of the error answer's shape, and a value of another shape all mean no code, so `BankErrorClassification.Classify` (unchanged) decides by the status. No error answer throws because its body cannot be read.
- **The log line's error code:** the code as received; `none` when the answer carried no value; `unrecognised` when it carried a value of another shape (never quoted). A `BankReadException` for an error answer names the status and the code, "no error code" or "an unrecognised error value", nothing else.
- **Every end writes the line (D6):** a result, a `BankReadException` and the caller's cancellation as today; any other exception at `Error`, outcome unexpected, `Reason` = its type name, then rethrown unchanged.
- **The two lines (D8 a):**

  ```csharp
  [LoggerMessage(EventId = 1, Message = "Bank balance read for {Who}: {Outcome}; HTTP status {Status}, error code {ErrorCode}, reason {Reason}, {DurationMs} ms")]
  [LoggerMessage(EventId = 2, Message = "Bank transactions read for {Who}: {Outcome}; HTTP status {Status} on the last page, error code {ErrorCode}, reason {Reason}, {Pages} pages, {LeftOut} left out, {DurationMs} ms")]
  // Reason: the BankReadException's message; another exception's type name (Type.Name); "none" for every other outcome.
  ```

ServiceDefaults and settings (D8 b):

```csharp
// RevolutReader.ServiceDefaults.ServiceDefaultsExtensions.AddOpenTelemetryExporters:
//   OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is set (unchanged; Aspire, locally);
//   Azure Monitor when APPLICATIONINSIGHTS_CONNECTION_STRING is set (production), for logs and traces only (D10), so
//   per signal rather than UseAzureMonitorExporter(), which registers metrics too:
TokenCredential credential = new ManagedIdentityCredential(ManagedIdentityId.FromUserAssignedClientId(clientId));   // AZURE_CLIENT_ID
builder.Services.AddOpenTelemetry()
  .WithTracing(tracing => tracing.AddAzureMonitorTraceExporter(o => { o.ConnectionString = connectionString; o.Credential = credential; }))
  .WithLogging(logging => logging.AddAzureMonitorLogExporter(o => { o.ConnectionString = connectionString; o.Credential = credential; }));
//   (The exact per-signal methods are checked against Azure.Monitor.OpenTelemetry.Exporter 1.10.0 at implementation.)
//   APPLICATIONINSIGHTS_CONNECTION_STRING set while AZURE_CLIENT_ID is empty → InvalidOperationException at start,
//   naming AZURE_CLIENT_ID (never a value).
```

```jsonc
// appsettings.json, top level: the standard names Azure Monitor and Azure.Identity use, read in ServiceDefaults as
// OTEL_EXPORTER_OTLP_ENDPOINT is (c006 design.md D8). Empty: nothing is exported to Azure (local runs, tests).
// Production: environment variable on the container app, from the Application Insights resource (infra) · Local: empty.
"APPLICATIONINSIGHTS_CONNECTION_STRING": "",
// Production: environment variable on the container app, the client ID of id-revolutreader-app (infra) · Local: empty.
"AZURE_CLIENT_ID": ""
```

The acceptance DSL and drivers:

```csharp
// Dsl/BankDsl.cs (GIVEN): a gateway in front of the bank answers 503 with its own HTML maintenance page, no error code.
public void GatewayAnswersWithMaintenancePage();

// Drivers/FakeBank.cs: the matching answer, written (the Mock ASPSP cannot produce it) with a comment saying so.
// The accented-browser scenario needs nothing new: Bank.ReadBalanceFor(user) and RequestAtBank.WithUserHeadersOf(...),
// compared with the cleaned browser name.
```

## Rule ownership

| Rule (spec, decision or convention) | Enforced by |
|---|---|
| A read requests at most 20 pages; a 20th page with a key is an error (bank-reads § Every page is read, D4) | `TransactionPages` |
| A kept transaction with a negative amount is an error; zero stays zero (§ What a transaction carries, D2) | `TransactionMapping` |
| A present user has an IP address and a non-blank user agent (§ Who triggers a read, D1 g) | `PresentUser` |
| Each user-agent character outside printable ASCII reaches the bank as `?` (§ Who triggers a read, D5) | `PsuHeaders`, applied to every request by `EnableBankingClient` |
| Only a code-shaped `error` value is a code; otherwise the status decides (§ Bank unavailable, D3, D7) | `EnableBankingErrorCode` (the shape), `EnableBankingClient` (reading the body), `BankErrorClassification` (the status table, unchanged) |
| An error value is quoted in logs and exceptions only when code-shaped, else `unrecognised` (D1 f, D7) | `EnableBankingClient` with `EnableBankingErrorCode` |
| Every end of a read writes one line, with a `Reason` (D6, D8 a) | `EnableBankingClient` |
| No account id, session id or user address in logs or exported telemetry (c004 D5), Application Insights included | unchanged (`RemoveAllLoggers()`, `HttpRequestTracing.Exclude`, the one line); `BankTelemetryTests` collects what the app exports, whatever the destination |
| Only the deployed app exports to Application Insights, writing with its own identity (D8 b) | `ServiceDefaultsExtensions` (only with the connection string; refuses to start without the client ID); Bicep (local authentication off, the role) |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected failures (Result) | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `ReadBalance` | `Balance` | `BankAccessExpired`, `BankRateLimited`, `BankUnavailable`; **now also** a 5xx or 408 without a code-shaped `error`, whatever its body, as `BankUnavailable`, and a 429 without one as `BankRateLimited` (D3) | `BankReadException`: an unknown code-shaped code, another status without a code, an unreadable success answer, no `ITAV` balance. Any exception still writes the line (D6). `OperationCanceledException` when the caller cancels |
| `ReadTransactions` | `Transactions` | the same, from any page | the same, plus a repeated continuation key, **a 20th page that still carries a key (D4)** and **a kept transaction with a negative amount (D2)** |
| `new PresentUser(…)` | `PresentUser` | — | `ArgumentNullException` (no address), `ArgumentException` (a blank user agent): a programming error at the caller (D1 g) |
| App start | — | — | `InvalidOperationException` when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set and `AZURE_CLIENT_ID` is not; the message names the setting, never a value (D8 b) |
| Export to Application Insights | — | — | none reaches the app: the exporter retries and keeps unsent data in its offline storage; its own failures go to OpenTelemetry's self-diagnostics, and a request never waits for it |

## Ports and contracts

**`IBankAccount`** (changed; capability `bank-reads`):

- **Behaviour, added:** a read requests at most 20 pages (D4); a kept transaction with a negative amount fails the read (D2); the user agent reaches the bank cleaned (D5); a present user is valid by construction (D1 g); a server error, 408 or 429 without a code-shaped `error` is a result whatever its body (D3).
- **Unchanged:** read-only, two operations, the bank's order with pages joined, no retries, the per-request timeout, concurrency (stateless apart from the HTTP client), idempotency (c004 design.md § Ports and contracts).
- **Failure modes:** § Error model. Every end of a read writes one log line, with a `Reason` (D6, D8 a).
- **Infrastructure:** unchanged (typed `HttpClient`, no resilience handler, logging removed, requests excluded from tracing, a JWT per request, System.Text.Json).
- **In-memory fake for unit tests:** none, as in C5 (§ Goals / Non-Goals).

## How each scenario is verified

Both new scenarios through the port, as c004 D1 decided, in `Scenarios/BankReads/BankReadsScenarios.cs` with `[Scenario("bank-reads", "<name>")]`, driven by `BankDriver` against the app copy's `IBankAccount` and the fake bank:

- **"A browser name with an accent reaches the bank with a question mark":** the fake bank records the headers it received; the test compares them with the cleaned name.
- **"A gateway's error page reads as bank unavailable":** the fake bank's new answer (`GatewayAnswersWithMaintenancePage`).

The modified requirements' existing scenarios stay as they are and stay green. Their new error clauses (a negative amount, the 20th page, a present user without an address or user agent) are errors, not results, so as in C5 they are covered by unit tests and adapter edge-case tests (`IntegrationTests/Wiring/EnableBanking/`), not by scenarios. None is a frontend or manual scenario: nothing reaches a screen or a device.

## Cross-cutting effects

- **API contract / TS client:** none; no endpoint.
- **Bicep** (`infra/`, deployed by the pipeline as the stack `revolutreader`; `az bicep lint` stays free of warnings, which fail `image-and-infra`):
  - `platform.bicep`: a workspace-based Application Insights resource `appi-revolutreader` on the workspace (`WorkspaceResourceId`), local authentication off (`DisableLocalAuth: true`); a role assignment `Monitoring Metrics Publisher` for `id-revolutreader-app` on it; the workspace's `dailyQuotaGb` 0.16 (D9);
  - `features.bicep`: the Application Insights resource and the app's identity referenced as `existing` (the user, 2026-11-08), so no connection string travels as a module output; from them, two environment variables on the container app: the connection string (`appInsights.properties.ConnectionString`) and the identity's client ID (`appIdentity.properties.clientId`); neither a secret. Their names: § Open questions, item 3. `main.bicep` keeps features waiting for the whole platform module, as today;
  - a read-only preview before the PR ([deployment.md § Previewing a change to the Bicep](../../../docs/operations/deployment.md#previewing-a-change-to-the-bicep-read-only)).
- **By hand, once, before the merge** (guided task, D8 b): the deploy identity's role condition gets `Monitoring Metrics Publisher`; without it the deploy fails at the new role assignment.
- **Settings:** the two top-level keys in `appsettings.json` with provenance comments (§ Public API sketch). The configuration rule ("no cloud credential in the configuration path") is untouched: the credential authorises sending telemetry, never reading a setting.
- **Bank calls** (ADR-0001 § Decision): the same requests; the user agent is still the user's real browser, with the characters HTTP cannot carry replaced.
- **ADRs:** **ADR-0009-application-telemetry** (new, D11): where the app's telemetry goes and how it is bounded (D8 b, D9, D10, and c005 design.md D6's workspace, which never had an ADR); added to `docs/adr/README.md`; workflow.md § 5 and `pm/progress.md` link it. D3 changes c004 design.md D4's table for error answers, recorded here: a rule of the adapter, not a cross-cutting decision.
- **Conventions:** workflow.md § 5 (Application Insights in v1, the resource list, the 0.16 GB cap); configuration.md (the two settings and their standard names).
- **Operations:** deployment.md (the resources table with Application Insights and the 0.16 GB cap, the identity's roles, § Checks: the two ready queries); azure-prerequisites.md step 5 (five roles, and the command that widened the condition).
- **Software factory:** a lesson in lessons.md (R-53, or the next free number when written): sending a .NET app's telemetry to Application Insights (the in-app exporter against the platform's managed agent and the vendor's all-in-one package), writing with the app's identity, and the deploy identity's role condition that has to grow with it. No inventory line: no reusable artifact.
- **Design:** no UI.

## Risks / Trade-offs

- [Revolut starts sending signed amounts] → every read holding such a transaction fails, and the log line's `Reason` names it; the fix is small (D2).
- [20 pages are too few if Revolut shrinks its pages drastically] → reads of long periods fail with the cap's `Reason`; raise the constant (D4).
- [Telemetry fills the daily cap (0.16 GB, D9)] → logs and traces only (D10), from an app that scales to zero and serves one user; a reached cap would stop all collection until the reset. #17 checks the real ingestion in the first days.
- [The exporter's offline storage cannot write in the chiseled, non-root container] → the exporter logs it to its self-diagnostics and sends without the buffer; the first deploy's check looks for missing telemetry. If needed, offline storage is turned off or pointed at a writable folder.
- [The Azure Monitor exporter bypasses the bank's trace filter] → it only adds an exporter to the same pipeline; `BankTelemetryTests` checks what the app exports through the same pipeline.
- [OTLP and Azure Monitor configured at once] → never in practice (Aspire sets OTLP locally, Bicep sets Application Insights in production); the implementer confirms they compose, or makes them exclusive.
- [The guided role step is not done before the merge] → the deploy fails at the role assignment and the previous revision keeps running; the owner runs the step and the workflow is re-run.
- [A wrong client ID or a missing role] → no telemetry arrives, the app keeps working, the console output still reaches the workspace; the post-merge check catches it.
- [Conflicts with parallel branches] → `fix/review-findings` (PR #26) and the handover (PR #25) are merged and this branch is rebased on them (2026-11-08); C6's change, when it merges first, touches `pm/` and possibly ServiceDefaults, reconciled at merge.
- [The ready queries' columns differ from what the docs suggest] → confirmed once the first bank lines arrive, which needs C7's first call; a heads-up for C7.

## Migration plan

Nothing to migrate: no stored data, no endpoint. Order: the guided role step, then the merge; the pipeline creates Application Insights, the role and the two variables, and deploys the new image. **After the merge** (a follow-up recorded in `pm/progress.md`, as C5's first deploy was): a read-only query shows the app's start lines in `AppTraces` and a request in `AppRequests`. **Rollback:** revert the merge; the stack deletes the Application Insights resource (telemetry already written stays in the workspace until its retention ends), the app stops exporting, the cap returns to 0.1 GB, and the widened role condition stays, harmless.

## Open questions (to settle with the user before `/tdd-apply`)

Each would change a task, so none is decided on the user's behalf (memory `simplicity-vs-maturity-is-users-call`). Claude's lean is given; the choice is the user's.

1. ~~An ADR for Application Insights?~~ **Decided 2026-11-08: yes, ADR-0009-application-telemetry (D11).**
2. ~~Export metrics too, or logs and traces only?~~ **Decided 2026-11-08: logs and traces only (D10).**
3. ~~The two settings' names?~~ **Decided 2026-11-08: the standard names (D12).**
4. **The user's browser in exported request telemetry** (raised by PR #26): OpenTelemetry's ASP.NET Core instrumentation records each incoming request's browser (`user_agent.original`) on its server span. Today nothing exports spans in production; with D8 they reach Application Insights (`AppRequests`), so from C7 on the daughter's browser string is stored there for each request. PR #26 now treats the browser as personal data the guard keeps out of logs and traces for bank reads (c004 D5: "personal data with no use in the log"). Options: accept it (standard request telemetry, useful to tell the phone app from a browser), or strip `user_agent.original` from exported spans in ServiceDefaults (a few lines and a test, consistent with c004 D5). Lean: strip it, for consistency with D5; the user decides.
