---
paths:
  - "**/*.cs"
---

# Backend code

- **Expected failures are Result values** (a C# 15 `union` of sealed record cases, built in C5; a generic union such as `BankResult<T>` declares its failure records next to it, not nested); exceptions only for bugs and infrastructure failures. Inner code returns domain-side results or plain values — **only endpoints** translate into the HTTP result and ProblemDetails; the HTTP result type never travels inward.
- **Every non-2xx response is ProblemDetails** (RFC 9457) for callers that accept JSON, with the status from the case → status table in the conventions — no ad-hoc error JSON. A change whose scenario produces a new case adds its row there.
- **No default HTTP retries:** an outgoing `HttpClient` gets retries only when its own change decides a policy, as a resilience handler on that client alone, never in ServiceDefaults; each client's calls decide (quotas, repeatable or not, an SDK's own retries, no stacked layers), and a convention test guards it. The bank client retries only a present user's transient failures (c008 design.md); 429, access expired and unattended reads never.
- **FastEndpoints, thin:** an endpoint holds route, OpenAPI metadata, auth and the Result → ProblemDetails mapping, and injects a plain handler class with no FastEndpoints/HTTP references. No mediator, no pipeline behaviors around handlers.
- **Reads project:** a read endpoint maps into a DTO with only the fields the UI shows — never a mirror of the Enable Banking model — and its exact shape is pinned by a test.
- **Never log bank data** — no balances, amounts, counterparties or transaction texts in logs, traces or error messages; ids and counts only. A code from the bank (a type code, an error code) is logged only when it looks like a code (a type code: `^[A-Z0-9_]{1,40}$`, `TransactionKinds.LooksLikeACode`); any other value is logged without quoting it.
- **The transaction store:** the port `ITransactionStore` in `Account/`, its adapter `TableTransactionStore` (with its settings and registration) in `Storage/`; storage failures are exceptions, never Result values. **The push device store** the same way: the port `IPushDeviceStore` in `Push/`, its adapter `TablePushDeviceStore` in `Storage/` (C8a).
- **Writes from other sites are refused** by `UseCrossSiteWriteProtection` (every POST/PUT/PATCH/DELETE under `/api`: `Sec-Fetch-Site` same-origin or none, else the app's own `Origin`, neither header passes; the sign-in return exempt; refused → 403 problem). A new write endpoint needs nothing of its own.
- **Secure by default:** every endpoint requires a signed-in, allowed user (the `AllowedUser` policy is the default and the fallback policy, an anonymous catch-all `/api/{**path}` answers 404 for every method, and a refusal counts only for a request that matched a real route, so an unknown API address answers 404 to everyone); only an explicit `AllowAnonymous` opens an address, and anonymous endpoints go on the explicit, test-checked allowlist (the test reads the real endpoint list, so routes a framework maps by itself are caught too). Health probes touch neither the database nor the bank.
- **Bank calls follow [ADR-0001-bank-data-access](../../docs/adr/0001-bank-data-access.md):** PSU headers only on requests directly triggered by a signed-in user's open or refresh, with that user's real values, all required headers or none; never on background work; handle 429, expired and revoked sessions.
- **Time:** never `DateTime.Now/UtcNow` or `DateTimeOffset.Now/UtcNow` — inject `TimeProvider`; time-dependent logic takes `DateTimeOffset now` as a parameter.
- **Guards:** BCL throw helpers (`ArgumentNullException.ThrowIfNull`, …) and `UnreachableException` only — no guard library, no custom `Guard`.
- **One-line blocks carry no braces;** the statement sits on the next line, indented.

Source of truth: [docs/conventions/README.md](../../docs/conventions/README.md).
