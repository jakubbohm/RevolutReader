# The iPhone Shortcut that triggers the account check

> The owner's iPhone starts the app's account check on every Revolut notification ([ADR-0008-phone-triggered-check](../adr/0008-phone-triggered-check.md)). This page says how the Shortcut is set up, how to check it, and how to restore it on a new phone or with a new key (c014 design.md D17). Its key's expiry and replacement are also in [expiring-approvals.md § 7](expiring-approvals.md#7-the-check-key-and-the-iphone-shortcut).
>
> Written 2026-11-21 (C9a), before the first setup: the menu names below follow iOS 27 as the phone test of 2026-11-06 used it ([#12](https://github.com/jakubbohm/RevolutReader/issues/12)). Correct them here if the phone shows them otherwise.

## What it does

- **The trigger:** a personal automation in the Shortcuts app, "when a notification arrives" from the **Revolut** app, set to **run immediately**, with **no filter** on the notification's text: every Revolut notification triggers the check, offers included, and a check after one that is not about the account finds no change and sends nothing (ADR-0008, item 2).
- **Its one action:** "Get Contents of URL":
  - **URL:** the app's address followed by `/api/account/check`, i.e. `https://tarjeta-papa.livelyground-53b2e5ad.germanywestcentral.azurecontainerapps.io/api/account/check` ([deployment.md § Identifiers](deployment.md#identifiers-non-secret); a new environment gets a new address);
  - **Method:** `POST`;
  - **Headers:** one, `X-Check-Key`, holding the production check key;
  - **Request body:** none.
- **What happens then:** the app reads the balance once, as the phone (its address and its browser name, which the Shortcut sends by itself), compares it with the last notification, and notifies every allowed account's devices when it changed. The Shortcut waits for the answer, through the app's wake-up of about 20 seconds; if it gives up, the check still runs to its end (c014 design.md D8). It does nothing with the answer.

## Setting it up

The owner does this on the iPhone, after C9a's deploy (c014 design.md § Migration plan, step 4).

1. **Get the key onto the phone,** never through a chat, an email, a note or the repository: in Safari on the iPhone, sign in to the Azure portal with the owner's own login, open the key vault `kv-revolutreader` → Secrets → `AccountCheck--Key` → the current version → "Show Secret Value", and copy it. Typing it by hand from the laptop's screen works too.
2. **Make the automation:** Shortcuts → Automation → new personal automation → "App"/"Notification" trigger from **Revolut** (no text filter) → **Run Immediately**.
3. **Add the action** "Get Contents of URL" with the URL, method, header and empty body above; paste the key as the header's value.
4. **Check it by hand:** run the automation's action once from the Shortcuts app. It answers `{"changed":false}`: the first check keeps the balance and sends nothing (c014 design.md D4). A `404` answer means the key is wrong; an answer of 503 or 429 means the bank did not answer, so try again later.
5. Clear the clipboard if the key went through it (copy something else).

## Checking it later

- **By hand:** run the action from the Shortcuts app; `{"changed":false}` or `{"changed":true}` means it works.
- **From the laptop, read-only:** the checks per day and what they came to, in [deployment.md § The checks and what they came to](deployment.md#the-checks-and-what-they-came-to). Days with Revolut notifications but no checks mean the automation no longer runs (an iOS update can switch it off); only 404s mean the key no longer matches.

## On a new phone

Whether the automation comes back with a restored backup has not been checked, so look for it after a restore, and set it up again where it is missing: steps 1–4 above, with the same key. Then switch off or delete the automation on the old phone, if it is still in use.

## Replacing the key

When the key leaked, or the laptop's copy of the setup is lost:

1. On the laptop, run the guided task's production variant again ([deployment.md § Guided task: the check key](deployment.md#guided-task-the-check-key)). Azure picks up the new version within 30 minutes and restarts the app; until the Shortcut has the new key, its checks get the unknown address's answer and read nothing.
2. On the iPhone, replace the header's value in the action with the new key (step 1 above), then check it by hand (step 4).

## Switching it off

Turn the automation off in the Shortcuts app. Nothing in the app needs it: when it is off, the daughter still sees live data whenever she opens the app (ADR-0001, item 1), and the next check after it is on again notifies the whole difference since the last notification (c014 design.md D9).
