# Spike: Enable Banking setup and Revolut link (M1)

**Roadmap:** M1 · **Started:** 2026-11-04 · **Verdict:** yes, 2026-11-04 (see § Verdict) · **Decision record:** [ADR-0001-bank-data-access](../../docs/adr/0001-bank-data-access.md)

## Question

Can we get a working Enable Banking application in restricted (personal-use) mode, linked to the owner's Revolut account? And what are Revolut's actual values for consent validity (Q5) and the required PSU headers (Q6)?

## Steps

| # | Step | Who | Touches the bank? | Status |
|---|---|---|---|---|
| 1 | Create an Enable Banking Control Panel account, using the account holder's own email | user | no | done 2026-11-04 |
| 2 | Register a production application. The key is generated in the browser and the private key moved to `secrets/`. All form fields are mandatory, so the privacy and terms URLs are localhost placeholders (not checked in restricted mode) | user | no | done 2026-11-04 |
| 3 | Read Revolut's entry from `GET /aspsps`: `maximum_consent_validity`, `required_psu_headers`, `psu_types`, `auth_methods` | script | no | done 2026-11-04 |
| 4 | Link the Revolut account in the Control Panel ("Activate by linking accounts"), which activates restricted mode. Country: Lithuania (Czechia is not offered; Revolut's EU bank is Revolut Bank UAB, Lithuania), type: personal | user (SCA in the Revolut app) | yes | done 2026-11-04 |
| 5 | Authorise an API session (`POST /auth` → SCA → `POST /sessions`) and record the actual `valid_until`. Right after the approval, download the transaction history since 2026-08-09 into `secrets/` ([ADR-0001 § Decision](../../docs/adr/0001-bank-data-access.md#decision), item 6). **Before about 2026-11-07** | script + user (SCA) | yes | done 2026-11-04 |
| 6 | Smoke test with the owner's own PSU headers: 6 balance reads (more than the 4 unattended) and one recent-transactions read; record only status codes, balance types and counts | script | yes | done 2026-11-04 |

## Scripts

PowerShell 7, run from the repository root.

| Script | Step | What it does |
|---|---|---|
| `eb-client.ps1` | — | Shared helpers, dot-sourced by the others: signs the API token (JWT, RS256, 1 hour) with the key in `secrets/` and calls the API. Never prints the key or the token |
| `get-aspsps.ps1` | 3 | `GET /aspsps` (Enable Banking's public bank list; no bank contact). Prints Revolut's values and saves the Revolut entries to `evidence/<date>-aspsps-revolut.json`. Run: `pwsh -NoProfile -File spikes/enable-banking/get-aspsps.ps1` |
| `create-session.ps1` | 5 | Requests a session lasting Revolut's maximum minus 1 hour (`POST /auth`) and opens the approval page. You approve in the Revolut app and paste the redirected `https://localhost/callback?...` address back, and the script creates the session (`POST /sessions`). The session ID and account UIDs are stored only in `secrets/session.json`; a redacted summary goes to `evidence/<date>-session.json`. Right after that it runs `export-history.ps1`, then checks the session status and that the application is still active. It needs you at the keyboard, so run it in your own PowerShell 7 window: `pwsh -NoProfile -File spikes/enable-banking/create-session.ps1 -HistoryStart 2026-08-09`. `-HistoryStart` (local date, default 2026-08-09) is passed to `export-history.ps1` |
| `export-history.ps1` | 5 | Downloads all transactions since `-HistoryStart` (local date, default 2026-08-09; requested from one day earlier, because Enable Banking reads dates as UTC), page by page, into `secrets/transactions-<date>.json`, exactly as sent. It prints and records in `evidence/<date>-history-export.json` only counts by status, settled transactions without `entry_reference`, duplicate references, and field names; the date range is printed but not recorded. Fallback if the download inside `create-session.ps1` fails: run it on its own while the start date is within the last 90 days, `pwsh -NoProfile -File spikes/enable-banking/export-history.ps1 -HistoryStart 2026-08-09` |
| `smoke-test.ps1` | 6 | Reads the balance 6 times and the last 7 days of transactions, all with the owner's real PSU headers: the public IP from `api.ipify.org`, which is sent only to Enable Banking and never printed or saved, and the script's user agent. Prints and records in `evidence/<date>-smoke-test.json` only status codes, error codes, balance types and counts. Run: `pwsh -NoProfile -File spikes/enable-banking/smoke-test.ps1` |

## Identifiers (non-secret)

C5 moves these into `appsettings.json`.

| Identifier | Value | Recorded |
|---|---|---|
| Application ID (JWT `kid`) | `469fb438-ada6-4831-9498-70a1890097d6` | 2026-11-04 |
| Environment | Production (restricted mode) | 2026-11-04 |
| Redirect URL(s) | `https://localhost/callback` (placeholder privacy and terms URLs: `https://localhost/privacy`, `https://localhost/terms`) | 2026-11-04 |
| ASPSP name / country / PSU type | Revolut / LT / personal | 2026-11-04 |
| Control Panel link expiry | 2026-12-04 (renew by 2026-12-03: roadmap M9) | 2026-11-04 |
| API session valid until | 2027-05-03T18:03:33Z (granted as requested); the session ID itself is in `secrets/session.json` | 2026-11-04 |

## Secrets (never committed)

Kept in `secrets/` (gitignored, along with `*.pem` and `*.key`) on the owner's machine until C4 puts them into Key Vault ([configuration.md § Hand-provisioned secrets](../../docs/conventions/configuration.md#hand-provisioned-secrets)).

- `secrets/<application-id>.pem`: the application's private key.
- `secrets/session.json`: session ID and account UIDs from step 5. Together with the key, they give access to bank data.
- `secrets/transactions-<date>.json`: the history download from step 5. This is bank data, not a secret: it stays here until it is imported into the database (the change that creates the transaction store), and is then deleted.

## Findings

*Filled in as the steps run. Evidence (redacted: no keys, tokens, account identifiers, balances or transactions) goes in `evidence/`.*

- **2026-11-04, step 4:** after the account link, the application became active (restricted mode). Revolut's approval screen showed the consent expiring on **2026-12-04 (30 days)**; the Control Panel offers no way to choose a longer period. Open: whether the API session (step 5) keeps working after this link expires.
- **2026-11-04, step 3** ([evidence](evidence/2026-11-04-aspsps-revolut.json)): `GET /aspsps` returned HTTP 200 with 2,762 banks, 29 of them Revolut entries (EEA countries; **no Czechia**, which confirms Lithuania as the right choice). For Revolut LT:
  - `maximum_consent_validity`: 15,552,000 s = **180 days** (the same for all 29 entries).
  - `required_psu_headers`: **not listed**, so a partial set of PSU headers cannot cause `PSU_HEADER_NOT_PROVIDED`.
  - `psu_types`: business, personal.
  - `auth_methods`: one redirect method per PSU type, with no extra credentials.
  - `beta`: false; BIC `REVOLT21`.
- **2026-11-04, step 5** ([session evidence](evidence/2026-11-04-session.json), [history evidence](evidence/2026-11-04-history-export.json)): `POST /auth` and `POST /sessions` returned HTTP 200.
  - **Session:** valid until **2027-05-03T18:03Z**, exactly as requested (180 days minus 1 hour). Status `AUTHORIZED`; the application is still active (`PRODUCTION`).
  - **Account:** one, EUR, type `CACC`, with a UID.
  - **History download:** 116 transactions in 3 pages since 2026-08-08 UTC. All are settled (`BOOK`), each with a unique `entry_reference`; settled dates run from 2026-08-10 to 2026-11-04. No pending transactions were returned at that moment.
  - The transaction fields include `balance_after_transaction`, `transaction_date`, `value_date`, `creditor`, `debtor`, `remittance_information` and `merchant_category_code`.
- **2026-11-04, after step 5:** the Control Panel link is **still active** next to the new API session, so Revolut keeps both consents. Whether API access depends on the link remains unknown, so the link is renewed (roadmap M9).
- **2026-11-04, step 6** ([evidence](evidence/2026-11-04-smoke-test.json)): with the owner's real `Psu-Ip-Address` and `Psu-User-Agent`:
  - **6 balance reads in a row all returned HTTP 200**, more than the 4 unattended reads a day. Reads with the user present are not capped at 4 (no control run without headers was made).
  - One balance came back, type `ITAV` (available balance). C5 checks once that it matches the Revolut app.
  - Recent transactions since 2026-10-28: HTTP 200, 23 in one page, all settled; again no pending transactions.

## Verdict

**2026-11-04: yes.** The application is active in restricted mode. The API session runs until 2027-05-03. The history since 2026-08-09 is saved locally. Live reads with the user present work beyond the 4-a-day limit. To keep: renew the Control Panel link every 30 days (M9). Every expiring approval: [docs/operations/expiring-approvals.md](../../docs/operations/expiring-approvals.md). M1 closed by the user on 2026-11-04.
