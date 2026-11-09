# Proposal: c011-add-push-sending

## TL;DR

- **What:** UC3's first slice, the server side of push. The app's three endpoints give a signed-in user's device the public push key and let it register and forget its push subscription, stored in a new table (known push services only). A sender sends Declarative Web Push messages to every device of an account on the allowlist, deletes devices the push service reports gone, and never retries. The owner's message endpoint, protected by a message key and answering like an unknown address without it, sends a message to a named account. The keys come from a guided task the owner runs before the merge. The frontend gets the push module and test stand-ins that C8b and C8c build on, with no screen of their own.
- **Out of scope:** the card, the menu item and the service worker showing a push (C8b); keeping a device's subscription right at every opening, at sign-out and on 401/403 (C8c); notifications about account changes (C9); retries; badges.
- **Riskiest assumption:** that Apple accepts what Lib.Net.Http.WebPush sends (aes128gcm, the `vapid` header) and shows the Declarative Web Push message. Tests can only check it against RFC 8291 and RFC 8292 with their own decryption; the first real proof is C8b's iPhone check.
- **Scenarios added** (`push-devices`): The app gets the public push key · Registering the same device again moves it to the account signed in now · A push address outside the known push services is refused · A subscription with missing or wrong-sized keys is refused · A forgotten device gets no more messages · Forgetting a device that was never registered is fine
- **Scenarios added** (`push-sending`): A registered device receives a message sent to its account · A message reaches every device of the account and none of another account's · Every push lives 24 hours and is urgent · An allowed account with no devices gets zero counts · A message without the right key gets the answer of an unknown address · A message to an account not on the allowlist is refused · A message to an account no longer on the allowlist deletes its devices · A message without a title is refused · A message whose page is not a page of the app is refused · A message too long for a push is refused · A device the push service reports gone is deleted · A device whose push service fails is counted as failed and kept

## Why

