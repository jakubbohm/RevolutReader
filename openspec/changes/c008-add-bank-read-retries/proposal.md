# Proposal: c008-add-bank-read-retries

## TL;DR

- **What and why:** a bank read for a present user retries a failed request up to 3 times (waits from 0.8 s, doubling, as the Azure SDK does), so a one-off network failure or bank error no longer ends as "bank unavailable" ([#27](https://github.com/jakubbohm/RevolutReader/issues/27)). Built with Microsoft's resilience library (`Microsoft.Extensions.Http.Resilience`, Polly) on the bank client alone.
- **Never retried:** our own 15 s timeout (it now covers a request with all its retries), unattended reads, rate limited, access expired, any other error.
- **Out of scope:** retries for any other client (none gets them by default); a C9 fallback check; a time budget per read.
- **Riskiest assumption:** that the failures worth retrying are one-off blips; no real bank read has failed yet, and the retry warnings will show it (design.md D9). Enable Banking accepting a continuation key twice was probed on the real account and holds (D11).
- **bank-reads, added** (requirement "Retrying a failed request"): "A one-off bank error is retried and the read succeeds"; "A connection that breaks once is retried and the read succeeds"; "A bank error that persists is tried four times, then reads as bank unavailable"; "A failure on a later page retries only that page"; "An unattended read is never retried".
- **bank-reads, modified** ("Bank unavailable"): "A bank that answers too slowly reads as bank unavailable" now also checks that the bank received exactly one request; the other two scenarios only say "every request" in their GIVEN. **Removed:** none.

## Why

The bank adapter turns every network failure and every error of the bank's own straight into "bank unavailable" ([c004 design.md D4](../archive/2026-11-07-c004-add-enable-banking-adapter/design.md)). The daughter then sees "Banka teď neodpovídá" for a blip that a second request a moment later would have survived, and C9's phone-triggered check has nobody to tap "try again". The owner asked for short retries (#27, 2026-11-08). C7 and C9 are the adapter's first callers, so the retries come before them (roadmap C11).

## What Changes

- **A present user's request is retried** when it fails in a way that reads as "bank unavailable": the bank cannot be reached, the connection breaks while the answer comes in, or the bank reports an error or a timeout of its own (`ASPSP_ERROR`, `ASPSP_TIMEOUT`, a 5xx or 408 without an Enable Banking code). Up to 3 retries, waits of about 0.8, 1.6 and 3.2 s with a random spread (design.md D4, D5).
- **Per HTTP request:** a failed transactions page retries that page only; Enable Banking accepts its key a second time (probed on the real account with the owner's headers, D11).
- **A `Retry-After` header is followed** while its wait still ends within the request's 15 s; otherwise the read ends at once instead of waiting for nothing (D8).
- **Never retried:** a request that runs into our own request timeout (the timeout now covers a request together with its retries, so the worst case stays 15 s, D1); every unattended read (D2); rate limited (429), access expired and every other error.
- **Built with Microsoft's resilience library** on the bank client only: `Microsoft.Extensions.Http.Resilience` 10.11.0, which runs on Polly (D3). The rule "no retries by default" stays, with a broader reason, and a convention test guards it (D10).
- **A new setting** `EnableBanking:RetryDelay` (0.8 s), the wait before the first retry; tests set it to zero (D7).
- **The retry library's own log lines:** the retry warnings stay, its line for every attempt is dropped; a ready query lists the retries (D9).

No **BREAKING** change: the port's signatures and result cases stay.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bank-reads`: a new requirement "Retrying a failed request"; "Bank unavailable" now applies once the retries are used up, and a request that runs into our own timeout is not repeated.

## Non-goals

- Retries for any other outgoing client: the rule "no default retries" stays (docs/conventions/README.md § Backend code).
- Retries on unattended reads, also a later C9 fallback check: C9 decides that if it keeps one (D2).
- A shorter timeout per attempt or a time budget per read (D1, decided against).
- A circuit breaker, hedging or a rate limiter: one user, one app copy, a handful of reads a day.

## References

- **Roadmap:** C11 `cNNN-add-bank-read-retries` (added 2026-11-08); depends on C5 and C12, both done. Runs in parallel with C6 (`c007-add-user-login`, its own session and worktree).
- **Issue:** [#27](https://github.com/jakubbohm/RevolutReader/issues/27) (the proposal and the questions this change decides).
- **Use cases:** UC2 and UC3 (kickoff ch. 5), through the adapter they build on.
- **Open questions:** decides none; applies Q6 through ADR-0001-bank-data-access: no retry may use up the 4 unattended reads a day, so unattended reads are never retried.
- **Earlier decisions it changes:** c001 design.md D5 and c004 design.md D4 ("the bank client never retries") become "the bank client retries a present user's transient failures only"; [ADR-0001](../../../docs/adr/0001-bank-data-access.md) gets a dated note; software-factory lesson R-30 is updated.

## Impact

- **Code:** `src/RevolutReader.Api/Bank/`: the retry rule and its options (new), the bank client's registration (the resilience handler, a handler that reads each answer whole), `EnableBankingClient` (marks a present user's requests; the reading of an error answer shared with the retry rule), `EnableBankingOptions` (`RetryDelay`); `appsettings.json` (`RetryDelay`, a log level for the library).
- **Tests:** six acceptance claims (five new, one changed) with new fake-bank facts; unit tests for the retry rule and its options; adapter edge-case tests in `IntegrationTests/Wiring/EnableBanking/`; a convention test that no other client retries; the telemetry guard reads once with a retry. Already added: the key-reuse probe next to Check 2, explicit, with its counts-only evidence (D11).
- **Packages:** `Microsoft.Extensions.Http.Resilience` 10.11.0 (nuget.org, stable since 2026-10-14, MIT), in the API project only.
- **Azure:** none. No Bicep change: `RetryDelay` keeps its `appsettings.json` value in production.
- **Docs:** docs/conventions/README.md § Backend code and `.claude/rules/backend-code.md` (the rule's broader reason and the bank client's exception), docs/conventions/testing.md (the driver's wiring now retries), ADR-0001 (a dated note and the key-reuse finding), `spikes/enable-banking/README.md` (the probe), docs/operations/deployment.md (a ready query for retries), docs/software-factory/lessons.md R-30, `CLAUDE.md` (the Check 2 row); `pm/roadmap.md` (C11's "within about 2 s" becomes the decided policy) and `pm/progress.md`.
- **Cost:** none. A persistent outage now takes about 6–8 s to show as "bank unavailable" instead of about 0.5 s (D4).
