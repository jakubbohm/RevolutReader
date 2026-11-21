# Proposal: c014-add-account-change-notifications

## TL;DR

- **What:** UC3's second slice, the server side (C9a). A key-protected, hidden endpoint the owner's iPhone Shortcut calls on every Revolut notification. It reads the balance once, with the phone's address and browser name, and keeps two stored balances: the last one seen and the last one notified. When they differ, every allowed account's devices get one notification, "Odešlo 3,80 €" or "Přišlo 100,00 €" over "Zůstatek 45,20 € (≈ 1 098 Kč)", which carries the balance for the phone to keep. One check runs at a time, at most one waits, and only the last check of a burst notifies. A caller that leaves never stops its check.
- **Out of scope:** the service worker writing the push's balance on the phone (C9b, #86); a backup check when the phone is off; the merchant or a count of payments in the notification; transactions.
- **Riskiest assumption:** that the Shortcut's request reaches the check as tested: a POST with the key, the phone's real browser name, and no `Sec-Fetch-Site` or `Origin` that the cross-site rule would refuse. Only the iPhone row after the deploy proves it.
- **Scenarios added** (`account-check`): A check without the right key gets the answer of an unknown address · The bank sees the phone's address and browser name · A check that names no browser reads nothing at the bank · The first check sends nothing · Money out is notified with the new balance · Money in is notified with the new balance · An unchanged balance sends nothing · Every allowed account with a registered device gets the notification · The notification carries the new balance for the phone to keep · A failed bank read sends nothing and answers as the balance does · A burst of checks sends one notification and reads the bank at most twice · A check whose bank read fails still sends what an earlier check found · A check goes on when its caller stops waiting · A change is not notified again after a device's push failed · A real payment brings the notification on the iPhone (manual)
- **Modified** (`push-sending`, requirement "Every push is a Declarative Web Push message"): added · The owner's message carries no balance; kept · Every push lives 24 hours and is urgent

## Why

