---
paths:
  - "**/*.cs"
---

# Backend code

- **Expected failures are Result values;** exceptions only for bugs and infrastructure failures. Inner code returns domain-side results or plain values — **only endpoints** translate into the HTTP result and ProblemDetails; the HTTP result type never travels inward.
- **Every non-2xx response is ProblemDetails** (RFC 9457), with the status from the case → status table in the conventions — no ad-hoc error JSON.
- **FastEndpoints, thin:** an endpoint holds route, OpenAPI metadata, auth and the Result → ProblemDetails mapping, and injects a plain handler class with no FastEndpoints/HTTP references. No mediator, no pipeline behaviors around handlers.
- **Reads project:** a read endpoint maps into a DTO with only the fields the UI shows — never a mirror of the Enable Banking model — and its exact shape is pinned by a test.
- **Never log bank data** — no balances, amounts, counterparties or transaction texts in logs, traces or error messages; ids and counts only.
- **Secure by default:** every endpoint requires a signed-in, allowed user; anonymous endpoints go on the explicit, test-checked allowlist. Health probes touch neither the database nor the bank.
- **Bank calls follow [ADR-0001-bank-data-access](../../docs/adr/0001-bank-data-access.md):** PSU headers only on requests directly triggered by a signed-in user's open or refresh, with that user's real values, all required headers or none; never on background work; handle 429, expired and revoked sessions.
- **Time:** never `DateTime.Now/UtcNow` or `DateTimeOffset.Now/UtcNow` — inject `TimeProvider`; time-dependent logic takes `DateTimeOffset now` as a parameter.
- **Guards:** BCL throw helpers (`ArgumentNullException.ThrowIfNull`, …) and `UnreachableException` only — no guard library, no custom `Guard`.
- **One-line blocks carry no braces;** the statement sits on the next line, indented.

Source of truth: [docs/conventions/README.md](../../docs/conventions/README.md).
