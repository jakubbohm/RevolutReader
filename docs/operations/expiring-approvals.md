# Expiring approvals and how to restore them

> What keeps the app's bank access (and later sign-in, deployment and push) alive: when each approval or secret expires, how you notice, and how to restore it. Every roadmap step that creates, renews or changes one updates this file ([roadmap § 1](../../pm/roadmap.md#1-how-to-use-this-roadmap)). Rebuilding everything after decommissioning is the separate reinstatement guide (roadmap step D1).
>
> Commands are PowerShell 7, run from the repository root. Last updated: 2026-11-05 (M3).

## Overview

| # | Approval or secret | Expires | Renew | Needs |
|---|---|---|---|---|
| 1 | [Enable Banking account link](#1-enable-banking-account-link) (Revolut consent given in the Control Panel) | **2026-12-04** (30 days; no longer option) | by 2026-12-03, then every 30 days (roadmap M9) | the account holder, Revolut app, ~5 min |
| 2 | [Enable Banking API session](#2-enable-banking-api-session) (Revolut consent the backend reads with) | **2027-05-03T18:03Z** (Revolut's maximum: 180 days); can end early | when it ends or the app reports an expired session | the account holder, Revolut app, ~5 min |
| 3 | [Enable Banking application key](#3-enable-banking-application-and-key) | no expiry found (checked 2026-11-04) | only if lost or leaked | the Control Panel account |
| — | API token (JWT) | 1 hour | nothing to do: signed for every request | — |

Not expiring, but required: the Enable Banking Control Panel account (registered with the account holder's own email) and the Revolut account itself; the deploy identity and its GitHub trust (M3: no secret, no expiry; rebuild in [azure-prerequisites.md](azure-prerequisites.md)).

**To be added by their steps** (do not guess them here): the Entra ID app registration and its 12-month client secret (M4), the secrets and the account allowlist in Key Vault (C4, C6), the VAPID keys for push (C8).

## 1. Enable Banking account link

- **What it is:** linking the account in the Enable Banking Control Panel ("Activate by linking accounts") activated the application in restricted mode and allowlisted the account. A restricted application returns data only for linked accounts. Revolut's consent for the link lasts 30 days.
- **Current state:** linked 2026-11-04, expires 2026-12-04. The link stayed active after the API session (#2) was created, so Revolut keeps both consents side by side.
- **How you notice:** the date shown on Revolut's approval screen, recorded in [spikes/enable-banking/README.md § Identifiers](../../spikes/enable-banking/README.md#identifiers-non-secret). What the API does once the link lapses is unknown ([ADR-0001-bank-data-access § Context](../adr/0001-bank-data-access.md#consent-validity-and-pricing-q5)), so renew before it does. Likely symptoms if it lapses: an empty account list, or errors on account reads.
- **Restore:**
  1. Sign in to the Enable Banking Control Panel and open the application *RevolutReader*.
  2. Link the account again: country **Lithuania**, bank **Revolut**, type **personal** (Czechia is not offered; Revolut's EU bank is in Lithuania).
  3. Approve in the Revolut app.
  4. Record the new expiry date in the spike README § Identifiers and in the overview above, and set a reminder for the day before it.
  5. Check that the API session (#2) still works, for example with `pwsh -NoProfile -File spikes/enable-banking/smoke-test.ps1` (status codes only). If it doesn't, restore #2.

## 2. Enable Banking API session

- **What it is:** the session the backend reads the balance and transactions with: a session ID and an account UID, kept in `spikes/enable-banking/secrets/session.json` and in Key Vault once C4 exists. Its end date is chosen at creation, up to Revolut's `maximum_consent_validity` of 180 days.
- **Current state:** created 2026-11-04, valid until 2027-05-03T18:03Z.
- **It can end early** (Enable Banking FAQ):
  - the approval is revoked in the Revolut app;
  - Revolut requires an action from the account holder, most often a yearly check of their details;
  - Revolut or Enable Banking changes certificates.

  The API then returns `EXPIRED_SESSION` or `REVOKED_SESSION`, which the bank adapter (C5) handles.
- **Restore:**
  1. Keep the old session file out of the way (the script refuses to overwrite it):
     ```powershell
     Move-Item spikes/enable-banking/secrets/session.json "spikes/enable-banking/secrets/session-replaced-$(Get-Date -Format 'yyyy-MM-dd').json"
     ```
  2. In your own PowerShell 7 window (the script waits for you to paste the address), run:
     ```powershell
     pwsh -NoProfile -File spikes/enable-banking/create-session.ps1 -HistoryStart 2026-08-09
     ```
     `-HistoryStart` is the first day of history to download (local date). Approve in the Revolut app. When the browser lands on the error page at `https://localhost/callback`, paste the full address into the script **straight away**.
  3. The script also downloads the transactions since `-HistoryStart` into `secrets/transactions-<date>.json`. Revolut returns transactions older than 90 days only within 5 minutes after the approval. If the database still holds the history, delete the file; if the database was lost, import it.
  4. Once Key Vault exists (C4): replace the session ID and account UID there, using the guided task ([configuration.md § Hand-provisioned secrets](../conventions/configuration.md#hand-provisioned-secrets)).
  5. Record the new end date in the spike README § Identifiers and in the overview above.
- **Note:** account UIDs change with every session. Enable Banking's `identification_hash` identifies the same account across sessions, and stored transactions are keyed by `entry_reference` ([ADR-0001-bank-data-access § Decision](../adr/0001-bank-data-access.md#decision), item 6).

## 3. Enable Banking application and key

- **What it is:** the production application *RevolutReader* (ID in the spike README § Identifiers). Its RSA key pair was generated in the browser at registration; Enable Banking holds only the public key. The private key is `spikes/enable-banking/secrets/<application-id>.pem`, and moves to Key Vault in C4.
- **Expiry:** none found in Enable Banking's documentation or Control Panel (2026-11-04).
- **Restore, if the key is lost or leaked:**
  1. If the key leaked: delete the application in the Control Panel.
  2. Register a new production application as in [spike step 2](../../spikes/enable-banking/README.md#steps). Every form field is mandatory: redirect URL `https://localhost/callback`, placeholder privacy and terms URLs, a data protection email. Let the browser generate the key, and move the downloaded `.pem` into `spikes/enable-banking/secrets/`.
  3. Put the new application ID into `spikes/enable-banking/eb-client.ps1` and the spike README (and `appsettings.json` once C5 exists), and the key into Key Vault (C4).
  4. Link the account (#1) and create a session (#2) for the new application.
