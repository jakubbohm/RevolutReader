# Spike: Enable Banking Mock ASPSP (sandbox)

**Roadmap:** F0-1 (testing conventions: how tests fake the bank) · **Started:** 2026-11-04 · **Verdict:** decided 2026-11-04 (see § Verdict) · **Related:** [M1 spike](../enable-banking/README.md), [docs/conventions/testing.md](../../docs/conventions/testing.md)

## Question

Enable Banking offers no Revolut sandbox, but it hosts a fake bank, the **Mock ASPSP**, filled with your own test data. What can it do, and where does it fit in testing: automated tests (CI), checking our client against the real API, local development?

## Steps

| # | Step | Who | Status |
|---|---|---|---|
| 1 | Upload the sample data file ([DK-Danske_Bank-synthetic-1.json](https://enablebanking.com/sample-data/DK-Danske_Bank-synthetic-1.json)) in the Control Panel → Mock ASPSP | user | done 2026-11-04 |
| 2 | Create a test account by hand (`RevolutReader Test`, CZK) with one balance and booked and pending transactions; delete one | Claude (browser, the user's login) | done 2026-11-04 |
| 3 | Call the Control Panel's data API without the login | Claude | done 2026-11-04 |
| 4 | Register a sandbox application (key generated in the browser, private key moved to `../enable-banking/secrets/`) | user | done 2026-11-04 |
| 5 | One approval against the Mock ASPSP, then read details, balances and transactions | Claude + user (approval code) | done 2026-11-04 |
| 6 | Change data in the Control Panel and read it again in the same session; filters; repeated reads without PSU headers; error responses | Claude | done 2026-11-04 |

## Scripts

PowerShell 7, run from the repository root. They reuse the M1 client (`../enable-banking/eb-client.ps1`) switched to the **sandbox** application, so they cannot reach the production application or the real Revolut account.

| Script | What it does |
|---|---|
| `mock-client.ps1` | Dot-sourced helper: loads the M1 client and switches it to the sandbox application ID and key |
| `create-mock-session.ps1` | `POST /auth` for Mock ASPSP / LT / personal (180 days, the mock's maximum; 10 days until c004), opens the approval page, takes the redirected `https://localhost/callback?...` address (prompt or `-CallbackUrl`), `POST /sessions`, keeps the session ID and account UIDs in `secrets/session.json`, saves the response without them to `evidence/`, then runs `read-mock.ps1`. The approval page needs your Control Panel login, so run it in your own window: `pwsh -NoProfile -File spikes/enable-banking-mock/create-mock-session.ps1` (`-New` starts a fresh approval) |
| `read-mock.ps1` | Session status, account details, balances and all transaction pages, saved unchanged to `evidence/` (made-up data). `-BalanceRepeats <n>` repeats the balance read without PSU headers: `pwsh -NoProfile -File spikes/enable-banking-mock/read-mock.ps1 -BalanceRepeats 6` |

## Identifiers (non-secret)

| Identifier | Value | Recorded |
|---|---|---|
| Sandbox application ID (JWT `kid`) | `b4780885-a339-48bd-b6b3-067e5056d2ad` (name "Sandbox", services AIS + PIS) | 2026-11-04 |
| Redirect URL | `https://localhost/callback` | 2026-11-04 |
| ASPSP name / country / PSU type | Mock ASPSP / LT / personal | 2026-11-04 |
| Test account | `RevolutReader Test` (CACC, CZK) in the Control Panel → Mock ASPSP | 2026-11-04 |
| Test account for C5 | `RevolutReader C5 Test` (CACC, EUR), uploaded from [`test-data/c004-transactions.json`](test-data/c004-transactions.json): an `ITAV` balance and 25 transactions (21 `BOOK`, 2 `PDNG`, 1 `CNCL`, 1 `RJCT`) | 2026-11-06 |

## Secrets (never committed)

- `../enable-banking/secrets/b4780885-a339-48bd-b6b3-067e5056d2ad.pem`: the sandbox application's private key.
- `secrets/session.json`: sandbox session ID and account UIDs (since 2026-11-06 the 180-day session with `RevolutReader C5 Test`, valid until 2027-05-05T19:44Z; the 10-day one it replaced is kept as `session-replaced-2026-11-06.json` until it ends on 2026-11-14). Only made-up data behind it, but kept out of the repository like any credential.
- `secrets/auth-state.json`: exists only while an approval waits for its address.

**Data rule:** Mock ASPSP data is made up. Never load a real account into it (the Control Panel offers an export of a real account through Enable Banking's demo app; not used).

## Findings

*All verified 2026-11-04. Raw responses in `evidence/` (made-up data; session ID and account UIDs removed).*

1. **Same API as production.** Base URL `https://api.enablebanking.com`, same JWT signing; only the application ID and key differ, and the bank is "Mock ASPSP" instead of "Revolut".
2. **Listed in 29 countries, including LT** (Revolut's country here; CZ is not listed), for personal and business users, approval by redirect, `maximum_consent_validity` 15552000 s = 180 days, the same as Revolut.
3. **Test data lives in the Control Panel.** Accounts, balances and transactions are entered as JSON in the shapes of the public API reference (`AccountResource`, `BalanceResource`, `Transaction`; the forms show only a random subset of fields, the "here" links list all of them), or uploaded as one JSON file. Only add and delete, no edit. Status `PDNG` (pending, no booking date) is accepted.
4. **What you enter is what the API returns,** with every unset field as `null` (e.g. `account_id`, `bank_transaction_code`) and `uid` / `identification_hash` added by Enable Banking.
5. **Changes are live:** a transaction added in the Control Panel appeared in the next read of an existing session, without a new approval.
6. **Entering data needs the Control Panel login.** The Control Panel's internal API (`/api/v2/cp/mock-aspsp/...`) returned `401 Unauthorized` for unauthenticated reads and an unauthenticated add. It is undocumented and tied to the owner's browser login. "No credentials needed" in the sandbox docs refers to the mock bank's approval page (no bank username or password).
7. **The approval needs the Control Panel login too.** Enable Banking's consent page ("Continue authentication") leads to the mock bank page on `enablebanking.com/cp/mock-aspsp/auth`, which lists the owner's mock accounts to tick, and "Authorize". It offers no way to simulate a rejection or an error. So a session cannot be created unattended; once created it lasts as long as requested (up to 180 days).
8. **No unattended-request limit.** 9 balance reads without PSU headers within a few minutes: all HTTP 200 (Revolut allows 4 a day).
9. **Filters work:** `transaction_status=PDNG` returned only the pending one; `date_from=2026-11-04` returned the pending transaction dated by `transaction_date` and left out the booked one from 2026-11-03.
10. **Real error responses** (`evidence/2026-11-04-error-responses.json`), shape `{ code, message, error, detail }`: future `date_from` → 422 `DATE_FROM_IN_FUTURE`; invalid `continuation_key` → 422 `WRONG_REQUEST_PARAMETERS` (not `WRONG_CONTINUATION_KEY`, which the reference also lists); unknown account → 404 `ACCOUNT_DOES_NOT_EXIST`; malformed `Psu-Ip-Address` → 422 `PSU_HEADER_INVALID` (Enable Banking validates PSU header formats).
11. **Not reproducible with the mock:** 429 / `ASPSP_RATE_LIMIT_EXCEEDED`, bank errors and timeouts, Revolut's own fields and behaviour. Expired or revoked sessions only by waiting for `valid_until` or by deleting the session (not tried). Paging (10 per page, newest first, per the docs) not exercised: the test account has 2 transactions.
12. **No paging at 25 transactions** (c004, 2026-11-06, `evidence/2026-11-06-account1-*.json`): `RevolutReader C5 Test` returned all 25 in one page, newest first, with `continuation_key: null`, so the documented 10 per page did not happen. The mock returns cancelled and rejected transactions as entered, and pending ones with no booking or value date, dated by `transaction_date`. The last page is marked the same way at Revolut: the M1 history came in pages of 50, 50 and 16, with a key on the first two and `null` on the last (structure only, counted 2026-11-06). `read-mock.ps1` now saves a single page as a one-page list; this capture was rewrapped to that shape.

## Verdict

Decided by the user, 2026-11-04: **automated tests use a local fake server (WireMock.Net) whose responses are copied from this mock's real responses; the Mock ASPSP itself serves response captures, on-demand checks of our real client against the real API (C5), and local development; no CI job against it** (findings 6, 7 and 11). The convention: [testing.md § Fake bank](../../docs/conventions/testing.md#fake-bank-a-local-fake-server-in-front-of-our-real-enable-banking-client).
