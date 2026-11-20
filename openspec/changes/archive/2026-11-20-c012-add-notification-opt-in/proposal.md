# Proposal: c012-add-notification-opt-in

## TL;DR

- **What:** UC3's part 1b, frontend only. A signed-in user turns notifications on from a card under the balance, "Chceš vědět o každé platbě?", wherever the browser can subscribe (on the iPhone, the Home Screen app). The card shows its result: on, or blocked with the path to iOS Settings. "Teď ne" hides it for good on the device, and the account menu's "Zapnout upozornění" then offers it while notifications are off. A failure while turning them on shows in the screen's one banner. The service worker shows a push on browsers that do not show Declarative Web Push themselves, and a tap opens the app.
- **Out of scope:** keeping the subscription right at every opening, at sign-out and on 401/403 (C8c, alongside); what C9's notifications say and the balance a push carries (C9); any endpoint or backend change (C8a's are used as they are).
- **Riskiest assumption:** that Apple accepts what C8a sends and the iPhone shows it, and that iOS asks for permission from the card's tap and lets the app subscribe right after. Tests cannot show either; the manual rows on the owner's iPhone are the first proof.
- **Scenarios added** (`notification-opt-in`): The card offers notifications under the balance · The card also shows in a computer's browser · Nothing offers notifications where the browser cannot have them · Nothing offers notifications once they are on · Turning notifications on from the card asks the phone and says they are on · "Upozornění jsou zapnutá" is gone at the next opening · Declining the phone's question says where to turn notifications on · The card saying notifications are off is gone at the next opening · "Teď ne" hides the card for good on this device · The account menu offers notifications after "Teď ne" · Turning notifications on from the account menu shows the result in the card · The account menu, with notifications blocked, says where to turn them on · Turning notifications on offline says to try again online · Turning notifications on when the server fails says to try again later · The iPhone asks for permission when the card's button is tapped (manual) · The iPhone asks for permission when the account menu's item is tapped (manual) · The card's path to the iPhone's Settings is right (manual)
- **Scenarios added** (`push-display`): A push shows as a notification where the browser does not show it itself · A push the browser shows itself shows once · A tap on a notification opens the app at its page · A tap on a notification brings the open app to the front · A message sent to the account shows on the iPhone and a tap opens the app (manual)
- **Scenarios modified** (`app-shell`): The account menu shows who is signed in (the menu may now hold "Zapnout upozornění"; the scenario names a browser that cannot have notifications)

## Why

Roadmap step **C8b** ([#60](https://github.com/jakubbohm/RevolutReader/issues/60)), use case **UC3** (kickoff ch. 5): the user enables notifications, and a push shows on the device. C8a ([#51](https://github.com/jakubbohm/RevolutReader/issues/51)) merged on 2026-11-10: the server can send a push and the app has the push module, but nothing lets a user turn notifications on, so no device can register yet. Every behaviour was decided with the owner in C8's explore (2026-11-08/09) and handed over in the issues' comments: the shared S1–S12 on #51 and C8b's own B1–B11 on #60. This change is proposed directly from them; its design.md becomes their home. Applies **Q9** (on the iPhone, Web Push works only in the Home Screen app, so that is where the card shows there).

## What Changes

- **The card** (design.md D2–D6), the design system's `NotificationOptIn`, under the balance header, wherever the browser can subscribe: not only in the Home Screen app (B2, a deliberate difference from the design system's "only in standalone mode": on the iPhone it is the same thing, and on a computer the owner can test it).
  - Default: "Chceš vědět o každé platbě?" with "Zapnout upozornění" and "Teď ne".
  - "Zapnout upozornění" asks the phone for permission straight from the tap, then subscribes with C8a's key and sends the subscription (C8a's push module), the button spinning meanwhile.
  - Enabled: "Upozornění jsou zapnutá", until the next opening, then never again.
  - Denied: "Upozornění jsou vypnutá. Zapneš je v Nastavení → Oznámení → Tarjeta Papá.", with no button, right after the user declines and when chosen from the menu; gone at the next opening, with no reminder at later openings.
  - "Teď ne" hides it for good on that device, remembered there.
