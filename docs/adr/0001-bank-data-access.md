# ADR-0001: Bank data access — consent, request limits and PSU headers

**Status:** Accepted (the user's decision, 2026-11-04) · **Date:** 2026-11-04 · **Roadmap:** M1 (verification); applied in F0-2, C5, C7, C9, C10 · **Questions:** Q5, Q6 (kickoff ch. 10)

> Recorded during M1. Findings were verified against the sources listed with each one on 2026-11-04. Revolut's exact `maximum_consent_validity` in Enable Banking is still to be read via `GET /aspsps` during the M1 setup; update § Context when it is.

## Context

The backend reads the balance and transactions of one Revolut account through Enable Banking (kickoff ch. 6). Two risks decide parts of the UC2 and UC3 design (roadmap ch. 3): how long the consent lasts and what Enable Banking costs (Q5), and how many requests the bank allows when the account holder is not present (Q6).

### Consent validity and pricing (Q5)

- **Consent validity:** Revolut gives providers registered in the EU 180 days of access (Enable Banking is an EU AISP licensed in Finland). Enable Banking caps each session at the bank's `maximum_consent_validity`, which is 180 days for most banks; Revolut's value is read via `GET /aspsps` once the application exists (no bank call). The ~2-month operating period fits with ~4 months to spare.
- **Early expiry** is still possible (revocation, or a bank that does not support several sessions per user). Restricted mode needs two bank authorisations: the account link in the Control Panel, and the API session.
- **Pricing:** free. Terms of Service: "Use of the Control Panel and the API under these Terms is free of charge." Production use is limited to linked accounts, "solely for evaluation purposes or for the personal use of private individuals". The Enable Banking account must be registered by the account holder (the terms forbid accessing accounts that do not belong to the Control Panel user).
- **Sources:** [Revolut FAQs](https://developer.revolut.com/docs/guides/build-banking-apps/faqs), [Revolut AIS tutorial](https://developer.revolut.com/docs/guides/build-banking-apps/tutorials/get-account-and-transaction-information), [Enable Banking FAQ](https://enablebanking.com/docs/faq/), [Enable Banking API reference](https://enablebanking.com/docs/api/reference/), [Enable Banking Terms of Service](https://enablebanking.com/terms/), [Enable Banking changelog Dec 2025](https://enablebanking.com/blog/2026/01/15/enable-banking-changelog-december-2025)

### Request limits (Q6)

- Revolut allows at most 4 requests per 24 hours per account, endpoint and consent when the PSU (the payment service user, i.e. the account holder) is not present (SCA RTS Art. 36(5)). The limit does not apply when the PSU is present, which is signalled by the PSU headers (IP address). Paging through one large response and fetching right after authorisation do not count.
- Enable Banking: send either all PSU headers the bank requires or none; none for scheduled fetches. An exhausted limit returns 429 `ASPSP_RATE_LIMIT_EXCEEDED`. The Terms of Service forbid bypassing rate limits and falsifying the origin of communications.
- Transactions older than 90 days are available only within 5 minutes after authorisation.
- **Sources:** [Revolut Usage and limits](https://developer.revolut.com/docs/guides/build-banking-apps/usage-and-limits) (blocks automated fetching; read via search index), [Revolut AIS restrictions](https://developer.revolut.com/blog/2024-09-16-open-banking-ais-restrictions), [Enable Banking FAQ](https://enablebanking.com/docs/faq/), [Enable Banking knowledge base](https://enablebanking.com/knowledge-base), [Enable Banking Terms of Service](https://enablebanking.com/terms/)

## Decision

Decided by the user, 2026-11-04:

1. **User-triggered reads are live and carry the user's PSU headers.** When a signed-in user opens or refreshes the account view, the backend reads live from the bank and forwards that user's real PSU headers (IP address, user agent, …). The user's position: the daughter acts on the account holder's behalf.
2. **Enable Banking support is not asked** (deviation from roadmap ch. 3, item 3). The user accepts the risk that Enable Banking cuts off the application; the design keeps that risk low through the constraints below.
3. **The background job for notifications runs 4 times a day without PSU headers:** every 6 hours, the first run at 06:00 (configurable).
4. **A database is needed:** it holds the downloaded transactions and the time of the daughter's last view.
5. **A notification is sent only if something changed since the daughter's last view.**

**Constraints (binding on every bank call):**

- PSU headers only on bank requests triggered directly by a signed-in user's open or refresh, with that user's real values.
- Never PSU headers on the background job.
- All required headers or none.
- No bank calls beyond what the view needs.
- 429 and bank errors are handled gracefully.

## Alternatives considered

*To be completed by the M1 session from its discussion with the user.*

## Consequences

- **Consent:** a consent renewal feature is most likely unnecessary — confirm from the actual `valid_until` after linking. The timing of the linking does not matter. Expired and revoked sessions (`EXPIRED_SESSION`, `REVOKED_SESSION`) must be handled; the fallback is repeating the linking, which needs the account holder for SCA.
- **Bank adapter:** it forwards PSU headers from the incoming request only on user-triggered reads, takes the list of required headers from `GET /aspsps`, and handles 429, expired and revoked sessions.
- **Account detail (UC2):** live reads; no cache is needed. Whether v1 already stores fetched data (e.g., as a fallback when a live read fails) is open for F0-2.
- **Notifications (UC3):** 4 runs a day from 06:00; notify only on changes since the daughter's last view. The time zone of the start time and whether the last view is tracked per user are decided with Q8.
- **Accepted risk:** Enable Banking may cut off the application because of the PSU-header approach (Decision, item 2).
- **Logging:** bank data never appears in logs (docs/conventions/README.md § Backend code).
