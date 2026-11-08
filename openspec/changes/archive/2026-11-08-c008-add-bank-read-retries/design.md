# Design: c008-add-bank-read-retries

## TL;DR

- **Our own 15 s timeout is final and covers a request with all its retries:** `HttpClient.Timeout` wraps the retry handler, so the worst case stays 15 s and a timed-out request is never repeated (D1).
- **Unattended reads are never retried;** the client marks a present user's requests, and an unmarked request is never retried (D2).
- **Microsoft's resilience library on the bank client only:** `Microsoft.Extensions.Http.Resilience` 10.11.0 (Polly), one retry strategy via `AddResilienceHandler`; no other client gets one (D3).
- **The Azure SDK's numbers:** 3 retries, waits from 0.8 s doubling (about 0.8, 1.6, 3.2 s) with a random spread; a real outage shows after about 6–8 s (D4).
- **Retried exactly when the attempt would read as "bank unavailable",** by the client's own classification of the answer, shared with the retry rule (D5).
- **Each attempt reads the whole answer,** so a connection that breaks mid-answer is retried too (D6).
- **The first wait is the setting `EnableBanking:RetryDelay`** (0.8 s, zero in tests); the count is a constant (D7).
- **A `Retry-After` header is followed,** but a retry whose wait would end after the request's 15 s is not made: the read fails at once (D8).
- **The library's retry warnings are kept, its per-attempt lines dropped;** a ready query lists the retries (D9).
- **The rule "no retries by default" stays,** with a broader reason (each client's calls decide: quotas, repeatable or not, an SDK's own retries), and a convention test guards it (D10).
- **A page's continuation key works a second time:** probed on the real account with the owner's headers (2026-11-08), so a failed page is retried alone (D11).
- **New or changed public interfaces:** `BankRetries` (the count, the present-user and deadline marks, the retry options, the retry rule); `WholeAnswerHandler`; `EnableBankingErrorValue` (moved out of the client, shared with the retry rule); `EnableBankingOptions.RetryDelay`; DSL facts for a one-off error, a one-off broken connection and a one-off error on a page, and `Bank.PagesRequested()`.
- **Integration points:** Enable Banking receives up to 4 identical requests per HTTP request for a present user, after failures only; nothing changes in Azure, the API contract or the AppHost.
- **Hard to reverse:** nothing. Removing the handler restores today's behaviour.

## Context

- See proposal.md § Why. D1–D4 were decided with the user in `/opsx:explore` (2026-11-08), one at a time, and D5–D11 right after propose, the same day; D11 after a probe against the real account.
- **The adapter today** (`main` at `c7c40da`; [c004 design.md](../2026-11-07-c004-add-enable-banking-adapter/design.md), [c006 design.md](../2026-11-08-c006-harden-bank-adapter/design.md)):
  - `EnableBankingClient` sends one signed `GET` per balance read and per transactions page, with the user headers of the `ReadTrigger`, and tags each request so the trace instrumentation leaves it out (`HttpRequestTracing.Exclude`).
  - A network failure (`HttpRequestException`) and our own timeout (`TaskCanceledException` while the caller has not cancelled) are "bank unavailable". An error answer is classified by its code-shaped `error` value, else by its status (`BankErrorClassification`, c006 D3).
  - Each read writes one log line, whose `{Pages}` counts the requests the client sent.