Roadmap step **C9a** ([#52](https://github.com/jakubbohm/RevolutReader/issues/52)), use case **UC3** (kickoff ch. 5): the owner's daughter gets a notification when the account changes. C8a, C8b and C8c have merged, so the server can push to her iPhone, but nothing tells her about the account yet. C9 was split in two on 2026-11-21 (N1): this change, the check, and C9b ([#86](https://github.com/jakubbohm/RevolutReader/issues/86)), which writes the push's balance on the phone, side by side. Every behaviour was decided with the owner in C9's explore (2026-11-20/21) and handed over in [#52's comment](https://github.com/jakubbohm/RevolutReader/issues/52#issuecomment-7052729352) (shared N1–N4, C9a's K1–K10). This change is proposed directly from them, and its design.md becomes their home. **Decides Q8** (the notification's content, N4). Applies **Q5** and **Q6** (the phone's reads carry its own user headers, ADR-0008) and **Q9** (the pushes reach the iPhone's Home Screen app).

## What Changes

- **The check endpoint** (design.md D6–D8, D11): `POST /api/account/check`, for anyone holding the check key, a key of its own (not the message key) in `X-Check-Key`. A missing or wrong key answers exactly as an unknown `/api` address does, checked before anything else, and the endpoint stays out of the API description. The bank read is a present user's, with the request's address and browser name: a request missing either answers C13's 400 and reads nothing. The answer says whether the balance has changed since the last notification. A bank failure answers as `GET /api/balance` does.
- **What the check reads and keeps** (D3, D4): the balance only, one request per check, never transactions. Two stored balances of its own, in a new table: *last seen*, written by every successful read, and *last notified*. The first check writes both and sends nothing.
- **When it notifies, and to whom** (D2, D5, D12): when *last seen* and *last notified* differ by at least a cent. The message goes to every account on the allowlist that has a registered device, the owner included, through C8a's sender. *Last notified* is written once the sender has run, whatever it reached.
- **What the notification says (Q8)** (D2): the title is the change since the last notification without a sign, "Odešlo 3,80 €" or "Přišlo 100,00 €". The text is the new balance with its koruna line, "Zůstatek 45,20 € (≈ 1 098 Kč)", with no-break spaces as the Screens design's board `Notifications / Lock screen / Default` draws them. A tap opens the app.
- **The push carries the balance** (D14, N2): every notification the check sends carries `"mutable": true` and, in its `data`, `balance` as `GET /api/balance` answers it, for C9b's service worker. The owner's messages carry neither. **Modifies** `push-sending`.
- **Bursts** (D10, N4's accepted costs): one check at a time, and at most one waits; later callers join it, so a burst costs at most two bank reads. Only the last check of a burst notifies, from the stored balances, so a last check whose read fails still sends what an earlier one found.
- **The caller never stops the check** (D8): the Shortcut waits for the answer, but the check runs on the app's own lifetime, not the request's. A phone that gives up, or a joined caller that leaves, does not stop it.
- **No backup check** (D9): when the phone is off, the next trigger notifies the whole difference since the last notification.
- **The key and the Shortcut** (D17): the owner makes the key with a PowerShell block (separate values for the laptop and production) into Key Vault, the user-secrets and the backup vault, and sets up the Shortcut on the iPhone. Bicep adds the table, the Key Vault reference and the setting.
- **Records** (D18): ADR-0008 answers its "C9 decides" points; dated notes in ADR-0005, ADR-0007 and ADR-0010; Q8 decided in `pm/progress.md`; the roadmap's C9 split into C9a and C9b (N1); configuration.md, expiring-approvals.md, local-secrets.md, deployment.md, a new `docs/operations/iphone-shortcut.md`; software-factory lessons. Carried along for C14's session: Prague times as plain text in deployment.md § Requests per account.

## Capabilities

### New Capabilities

- `account-check`: the check the owner's iPhone triggers: its key, the bank read with the phone's headers, the two stored balances and what counts as a change, the notification's text, its recipients and the balance it carries, and how a burst of checks is run.

### Modified Capabilities

- `push-sending`: the requirement "Every push is a Declarative Web Push message" states the two members a notification about the account adds (`mutable`, and the balance in `data`) and that the owner's messages carry neither.

## Non-goals

- **The phone keeping the push's balance:** C9b (#86) writes `data.balance` into the stored balance in the service worker. Nothing here changes the frontend.
- **A backup check** when the phone is off or its automation breaks (K8): no clock, no unattended reads, no watchdog.
- **The merchant, or a count of payments,** in the notification (N4: options A and B were dropped). A burst comes as one net amount, and changes that cancel out within one burst send nothing.
- **Transactions:** the check writes nothing into C7b's transaction store and reads none (K1).
- **A rate limit on the check endpoint:** its key has 256 bits and is compared in constant time, like the message key.
- **Choosing the recipients by name** (everyone but the owner, or the daughter only): each would need a setting naming an email address (K4).

## Impact

- **Backend:** a new `Check/` folder (the endpoint, its settings, the queue that runs one check at a time, the check itself, the notification's text, the stored balances' port, the log lines); the stored balances' Table adapter in `Storage/`; `Push/PushMessage` and `PushMessages` gain the optional balance; `Program.cs` registrations; `appsettings.json` gains the `AccountCheck` and `CheckedBalances` sections.
- **API contract:** none visible. The check endpoint stays out of `openapi.json` and `schema.d.ts`, so no regeneration.
- **AppHost:** one secret parameter, `accountcheck-key`.
- **Infrastructure:** `infra/platform.bicep` (the `checkedbalances` table, under C7b's account-wide table role), `infra/features.bicep` (one Key Vault reference, one setting). No new role. The key must be in Key Vault before the merge.
- **CI:** the image smoke run and the OpenAPI export check need a made-up check key.
- **Tests:** an acceptance driver for the phone's check, a check key per test, a fake bank whose answer a test can hold, the fake push service reading the two new members; the stored balances' contract tests on Azurite.
- **The iPhone:** the Shortcut and its key, set up by hand after the deploy.
