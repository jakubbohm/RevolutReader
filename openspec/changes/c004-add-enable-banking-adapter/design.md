# Design: c004-add-enable-banking-adapter

## TL;DR

- **The bank port gets a spec** (`bank-reads`), verified through its public interface: acceptance tests take the port from the test's app copy and point it at a WireMock.Net fake bank (D1).
- **Two reads for the one configured account**: the balance, and the transactions from a day across every page. Every call states who triggers it, a present user (IP address and user agent go to the bank) or unattended (no PSU headers); there is no default (D2).
- **Booked and pending transactions only, seven fields each**; everything else stays out (D3).
- **One generic union for results**, `BankResult<T>`: the value, or access expired, rate limited, bank unavailable, decided by Enable Banking's `error` code. No retries, a 15 s per-request timeout, and a failed page fails the whole read (D4).
- **No identifiers in telemetry**: the bank client's HTTP logging is removed and its requests are kept out of the exported traces; the adapter logs one line per read; a guard test checks it (D5).
- **Settings:** an `EnableBanking` section validated at start-up. Application id, key, session and account are secrets (AppHost user-secrets locally, Key Vault in production), with a copy in the owner's backup vault (D6). Two explicit checks against the real service; the recent window is 31 days (D7).
- **New public interfaces:** `IBankAccount` (the port), `ReadTrigger` (`PresentUser` / `Unattended`), `BankResult<T>` with `BankAccessExpired`, `BankRateLimited`, `BankUnavailable`, `Balance`, `Transactions`, `BankTransaction`; `AddEnableBanking()`; DSL `Bank`; drivers `BankDriver`, `FakeBank`.
- **Integration points:** Enable Banking (`GET /accounts/{id}/balances`, `GET /accounts/{id}/transactions`, read-only); the AppHost's four secret parameters; ServiceDefaults' trace filter; Bicep through whichever of C4 and C5 merges second (D8).
- **Hard to reverse:** the port's contract once C7 and C9 build on it, above all the result cases and the explicit present-user / unattended form.

## Context

- See proposal.md § Why. Every decision below was made with the user in explore, one at a time (2026-11-06); D8 records the parallel work.
- **Backend today:**
  - `Program.cs`: ServiceDefaults, ProblemDetails with `UseStatusCodePages`, C3's `UseAppPages()`, FastEndpoints with `GET /health`.
  - ServiceDefaults: OpenTelemetry (ASP.NET Core and HTTP-client instrumentation, OTLP when configured) and service discovery; no resilience handler, so no retries (C1).
  - No options class, no `HttpClient` and no Result type yet; `appsettings.json` holds only logging and `AllowedHosts`.
  - CA1515 is off for the API, so its types stay public.
- **Tests today:**
  - The acceptance harness runs one app copy per test in `Production`. `AcceptanceTest.ConfigureWebHostBuilder` sets the environment and C3's stand-in web root, and `Services` gives the app copy's service provider.
  - The unit project holds C3's `PageCachingTests`; the integration project is empty but references the API.
- **Enable Banking** (API reference, read 2026-11-06; spikes `enable-banking/` and `enable-banking-mock/`):
  - every request carries a JWT signed RS256 with the application's key (`kid` = application id, `iss` `enablebanking.com`, `aud` `api.enablebanking.com`, at most a day; we use one hour, docs/operations/expiring-approvals.md);
  - errors arrive as `{ message, code, error, detail }`;
  - the Mock ASPSP pages transactions by 10, Revolut by 50; how the last page is signalled is not documented.
- **Real data seen so far** (counts only): D3's check of the M1 history, and the 2026-11-06 smoke test (22 transactions since 2026-10-30, 20 `BOOK`, 2 `PDNG`).

## Goals / Non-Goals

**Goals:**

- The thirteen `bank-reads` scenarios, all verified through the port (§ How each scenario is verified).
- The adapter as C7 and C9 will use it: production wiring, settings validated at start, telemetry without identifiers.
- Evidence that the real Enable Banking answers as the fake bank does: Check 1 against the Mock ASPSP, Check 2 once against the real account (D7).

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- No in-memory fake of the port: no unit test in C5 needs one, so there is no `[integration]` group (testing.md § Fake bank). C7 decides whether its handlers need one.
- No caching of tokens or results: one token per request, one bank call per page.
- No time zone handling: Enable Banking's dates are calendar dates, and `date_from` is taken as given.

## Bootstrap (done before `/tdd-apply`, not in tasks.md)

The test-writer may add only signatures to production code, and the fake bank's answers must be copied from real Mock ASPSP responses (testing.md § Fake bank). So, as in C1 and C3, Claude prepares a green starting point on the change branch once the user approves these artifacts, committed as `[setup]`. None of it is behaviour.

1. **Packages** (verified on nuget.org, 2026-11-06), in `Directory.Packages.props` under Tests:
   - `WireMock.Net` 2.21.0, referenced by the acceptance and integration test projects;
   - `OpenTelemetry.Exporter.InMemory` 1.20.1 (the version of the other OpenTelemetry packages), referenced by the acceptance tests for D5's guard.
2. **A 180-day Mock ASPSP session** (D6): `create-mock-session.ps1` asks for 180 days instead of 10 (one line), and the owner runs it with the Control Panel login. The current session ends 2026-11-14.
3. **Made-up test data with more than one page:**
   - Claude writes `spikes/enable-banking-mock/test-data/c004-transactions.json`, 25 made-up transactions in the shape of the API reference's `Transaction`: booked and pending, money in and out, one without a counterparty, one with two lines of payment details, and one each cancelled and rejected.
   - The owner uploads it in the Control Panel.
   - The owner runs `read-mock.ps1`, which saves every page unchanged to `evidence/`.
   - The fake bank's answers are copied from that capture. The capture also shows how the bank marks the last page (no key, an empty key, or an empty page); D7's paging rule holds either way.
4. The setup build and the full suite are green. The only accepted red is the traceability check reporting this change's 13 scenarios as not claimed; group 1 claims them.

## Decisions

> Started in `/opsx:explore` (2026-11-06): each decision was recorded here right after the user's yes. Two refinements made while writing the rest of this design in `/opsx:propose` are marked as such (D5, D7); D8 was added there.

