# ADR-0010: Web Push — Declarative Web Push from .NET with Lib.Net.Http.WebPush, allowlisted accounts only, and a hidden message endpoint

**Status:** Accepted (the owner's decisions in C8's explore, 2026-11-08 and 2026-11-09, and during C8a's apply, 2026-11-09) · **Date:** 2026-11-10 · **Roadmap:** C8 (applied in C8a; binds C8b, C8c and C9) · **Questions:** none

> The design trail: [c011 design.md D1, D2, D3, D5 and D10](../../openspec/changes/c011-add-push-sending/design.md), which copies the explore's decisions S1–S12 and A1–A8 from [issue #51](https://github.com/jakubbohm/RevolutReader/issues/51) and is their home. Sources were read on the dates given with each one.

## Context

- **The app tells the owner's daughter when her balance changes** (UC3, [pm/kickoff.md](../../pm/kickoff.md)). She uses the app on an iPhone 13 Pro running iOS 26, from the Home Screen. iOS delivers Web Push to Home Screen web apps, and since iOS 18.4 Safari also shows **Declarative Web Push** messages by itself, without running the service worker ([WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), re-read 2026-11-09).
- **Safari may revoke a site's push permission** when a push shows nothing. A declarative message always shows a notification, so that risk does not arise.
- **Sending Web Push takes two standards.** RFC 8291 covers encrypting the message for the device (`aes128gcm`), and RFC 8292 covers signing a token with the app's VAPID key so the push service knows the sender. The backend is .NET (C1).
- **The push address is a capability.** Whoever holds a device's push address, its two keys and the app's VAPID private key can push to it. The server sends a request to whatever address a device registers, so an unchecked address would let a signed-in user make the server call any address.
- **The owner wants a way to send a test message without the UI** (C8's explore, A2), and the repository is public, so neither an email address nor the way in can be written down there.

## Decision

Decided by the owner in C8's explore (S2–S4, S6, S7, S12, A2; 2026-11-08 and 2026-11-09), item 2's service-worker detail corrected on 2026-11-09 after a review finding (R4).

1. **The library: [Lib.Net.Http.WebPush](https://www.nuget.org/packages/Lib.Net.Http.WebPush) 3.3.1** (MIT; read 2026-11-08). It encrypts with `aes128gcm` and signs with the RFC 8292 `vapid` scheme.
   - It runs on the app's own `HttpClient`, with no retry handler, and its own retries of a 429 are switched off (`AutoRetryAfter = false`).
   - On .NET 6 and later it uses .NET's own cryptography, with no BouncyCastle.
   - **The tests decrypt with their own code**, an RFC 8291 decryption on .NET's cryptography checked against the RFC's Appendix A, so the library never checks itself.
2. **Every push is a Declarative Web Push message:** `{"web_push":8030,"notification":{"title","body","navigate"}}`.
   - `title` is required. `body` is the optional text, left out when there is none.
   - `navigate` is always a page of the app itself: the server builds it from the app's own address, and only a path outside `/api` is allowed. `/` is used when no page is given.
   - Never `app_badge`.
   - A message's JSON may be at most 3993 bytes, the plaintext RFC 8291 lets every push service accept. A longer message is refused, never cut.
   - Every push waits up to **24 hours** at the push service (`TTL: 86400`) and is **urgent** (`Urgency: high`). The delivery port takes both with each push, so C9 can choose its own.
   - **The service worker gets the push event for a declarative message only when it carries `"mutable": true`**, which defaults to false. C8a's messages carry none, so on the iPhone Safari shows the notification and the service worker does not run. Browsers that do not read the format fire the push event as for any push.
3. **Who gets a push.** A device is one record, keyed by its push address, under the account signed in when it last registered.
   - A message to an account goes to all its devices at once, each once.
   - **Only accounts on the allowlist ([ADR-0004-account-allowlist](0004-account-allowlist.md)) get pushes**, checked by the sender itself on every send, so C9's notifications follow the same rule. A message to an account that is not on the list is refused, and that account's devices are deleted.
   - A device the push service reports gone (404, 410) is deleted.
   - Any other failure is counted and the device kept. **Nothing is retried.**
   - The answer counts the devices reached, failed and removed.
   - Devices register only at **known push services**: Apple's, Google's, Mozilla's and Microsoft's, by `https` origin. Plain `http` is allowed only for a loopback test fake.
4. **The keys: a VAPID key pair and a message key.**
   - The owner makes them with one PowerShell 7 block, on .NET's own `ECDsa` (P-256) and 32 random bytes. The laptop and production get separate values. Production's live only in Key Vault (`Push--VapidPublicKey`, `Push--VapidPrivateKey`, `Push--MessageKey`). They are never printed.
   - The app refuses to start without a valid pair.
   - **A lost or replaced key heals itself:** every device replaces its subscription at its next opening, when the app finds it was made with another key. So the production keys need no backup.
   - The token's contact (`sub`) is the app's own `https://` address, never an email, and it is also the base of every page a tap opens.
5. **A hidden message endpoint for the owner:** `POST /api/push/messages`, with the message key in `X-Message-Key`. It stays open after development, with no switch.
   - The key is checked in constant time, before the body is read.
   - **A missing or wrong key gets exactly the 404 an unknown address gets.** The endpoint is kept out of the API description, so a probe cannot tell it exists.
   - Each request names its account, so no address is configured or written down.
   - It sends through the same sender C9 uses.

## Alternatives considered

- **[WebPush](https://www.nuget.org/packages/WebPush) 1.0.13:** it sends only the older draft encryption `aesgcm`, and its README marks Safari unsupported (read 2026-11-08).
- **Our own implementation on .NET's cryptography** (about 150–200 lines, provable against RFC 8291's worked example): no third-party cryptography, but about half a day more. The owner chose speed. It stays the escape route if the library gets a published vulnerability, which the build's `TreatWarningsAsErrors` turns red.
- **Azure Notification Hubs:** Microsoft Learn says "Apple Safari isn't included" and lists iOS as not supported (updated 2026-03-04, read 2026-11-08). It would also add a namespace, a hub and a secret.
- **A classic push that our service worker shows:** a push that ends up showing nothing risks Safari revoking the site's permission. A declarative push always shows something, because Safari shows it even when the service worker does not run (c011 design.md D2).
- **A test button in the app, or a confirmation push when notifications are turned on** (instead of the message endpoint): the owner chose the endpoint, which also lets C9's notifications be tested the same way, with no UI.
- **Retries inside the sender:** the caller can send again, and C9 decides for its own notifications.

## Consequences

- **C8b** (the card and the service worker) and **C8c** (the subscription's upkeep at every opening, at sign-out, and on 401 or 403) build on the shared frontend pieces C8a ships (`src/app/push.ts`), and on the three endpoints for the app: the key, register and forget. The heal-itself promise of item 4 depends on C8c's upkeep.
- **Apple may refuse a token whose contact is a localhost address.** A local check that sends to a real iPhone (C8b's) sets `Push:Subject` to a real `https://` address. Apple publishes no rule either way, and one open-source project reports a 403 `BadJwtToken` for `mailto:admin@localhost` (c011 design.md D5, R5).
- **C9** sends through `SendPushHandler` and gets the allowlist, gone devices and the count logging for free.
  - If it needs the service worker on the iPhone (ADR-0007's stored balance), it adds `"mutable": true` through its own push-sending spec change.
  - It must never touch the stored balance for a message that carries none.
- **What tests cannot show:** that Apple accepts our token and encryption. That is a manual check on the iPhone in C8b. The fake push service checks what Apple would and more: the token, `TTL`, `Urgency`, the encoding and the decrypted content.
- **Telemetry:** the app's own log lines hold counts and outcomes only.
  - The push client's own request lines and traces keep the push address, as every outgoing client except the bank's does. The owner accepted this for speed: the telemetry is private, and an address alone cannot deliver a push.
  - The full version is a recorded software-factory divergence: it gives the push client the bank client's two measures and a guard over exported traces.
- **Hard to reverse:** the table's keys, the setting and secret names, the endpoint and field names C8b, C8c and C9 build on, and the message key's header.
