# Proposal: c004-add-enable-banking-adapter

## TL;DR

- **What:** the backend's read-only connection to Enable Banking for the one linked Revolut account: the balance, and the transactions from a given day across every page. Each read states whether a user is present (the user's address and browser go to the bank) or not (no user headers). Expected failures come back as the first Result union: access expired, rate limited, bank unavailable. Plus its settings and secrets, logs without account identifiers, and two on-demand checks against the sandbox bank and the real account.
- **Why now:** C7 (account detail) and C9 (notifications) both read through it; it runs in parallel with C4 and C6.
- **Out of scope:** any endpoint and the case → status mapping (C7), storage and the history import (C7), the background job (C9), consent renewal (C10), retries of any kind.
- **Riskiest assumption:** the fake bank (copied from the Mock ASPSP and written from the API reference) answers like the real Enable Banking. Checks 1 and 2 test it against the sandbox and the real account; of the failures, only an unknown session can be produced on demand.
- **Scenarios added** (`bank-reads`): The balance is the account's available balance · A spent payment comes back negative, with the payee and its details · A received transfer comes back positive, with the payer · Pending transactions come back marked pending · Cancelled and rejected transactions are left out · Transactions on every page are returned · A read for a present user carries the user's address and browser · An unattended read carries no user headers · An expired bank session reads as access expired · A reached request limit reads as rate limited, with no second request · A bank error reads as bank unavailable · A bank that answers too slowly reads as bank unavailable · A failure on a later page fails the whole read

## Why

Roadmap step **C5** (`pm/roadmap.md`). No use case directly: UC2 (account detail, C7) shows what this reads, and UC3 (notifications, C9) compares it. The adapter is a port later changes build on, so its contract gets a capability spec, verified through its public interface (design.md D1). Everything below was decided with the user in explore, one decision at a time (2026-11-06, design.md D1–D8).

## What Changes

- **A bank port for the one configured account** (D2):
  - two read-only operations, the balance and the transactions from a given day; the adapter follows every page itself;
  - every caller states who triggers the read: a present user (the user's IP address and user agent, sent as `Psu-Ip-Address` and `Psu-User-Agent`) or unattended (no PSU headers);
  - callers never pass account or session ids.
- **What it hands back** (D3): the available (`ITAV`) balance; booked and pending transactions with reference, status, date, signed amount, currency, counterparty and payment-detail lines. Every other field and status stays out.
- **The Result type, first built here** (D4): one generic C# 15 union, a success value or one of three failures, decided by Enable Banking's error code. No retries, a per-request timeout setting, and a failure on any page fails the whole read.
- **No account identifiers in logs or traces** (D5): the bank client's default HTTP logging and tracing are switched off, and the adapter logs one line per read instead. A guard test checks it.
- **Settings and secrets** (D6): an `EnableBanking` section validated at start-up. Application id, private key, session id and account id are secrets in the AppHost's user-secrets locally (the sandbox application and the Mock ASPSP) and in Key Vault in production. A guided task fills them in locally and copies them to the owner's backup vault. A new 180-day Mock ASPSP session covers local development.
- **Two checks against the real service** (D7), explicit tests the owner runs, never CI: against the Mock ASPSP (repeatable) and once against the real account (counts only, saved as spike evidence). The recent window is set to 31 days.
- **Conventions and records updated:**
  - a port's scenarios are verified through its public interface (`openspec/config.yaml`, testing.md);
  - failure records sit next to the union (README.md § Backend code);
  - ADR-0001 is amended: PSU headers as an explicit parameter, a fixed header set, pending transactions confirmed, the recent window;
  - configuration.md, docs/operations and lesson R-44 are updated too.

## Capabilities

### New Capabilities

- `bank-reads`: what the backend reads from the linked bank account and how: the balance and the transactions, the user headers a read carries, and how expected failures come back. The contract C7 and C9 build on.

### Modified Capabilities

None. The existing scenarios (`service-health`, `api-errors`, `app-delivery`) keep passing; their app copies get the bank settings (D6).

## Non-goals

- **Endpoints and ProblemDetails for the bank cases:** C7 is the first endpoint that reads the bank, behind C6's sign-in, and it adds the case → status rows (D1, D4).
- **Storage, the history import and the dynamic window:** C7 (ADR-0001 § Decision, item 6; D7).
- **The background job and its 4 unattended reads a day:** C9. C5 only offers the unattended form.
- **Consent renewal:** C10. An expired session is reported as access expired; the owner links again.
- **Retries, a `GET /aspsps` header lookup, session-status calls, `date_to`, a status filter, a fetch strategy:** none (D2, D4).
- **Fields the screens don't need:** time of day (Enable Banking gives dates only), refunds, the CZK equivalent, the display rule for payment details: heads-ups for C7 (D3).
- **Comparing the balance with the Revolut app:** the owner sees it once the deployed app shows it (C7, D7).
- **The forwarded-headers setup behind the Container Apps ingress:** C7 or C4 (D2).

## Open questions

- **Applies Q5** (ADR-0001-bank-data-access): an expired, revoked or closed session is the case "access expired"; the remedy stays the owner's linking.
- **Applies Q6** (ADR-0001): PSU headers only when a user is present, with that user's real values; none when unattended; a 429 is never retried.
- **Input to Q7** (decided in C7): payment details stay a list of the bank's lines; how to show them is C7's display rule.

## Impact

- **New code:**
  - the adapter in `src/RevolutReader.Api/Bank/`: port, union, records, options, client, token, mapping;
  - its registration in `Program.cs`;
  - a request option in ServiceDefaults that keeps bank calls out of HTTP-client traces;
  - the four secret parameters in `AppHost.cs`.
- **Tests:**
  - acceptance scenarios, DSL and drivers with a WireMock.Net fake bank;
  - bank settings for every test app copy;
  - a logging guard in `Conventions/`;
  - unit tests for the token, the mapping and the error classification;
  - adapter edge cases and the two explicit checks in `IntegrationTests/Wiring/`.
- **Packages:** WireMock.Net 2.21.0 (tests only). No package for the token: the BCL signs it.
- **Settings:** `appsettings.json` gains the `EnableBanking` section (four `"<secret>"` entries).
- **Running locally:** `aspire start` needs the four local secrets, set once per machine by the guided task.
- **Deployment:** the deployed app needs the four production secrets in Key Vault. C4 is being built in parallel, so whichever of C4 and C5 merges second wires them into Bicep (design.md D8).
- **Docs:**
  - `openspec/config.yaml`;
  - `docs/conventions/` (README.md, configuration.md, testing.md) and their `.claude/rules/` mirrors;
  - ADR-0001 (amendment);
  - `docs/operations/expiring-approvals.md`;
  - `spikes/enable-banking-mock/` (180-day sessions; made-up test data and a multi-page capture for the fake bank, design.md § Bootstrap);
  - `docs/software-factory/lessons.md` (R-44);
  - `CLAUDE.md` § Commands, `pm/progress.md`.
- **No change to:** the API contract (no endpoint, no TS client), Entra, the ruleset.