### D1 — The bank port gets a spec, verified through its public interface

Decided with the user (2026-11-06, explore). C5 adds no endpoint: the first one that reads the bank is C7, behind C6's sign-in, and an earlier anonymous one would expose the balance once C4 deploys. The rule "every scenario is verifiable through a public channel (API, UI or a notification)" left the adapter without a spec, and the place the conventions gave a port's contract (this file's "Ports and contracts") is archived with the change, so the contract C7 and C9 build on would have no lasting home in `openspec/specs/`.

- **A port that later changes build on gets a capability spec.** Its public channel is its public interface. A class used only inside its own change stays in `design.md`.
- **Verified by acceptance tests, as any scenario.** The four layers stay; only the driver changes channel: `Drivers/` takes the port from the test's own app copy (production wiring: settings, `HttpClient`, no retries) and points the adapter at the WireMock fake bank. The traceability check and `/tdd-apply` work unchanged (a normal `[acceptance]` group).
- **Observable outcomes:** the result the port returns and the requests the fake bank received (PSU headers, number of calls). Error scenarios name result cases, not problem descriptions; those start where an endpoint maps the cases (C7).
- **Scenarios name domain outcomes** (balance read, consent expired), never methods or classes, so restructuring the code does not churn the spec.
- **Costs accepted:** C7's endpoint scenarios run through the same adapter, so a mapping bug turns two tests red (different claims, overlapping paths); `specs/` now holds component contracts next to app behaviour, kept small by the rule above.
- **Doc updates, as tasks of this change:** `openspec/config.yaml` spec rules (a port's scenarios are verified through its public interface; their error scenarios name result cases); `docs/conventions/testing.md` (acceptance tests may drive a port directly; the driver's channel); a `docs/software-factory/lessons.md` entry (the public-channel rule generalises from apps to libraries and ports: the channel is the public interface of what is specified).
- **Alternatives rejected:** an adapter-only change with no specs, test-first through integration and unit tests, its user-facing scenarios in C7 (proposed by Claude first; it leaves the contract without a lasting spec and needs a new kind of change in `/tdd-apply`); folding C5 into C7's first slice (every behaviour gets an API scenario, but C5 would wait for C3 and C6 and lose the parallel track).

### D2 — The port's surface and how PSU headers reach it

Decided with the user (2026-11-06, explore). Checked against the [Enable Banking API reference](https://enablebanking.com/docs/api/reference/) (read 2026-11-06).

- **Two read-only operations, both for the one configured account:** the balance, and the transactions from a given date, the adapter following every page itself (`continuation_key`, "only valid in current session"). No `date_to`, no `transaction_status` filter (everything is read and the statuses are mapped), no `strategy` other than the default, no session-status call. Callers never pass account or session ids; both come from configuration.
- **PSU headers are a required parameter with two forms:** *present user* (IP address and user agent) or *unattended* (no PSU headers). Every caller states which; there is no default. Rejected: the adapter copying headers from whatever HTTP request it runs inside. Under the original C9 plan that would have forwarded the Logic App's own address as a PSU header, against ADR-0001's "never PSU headers on the background job", and a fallback check in C9 could do the same. The explicit form makes the constraint visible at every call site and checkable at the fake bank.
- **A fixed header set: `Psu-Ip-Address` and `Psu-User-Agent`,** not a lookup of the required headers in `GET /aspsps`. Revolut lists no `required_psu_headers` (2026-11-04), M1 proved the pair works, and Enable Banking recommends exactly these two. A lookup adds a bank-list call, caching and code for a case that cannot happen today; if Revolut ever requires a header, the read fails visibly with `PSU_HEADER_NOT_PROVIDED`. **ADR-0001 § Consequences ("takes the list of required headers from `GET /aspsps`") gets a dated amendment** as a task of this change.
- **The IP is a parsed IP address, checked when the present-user form is created.** Enable Banking rejects a malformed one with 422 `PSU_HEADER_INVALID` (Mock ASPSP, 2026-11-04).
- **Dependency for C7 (or C4), not built here:** behind the Container Apps ingress the user's address arrives in `X-Forwarded-For`; without the forwarded-headers setup the app would send the ingress's internal address as the user's.

### D3 — What the port hands back: the fields the screens need, plus the storage key

Decided with the user (2026-11-06, explore). Grounded in the Screens design (artboards `Account / Detail / *` and `Account / Transaction sheet / *`, and the `Tx` type of its components: kind, status, counterparty, description, signed EUR amount, date and time; the balance in EUR with a CZK equivalent), the [Enable Banking API reference](https://enablebanking.com/docs/api/reference/) (read 2026-11-06) and two checks of real data that recorded counts only.

- **Balance:** amount and currency of the `ITAV` balance, the one Revolut returns (M1, 2026-11-04; again 2026-11-06).
- **Transaction:**

  | Field | From Enable Banking |
  |---|---|
  | reference | `entry_reference` (C7 stores settled transactions by it, ADR-0001 § Decision item 6; a pending one may not have it) |
  | status | `BOOK` → booked, `PDNG` → pending |
  | date | `transaction_date`, else `booking_date`, else `value_date` |
  | amount | `transaction_amount.amount`, negative when `credit_debit_indicator` is `DBIT` |
  | currency | `transaction_amount.currency` |
  | counterparty | `creditor.name` for `DBIT`, `debtor.name` for `CRDT`; may be missing |
  | payment details | the `remittance_information` lines, passed through unchanged as a list; may be empty |

- **Left out:** every other field (`balance_after_transaction`, `exchange_rate`, `merchant_category_code`, `bank_transaction_code`, accounts, agents, references, `note`, `transaction_id`); transactions with any other status (`CNCL`, `RJCT`, `HOLD`, `SCHD`, `OTHR`), of which only the count is logged. Less mapped is less bank data in memory and logs; C7 adds a field when a screen needs it.
- **Payment details stay a list, not a joined description** (the user, after the check below): in 100 of 116 real transactions one line only repeats the counterparty's name. How to show the lines (drop the repeated name, what to show when nothing remains) is a display rule for C7, which decides Q7.
- **Check of the M1 history file** (2026-11-06; 116 settled transactions since 2026-08-08; counts only, nothing printed or saved):
  - `transaction_date` never present; `booking_date` and `value_date` always present, date-only; `booking_date` never later than `value_date` (100 earlier, 16 equal). So for settled Revolut transactions the date rule lands on `booking_date`, the earlier date.
  - Counterparty missing on 1 of 103 `DBIT` (no `creditor.name`) and 2 of 13 `CRDT` (no `debtor.name`).
  - `remittance_information` on all 116, at most 2 lines (14 with 2); one line equals the counterparty name in 100.
  - `bank_transaction_code` (`description`, `code`, `sub_code`) on all 116; `exchange_rate` on 2; `merchant_category_code`, `transaction_id`, `balance_after_transaction`, `note` on none; one currency.
  - 50 transactions per page, newest first (pages of 50, 50, 16).
- **Pending transactions confirmed** ([evidence](../../../spikes/enable-banking/evidence/2026-11-06-smoke-test.json), 2026-11-06, the owner's PSU headers): transactions since 2026-10-30 returned 22 in one page, 20 `BOOK` and 2 `PDNG`. This settles ADR-0001's open "whether Revolut returns pending transactions"; which fields a pending one carries (`entry_reference`, which dates) and how long it stays pending (the recent window, ADR-0001 § Consequences) remain for C5's check against the real account.
- **Heads-ups for C7, not built here:**
  1. **Time of day:** the screens show "5. 11. 2026, 14:05", but every Enable Banking transaction date is date-only. The design drops the time, or C7 finds it elsewhere.
  2. **Refunds:** no field says "refund"; `bank_transaction_code` is the likely source.
  3. **CZK equivalent:** a daily EUR→CZK rate from outside the bank (e.g. the Czech National Bank), a new external dependency that is not the adapter's business.
  4. **Payment details:** the display rule above.

### D4 — The result type: one generic union, three failure cases

Decided with the user (2026-11-06, explore). Grounded in the Screens design's error artboards (`Account / Detail / Error – bank link expired`, `– too many requests`, `– bank unavailable`, `– bank unavailable, no data`), the [Enable Banking API reference](https://enablebanking.com/docs/api/reference/) (`ErrorCode`, read 2026-11-06) and Microsoft Learn on [C# 15 union types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/union) (updated 2026-10-23: a union can be generic, and a type parameter can be a case type).

- **One generic union for both reads:** the success value is the type parameter (a balance, or the list of transactions), the three failures are shared. Sketch (names settled in the Public API sketch): `union BankResult<T>(T, BankAccessExpired, BankRateLimited, BankUnavailable)`; a `switch` over it must handle all four.
- **The failure records are declared next to the union, not nested in it** (deviation from docs/conventions/README.md § Backend code, "records nested in it"): nested in a generic type, each would be a separate type per success type, and C7, which reads both, would handle every failure twice. README's sentence is updated as a task of this change.
- **The cases and what maps to them, decided by Enable Banking's `error` code** (the reference does not say which HTTP status comes with which code; a secondary source says 422 or 404 for session errors). The HTTP status decides only when the body carries no code:

  | Case | The screen it leads to | `error` codes (HTTP status without a code) |
  |---|---|---|
  | **Access expired**: only the owner can fix it | "Propojení s bankou vypršelo" (the owner must renew the link) | `EXPIRED_SESSION`, `REVOKED_SESSION`, `CLOSED_SESSION`, `SESSION_DOES_NOT_EXIST`; by best reading also `ASPSP_PSU_ACTION_REQUIRED` (the bank wants the account holder), `NO_ACCOUNTS_ADDED` and `ASPSP_ACCOUNT_NOT_ACCESSIBLE` (lost access to the account, e.g. if API access depends on the 30-day Control Panel link, roadmap M9) |
  | **Rate limited** | "Příliš mnoho obnovení" | `ASPSP_RATE_LIMIT_EXCEEDED` (429). **Never retried** |
  | **Bank unavailable** | "Banka teď neodpovídá", with a retry | `ASPSP_ERROR`, `ASPSP_TIMEOUT` (5xx, 408); our own timeout; a network failure |

- **Expired and revoked are one case:** one screen, one remedy (the owner links the account again). The log records the actual code.
- **"Bank unavailable" is a result, not an exception:** an outside service the app expects to fail now and then, with its own screen in the design. Exceptions stay for bugs and infrastructure failures (docs/conventions/README.md § Backend code).
- **Our own timeout per bank request is a setting** with a starting value (about 15 s), adjusted after C5's check against the real account measures how long reads take; without it `HttpClient` waits 100 s.
- **A multi-page read that fails on any page fails as a whole** with that page's case; no partial list.
- **Everything else is an exception** (a bug or misconfiguration on our side): a wrong key or account (`UNAUTHORIZED_ACCESS`, `ACCOUNT_DOES_NOT_EXIST`, `ACCESS_DENIED`), wrong parameters (`WRONG_REQUEST_PARAMETERS`, `WRONG_CONTINUATION_KEY`, `DATE_FROM_IN_FUTURE`, …), a rejected or missing PSU header, an unknown code, a body that cannot be parsed, no `ITAV` balance. The log carries the HTTP status and the error code only; C7's endpoint turns it into a 500.
- **The case → status rows move to C7,** the first endpoint that maps these cases (D1); docs/conventions/README.md § Backend code ("the bank cases in C5") is updated as a task of this change.
- **Early expiry is real:** Enable Banking's [January 2026 changelog](https://enablebanking.com/blog/2026/02/17/enable-banking-changelog-january-2026) reports sessions expiring before their `valid_until` after certificate updates.

### D5 — No account identifiers in logs or traces: silence the bank client, log one line per read

Decided with the user (2026-11-06, explore). Since .NET 9 the built-in `IHttpClientFactory` logging redacts only the query string of a URI (replaced by `*`); the path is logged as is ([Microsoft Learn, .NET 9 breaking change](https://learn.microsoft.com/en-ca/dotnet/Core/compatibility/networking/9.0/query-redaction-logs), read 2026-11-06), and OpenTelemetry's HTTP-client instrumentation (ServiceDefaults) records the URL of every outgoing call. The bank's paths carry the account id (`/accounts/{uid}/balances`, `/accounts/{uid}/transactions`), and those log lines are at `Information`, the base level in `appsettings.json`. Untreated, the account id would reach every log and trace, locally (Aspire dashboard) and in production (C4's log destination). CLAUDE.md: never log account identifiers.

- **For the bank's `HttpClient` only:** the factory's default HTTP logging is removed, and its requests are left out of the HTTP-client traces. Nothing records the URL, so nothing has to be masked. *Refined in propose:* the client marks each request with a request option (`HttpRequestTracing.Exclude`) that ServiceDefaults' trace filter drops, rather than ServiceDefaults filtering by the Enable Banking host; ServiceDefaults then needs no bank address, and the test's fake bank is excluded the same way.
- **The adapter logs one line per read instead:** which read (balance, transactions), present user or unattended, HTTP status, Enable Banking `error` code, duration, number of pages, number of transactions left out (D3). The line carries the request's trace id through the logging scope, so it can still be matched to a trace. Never the PSU IP address or user agent (personal data with no use in the log), never amounts, names, texts or ids.
- **Exceptions the adapter throws (D4's "everything else") never carry a URL or a response body** in their message.
- **A guard test:** it runs a bank read in the test's own app copy against the fake bank, collects every log message (with its scopes) and every trace activity with its tags, and fails when the configured account id, the session id or the PSU IP address appears in any of them. *Refined in propose:* "every trace activity" means every activity the app exports, collected by OpenTelemetry's in-memory exporter. Since .NET 9 the runtime's own HTTP activity carries the URL in-process; it is harmless as long as nothing exports or logs it, and a plain `ActivityListener` would fail on it. A rule, not a scenario (no public channel shows logs), so it is listed in Rule ownership and lives with the structural checks of the running app (`Conventions/`).
- **Rejected:** masking the id in place (a custom HTTP-client logger plus rewriting the URL tags on each trace activity), which keeps bank calls as their own trace steps but relies on two hooks that must catch every place a URL is recorded.

### D6 — Settings and secrets: one `EnableBanking` section, every identifier a secret

Decided with the user (2026-11-06, explore). Follows docs/conventions/configuration.md: `appsettings.json` is the inventory of every setting, a secret is declared there as `"<secret>"`, and the options are validated at start-up (`ValidateDataAnnotations`, `ValidateOnStart`), so the app refuses to start while one is missing.

| Setting | Production | Local (`aspire start`) | Tests |
|---|---|---|---|
| API address | `appsettings.json`: `https://api.enablebanking.com` | same | the WireMock fake bank's address |
| Application ID | Key Vault (C4) | the AppHost's user-secrets: the sandbox application | made up |
| Private key (PEM text) | Key Vault (C4) | user-secrets: the sandbox key | generated at test time |
| Session ID | Key Vault (C4) | user-secrets: the Mock ASPSP session | made up |
| Account ID | Key Vault (C4) | user-secrets: the Mock ASPSP account | made up |
| Request timeout | `appsettings.json`: 15 s (D4) | same | short |

- **The application ID is kept out of the settings files too** (the user): it is not confidential (it is the JWT's `kid`, and the M1 spike already shows it), but it does not belong in the app's visible settings. `appsettings.json` therefore declares four `"<secret>"` entries, and `appsettings.Development.json` gets no Enable Banking entry.
- **Local runs:** `aspire start` does not start the API until the four local secrets are set. User-secrets live per machine under the AppHost's id, so every checkout on the machine shares them (the C3 worktree too). They reach the API as Aspire parameters (configuration.md). A **guided manual task** sets them from the owner's files with PowerShell: nobody pastes the key by hand, and the PEM is stored as the file's text.
- **A longer Mock ASPSP session for local development:** the current one expires 2026-11-14, because the spike script (`spikes/enable-banking-mock/create-mock-session.ps1`) asks for 10 days. The guided task changes that one line to 180 days, the most the Mock ASPSP allows, and creates a new session, which needs the owner's Control Panel login once. The new expiry goes into docs/operations, which lists every expiring secret.
- **Production:** C4's first deployment needs the four production values in Key Vault. C5 lists them in configuration.md § Hand-provisioned secrets, with C4's guided task as the step that puts them there. The values are already on the owner's machine (the key in `spikes/enable-banking/secrets/`, the session and account ids in `secrets/session.json`).
- **Tests need no real secret:** the acceptance harness gives every app copy a key generated at test time, made-up ids and the fake bank's address. The existing health and error tests get them too, otherwise their app copies would no longer start.
- **Heads-up for C6:** if its OpenAPI export starts the app, that run needs these settings filled with dummy values.
- **A backup copy of every local secret in the owner's personal Key Vault** (the user, 2026-11-06): `jb-localdev-secrets-copy` (resource group `Shared`, the owner's subscription) keeps the local secrets so they survive a new or reinstalled laptop. All the owner's projects share it; the app and the tests never read it.
  - **Names:** `RevolutReader--<store>--<key>`, where `<store>` is the user-secrets store the value belongs to (e.g. `AppHost`) and `<key>` is its user-secrets key with `:` written as `--` (Key Vault names allow only letters, digits and dashes), e.g. `RevolutReader--AppHost--Parameters--<parameter name>`. The mapping is reversible, so restoring is mechanical.
  - **The guided task writes each value to both places** in one PowerShell script that reads the owner's files and prints nothing. docs/operations gets the restore command (every `RevolutReader--*` secret back into its user-secrets store).
  - **Prerequisite:** the vault uses Azure role-based access, and the owner's Owner role on the subscription gives no access to secret values; the owner needs `Key Vault Secrets Officer` on the vault. Assigned with the user's go on 2026-11-06.

### D7 — Two on-demand checks against the real Enable Banking

Decided with the user (2026-11-06, explore). The automated tests prove the client only against our fake bank, whose answers we wrote. Roadmap C5: "checked on demand against the Mock ASPSP through the sandbox application and verified once against the real API" (testing.md § Fake bank).

- **Explicit tests in the integration test project,** marked `[Explicit]`: TUnit runs them only when the filter selects nothing but explicit tests, so `dotnet test` and CI skip them ([TUnit docs](https://tunit.dev/docs/writing-tests/explicit), read 2026-11-06). They take the port from the app's production wiring, as the acceptance driver does (D1), with real settings instead of the fake bank. The owner runs them on the owner's machine; never in CI.
- **Check 1, the Mock ASPSP, repeatable:** the sandbox values from the AppHost's user-secrets (the ones `aspire start` uses, D6). It reads the balance and enough transactions to need more than one page, with PSU headers and unattended, and once with a made-up session id, which must come back as access expired (D4): the only failure the mock produces on demand. It proves what the fake cannot: the signed token, the addresses, the headers, the real JSON, the paging.
- **Check 2, the real account, once before C5 ends:**
  - The production values sit apart from the sandbox values, so `aspire start` cannot reach the real account; they are backed up like every local secret (D6). *Refined in propose:* explore placed them in the test project's own user-secrets, but configuration.md § Local development and tests keeps every local secret in the AppHost's user-secrets only. So they sit there under `RealAccountCheck:*` keys, which the AppHost never declares as parameters and so never hands to the API; only Check 2 reads them.
  - Which fields a pending transaction carries is not visible through the port (it picks one date, D3). Check 2 therefore also reads the raw pages through the adapter's own page reader and counts the fields there.
  - One present-user read (balance and transactions) with the owner's public IP, fetched as the M1 smoke test does, and one unattended read (1 of the 4 a day, ADR-0001).
  - It prints no bank data and writes a counts-only summary to `spikes/enable-banking/evidence/`: for pending transactions, how many carry `entry_reference`, which dates they carry and the oldest one's age in days; each read's duration (sets D4's timeout); counts by status.
  - The findings go into a dated amendment of ADR-0001 and into the timeout setting.
- **Moved out:** comparing the balance with the Revolut app (it would print the balance; the owner sees it once the deployed app shows it, C7); whether a pending transaction keeps its `entry_reference` when it settles (needs two runs days apart and matters only to notifications: heads-up for C9).
- **The recent window (ADR-0001 § Consequences: "set in C5 from real data") is 31 days, sized by Revolut's longest holds, not by the M1 history.** The history's gap between `booking_date` and `value_date` (16 transactions 0 days, 96 one day, 4 two days; counted 2026-11-06, nothing printed) covers three months of ordinary card payments and no long hold. Deposits and pre-authorisations (hotels, car rentals) stay pending up to 10 working days by Revolut's FAQ as quoted in its [community forum](https://community.revolut.com/t/problem-with-payment-of-a-deposit/13396), about 15 days in user reports when the merchant waits to inspect a returned car; Revolut's own help page says the app shows each pending payment's latest release date (read 2026-11-06). Why the window matters: a pending transaction is shown only while its date lies inside it, and if a settled transaction keeps its original date (all 116 have `booking_date` ≤ `value_date`), it is stored only when it settles inside the window. 31 days is about 40 transactions at the history's rate (1.3 a day), usually one page. Check 2 confirms the dating: if settled transactions are dated by settlement, only the showing part depends on the window. Accepted gap: a hold longer than 31 days drops off the list while pending (the balance stays right, it comes from the bank) and could miss the history if it later settles. The window is the caller's date (D2), so C7 owns the setting; ADR-0001's amendment records the value.
- **Rejected for now: a dynamic window** (proposed by the user): storage remembers the oldest pending transaction's date and the next read starts there. It covers holds of any length, but it adds stored state and edge cases (two readers, failed reads, a cap) to C7 for holds Revolut releases well within 31 days. It needs nothing from the adapter, so C7 can switch to it later if a hold ever outlives the window.
- **Every read follows every page, whatever the window** (the user): the adapter keeps requesting with the returned `continuation_key` until a response carries none, also after a page with no transactions, and returns all pages' transactions as one list (D2). The API reference does not describe page size, empty pages or the end of the iteration (read 2026-11-06). The history came in pages of 50 (D3). A scenario covers a read of three pages; a repeated `continuation_key` is an exception rather than an endless loop; Check 1 reads past one page of the Mock ASPSP, and Check 2 records the number of pages.

### D8 — Parallel work: C3 merged, C4 in its own worktree

Recorded in propose (2026-11-06), from the user's notes that C3 has merged and C4 runs in parallel.

- **C3 merged before propose; C5 is rebased onto it.** C3 already holds the shared places:
  - `AcceptanceTest.ConfigureWebHostBuilder` sets the stand-in web root; C5 adds one call to `FakeBank` next to it.
  - The AppHost's `web` resource waits for the API, which from C5 on needs the four local secrets to start (D6).
  - CLAUDE.md's note that the unit and integration projects stay empty "until C5" is out of date since C3 added unit tests; C5 rewrites it (close group).
- **C4 runs in parallel** (its own worktree, started 2026-11-06). From C5 on the app refuses to start without the four Enable Banking secrets (D6), in production too. Whichever change merges second wires them into the deployment:
  - If C4 is in `main` when C5 rebases before its PR, C5's deployment task adds them to Bicep: four Key Vault secrets, referenced as Container Apps secrets, as the environment variables `EnableBanking__ApplicationId`, `EnableBanking__PrivateKey`, `EnableBanking__SessionId` and `EnableBanking__AccountId`. It also runs the guided Key Vault task, showing each Azure change first and running it only on the owner's go (CLAUDE.md).
  - Otherwise C4 does the same with these names; the owner passes them to the C4 session.
- **Files shared with C4:** CLAUDE.md, configuration.md § Hand-provisioned secrets, docs/operations, pm/progress.md and lessons.md. They merge as text at the rebase. Lesson numbers R-44 and R-45 are free as of writing; if C4 takes them first, whichever change merges second renumbers.

## Public API sketch

The port and its types (`src/RevolutReader.Api/Bank/`). Union case types are concrete records, never interfaces.

```csharp
namespace RevolutReader.Api.Bank;

/// <summary>The one linked account at the bank (D2). Read-only; account and session come from the settings.</summary>
public interface IBankAccount {
  Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken);

  /// <summary>From <paramref name="from"/>, inclusive, across every page (D7).</summary>
  Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken);
}

/// <summary>Who triggers a read (D2). No default: a default (empty) union throws in a switch.</summary>
public union ReadTrigger(PresentUser, Unattended);

/// <summary>The user's real values. The address is already parsed (C7 takes it from the forwarded headers).</summary>
public sealed record PresentUser(IPAddress IpAddress, string UserAgent);   // UserAgent: ThrowIfNullOrWhiteSpace

public sealed record Unattended;

/// <summary>D4: the value, or one of three expected failures.</summary>
public union BankResult<T>(T, BankAccessExpired, BankRateLimited, BankUnavailable);

public sealed record BankAccessExpired;
public sealed record BankRateLimited;
public sealed record BankUnavailable;

public sealed record Balance(decimal Amount, string Currency);

/// <summary>In the bank's order (newest first for Revolut), pages joined.</summary>
public sealed record Transactions(IReadOnlyList<BankTransaction> Items);

public sealed record BankTransaction(
  string? Reference,                  // entry_reference; may be missing while pending
  TransactionStatus Status,
  DateOnly Date,                      // transaction_date ?? booking_date ?? value_date
  decimal Amount,                     // negative when DBIT
  string Currency,
  string? Counterparty,               // creditor.name for DBIT, debtor.name for CRDT
  IReadOnlyList<string> PaymentDetails);

public enum TransactionStatus { Booked, Pending }
```

The adapter, in the same folder. Its types are public (CA1515 is off for the API), but other code uses only the port and `AddEnableBanking`.

```csharp
/// <summary>Section "EnableBanking" (D6).</summary>
public sealed class EnableBankingOptions {
  [Required] public required Uri ApiBaseUrl { get; init; }
  [Required, NotSecretPlaceholder] public required string ApplicationId { get; init; }
  [Required, NotSecretPlaceholder] public required string PrivateKey { get; init; }      // PEM text
  [Required, NotSecretPlaceholder] public required string SessionId { get; init; }
  [Required, NotSecretPlaceholder] public required string AccountId { get; init; }
  [Range(typeof(TimeSpan), "00:00:01", "00:02:00")] public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(15);
}

// src/RevolutReader.Api/Configuration/: the shared validator configuration.md § Binding names, built here first.
public sealed class NotSecretPlaceholderAttribute : ValidationAttribute;                    // rejects "<secret>"

/// <summary>The key parses as an RSA key in PEM form. The message names the setting, never its value.</summary>
public sealed class EnableBankingOptionsValidator : IValidateOptions<EnableBankingOptions>;

public sealed class ApplicationToken(string applicationId, RSA key) {
  /// <summary>RS256; header kid = application id; iss enablebanking.com, aud api.enablebanking.com, iat = now, exp = now + 1 h. BCL only.</summary>
  public string Create(DateTimeOffset now);
}

public static class BalanceSelection {
  /// <summary>The ITAV balance; none → BankReadException.</summary>
  public static Balance Available(EbBalances balances);
}

public static class TransactionMapping {
  /// <summary>Booked and pending kept and mapped (D3); every other status left out and counted.</summary>
  public static MappedTransactions Map(IEnumerable<EbTransaction> transactions);
}
public sealed record MappedTransactions(IReadOnlyList<BankTransaction> Kept, int LeftOut);

public static class TransactionPages {
  /// <summary>
  /// Follows continuation keys until none comes back, also after an empty page; a repeated key → BankReadException;
  /// the first failed page ends the read with its failure (D7).
  /// </summary>
  public static Task<BankResult<JoinedPages>> ReadAll(Func<string?, Task<BankResult<EbTransactionPage>>> readPage);
}
public sealed record JoinedPages(IReadOnlyList<EbTransaction> Transactions, int PageCount);

public static class PsuHeaders {
  /// <summary>Psu-Ip-Address and Psu-User-Agent for a present user; none for an unattended read.</summary>
  public static IReadOnlyList<KeyValuePair<string, string>> For(ReadTrigger trigger);
}

public enum BankErrorKind { AccessExpired, RateLimited, Unavailable, Unexpected }

public static class BankErrorClassification {
  /// <summary>D4's table: the error code decides; the status only when the body has no code.</summary>
  public static BankErrorKind Classify(HttpStatusCode status, string? errorCode);
}

/// <summary>
/// The typed HttpClient (D4, D5): signs each request, adds the PSU headers, marks it excluded from tracing, sends it once,
/// maps errors, logs one line per read.
/// </summary>
public sealed class EnableBankingClient(HttpClient http, IOptions<EnableBankingOptions> options, ApplicationToken token, TimeProvider time, ILogger<EnableBankingClient> logger) : IBankAccount {
  /// <summary>One raw page; used by ReadTransactions and by Check 2's field counts (D7).</summary>
  public Task<BankResult<EbTransactionPage>> ReadTransactionPage(DateOnly from, string? continuationKey, ReadTrigger trigger, CancellationToken cancellationToken);
}

/// <summary>Bugs and misconfiguration (D4's "everything else"): HTTP status and error code only, never a URL or a body.</summary>
public sealed class BankReadException : Exception;

// Wire records, snake_case as in the API reference: EbBalances, EbBalance, EbAmount, EbTransactionPage, EbTransaction, EbParty, EbError.

public static class EnableBankingRegistration {
  /// <summary>
  /// Options bound and validated at start; ApplicationToken as a singleton; the typed client with BaseAddress = ApiBaseUrl,
  /// Timeout = RequestTimeout and RemoveAllLoggers(); IBankAccount → EnableBankingClient; TimeProvider.System unless one is registered.
  /// Called from Program.cs.
  /// </summary>
  public static IServiceCollection AddEnableBanking(this IServiceCollection services);
}
```

ServiceDefaults and the AppHost:

```csharp
namespace RevolutReader.ServiceDefaults;

public static class HttpRequestTracing {
  /// <summary>A request carrying this option is left out of the exported HTTP-client traces (D5).</summary>
  public static readonly HttpRequestOptionsKey<bool> Exclude = new("RevolutReader.ExcludeFromTracing");
}
// ConfigureOpenTelemetry: AddHttpClientInstrumentation(o => o.FilterHttpRequestMessage = r => !(r.Options.TryGetValue(HttpRequestTracing.Exclude, out bool e) && e))

// AppHost.cs: four secret parameters, handed to the API as environment variables (D6).
IResourceBuilder<ParameterResource> applicationId = builder.AddParameter("enablebanking-application-id", secret: true);
// … "enablebanking-private-key", "enablebanking-session-id", "enablebanking-account-id"
api.WithEnvironment("EnableBanking__ApplicationId", applicationId) /* … the other three */;
```

The acceptance DSL and drivers:

```csharp
// Dsl/BankDsl.cs: the bank as the scenarios state it. Defaults: a present user (203.0.113.7, an iPhone browser), EUR.
public sealed class BankDsl(BankDriver driver) {
  // What the bank holds or reports (GIVEN)
  public void HasAvailableBalance(decimal amount, string currency = "EUR");
  public void Lists(params TransactionAtBank[] transactions);                 // one page
  public void ListsInPages(DateOnly since, int count, int pages);
  public void ListsFirstPageThenFails(DateOnly since);
  public void ReportsExpiredSession();
  public void ReportsRequestLimitReached();
  public void ReportsOwnError();
  public void AnswersAfterTheRequestTimeout();

  // Reads (WHEN)
  public Task<BalanceAnswer> ReadBalance();                                   // for the default present user
  public Task<BalanceAnswer> ReadBalanceFor(UserAtDevice user);
  public Task<BalanceAnswer> ReadBalanceUnattended();
  public Task<TransactionsAnswer> ReadTransactionsFrom(DateOnly day);

  // What the bank received (THEN)
  public IReadOnlyList<RequestAtBank> RequestsReceived();
}

// DSL types, compared by value (lists item by item):
//   TransactionAtBank: booked | pending | cancelled | rejected; money out | in; amount, day, counterparty?, reference?, details
//   UserAtDevice(string IpAddress, string Browser); RequestAtBank(UserHeaders? Headers)
//   BalanceAnswer, TransactionsAnswer: an outcome (read, access expired, rate limited, bank unavailable) and the value
//   TransactionSeen(string? Reference, string Status, DateOnly Date, decimal Amount, string Currency, string? Counterparty, Lines Details)

// Drivers/FakeBank.cs: a WireMock.Net server per test, started before the app copy. Made-up account and session ids, an RSA key
//   generated once per run, a 1 s request timeout; Configure(IWebHostBuilder) writes them into the app copy's settings.
//   Answers copied from the Mock ASPSP capture (§ Bootstrap); what the mock cannot produce (429, an expired session,
//   ASPSP_ERROR, a slow answer) written from the API reference with a comment saying so. The transactions stub answers only
//   for the expected date_from and continuation_key.
// Drivers/BankDriver.cs: takes IBankAccount from the app copy (Services), turns DSL facts into FakeBank stubs and port
//   results into DSL answers.
// Drivers/AcceptanceTest.cs: ConfigureWebHostBuilder also calls FakeBank.Configure(builder); protected BankDsl Bank.
```

The guard and the checks:

```csharp
// tests/RevolutReader.AcceptanceTests/Conventions/BankTelemetryTests.cs (D5): a capturing ILoggerProvider (scopes included)
//   and OpenTelemetry's in-memory trace exporter in the app copy; one balance read and one transactions read for a present
//   user; neither the account id, the session id nor the PSU IP address appears in any message, scope value or exported tag.

// tests/RevolutReader.IntegrationTests/Wiring/RealBank/ (D7), [Explicit, Category("RealBank")], written by the implementer:
//   MockAspspCheck:   settings from the AppHost's user-secrets (Parameters:enablebanking-*), services.AddEnableBanking().
//   RealAccountCheck: the RealAccountCheck:* values; writes spikes/enable-banking/evidence/<date>-real-account-check.json,
//                     counts only; prints nothing from the bank.
```

## Rule ownership

| Rule (spec, ADR or convention) | Enforced by |
|---|---|
| The balance is the `ITAV` balance; none is an error | `BalanceSelection` |
| Booked and pending kept; other statuses left out and counted | `TransactionMapping` |
| A transaction's fields: sign by `DBIT`/`CRDT`, counterparty side, date fallback, details unchanged | `TransactionMapping` |
| Every page followed, an empty page too; a repeated key is an error; a failed page fails the read | `TransactionPages` |
| PSU headers exactly for a present user, none unattended, no default | `ReadTrigger` (the type) and `PsuHeaders`, applied to every request by `EnableBankingClient` |
| Error code → access expired, rate limited, bank unavailable or unexpected | `BankErrorClassification` |
| Our timeout and a network failure are bank unavailable; the caller's own cancellation is passed on | `EnableBankingClient` |
| Never retried (ADR-0001) | no resilience handler on any client (ServiceDefaults, C1); `EnableBankingClient` sends each request once |
| Read-only toward the bank | `IBankAccount` has only reads; the client sends only `GET` |
| Every request signed by the application | `ApplicationToken` and `EnableBankingClient` |
| Settings complete, no placeholder left, the key parses | `NotSecretPlaceholderAttribute`, `EnableBankingOptionsValidator`, `ValidateOnStart` |
| No account id, session id or PSU address in logs or exported traces (D5) | `RemoveAllLoggers()`, `HttpRequestTracing.Exclude`, the adapter's one log line; guarded by `BankTelemetryTests` |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected failures (Result) | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `ReadBalance` | `Balance` | `BankAccessExpired`, `BankRateLimited`, `BankUnavailable` (D4) | `BankReadException`: an unexpected code or status, an unreadable body, no `ITAV` balance. `OperationCanceledException` when the caller cancels |
| `ReadTransactions` | `Transactions` | the same, from any page | the same, plus a repeated continuation key |
| App start | — | — | `OptionsValidationException` from `ValidateOnStart`: a missing or placeholder setting, a key that does not parse. The message names the setting, never its value |

- A network failure (`HttpRequestException`) and our own timeout (`TaskCanceledException` while the caller's token is not cancelled) become `BankUnavailable`.
- The log line records the HTTP status and the Enable Banking `error` code for every outcome; an exception's message carries the same and nothing else (D5). C7's endpoint maps the cases to statuses and lets exceptions become a 500.

## Ports and contracts

**`IBankAccount`** (new; capability `bank-reads`):

- **Behaviour:** read-only, for the one configured account and session; two operations (D2). Transactions come in the bank's order with the pages joined; the result holds every page or the read fails (D7).
- **Not found:** an unknown session is access expired (D4). An unknown account is a misconfiguration and throws.
- **Ordering and concurrency:** stateless apart from the HTTP client, so concurrent calls are independent; C7 and C9 may read at the same time.
- **Idempotency:** reads repeat freely as far as the code is concerned. The bank's limits are the caller's concern: an unattended read counts against the 4 a day, paging does not (ADR-0001 § Request limits).
- **Failure modes:** D4. Never retried; a per-request timeout from the settings; a failed page fails the read.
- **Infrastructure:**
  - a typed `HttpClient` from `IHttpClientFactory`: no resilience handler, `Timeout` = `RequestTimeout`, logging removed, requests excluded from tracing;
  - a JWT signed per request with the BCL's RSA;
  - System.Text.Json with snake_case names.
- **In-memory fake for unit tests:** none in C5 (Goals / Non-Goals). The acceptance tests use the real adapter against WireMock.Net (testing.md § Fake bank), so there is no `[integration]` group.

## How each scenario is verified

All thirteen through the port, as D1 decided. Each is an acceptance test in `Scenarios/BankReads/BankReadsScenarios.cs`, claimed with `[Scenario("bank-reads", "<name>")]`, driven by `BankDriver` against the app copy's `IBankAccount` and the fake bank. None is a frontend or manual scenario: nothing in C5 reaches a screen or a device. Checks 1 and 2 are not scenarios; they check the fake bank against the real service (D7).

## Cross-cutting effects

- **API contract / TS client:** none; no endpoint.
- **Bicep:** none in C5 itself; D8's conditional task applies if C4's `infra/` is in `main` when C5 rebases.
- **Settings:** the `EnableBanking` section in `appsettings.json`: `ApiBaseUrl` and `RequestTimeout` with values, the four secrets as `"<secret>"`, each key with its provenance comment (configuration.md). The AppHost declares four secret parameters.
- **Bank calls** (ADR-0001 § Decision):
  - PSU headers only when the caller says a user is present, with that user's values (D2);
  - none when unattended;
  - one request for the balance and one per page for transactions, nothing else (no session or bank-list calls);
  - 429 and bank errors come back as results; no retries.
- **ADRs:** ADR-0001 gets a dated amendment:
  - § Consequences, "Bank adapter": PSU headers are an explicit caller parameter, not copied from the incoming request; a fixed header set instead of `GET /aspsps`;
  - pending transactions confirmed;
  - the recent window, 31 days;
  - Check 2's findings.
- **Conventions:**
  - `openspec/config.yaml` § specs: a port's scenarios are verified through its public interface, and its error scenarios name result cases (D1);
  - testing.md and `.claude/rules/testing.md`: a driver may take a port from the app copy, the harness's bank settings, the explicit checks;
  - README.md § Backend code: failure records next to the union (D4); the bank cases' status rows move to C7;
  - configuration.md:
    - the shared `"<secret>"` validator now exists;
    - § Hand-provisioned secrets gets four rows, provisioned in C4 or by D8's task;
    - § Local development and tests: the backup vault and the `RealAccountCheck:*` keys.
- **Operations:**
  - `docs/operations/expiring-approvals.md`: a row for the Mock ASPSP session (180 days); § 3's step 3 now names the application id as a secret;
  - a new `docs/operations/local-secrets.md`: setting, backing up and restoring the local secrets, in PowerShell 7.
- **Design:** no UI.
- **Software factory:**
  - lesson R-44 *(New)*: the public-channel rule generalises from apps to libraries and ports; the channel is the public interface of what is specified (D1);
  - lesson R-45 *(New)*: `IHttpClientFactory` logging and HTTP-client tracing record URL paths, so an identifier in a path leaks. The fix: silence that one client, log one line per call, and guard it with a test (D5);
  - inventory lines: the telemetry guard test and the fake bank driver.

## Risks / Trade-offs

- [The fake bank answers differently from the real Enable Banking] → copied from a fresh Mock ASPSP capture (§ Bootstrap) and checked by Check 1 against the sandbox and Check 2 against the real account. Failures other than an unknown session cannot be produced on demand; their mapping rests on the API reference and the mock's real error bodies.
- [A generic union with a type-parameter case doesn't compile or misbehaves on .NET 11 RC3] → Microsoft Learn says it is supported (2026-10-23), and group 1's stubs compile it first. Fallback: two non-generic unions (`BalanceResult`, `TransactionsResult`) sharing the three failure records; the scenarios don't change.
- [The trace filter doesn't keep the runtime's HTTP activity out of the export] → the guard test fails. Fallback: D5's rejected alternative, applied only to the exported activity (a processor strips `url.full` and `url.path`).
- [Revolut sends an error code mapped to "unexpected" that should be a case] → C7 shows a 500 and the log names the code; the mapping is one table (`BankErrorClassification`).
- [Early session expiry] (Enable Banking changelog, January 2026) → access expired; the owner links again (docs/operations/expiring-approvals.md § 2).
- [A hold longer than 31 days] → accepted gap (D7); C7 can switch to the dynamic window.
- [`aspire start` stops working until the local secrets are set] → the guided task in the local-development group. User-secrets are per machine, so once is enough.
- [Check 2 runs in CI or by accident] → `[Explicit]`, and CI has none of the values; the check fails with a message naming the missing setting.
- [C4 and C5 both edit the secrets docs and Bicep] → D8.

## Migration plan

Nothing to migrate: no stored data, no endpoint. Rollback is reverting the merge commit; the deployed app (once C4 exists) then no longer needs the four Enable Banking secrets.
