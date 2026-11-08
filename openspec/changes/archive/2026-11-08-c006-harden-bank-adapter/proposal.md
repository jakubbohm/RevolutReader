# Proposal: c006-harden-bank-adapter

## TL;DR

- **What and why:** the bank adapter C5 built has five flaws a code review found and two found while assessing them. Nothing calls it yet, so they are fixed now, before C7 builds on it: no endless paging, no flipped sign, a gateway's error page reads as "bank unavailable", accented browser names, a log line for every read, no bank text quoted into logs, the present user checked. Every failed bank read also becomes easy to find: its reason in the log line, Application Insights fed by the app, and ready queries; the daily log cap matches the free 5 GB a month.
- **Out of scope:** C7's endpoints and forwarded headers; the review's ten minor findings (merged in PR #26); alerts; the small edges D1 accepts.
- **Riskiest assumption:** Revolut keeps sending unsigned amounts (none of 116 had a minus); if one ever comes signed, reads fail visibly until the code is changed (design.md D2).
- **bank-reads, added:** "A browser name with an accent reaches the bank with a question mark"; "A gateway's error page reads as bank unavailable".
- **bank-reads, modified** (their scenarios unchanged): "What a transaction carries", "Every page is read", "Who triggers a read", "Bank unavailable". **Removed:** none.

## Why

A whole-codebase review (2026-11-07) found five flaws in the Enable Banking adapter, and the assessment in `/opsx:explore` found two more (design.md § Context, D1). The adapter has no caller yet: C7 (UC2, the account detail) is its first, then C9 (UC3, the notifications). Fixing them now costs a small change; after C7 it would mean wrong amounts in stored history, an endless request in front of the user, or the wrong error screen. Early in operation, every unexpected answer from the bank should also be easy to find, to catch the cases nothing covers yet (D8).

## What Changes

- **Paging stops at 20 pages:** a read whose 20th page still announces another fails as an error, instead of following new continuation keys forever (D4).
- **A negative amount from the bank is an error,** instead of a payment turning into money received (D2).
- **An error answer without an Enable Banking code is decided by its status, whatever its body:** a gateway's HTML or JSON error page on a 5xx is "bank unavailable" (D3). Only a value shaped like an Enable Banking code counts as a code (D7).
- **The browser name is cleaned before it is sent:** anything outside printable ASCII becomes `?`, so an accented browser name no longer blocks that user's reads (D5).
- **A present user is checked when created:** an IP address and a non-blank user agent, as c004 design.md D2 already says (D1 g).
- **Every end of a read writes its one log line,** also on an unexpected exception (D6), and the line says **why** a read ended unexpectedly (D8 a). The bank's error code is logged only when it has the shape of a code (D7).
- **Application Insights:** a workspace-based resource on the existing Log Analytics workspace; the deployed app exports its logs and traces (not its metrics, which the platform's own metrics cover, D10) to it through Microsoft's Azure Monitor exporter, writing with its own managed identity (local authentication off). Local runs and tests are unchanged (D8 b). Its role on Application Insights needs the deploy identity's role condition widened by hand, once (guided task, D8 b).
- **Ready queries** in `docs/operations/deployment.md`: every bank read that did not end as read, and the same counted by reason (D8 c).
- **The workspace's daily cap matches the free allowance:** 0.16 GB a day (5 GB a month per billing account ÷ 31), up from 0.1 GB; Application Insights data counts against the same allowance (D9).

No **BREAKING** change: the port's signatures stay; its callers do not exist yet.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bank-reads`: a negative amount is an error (What a transaction carries); a read stops after 20 pages (Every page is read); the browser name is cleaned and a present user is checked (Who triggers a read); a server error without an Enable Banking code is bank unavailable (Bank unavailable).

## Non-goals

- C7's endpoints, its forwarded-headers setup and the IPv4-in-IPv6 address form (c004 design.md D2): they belong to the first caller.
- The review's ten minor findings, fixed directly on `fix/review-findings` and merged in PR #26, among them the check that the API address is an http or https address.
- Alerts on failed reads (each alert rule costs a little a month): the ready queries come first.
- A time limit for a whole read: the caller passes a cancellation token with its own deadline (D4).
- The small edges D1 accepts: a byte-order mark before an error body, the "left out" count when mapping fails, a page counted that was never sent, the timeout-versus-cancellation race.
- Microsoft's all-in-one OpenTelemetry package, live metrics, the profiler and sampling (D8, rejected).

## References

- **Roadmap:** a new step, C11 "Harden the bank adapter", before C7 and in parallel with C6 (the user, 2026-11-07; change log in `pm/progress.md`).
- **Use cases:** UC2 and UC3 (kickoff ch. 5), through the adapter they build on.
- **Open questions:** decides none; applies Q6 through ADR-0001-bank-data-access (the user headers on present-user reads; paging within one read does not count against the bank's limit).
- **Earlier decisions it changes:** c004 design.md D4's table for error answers (D3), and c005 design.md D6's "Application Insights … can come later" (D8) and its 0.1 GB daily cap (D9).

## Impact

- **Code:** `src/RevolutReader.Api/Bank/` (`TransactionPages`, `TransactionMapping`, `PsuHeaders`, `ReadTrigger`, `EnableBankingClient`, a new code-shape check); `src/RevolutReader.ServiceDefaults/` (the Azure Monitor exporter); `appsettings.json` (two empty settings for the exporter).
- **Tests:** two acceptance scenarios with a new fake-bank answer and DSL facts; unit tests for the mapping, the pages, the user headers, the present user and the code shape; adapter edge-case tests in `IntegrationTests/Wiring/EnableBanking/`, one of which (`ErrorAnswerTests`) changes its expectation for a 503 with an HTML page.
- **Packages:** `Azure.Monitor.OpenTelemetry.Exporter` 1.10.0 and `Azure.Identity` 1.21.0 (nuget.org, 2026-11-08).
- **Azure (Bicep, deployed by the pipeline):** a workspace-based Application Insights resource with local authentication off; the app's identity gets `Monitoring Metrics Publisher` on it; two environment variables on the container app; the workspace's daily cap 0.16 GB. **By hand, once, by the owner:** the deploy identity's role condition gets that role ([azure-prerequisites.md](../../../../docs/operations/azure-prerequisites.md) step 5).
- **Docs:** a new ADR, `docs/adr/0009-application-telemetry.md` (D11); `docs/operations/deployment.md` (queries), `docs/operations/azure-prerequisites.md` (five roles), `docs/conventions/workflow.md` § 5 (Application Insights), `docs/conventions/configuration.md` (the two settings), a lesson in `docs/software-factory/lessons.md`; `pm/roadmap.md` and `pm/progress.md` (C11).
- **Cost:** none expected. Application Insights stores into the same workspace, under the same free 5 GB a month, and the workspace's daily cap becomes 0.16 GB to match that allowance (D9; #17 watches the volume).
