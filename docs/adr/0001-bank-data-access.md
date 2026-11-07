# ADR-0001: Bank data access — consent, request limits, PSU headers and transaction history

**Status:** Accepted (the user's decision, 2026-11-04); Decision item 3 and the background-job constraint superseded 2026-11-06 by [ADR-0008-phone-triggered-check](0008-phone-triggered-check.md): the owner's iPhone triggers the check, with the phone's PSU headers; amended 2026-11-07 in C5: pending transactions confirmed and the real account checked through the bank adapter (Transaction history), the adapter's PSU-header form, fixed header pair and timeout (Consequences), the recent window of 31 days (Consequences) · **Date:** 2026-11-04 · **Roadmap:** M1 (verification); applied in F0-2, M3, C5, C7, C9, C10, M9 · **Questions:** Q5, Q6 (kickoff ch. 10); input to Q7

> Recorded during M1. Findings were verified against the sources listed with each one on 2026-11-04. Revolut's values in Enable Banking were read via `GET /aspsps` on 2026-11-04 ([spike evidence](../../spikes/enable-banking/evidence/2026-11-04-aspsps-revolut.json)); the API session was authorised on 2026-11-04 in M1 ([session evidence](../../spikes/enable-banking/evidence/2026-11-04-session.json)).

## Context

The backend reads the balance and transactions of one Revolut account through Enable Banking (kickoff ch. 6). Two risks decide parts of the UC2 and UC3 design (roadmap ch. 3): how long the consent lasts and what Enable Banking costs (Q5), and how many requests the bank allows when the account holder is not present (Q6).

### Consent validity and pricing (Q5)

- **Consent validity:** Revolut gives providers registered in the EU 180 days of access (Enable Banking is an EU AISP licensed in Finland). Enable Banking caps each session at the bank's `maximum_consent_validity`. **Revolut's value is 15,552,000 s = 180 days** (all 29 Revolut country entries, `GET /aspsps`, 2026-11-04). The operating period fits: **the API session authorised in M1 on 2026-11-04 was granted until 2027-05-03T18:03Z**, exactly as requested.
- **Early expiry** is still possible (revocation, or a bank that does not support several sessions per user). Restricted mode needs two bank authorisations: the account link in the Control Panel, and the API session.
- **Control Panel account link: 30 days.** When the account was linked on 2026-11-04, Revolut's approval screen showed the consent expiring on 2026-12-04, and the Control Panel offers no choice of period. Enable Banking's linked-accounts page:
  - The link activates the application in restricted mode, and the application "will stay in this state until an agreement has been signed".
  - The link does not authorise data access. That still needs an API session, "even when using the same account".
  - Only linked (allowlisted) accounts return data.
  - The page does not say whether the account stays allowlisted after the link's consent expires.

  **M1 finding (2026-11-04):** the link stayed active after the API session was created, so Revolut keeps both consents side by side. Whether API access depends on the link therefore remains unknown, and the link is renewed (roadmap M9; how: [docs/operations/expiring-approvals.md § 1](../operations/expiring-approvals.md#1-enable-banking-account-link)). Source: [Enable Banking: Whitelisting own accounts](https://enablebanking.com/docs/api/linked-accounts/), FAQ "Why does my restricted application receive an empty list of accounts" (both read 2026-11-04).
- **Operating period:** at least until the end of 2026 (the user, 2026-11-04).
- **Pricing:** free. Terms of Service: "Use of the Control Panel and the API under these Terms is free of charge." Production use is limited to linked accounts, "solely for evaluation purposes or for the personal use of private individuals". The Enable Banking account must be registered by the account holder (the terms forbid accessing accounts that do not belong to the Control Panel user).
- **Sources:** [Revolut FAQs](https://developer.revolut.com/docs/guides/build-banking-apps/faqs), [Revolut AIS tutorial](https://developer.revolut.com/docs/guides/build-banking-apps/tutorials/get-account-and-transaction-information), [Enable Banking FAQ](https://enablebanking.com/docs/faq/), [Enable Banking API reference](https://enablebanking.com/docs/api/reference/), [Enable Banking Terms of Service](https://enablebanking.com/terms/), [Enable Banking changelog Dec 2025](https://enablebanking.com/blog/2026/01/15/enable-banking-changelog-december-2025)

### Request limits (Q6)

- Revolut allows at most 4 requests per 24 hours per account, endpoint and consent when the PSU (the payment service user, i.e. the account holder) is not present (SCA RTS Art. 36(5)). The limit does not apply when the PSU is present, which is signalled by the PSU headers (IP address). Paging through one large response and fetching right after authorisation do not count.
- Enable Banking: send either all PSU headers the bank requires or none; none for scheduled fetches. An exhausted limit returns 429 `ASPSP_RATE_LIMIT_EXCEEDED`. The Terms of Service forbid bypassing rate limits and falsifying the origin of communications.
- **Revolut lists no `required_psu_headers`** (`GET /aspsps`, 2026-11-04), so a partial set cannot cause `PSU_HEADER_NOT_PROVIDED`.
- **M1 smoke test (2026-11-04):**
  - 6 balance reads in a row with the owner's real `Psu-Ip-Address` and `Psu-User-Agent` all returned HTTP 200, more than the 4 unattended reads. A recent-transactions read with the same headers also succeeded.
  - So reads made with the user present are not capped at 4 a day. No control run without headers was made, so the test does not show that unattended reads *are* capped; the design does not depend on that.
  - Revolut returns one balance, type `ITAV` (available balance).

  Evidence: [spike evidence](../../spikes/enable-banking/evidence/2026-11-04-smoke-test.json).
- **Enable Banking's FAQ on PSU headers:**
  - At least one PSU header marks a fetch as online, and the bank's background limits then do not apply.
  - It recommends sending as many headers as available, especially `Psu-Ip-Address` and `Psu-User-Agent`.
  - The headers must belong to the person who triggers the fetch: "if person A triggers data retrieval, you should provide the headers specific to person A".
  - It does not say whether that person must be the account holder.
- Transactions older than 90 days are available only within 5 minutes after authorisation.
- **Sources:** [Revolut Usage and limits](https://developer.revolut.com/docs/guides/build-banking-apps/usage-and-limits) (blocks automated fetching; read via search index), [Revolut AIS restrictions](https://developer.revolut.com/blog/2024-09-16-open-banking-ais-restrictions), [Enable Banking FAQ](https://enablebanking.com/docs/faq/), [Enable Banking knowledge base](https://enablebanking.com/knowledge-base), [Enable Banking Terms of Service](https://enablebanking.com/terms/)

### Transaction history

- **History is needed from 2026-08-09**, the day the daughter started using the account, and is kept for the whole operation (the user, 2026-11-04). 90 days after 2026-08-09 is 2026-11-07.
- **Revolut:** a transactions request made later than 5 minutes after the consent was authorised returns nothing older than 90 days, "counted from the moment the request for the transactions is made" ([Revolut FAQs](https://developer.revolut.com/docs/guides/build-banking-apps/faqs)).
- **Enable Banking:**
  - `entry_reference` is the ID for matching transactions across fetches. In most cases only settled (`BOOK`) transactions have one: before settlement "its properties may still change or the transaction may even be cancelled".
  - Pending (`PDNG`) transactions must be left out of matching unless their ID survives settlement. `transaction_id` is not a stable reference.
  - Enable Banking does not store or cache account data.
  - Transactions come in pages (`continuation_key`).
  
  Source: [Enable Banking FAQ](https://enablebanking.com/docs/faq/), read 2026-11-04.
- **History download (M1, 2026-11-04):**
  - 116 transactions since 2026-08-08 UTC, all settled, each with a unique `entry_reference`.
  - No pending transactions were returned at that moment, so it is still unconfirmed whether Revolut returns pending transactions through Enable Banking. *(Amended 2026-11-07, in C5: confirmed. The smoke test of 2026-11-06 returned 20 `BOOK` and 2 `PDNG` ([evidence](../../spikes/enable-banking/evidence/2026-11-06-smoke-test.json)), and Check 2 below found one pending transaction too.)*
  
  Evidence: [spike evidence](../../spikes/enable-banking/evidence/2026-11-04-history-export.json).
- **Check 2, the real account through the app's bank adapter (C5, 2026-11-07):** one run with the owner's PSU headers, plus one unattended balance read. Counts only, nothing printed ([evidence](../../spikes/enable-banking/evidence/2026-11-07-real-account-check.json); c004 design.md D7).
  - Every read succeeded, including the unattended one: the signed token, the PSU headers and the real answers work as the adapter expects.
  - 89 days of transactions came in **3 pages** (127 transactions: 126 `BOOK`, 1 `PDNG`). Every page was followed to the one without a `continuation_key`, which is the first live test of paging.
  - **Booked transactions:** all 126 have `entry_reference`, `booking_date` and `value_date`, none has `transaction_date`. So the adapter dates them by `booking_date`.
  - **The pending transaction** (a sample of one) had `entry_reference` and `booking_date`, no `transaction_date` or `value_date`, and was 0 days old. Whether a pending transaction keeps its `entry_reference` when it settles still needs two runs days apart (a heads-up for C9).
  - **Durations:** a balance read 244–760 ms; all three pages 1.4–1.5 s, about 0.5 s a page.

## Decision

Decided by the user, 2026-11-04:

1. **User-triggered reads are live and carry the user's PSU headers.** When a signed-in user opens or refreshes the account view, the backend reads live from the bank and forwards that user's real PSU headers (IP address, user agent, …). The user's position: the daughter acts on the account holder's behalf.
2. **Enable Banking support is not asked** (deviation from roadmap ch. 3, item 3). The user accepts the risk that Enable Banking cuts off the application; the design keeps that risk low through the constraints below.
3. **The background job for notifications runs 4 times a day without PSU headers:** every 6 hours, the first run at 06:00 (configurable). *(Superseded by the user, 2026-11-05, after the phone test of 2026-11-06: [ADR-0008-phone-triggered-check](0008-phone-triggered-check.md). A Revolut notification on the owner's iPhone triggers the check, and its reads carry the phone's PSU headers.)*
4. **A database is needed:** it holds the downloaded transactions and the time of the daughter's last view.
5. **A notification is sent only if something changed since the daughter's last view.**
6. **Settled transactions are stored from 2026-08-09 for the whole operation; pending ones never.**
   - Only settled transactions are written to the database, keyed by `entry_reference`.
   - Each open or refresh reads the balance and a short recent window live. Newly settled transactions are stored; pending ones are shown but not stored. The background job reads the same window without PSU headers. *(Since ADR-0008: the phone-triggered check reads it, with the phone's PSU headers.)*
   - The history since 2026-08-09 is downloaded once, right after the API session is approved in M1 (spike step 5), into a gitignored file on the owner's machine. It is imported once the database exists, and the file is then deleted.

**Constraints (binding on every bank call):**

- PSU headers only on bank requests triggered directly by a signed-in user's open or refresh, with that user's real values. *(Since ADR-0008, also on the check the owner's iPhone triggers, with the phone's real values.)*
- Never PSU headers on the background job. *(Superseded by ADR-0008: there is no scheduled job. A fallback check, if C9 keeps one, sends none.)*
- All required headers or none.
- No bank calls beyond what the view needs.
- 429 and bank errors are handled gracefully.

## Alternatives considered

- **Unattended reads only, served from stored data.** A background job fetches within the quota (every 6 hours) and the account view shows the stored data. Proposed by Claude as the safe reading of the limit. Rejected by the user: whenever the daughter opens or refreshes the view it must show the same data as the Revolut app. A delay of up to 6 hours is acceptable for notifications, not for the view.
- **Ask Enable Banking support first.** Ask whether reads triggered by the daughter may carry PSU headers, and enable live reads only after a written yes. Recommended by Claude, because sending the headers without confirmation risks being read as falsifying the origin of communications. Rejected by the user: in the user's view the daughter acts on the account holder's behalf, and the user prefers to accept the risk rather than ask.
- **Show only the bank's rolling 90 days** (no stored history). Recommended by Claude when asking whether older history is needed. Rejected by the user: the history since 2026-08-09 is needed for good, and a rolling window loses it.
- **No local file: the app downloads the history itself after a new approval, once it exists.** Cleaner, because no bank data sits on the owner's disk. Proposed by Claude as the alternative and not chosen: it costs another approval and an approval flow in the app, and after 2026-11-07 it depends entirely on the 5-minute window after that approval.

## Consequences

- **Consent:** no consent renewal feature is needed: the API session runs until 2027-05-03, beyond the operating period. The 30-day Control Panel link is renewed by hand every 30 days (roadmap M9); M1 could not show that API access is independent of it. Every expiring approval and how to restore it: [docs/operations/expiring-approvals.md](../operations/expiring-approvals.md). Expired and revoked sessions (`EXPIRED_SESSION`, `REVOKED_SESSION`) must be handled; the fallback is repeating the linking, which needs the account holder for SCA.
- **Bank adapter:** it forwards PSU headers from the incoming request only on user-triggered reads (since ADR-0008, also on the phone-triggered check), takes the list of required headers from `GET /aspsps` (none for Revolut as of 2026-11-04; Enable Banking recommends sending all available, especially `Psu-Ip-Address` and `Psu-User-Agent`), and handles 429, expired and revoked sessions. *(Amended by the user, 2026-11-06, in C5's explore, and built in C5 ([c004 design.md D2, D4](../../openspec/changes/archive/2026-11-07-c004-add-enable-banking-adapter/design.md)):*
  - *the PSU headers are an explicit parameter of every read, "present user" (with that user's address and browser) or "unattended" (none), and never copied from the incoming request, so the constraint is visible at every call site;*
  - *the header set is fixed to `Psu-Ip-Address` and `Psu-User-Agent` instead of a `GET /aspsps` lookup: Revolut requires none, and if it ever does, the read fails visibly with `PSU_HEADER_NOT_PROVIDED`;*
  - *429, expired and revoked sessions come back as results ("rate limited", "access expired"), never retried;*
  - *each bank request has a 15 s timeout, kept after Check 2 measured the slowest request at under 1 s (the owner, 2026-11-07).)*
- **Account detail (UC2):** the stored settled transactions, plus a live read of the balance and the recent window (Decision, item 6).
  - **A database is needed in v1.** This answers F0-2's "whether Cosmos DB is needed already in v1"; the storage technology stays F0-2's call, and M3 prepares access to it.
  - The recent window must cover how long Revolut keeps transactions pending. It is set in C5 from real data, which also confirms whether Revolut returns pending transactions at all (none appeared in the history download). *(Amended by the user, 2026-11-06, in C5's explore: **31 days**, sized by Revolut's longest holds (deposits and pre-authorisations, up to about 15 days in user reports), not by the M1 history, whose card payments settled within 2 days. A hold longer than 31 days drops off the list while pending; the balance stays right. The window is the caller's date, so C7 owns the setting ([c004 design.md D7](../../openspec/changes/archive/2026-11-07-c004-add-enable-banking-adapter/design.md)). Check 2's one pending transaction was 0 days old, so nothing contradicts it yet.)*
  - The history download found a unique `entry_reference` on all 116 settled transactions, so no fallback key is planned.
  - The history file is imported by the change that creates the transaction store; the file is then deleted.
- **Bank data on disk:** until that import, the history sits in `spikes/enable-banking/secrets/` on the owner's machine (gitignored, never printed or committed).
- **Notifications (UC3):** 4 runs a day from 06:00; notify only on changes since the daughter's last view. The time zone of the start time and whether the last view is tracked per user are decided with Q8. *(Since ADR-0008: the check runs when a Revolut notification reaches the owner's iPhone, so there is no start time; whether the last view is tracked per user is still decided with Q8.)*
- **Accepted risk:** Enable Banking may cut off the application because of the PSU-header approach (Decision, item 2).
- **Logging:** bank data never appears in logs (docs/conventions/README.md § Backend code).