- **The bank client's wiring** (`EnableBankingRegistration`): a typed client with `BaseAddress`, `Timeout` = `RequestTimeout` (15 s, kept after Check 2 measured the slowest request at 0.76 s), logging removed. No resilience package anywhere: c001 D5 removed the template's standard handler from ServiceDefaults, and `Directory.Packages.props` says why.
- **Tests:** the acceptance tests drive the port on the production wiring against the WireMock fake bank (`Drivers/FakeBank`, a 5 s timeout); the DSL reads for a present user unless a scenario says unattended. The adapter's edge cases run against `BankOnWireMock` in `IntegrationTests/Wiring/EnableBanking/`. Since C6 (merged 2026-11-08, #30), every acceptance app copy runs on a `FakeTimeProvider` (`Drivers/FakeMicrosoft.Clock`, the app's only `TimeProvider`), which moves only when a test moves it.
- **What .NET already retries:** its HTTP stack resends a request without a body up to 3 times when the server closed the connection before any answer came, typically a kept-alive connection the server had closed as idle ([HttpConnectionPool.cs](https://source.dot.net/System.Net.Http/System/Net/Http/SocketsHttpHandler/ConnectionPool/HttpConnectionPool.cs.html), [HttpConnection.cs](https://source.dot.net/System.Net.Http/System/Net/Http/SocketsHttpHandler/HttpConnection.cs.html), read 2026-11-08 on the development branch, not checked on the .NET 11 build). Our bank requests are bodiless `GET`s, so that case never reached the adapter. This change covers the rest.
- **Parallel work:** C6 (`c007-add-user-login`) ran in its own session and merged first (#30, 2026-11-08); this branch merged `main` after it (conflicts only where both added package lines and progress rows).

## Goals / Non-Goals

**Goals:**

- The five new `bank-reads` scenarios and the changed timeout scenario, verified through the port.
- Retries that callers never see except as time: the port's signatures, result cases and log line stay.
- The rule "no default retries" kept, and now guarded by a test.

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- No in-memory fake of the port and no `[integration]` group, as in C5 and C12.
- No change to the classification of error answers (c006 D3), the page cap or the user headers.
- No resilience for anything but the bank client.

## Bootstrap (done before `/tdd-apply`, not in tasks.md)

As in C1, C3, C5 and C12, Claude prepares a green starting point on the change branch once the user approves these artifacts, committed as `[setup]`. None of it is behaviour.

1. **Rebase** on `main` if it moved (C6 may merge first).
2. **Package:** `Microsoft.Extensions.Http.Resilience` 10.11.0 (nuget.org: stable since 2026-10-14, MIT; depends on `Microsoft.Extensions.Resilience` and `Microsoft.Extensions.Http.Diagnostics` 10.11.0, the same line as the project's `Microsoft.Extensions.ServiceDiscovery` 10.11.0) in `Directory.Packages.props`, its comment rewritten (no longer "no Microsoft.Extensions.Http.Resilience"), referenced by `RevolutReader.Api` only.
3. **Check the names the sketch uses** against 10.11.0: `AddResilienceHandler(name, (builder, context) => …)` with `context.ServiceProvider`; `HttpRetryStrategyOptions` (`MaxRetryAttempts`, `Delay`, `BackoffType`, `UseJitter`, `ShouldRetryAfterHeader`, `ShouldHandle`); `ResilienceContext.GetRequestMessage()`; `Outcome.FromResult`/`FromException`. A different name is corrected in the sketch, not a decision.
4. The build and the full suite are green. The only accepted red is the traceability check naming this change's five new scenarios as not claimed; group 1 claims them.
5. *Already done (2026-11-08, D11):* the key-reuse probe `RealAccountCheck.A_continuation_key_works_a_second_time` (explicit, never in the default run) and its evidence.

*Steps 1–4 done (2026-11-08):*

- rebased onto `50d0044` (#34);
- the package in `Directory.Packages.props` and `RevolutReader.Api`; it brings Polly.Core and Polly.Extensions 8.4.2;
- every name in the sketch found in the API docs of 10.11.0 and Polly.Core 8.4.2;
- build with no warning; backend 391 of 392, the one red being the traceability check naming exactly the five new scenarios; frontend 31 of 31; formatting clean.
- the probe (step 5) kept by the user and committed.
- `main` merged after C6 (#30): build with no warning; backend 518 of 519, the one red still that traceability check; frontend 53 of 53; formatting clean. This is the baseline for `/tdd-apply`.

## Decisions

### D1 — Our own request timeout is final, and covers a request with all its retries

Decided with the user (2026-11-08, explore).

- **How it works:** `HttpClient.Timeout` (`EnableBanking:RequestTimeout`, 15 s) applies to the whole send through the client's handlers, the retry handler included. So it bounds a request's attempts and the waits between them. When it runs out, the request's cancellation fires; the retry strategy never retries a cancelled execution; the client reports "timed out", so "bank unavailable", as today.
- **What changes in meaning:** `RequestTimeout` was the limit for one attempt; it becomes the limit for one request with its retries. The worst case for one request stays 15 s (per page for transactions). Its `appsettings.json` comment says so.
- **Rejected:**
  - A shorter timeout per attempt (e.g. 5 s), retried, within about 15 s: it would also retry a hung request, but it changes the setting's meaning and fails an attempt that a slow day (5–15 s) would have answered.
  - One time budget per read, shared by its pages: the most precise, and the most code.
- **Accepted gap:** a hung request is not retried. Enable Banking does not say how long it waits for Revolut before answering `ASPSP_TIMEOUT` (API reference, read 2026-11-08). If it waits longer than 15 s, a slow Revolut always shows as our timeout and is never retried.

### D2 — Unattended reads are never retried

Decided with the user (2026-11-08, explore).

- **Why:** Revolut allows 4 unattended requests a day ([ADR-0001](../../../../docs/adr/0001-bank-data-access.md) § Request limits), and nobody knows whether a request that reached the bank and failed counts against them. No unattended caller exists today; C9 decides about a fallback check, and with it whether such a check retries.
- **How:** the client marks each request of a present user's read (`BankRetries.PresentUser`); the retry rule retries only marked requests. A request without the mark is never retried, so the rule fails safe.
- **Rejected:** retrying an unattended request only when no connection was made (the bank surely never saw it). Precise, but for a caller that does not exist yet.

### D3 — Microsoft's resilience library, on the bank client only

Decided with the user (2026-11-08, explore: "We shouldn't invent our own solution, we should use the built-in resiliency library").

- **What:** `Microsoft.Extensions.Http.Resilience` (it runs on Polly) with `AddResilienceHandler` on the typed bank client: one retry strategy, configured by `BankRetries.Options`. Not the standard handler: no total or attempt timeout (D1 keeps `HttpClient.Timeout` as the limit), no circuit breaker, no rate limiter, no hedging. One user and one app copy make a handful of reads a day, so none of them would ever act.
- **Only here:** referenced by the API project, never by ServiceDefaults; no `ConfigureHttpClientDefaults` adds a handler (D10 guards it).
- **Why it fits:** it retries each HTTP request on its own, so a failed transactions page is retried alone; it resends the same request, with its signed token (valid 1 h) and its user headers. The client still sends each page once, so its log line's `{Pages}` stays right.
- **Rejected:** a hand-written loop in `EnableBankingClient` (recommended by Claude for fewer parts; the user prefers the standard library); Polly.Core used inside the client around each request (no HTTP-level idiom, more glue of our own).

### D4 — The numbers: the Azure SDK's

Decided with the user (2026-11-08, explore).

- **3 retries; waits from 0.8 s, doubling (about 0.8, 1.6 and 3.2 s), with a random spread.** With exponential waits and jitter on, the library spreads each wait at random around that curve (Polly's `DecorrelatedJitterBackoffV2`, [pollydocs](https://www.pollydocs.org/strategies/retry.html)). No maximum wait: D1's timeout bounds them.
- **Compared** (read 2026-11-08):

  | Client | Retries | First wait | Then |
  |---|---|---|---|
  | Azure SDK for .NET, `Azure.Core` [RetryOptions.cs](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/core/Azure.Core/src/RetryOptions.cs) | 3 | 0.8 s | exponential, max 1 min |
  | Microsoft's standard HTTP handler ([Learn](https://learn.microsoft.com/dotnet/core/resilience/http-resilience), 2026-02-24) | 3 | 2 s | exponential with jitter; 10 s per attempt, 30 s in total |
  | Polly's plain default ([pollydocs](https://www.pollydocs.org/strategies/retry.html)) | 3 | 2 s | constant, no jitter |

- **The cost:** when the bank is really down, a read tries 4 times and waits about 5.6 s in between, so "bank unavailable" appears after about 6–8 s instead of about 0.5 s. A spread that runs past 15 s ends at the timeout.
- **Rejected:** 2 retries (a real outage shows after about 3–4 s); #27's first sketch of 0.2 and 1 s.

### D5 — Retried exactly when the attempt would read as "bank unavailable"

Decided with the user (2026-11-08, after propose): the exact rule, not the status-only one.

- **The rule (`BankRetries.ShouldRetry`):** only for a request marked as a present user's (D2):
  - a network failure (`HttpRequestException`, also what a body that breaks while it comes in throws) → retry;
  - an error answer → its `error` value read exactly as the client reads it (`EnableBankingErrorValue`, c006 D3, D7), then `BankErrorClassification.Classify`: `Unavailable` → retry; rate limited, access expired, unexpected → no retry;
  - a success answer, or a cancellation (ours or the caller's) → no retry.
- **One reading of an error answer:** the client's private `ErrorValue` and its body reading move into `EnableBankingErrorValue`, used by both, so the retry rule and the final outcome can never disagree.
- **Rejected, simpler:** decide by the status alone (network failures, 5xx and 408, never 429), as the library's default does without 429. No body reading in the rule and no shared type. But a 5xx that carries an unknown code (an error) or an access-expired code would be retried 3 times: harmless for a present user (no request limit), yet it contradicts "no request that ends as an error is repeated" and delays the error by about 6 s.

### D6 — Each attempt reads the whole answer

Decided with the user (2026-11-08, after propose).

- **What:** a small handler inside the retry handler (`WholeAnswerHandler`, added after it, so it runs within each attempt) loads the answer's body into memory before the attempt ends.
- **Why:** without it, `HttpClient` reads the body only after the retry handler has returned, so a connection that breaks while the body comes in is never retried. It also makes the body safe for the retry rule to read (D5). Bodies are small (a page of about 50 transactions), and `HttpClient` buffers them anyway.
- **Rejected, simpler:** accept the gap; a break mid-answer stays "bank unavailable". One handler less, but the scenario "A connection that breaks once is retried and the read succeeds" would then need a break before the answer starts, which .NET's own resend (§ Context) may absorb, so the test could pass without our retries.

### D7 — The first wait is a setting; the count is a constant

Decided with the user (2026-11-08, after propose).

- **`EnableBanking:RetryDelay`**, `00:00:00.8`, `[Range]` 0 to 5 s, declared in `appsettings.json` with its provenance comment. The acceptance and integration harnesses set it to zero, so retries run at once and the tests stay fast (a zero wait does not wait).
- **`BankRetries.MAX_RETRIES = 3`, a constant**, like c006 D4's page cap: a limit nobody tunes, and `appsettings.json` is inside the image anyway.
- **Why a setting for the wait:** the library takes its clock from the app's services (Polly.Extensions assigns a registered `TimeProvider`, [PollyServiceCollectionExtensions.cs](https://github.com/App-vNext/Polly/blob/main/src/Polly.Extensions/DependencyInjection/PollyServiceCollectionExtensions.cs), [Polly #1983](https://github.com/app-vnext/polly/issues/1983)). The acceptance harness registers a `FakeTimeProvider` as the app's clock (C6, § Context), so in acceptance tests a non-zero wait would never end unless the test moved the clock. A zero wait does not depend on the clock.
- **The production numbers are pinned** by a unit test of `BankRetries.Options` (3 retries, exponential from the given wait, jitter on, `Retry-After` followed) and by the declared 0.8 s.
- **Rejected:** both as constants, with tests moving a `FakeTimeProvider` past each spread wait (no setting, fiddlier tests); both as settings, as the Azure SDK's `RetryOptions` exposes them and Microsoft's transient-fault guidance suggests (more knobs, one nobody turns).

### D8 — A `Retry-After` header is followed, unless its wait would outlast the request

Decided with the user (2026-11-08, after propose: "the 15s timeout still applies"; "if it's longer than 15 seconds, it should fail immediately and not unnecessarily wait 15 seconds").

- **Followed:** when a retried answer carries `Retry-After` (seconds or a date), the library waits that long instead of D4's wait (`ShouldRetryAfterHeader = true`, its default). With 429 never retried, it can only come with a 503 or 408, typically from a gateway. Microsoft's transient-fault guidance says to follow it ([Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults), 2026-02-26), and the Azure SDK does.
- **Never a wait for nothing:** the client marks each request with its deadline (`BankRetries.Deadline`: now + `RequestTimeout`, from the injected `TimeProvider`). The retry rule does not retry when the `Retry-After` wait would end after that deadline; the attempt's answer is the result at once ("bank unavailable"). It measures against the time left, so a 12 s `Retry-After` after attempts that already took 5 s fails at once too, not only one over 15 s (the user did not object to the time-left version, 2026-11-08). A request without a deadline mark gets no `Retry-After` wait.
- **D4's own waits are not checked against the deadline:** they add up to about 5.6 s and outrun the 15 s only when the attempts themselves are slow; then the timeout ends the read, as D1 accepts.
- **Rejected:** ignoring `Retry-After` (Claude's first proposal): the waits would stay predictable, but against the guidance and the server's own signal; comparing with the full 15 s only: no deadline mark, but a wait just inside 15 s would still be cut off by the timeout after waiting.

### D9 — The library's log lines: retry warnings kept, per-attempt lines dropped

Decided with the user (2026-11-08, after propose).

- **What the library logs** ([Polly telemetry](https://www.pollydocs.org/advanced/telemetry.html)), through the app's logging under the category `Polly`: a line for every attempt ("Execution attempt", Information for a success, Warning when it will be retried) and a warning for every retry ("Resilience event occurred. EventName: 'OnRetry'"), each with the pipeline's name, the result (the status code) or the exception.
- **`Logging:LogLevel:Polly` = `Warning`** in `appsettings.json`: the Information line of every successful attempt goes, or every bank request would add a line to Application Insights (#17 watches the volume). The retry warnings stay.
- **The read's own line stays** as c006 D6 has it: one per read, `{Pages}` still pages. A retry shows in the library's warnings, under the same trace id.
- **A ready query** in deployment.md § Checks: the retries in a period (the library's warnings in `AppTraces`).
- **Checked for identifiers:** the telemetry guard (`Conventions/BankTelemetryTests`) adds a read that is retried once, so the library's lines are checked like every other line; an adapter edge test checks that a read answered at once writes no line of the library.
- **Rejected:** count the retries in the read's own line (complete in one line, but glue of our own between the library and the client); drop all library lines (retries invisible). Microsoft's guidance also logs transient faults as warnings, not errors.

### D10 — The rule "no retries by default" stays, with a broader reason, and a convention test guards it

Decided with the user (2026-11-08, after propose). The user asked whether the rule should exist at all now that the bank client has its own policy.

- **Why it stays:** the reason is no longer only "a retried 429 burns the bank's 4 unattended reads" (c001 D5). Whether to retry depends on what a client calls, so each client decides. Every client this app has or plans, under a retry default:

  | Client | Under a default |
  |---|---|
  | Bank (C11) | has its own policy, so it would first have to remove the default; otherwise two layers stack (up to 4 × 4 = 16 requests per page, 429s included) |
  | Azure Storage (C6, C7) and the telemetry exporter | Azure SDK clients with their own built-in retries, not built from `IHttpClientFactory`: the default does not reach them |
  | Sign-in to Microsoft (C6) | the OpenID Connect handler builds its own back-channel `HttpClient` (to the best of Claude's knowledge, not checked in code): the default does not reach it either |
  | Push sender (C8) | a POST per notification; the standard handler retries every method by default ([Learn](https://learn.microsoft.com/dotnet/core/resilience/http-resilience)), so a retry after a lost answer can deliver a notification twice, against ADR-0008's "at most one notification": it would need an opt-out |

  A default would help no client here and need two opt-outs, each invisible when forgotten. Microsoft's transient-fault guidance says the same in general: retry "only when you can determine their full effect", prefer an SDK's built-in retries, avoid "duplicated layers of retry code", and beware repeating operations that are not idempotent ([Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults), 2026-02-26).
- **The guard:** with the package now in the repository, one line in ServiceDefaults would give every client retries. A convention test in the acceptance project's `Conventions/`: the app copy's plain `HttpClient` from `IHttpClientFactory` (not the bank's) sends one request to a local fake that answers 503, and exactly one request arrives. A probe adding the standard handler proves it fails (lesson R-31's practice).
- **When it flips** (lesson R-30): back to the template default when every downstream is your own repeatable service with no quota.
- **Rejected:** drop the rule and adopt the template default, as DoseUp does (every future client gets transient handling unasked; the bank client would start with `RemoveAllResilienceHandlers()`, and C8 would have to remember the push sender); keep the rule without a test (the rule's text and review only).

### D11 — A page's continuation key works a second time, so a failed page is retried alone

Decided with the user (2026-11-08, after propose): probe it on the real account with the owner's headers, the owner present.

- **The question:** Enable Banking does not say whether a continuation key works twice; its reference only says it is "only valid in current session" (API reference, read 2026-11-08). The Mock ASPSP does not page ([spike README](../../../../spikes/enable-banking-mock/README.md), item 12), so Check 1 could not try it.
- **The probe** (`RealAccountCheck.A_continuation_key_works_a_second_time`, an explicit test next to Check 2, run 2026-11-08 13:11 UTC): with the owner's public address and a check user agent, the first page of the last 89 days, then the second page twice with the same key, the second time right after the first answered (3 present-user requests, none unattended). All three read; both answers of the second page held the same 50 transactions in the same order, and both announced a third page ([evidence](../../../../spikes/enable-banking/evidence/2026-11-08-continuation-key-reuse.json), counts only). A key that has already been answered once is the strongest case: a retry after a failure sends a key Enable Banking may not even have seen.
- **So:** a failed transactions page is retried with its key, as D3 already does. ADR-0001 § Transaction history gets the finding.
- **Rejected:** accepting the risk unprobed (Claude's first proposal: a refused key would have ended as an error, visibly); not retrying later pages at all.

## Public API sketch

The adapter (`src/RevolutReader.Api/Bank/`). Only what changes; the rest stays as c004 and c006 have it.

```csharp
namespace RevolutReader.Api.Bank;

/// <summary>The bank client's retries (D1–D8): what is retried, how often and how long it waits.</summary>
public static class BankRetries {
  /// <summary>At most this many retries after the first attempt (D4, D7).</summary>
  public const int MAX_RETRIES = 3;

  /// <summary>Set on a request of a present user's read, the only kind ever retried; a request without it is never retried (D2).</summary>
  public static readonly HttpRequestOptionsKey<bool> PresentUser = new("RevolutReader.Bank.PresentUser");

  /// <summary>Set on every request: when its request timeout runs out (now + RequestTimeout). A Retry-After wait must end before it (D8).</summary>
  public static readonly HttpRequestOptionsKey<DateTimeOffset> Deadline = new("RevolutReader.Bank.Deadline");

  /// <summary>
  /// The retry strategy: MAX_RETRIES, exponential waits from <paramref name="firstWait"/> with jitter, Retry-After followed,
  /// ShouldHandle = <see cref="ShouldRetry"/> with the request taken from the resilience context and now from
  /// <paramref name="time"/> (D4, D5, D8).
  /// </summary>
  public static HttpRetryStrategyOptions Options(TimeSpan firstWait, TimeProvider time);

  /// <summary>
  /// D5: true only when <paramref name="request"/> carries <see cref="PresentUser"/> = true and the attempt failed in a way
  /// that reads as bank unavailable: an HttpRequestException, or an error answer whose error value
  /// (<see cref="EnableBankingErrorValue"/>) BankErrorClassification puts as Unavailable. False for a success, rate
  /// limited, access expired, an unexpected answer and any cancellation. D8: false too when the answer's Retry-After wait,
  /// counted from <paramref name="now"/>, would end after the request's <see cref="Deadline"/>, or when a Retry-After comes
  /// on a request without a deadline. Never throws for what an answer holds.
  /// </summary>
  public static ValueTask<bool> ShouldRetry(HttpRequestMessage? request, Outcome<HttpResponseMessage> outcome, DateTimeOffset now, CancellationToken cancellationToken);
}

/// <summary>Inside the retry handler: loads each answer's body into memory within its attempt (D6).</summary>
public sealed class WholeAnswerHandler : DelegatingHandler {
  protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken);
}

/// <summary>
/// An error answer's error value (c006 D3, D7), as the client and the retry rule both read it (D5): a code, no value, or a
/// value of another shape (never quoted). Moved from EnableBankingClient's private ErrorValue, unchanged in meaning.
/// </summary>
public readonly record struct EnableBankingErrorValue(string? Code, bool IsUnrecognised) {
  public static EnableBankingErrorValue None { get; }

  /// <summary>As the log line says it: the code as received, "none" or "unrecognised".</summary>
  public string Logged { get; }

  /// <summary>Reads the body; what it holds never makes it throw (a body that is not JSON of the error shape is no value).</summary>
  public static Task<EnableBankingErrorValue> Read(HttpResponseMessage response, CancellationToken cancellationToken);
}

public sealed class EnableBankingOptions {
  // … unchanged …

  /// <summary>The wait before the first retry; later waits double from it, spread at random (D4, D7). Zero in tests.</summary>
  [Range(typeof(TimeSpan), "00:00:00", "00:00:05")]
  public TimeSpan RetryDelay { get; init; } = TimeSpan.FromSeconds(0.8);
}
```

The wiring (`EnableBankingRegistration.AddEnableBanking`), order matters: a handler added later runs inside the one before it. Two statements on the client builder, because `AddResilienceHandler` returns the pipeline's builder, not the client's (corrected during `/tdd-apply`, 2026-11-08; the first sketch chained them, which does not compile):

```csharp
IHttpClientBuilder bank = services
  .AddHttpClient<IBankAccount, EnableBankingClient>(/* BaseAddress, Timeout = RequestTimeout: now the limit for a request with its retries (D1) */)
  .RemoveAllLoggers();

bank.AddResilienceHandler("bank-retries", static (pipeline, context) =>
  pipeline.AddRetry(BankRetries.Options(
    context.ServiceProvider.GetRequiredService<IOptions<EnableBankingOptions>>().Value.RetryDelay,
    context.ServiceProvider.GetRequiredService<TimeProvider>())));
bank.AddHttpMessageHandler(static () => new WholeAnswerHandler());   // added after, so it runs inside: within each attempt (D6)
```

`EnableBankingClient` keeps its signature. Inside: each request gets `request.Options.Set(BankRetries.PresentUser, trigger.Value is PresentUser)` and `request.Options.Set(BankRetries.Deadline, time.GetUtcNow() + RequestTimeout)` next to the trace exclusion; its error answers are read with `EnableBankingErrorValue.Read`. Nothing else changes: the final attempt's outcome is classified as today, the log line is the same.

`appsettings.json`: `EnableBanking:RetryDelay` = `"00:00:00.8"` (production and local: this value; tests: zero); `RequestTimeout`'s comment says it covers a request with its retries; `Logging:LogLevel:Polly` = `"Warning"` (D9).

Acceptance DSL (`Dsl/BankDsl`) and drivers. The fake bank's retry wait is zero (`Drivers/FakeBank`):

```csharp
/// <summary>The first request: the bank reports an error of its own; later requests get what the scenario set up (the default balance otherwise).</summary>
public void ReportsOwnErrorForTheFirstRequest();

/// <summary>
/// The first request: the answer starts and the connection breaks while it comes in; later requests get what the scenario
/// set up. It must be a break .NET's own resend does not absorb (the answer has started), so only the app's retry can recover.
/// </summary>
public void BreaksConnectionWhileAnsweringTheFirstRequest();

/// <summary>As ListsInPages, and the first request for page <paramref name="failingPage"/> gets the bank's own error.</summary>
public void ListsInPagesWithOneErrorOnPage(DateOnly since, int count, int pages, int failingPage);

/// <summary>The page each transactions request asked for, in the order received (1 for the first page).</summary>
public IReadOnlyList<int> PagesRequested();
```

## Rule ownership

| Rule (spec `bank-reads`) | Enforced by |
|---|---|
| A present user's request is repeated up to three times | `BankRetries.Options` (`MaxRetryAttempts` = `MAX_RETRIES`) |
| Only failures that read as bank unavailable are repeated | `BankRetries.ShouldRetry` with `EnableBankingErrorValue` and `BankErrorClassification` |
| A break while the answer comes in counts as such a failure | `WholeAnswerHandler` (D6) |
| Only a present user's requests | `EnableBankingClient` sets the mark; `BankRetries.ShouldRetry` requires it |
| The first answer that is not such a failure is used | the retry strategy, then `EnableBankingClient`'s classification, unchanged |
| The timeout covers a request with its repeats; a timed-out request is not repeated | `HttpClient.Timeout` around the handler (`EnableBankingRegistration`); the strategy stops on cancellation |
| A `Retry-After` wait is followed, but a repeat whose wait would end after the timeout is not made (design only, D8) | `EnableBankingClient` sets the deadline; `BankRetries.ShouldRetry` compares; the strategy waits as asked |
| A transactions read repeats only the failed page | the handler sits on the HTTP client, below `TransactionPages`: each page is its own request |
| Rate limited, access expired and errors are never repeated | `BankRetries.ShouldRetry` (every kind but `Unavailable`) |
| Bank unavailable once no repeat is left | `EnableBankingClient` (unchanged) |
| No other client retries | ServiceDefaults (no handler) and the convention test (D10) |

## Error model

- No new operation and no new result case. The retries happen inside one request; callers see only the time they take.
- The final attempt is classified as today: a network failure or our timeout is "bank unavailable"; an error answer gets its case or a `BankReadException` (c004 D4, c006 D3).
- `BankRetries.ShouldRetry` never throws for what an answer holds; `EnableBankingErrorValue.Read` keeps the client's rule that no body makes it throw.

## Ports and contracts

- **`IBankAccount`:** signatures and cases unchanged. Contract additions:
  - **Failure modes:** a present user's request that fails in a way that reads as bank unavailable is sent up to 4 times within the request timeout, waiting about 0.8, 1.6 and 3.2 s in between, or as long as a `Retry-After` asks when that still ends within the timeout (otherwise the read ends at once); an unattended request is sent once.
  - **Idempotency:** every request is a `GET`, so resending is safe. The bank's limits are unchanged for the caller: unattended reads still make one request per page.
  - **Ordering and concurrency:** unchanged; concurrent reads retry independently.
- **Infrastructure:** the typed `HttpClient` as before, plus the library's resilience handler (one retry strategy) and `WholeAnswerHandler` inside it; `Timeout` = `RequestTimeout` around both.
- **In-memory fake:** none, as in C5 and C12; the acceptance tests use the real adapter against the fake bank.

## How each scenario is verified

All six through the port, as acceptance tests in `Scenarios/BankReads/BankReadsScenarios.cs`, driven by `BankDriver` against the fake bank, with the retry wait at zero (D7). None is a frontend or manual scenario.

- **"A connection that breaks once is retried and the read succeeds":** the fake's break must happen after the answer has started (e.g. a promised body cut short). A break before any answer could be resent by .NET itself (§ Context), and the test would pass without our retries.
- **"A bank that answers too slowly reads as bank unavailable":** unchanged setup (an answer after the 5 s timeout), plus the request count.
- **The changed GIVENs** of "A bank error reads as bank unavailable" and "A gateway's error page reads as bank unavailable" ("every request") match what their DSL facts already do; their tests are unchanged.
- Present-user 429 and access expired (never retried), a retried page that keeps its continuation key and user headers, and `Retry-After` (D8: a 60 s one ends the read at once after one request; a 1 s one is waited for; one that overruns the time left ends it at once) are adapter edge tests, not scenarios: the spec leaves every wait to this design, as it leaves D4's numbers.

## Cross-cutting effects

- **API contract / TS client:** none.
- **Bicep / AppHost:** none. `RetryDelay` keeps its `appsettings.json` value in production; no environment variable.
- **Settings:** `EnableBanking:RetryDelay` (D7) and `Logging:LogLevel:Polly` (D9) declared in `appsettings.json`; `RequestTimeout`'s comment updated (D1). No secret.
- **Bank calls (ADR-0001 § Decision):**
  - unattended requests are never repeated, so the 4 a day are never touched by a retry;
  - a present user's repeat carries the same user headers;
  - "no bank calls beyond what the view needs": a repeat replaces a call that failed.

  ADR-0001 gets a dated note in its Consequences ("429, expired and revoked sessions … never retried" stays; a present user's transient failures are retried, c008), and D11's finding in § Transaction history (a continuation key works a second time).
- **Docs:**
  - docs/conventions/README.md § Backend code: the rule keeps "no retries by default", with D10's broader reason (each client's calls decide: quotas, repeatable or not, an SDK's own retries), and "the bank client never retries" becomes "the bank client retries only a present user's transient failures (c008 design.md)";
  - `spikes/enable-banking/README.md`: the key-reuse probe and its evidence (D11); `CLAUDE.md`'s Check 2 row: its filter now also runs the probe (3 more present-user requests, none unattended);
  - `.claude/rules/backend-code.md`, its mirror;
  - docs/conventions/testing.md (the driver's "production wiring … no retries" now includes the bank client's retries);
  - `Directory.Packages.props` and the ServiceDefaults comment;
  - docs/operations/deployment.md § Checks, the ready query (D9);
  - `pm/roadmap.md` C11: "within about 2 s" becomes the decided policy, with a change-log row in `pm/progress.md` (the user decided D4).
- **Software-factory kits:** no shortcut in a kit of the handover inventory (openspec/config.yaml, design rule added by #34): the R-30 kit (ServiceDefaults without default retries) stays whole and gains its guard test (D10).
- **Software factory:** lesson R-30 updated:
  - the rule stays, with D10's broader reason (quotas, idempotency, an SDK's own retries, no stacked layers), and a convention test guards it; a client that needs retries gets a resilience handler of its own;
  - its retry rule reuses the client's own error classification, and the client's timeout wraps it;
  - requests that a quota counts (unattended) are never retried;
  - the platform already resends idle-connection failures;
  - the numbers are copied from a well-known SDK (the Azure SDK) rather than invented;
  - `Retry-After` is followed only while its wait still ends within the request's own timeout;
  - an undocumented behaviour a retry relies on (here a reused continuation key) is probed once against the real service, with the owner present.

  R-30's line in the inventory of `creating-handover-package.md` is checked. Lesson line 488's "no retries" is updated.

## Risks / Trade-offs

- [Enable Banking stops accepting a reused continuation key later] → probed once (D11); a refusal would end the page as an error with its code in the log, never wrong data.
- [A gateway's `Retry-After` makes a read wait] → only while the wait still ends within the 15 s; otherwise the read ends at once (D8).
- [The acceptance harness's `FakeTimeProvider` (C6) freezes the library's waits] → tests run with a zero wait (D7); a comment at the setting says why. D8's deadline is read from the same clock, so it stays consistent with it.
- [The library's lines carry an identifier] → the telemetry guard reads with a retry (D9); the library logs no request address, only its pipeline name, the status or the exception.
- [`Microsoft.Extensions.*` 10.11 packages on .NET 11 RC3] → the same line as ServiceDiscovery 10.11.0, which builds today; the bootstrap proves it.
- [Retries hide a bank that degrades] → the retry warnings and the ready query (D9).
- [A real outage takes about 6–8 s to show] → accepted with D4.
- [C6 merges first and conflicts] → rebase; the shared files are lists where both add lines.

## Migration Plan

Nothing to migrate. The next deploy after the merge carries it; rolling back is reverting the PR (no data, no Azure change).

## Open questions

None. D1–D11 are decided (2026-11-08).