Roadmap step **C8a** ([#51](https://github.com/jakubbohm/RevolutReader/issues/51)), use case **UC3** (kickoff ch. 5): the owner's daughter gets a push notification when the account changes. Before any notification can be turned on (C8b) or kept right (C8c), and before C9 can say what changed, the server must be able to send a push to a user's devices. C7a and C7b have merged, so C7b's Table Storage setup is on `main`. Every behaviour was decided with the owner in C8's explore (2026-11-08/09) and handed over in #51's comments (shared S1–S12, C8a's A1–A8); this change is proposed directly from them, and its design.md becomes their home. Applies **Q9** (on iOS, Web Push works only for the Home Screen app; the sending side is the same for every browser).

## What Changes

- **The keys** (design.md D5): a VAPID key pair (P-256) and a message key, made by one PowerShell 7 block the owner runs before the merge and written straight into Key Vault and the AppHost's user-secrets, never printed. Separate values for the laptop and for production. The app refuses to start without them or when the two VAPID halves are not a pair. The token's contact is the app's own `https://` address, so no email goes into the public repository.
- **The app's endpoints** (D9), for signed-in, allowed users:
  - `GET /api/push/key`: the public key the app subscribes with, the first runtime value from the API (configuration.md § Frontend);
  - `PUT /api/push/subscription`: stores this device under the signed-in account; the same device registered again moves to the account signed in now; only `https://` addresses at the known push services (Apple, Google, Mozilla, Microsoft) and well-formed keys;
  - `DELETE /api/push/subscription`: forgets this device; fine when it was never stored.
- **The store** (D11, D13): one table, `pushdevices`, in the app's storage account, one row per device keyed by a hash of its push address, read whole when sending. Its port gets an in-memory fake and contract tests, as C7b's store did. Bicep adds the table; C7b's account-wide table role already covers it.
- **The sender** (D1–D4, D14): every push is a Declarative Web Push message (title, text, the app page a tap opens), lives 24 hours at the push service and is urgent. Only accounts on the allowlist get pushes, checked on every send; a message to any other account is refused and its devices deleted. A device the push service reports gone (404, 410) is deleted; any other failure is counted and the device kept. No retries. Logs hold counts and outcomes only. Lib.Net.Http.WebPush 3.3.1 encrypts and signs.
- **The owner's message endpoint** (D10, D14): `POST /api/push/messages` with the message key in a header: a message to every device of a named account, answering how many devices got it, failed and were removed. Without the right key it answers exactly as an unknown `/api` address does. It is kept out of the API description and stays open after development, for tests and the owner's own messages.
- **The shared frontend pieces** (D8): a push module (get the key, subscribe with it, send and forget the subscription, unsubscribe, read the current subscription and the key it was made with) with unit tests, and the test kit's stand-ins for `Notification`, `PushManager` and the service worker registration. No screen and no scenario of their own.
- **Tests** (D7): a fake push service per test (WireMock) that checks the token, the lifetime and the urgency; test devices with their own keys, whose messages the tests decrypt with their own code, never the library's.
- **Records:** ADR-0010-web-push (D16); configuration.md (the `Push` and `PushDevices` sections, three hand-provisioned secrets); expiring-approvals.md and local-secrets.md (the keys, no expiry); deployment.md (the guided task, the table, a test message); testing.md § Decided later; azure-prerequisites.md notes the unused Key Vault Secrets Officer grant (D17); software-factory lessons and inventory lines (D18).

## Capabilities

### New Capabilities

- `push-devices`: a device's push registration with the app: the public key it subscribes with, storing and forgetting its subscription under the signed-in account, and which subscriptions are accepted. C8b and C8c use it from the browser.
- `push-sending`: sending a push to an account's devices: who gets one, what a push carries, what happens to devices the push service reports gone or failing, and the owner's message endpoint that sends one. C9's notifications go through the same sender.

### Modified Capabilities

None. The new endpoints follow the rules `sign-in` (allowed users only, writes from other sites refused) and `api-errors` (problem descriptions) already state, without changing them.

## Non-goals

- **The opt-in screens and the service worker showing a push:** C8b (#60). Nothing here asks for the notification permission or shows anything.
- **Keeping a subscription right:** re-sending it at every opening, replacing one made with an old key, removing it at sign-out and on 401/403 (C8c, #61). C8a serves the key and the endpoints C8c calls.
- **Notifications about the account:** C9 (#52), with its own message content (Q8) and its own lifetime and urgency.
- **Retries, badges, a confirmation push when notifications are turned on, a test button:** not chosen in explore (S3, S4, A2).
- **An on/off switch for the message endpoint:** it stays open (A2).
- **Changing the deploy identity's role condition:** a manual step outside this change (D17).
- **Proving that Apple accepts the push:** C8b's manual check on the iPhone (S9).

## Impact

- **Backend:** a new `Push/` folder (settings, the device store port, the sender and its delivery port, the endpoints, the log lines) and the store's Table adapter in `Storage/`; `Program.cs` registrations; `appsettings.json` gains the `Push` and `PushDevices` sections.
- **Package:** `Lib.Net.Http.WebPush` 3.3.1 (MIT, 2025-03-09; Portable.BouncyCastle with it), checked in explore on 2026-11-08 (S2).
- **API contract:** three endpoints in `openapi.json` and the regenerated `schema.d.ts`; the message endpoint stays out of both.
- **AppHost:** three secret parameters, `push-vapid-public-key`, `push-vapid-private-key`, `push-message-key`.
- **Infrastructure:** `infra/platform.bicep` (the `pushdevices` table, the environment's domain as an output), `infra/features.bicep` (three Key Vault references, `Push__Subject` from the app's address), `infra/main.bicep` (passing it on). No new resource type, role or manual role change. The three secrets must be in Key Vault before the merge.
- **CI:** the image smoke run and the OpenAPI export check need made-up push keys.
- **Frontend:** `src/app/push.ts` and `src/test/` stand-ins; no screen changes.
- **Tests:** acceptance drivers for the fake push service and test devices; a second allowed test user (Petr); the store's contract tests on Azurite.
