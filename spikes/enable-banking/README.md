# Spike: Enable Banking setup and Revolut link (M1)

**Roadmap:** M1 · **Started:** 2026-11-04 · **Verdict:** yes, 2026-11-04 (see § Verdict) · **Decision record:** [ADR-0001-bank-data-access](../../docs/adr/0001-bank-data-access.md) · **Follow-ups:** step 7, for issue [#12](https://github.com/jakubbohm/RevolutReader/issues/12) (2026-11-06); step 8, for the bank client's retries (C11, 2026-11-08)

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
| 7 | After M1, for issue [#12](https://github.com/jakubbohm/RevolutReader/issues/12) (the phone triggers the account check when a Revolut notification arrives): how soon after the notification the change shows up in Enable Banking, and whether a card payment appears as pending at once. The owner makes a small payment on the account and marks the moment the notification appears; the script reads the balance and the last 2 days' transactions every 20 s with the owner's PSU headers and records only offsets and counts | script + user (a payment) | yes | done 2026-11-06 |
| 8 | For C11 (the bank client's retries, [c008 design.md D11](../../openspec/changes/archive/2026-11-08-c008-add-bank-read-retries/design.md)): whether Enable Banking accepts a transactions page's continuation key a second time, as a retried page sends it. With the owner's PSU headers: the first page of the last 89 days, then the second page twice with the same key, the second time right after the first answered. 3 present-user requests, none unattended; records only outcomes, durations and counts | test + user (present) | yes | done 2026-11-08 |

## Scripts

PowerShell 7, run from the repository root.

| Script | Step | What it does |
|---|---|---|
| `eb-client.ps1` | — | Shared helpers, dot-sourced by the others: signs the API token (JWT, RS256, 1 hour) with the key in `secrets/` and calls the API. Never prints the key or the token |
| `get-aspsps.ps1` | 3 | `GET /aspsps` (Enable Banking's public bank list; no bank contact). Prints Revolut's values and saves the Revolut entries to `evidence/<date>-aspsps-revolut.json`. Run: `pwsh -NoProfile -File spikes/enable-banking/get-aspsps.ps1` |
| `create-session.ps1` | 5 | Requests a session lasting Revolut's maximum minus 1 hour (`POST /auth`) and opens the approval page. You approve in the Revolut app and paste the redirected `https://localhost/callback?...` address back, and the script creates the session (`POST /sessions`). The session ID and account UIDs are stored only in `secrets/session.json`; a redacted summary goes to `evidence/<date>-session.json`. Right after that it runs `export-history.ps1`, then checks the session status and that the application is still active. It needs you at the keyboard, so run it in your own PowerShell 7 window: `pwsh -NoProfile -File spikes/enable-banking/create-session.ps1 -HistoryStart 2026-08-09`. `-HistoryStart` (local date, default 2026-08-09) is passed to `export-history.ps1` |
| `export-history.ps1` | 5 | Downloads all transactions since `-HistoryStart` (local date, default 2026-08-09; requested from one day earlier, because Enable Banking reads dates as UTC), page by page, into `secrets/transactions-<date>.json`, exactly as sent. It prints and records in `evidence/<date>-history-export.json` only counts by status, settled transactions without `entry_reference`, duplicate references, and field names; the date range is printed but not recorded. Fallback if the download inside `create-session.ps1` fails: run it on its own while the start date is within the last 90 days, `pwsh -NoProfile -File spikes/enable-banking/export-history.ps1 -HistoryStart 2026-08-09` |
| `smoke-test.ps1` | 6 | Reads the balance 6 times and the last 7 days of transactions, all with the owner's real PSU headers: the public IP from `api.ipify.org`, which is sent only to Enable Banking and never printed or saved, and the script's user agent. Prints and records in `evidence/<date>-smoke-test.json` only status codes, error codes, balance types and counts. Run: `pwsh -NoProfile -File spikes/enable-banking/smoke-test.ps1` |
| `watch-change.ps1` | 7 | Takes a first reading of the balance and the last 2 days' transactions, then reads both every 20 s with the owner's real PSU headers (as in `smoke-test.ps1`). Press Enter the moment the Revolut notification appears and Q to stop early. It stops on its own 15 min after the notification, once the balance has changed and a booked transaction has appeared, or at the first error. For each change (balance, or the count of pending `PDNG` or booked `BOOK` transactions) it prints the window it happened in, e.g. "PDNG 0->1 between 3 s and 23 s" after the notification. The balance is compared in memory only, never printed, saved or hashed. `evidence/<date>-watch-change.json` holds only offsets, status codes, error codes and counts; neither the time of day nor the PSU header values are recorded. It waits for key presses, so run it in your own PowerShell 7 window: `pwsh -NoProfile -File spikes/enable-banking/watch-change.ps1` (`-IntervalSeconds`, `-MaxMinutes`, `-RecentDays`; `-SecretsDir <folder>` when the key and `session.json` are not in this copy's `secrets/`, e.g. when running it from a worktree) |

Step 8 is not a script: it is an explicit .NET test next to Check 2, `RealAccountCheck.A_continuation_key_works_a_second_time` in [RealAccountCheck.cs](../../tests/RevolutReader.IntegrationTests/Wiring/RealBank/RealAccountCheck.cs), never in the default run. It runs the app's bank client on its production wiring with Check 2's `RealAccountCheck:*` user-secrets ([local-secrets.md § 2](../../docs/operations/local-secrets.md#2-check-2s-values-into-the-user-secrets)), sends the owner's public IP (from `api.ipify.org`, never printed or saved) and a check user agent, and writes `evidence/<date>-continuation-key-reuse.json`: each request's outcome, duration and transaction count, whether it announces a next page, and whether both answers of the second page hold the same transactions in the same order (compared in memory by `entry_reference`, never saved). Since C11 the production wiring retries a present user's failed request, so a rerun sends more than 3 requests only if one fails, and none is unattended. Run it alone, with the owner present: `dotnet test --project tests/RevolutReader.IntegrationTests --treenode-filter "/*/*/RealAccountCheck/A_continuation_key_works_a_second_time" --output Detailed`.

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
- `secrets/transactions-<date>.json`: the history download from step 5. This is bank data, not a secret: it stays here until C7b's explicit check `HistoryImportCheck` imports it into the deployed table, once, after C7b's deploy ([deployment.md § The history import](../../docs/operations/deployment.md#the-history-import-c7b)); then the owner deletes it and its backup.

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
- **2026-11-06, step 7** ([evidence](evidence/2026-11-06-watch-change.json)): one small card payment by the owner, 47 readings 20 s apart with the owner's PSU headers (94 API calls in about 16 minutes), all HTTP 200.
  - **The change was already in Enable Banking when the notification appeared.** The balance and the number of pending transactions (3 → 4) changed between 22 s and 2 s *before* the owner pressed Enter at the notification. With readings 20 s apart and the owner's reaction time, the data is there no later than the notification.
  - **A card payment shows up at once as pending (`PDNG`), and the balance changes with it.** It was not settled within 15 minutes (`BOOK` unchanged), as expected for a card payment.
  - **Revolut does return pending transactions through Enable Banking:** 3 were there at the start (steps 5 and 6 saw none).
  - No rate limit was hit by 94 calls with the owner's PSU headers within 16 minutes.
  - For C9 (one sample): the check endpoint can read once, right when the Shortcut calls it; it needs no repeated reads to catch a card payment. A transfer coming in was not measured.
- **2026-11-08, step 8** ([evidence](evidence/2026-11-08-continuation-key-reuse.json)): run at 13:11 UTC with the owner present and the owner's real `Psu-Ip-Address` and `Psu-User-Agent`; all 3 requests read (0.4–1.1 s each).
  - The first page of the last 89 days held 50 transactions and announced a second page.
  - The second page, asked twice with the same key, the second time right after the first answer: 50 transactions each time, the same ones in the same order, and both announced a third page.
  - **A continuation key works a second time,** even after it has been answered once. That is the strongest case: a retry after a failure sends a key Enable Banking may not even have seen. So the bank client retries a failed page with its key ([ADR-0001 § Transaction history](../../docs/adr/0001-bank-data-access.md#transaction-history)).

## Verdict

**2026-11-04: yes.** The application is active in restricted mode. The API session runs until 2027-05-03. The history since 2026-08-09 is saved locally. Live reads with the user present work beyond the 4-a-day limit. To keep: renew the Control Panel link every 30 days (M9). Every expiring approval: [docs/operations/expiring-approvals.md](../../docs/operations/expiring-approvals.md). M1 closed by the user on 2026-11-04.

**Step 7, 2026-11-06:** a card payment is visible in Enable Banking (balance and a new pending transaction) by the time its Revolut notification appears, so a check triggered by the notification finds it on the first read (issue [#12](https://github.com/jakubbohm/RevolutReader/issues/12)).

**Step 8, 2026-11-08:** Enable Banking accepts a transactions page's continuation key a second time, so a retried page keeps its key (C11, [c008 design.md D11](../../openspec/changes/archive/2026-11-08-c008-add-bank-read-retries/design.md)).