- **The account menu's "Zapnout upozornění"** (D7), above "Odhlásit se", whenever notifications are off and the card is not on screen, never once they are on. After "Teď ne" it asks the phone from the tap and the card comes back with the result; while the phone blocks notifications it brings back the Denied card.
- **A failure while turning them on** (D8): offline or a server error shows "Upozornění se nepodařilo zapnout" in C7a's single banner, with "Zkus to znovu, až budeš online." or "Zkus to prosím za chvíli.", and the card returns to its default state.
- **The service worker showing a push** (D9): a push the browser already shows as a Declarative Web Push message (Safari) is left as it is; elsewhere (Chrome on a computer) the service worker shows the same message itself. A tap opens the app at the message's page, or brings an open app to the front.
- **Manual checks on the owner's iPhone** after the deploy (D11): the permission question from the card and from the menu, a message sent through C8a's message endpoint arriving and opening the app (the first proof that Apple accepts C8a's push), and the path to iOS Settings. Rows 1 and 2 again at M7 on the daughter's phone.

## Capabilities

### New Capabilities

- `notification-opt-in`: offering and turning on notifications on the device: the card and its states, "Teď ne", the account menu's item, and what a failure shows. C8c's upkeep and C9's notifications build on the subscription it creates.
- `push-display`: what the device does with a push it receives: showing it where the browser does not, and what a tap opens. C9 extends it (the balance a push carries, ADR-0007).

### Modified Capabilities

- `app-shell`: "The top bar holds the account menu" said the menu holds one item, "Odhlásit se", and nothing else. It now also holds "Zapnout upozornění" while notification-opt-in offers it; its scenario names a browser that cannot have notifications, so it still shows the one item.

## Non-goals

- **The subscription's lifecycle:** re-sending it at every opening, replacing one lost or made with an old key, removing it at sign-out and on 401/403, coming back after a new sign-in (C8c, [#61](https://github.com/jakubbohm/RevolutReader/issues/61), alongside; S10).
- **What a notification says and the balance it carries:** C9 ([#52](https://github.com/jakubbohm/RevolutReader/issues/52), Q8), including the lock-screen boards (options A and B) and storing the balance from the push handler (ADR-0007).
- **A reminder at every opening while notifications are blocked,** a close button or a timer on the Denied card (B6: the owner dropped them once the menu item covered the blocked case).
- **The card coming back by itself after "Teď ne"** (B3: a 7-day return was replaced by the menu item).
- **A confirmation push, a test button, badges:** not chosen in explore (S3, A2).
- **Any backend, API or infrastructure change:** C8a's three endpoints and its message endpoint are used as they are.
- **A change to the design:** the boards are implemented as drawn; B2's difference is behaviour, where the spec wins (`.claude/rules/design.md`).

## Impact

- **Frontend:** the card component; the account menu's new item (`AppShell`, `AccountMenu`); the rules of what is offered and the turning-on sequence (new modules beside `useAccountScreen`); the screen's one banner gains the failure (`screenState.ts`, `AccountScreen.tsx`); the service worker's push and tap handling (a new module wired into `sw.ts`); `App.tsx` wiring. No new package.
- **The phone keeps one more thing:** the "Teď ne" choice, on the device. It is not bank data, so ADR-0007 is unchanged (D5).
- **Tests:** two new frontend scenario files; the test kit gains a stand-in for the service worker's side (showing a notification, the app's windows) and the remembered choice; four manual rows in `tests/manual-scenarios.md`.
- **Local check:** the dev server registers no service worker, so the local check in Chrome through `aspire start` stops before subscribing; subscribing, the first push and its tap are checked on the deployed app (design.md D12, the owner's choice).
- **Shared with C8c** (S10, D13): the wiring in `App.tsx` and the rows in `pm/progress.md`, joined by hand by whichever merges second; probably also small edits to `useAccountScreen.ts` and the test kit, which design.md names.
- **Docs:** testing.md (the service worker's stand-in), `tests/manual-scenarios.md`, ADR-0010 (a dated note on the service worker's display rule), software-factory lessons and inventory lines (D14).
- **No change** to the API contract, `openapi.json`, the AppHost, settings, secrets or Bicep.
