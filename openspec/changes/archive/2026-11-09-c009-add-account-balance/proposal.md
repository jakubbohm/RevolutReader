# Proposal: c009-add-account-balance

## TL;DR

- **What:** UC2's balance end to end. `GET /api/balance` reads the balance live for the signed-in user, with the time it was read and the koruna rate. The account screen shows it in its header with the CZK equivalent and freshness, refreshes it on "Obnovit" and on every return, and keeps the last one on the phone. It also shows the waiting screen (normal and slow) on the app's first request, the offline screens, the bank's three error banners, a banner for unexpected answers, a failed sign-out, and the sign-out's busy state. While the app is on screen it keeps the server awake. The API's 500 becomes a problem description.
- **Out of scope:** the transaction list and its place (C7b), push notifications (C8, C9), sourcing the rate from an outside service (#39), the always-on replica (#18), any design change.
- **Riskiest assumption:** a `/health` request every 4 minutes keeps the Container Apps replica from scaling to zero (300 s cool-down). It is checked on Azure after the merge (design.md D9).
- **Scenarios added** (`account-balance`, new): The balance comes with the time it was read and the koruna rate · The bank sees the signed-in user's address and browser · A balance request without a browser name reads nothing at the bank · Expired bank access answers its own problem · A reached bank limit answers its own problem · A bank that does not answer is its own problem · The account screen shows the balance, its koruna value and when it was read · Tapping "Obnovit" reads the balance again · Coming back to the app reads the balance again · A bank that does not answer shows a banner with a retry · Too many refreshes shows a warning with no action · Expired bank access asks to let Dad know · An unexpected answer to the balance read shows a banner with a retry · A balance read replaces the one the phone keeps · Signing out forgets the balance on the phone · A login that has ended forgets the balance on the phone
- **Scenarios added** (`app-shell`): A sleeping server shows the waking-up screen after 1.5 seconds · A slow wake offers to try again after 30 seconds · A stored balance shows at once while the server wakes · Offline with a stored balance shows it with the offline banner · Offline with nothing stored says the balance loads once online · Coming back online loads what was waiting · A refresh with no answer for 60 seconds counts as offline · An unexpected answer to who is signed in shows a banner with a retry · The app keeps the server awake while it is on the screen · The app lets the server sleep after 30 minutes without use
- **Scenarios added** (`sign-in`): A sign-out that fails offline says to try again online · A sign-out the server fails says to try again later · The menu shows the sign-out under way · A login that ends while the app is open shows the sign-in screen
- **Scenario added** (`api-errors`): An unexpected failure answers with a problem description that reveals nothing · **modified requirement** "Error responses are problem descriptions": a caller that rules JSON out *may* get plain text, no longer *only* gets it (its two scenarios unchanged)

## Why

Roadmap step **C7a** (`pm/roadmap.md`, issue [#41](https://github.com/jakubbohm/RevolutReader/issues/41)), use case **UC2** (kickoff ch. 5), part 1: the daughter opens the app and sees the balance of the account. C6 left an empty account screen, which shows nothing while the server wakes (about 20 s) or the phone is offline, and says nothing when a sign-out fails ([#33](https://github.com/jakubbohm/RevolutReader/issues/33) finding 7). C13 built the shared backend pieces (the present user from the request, the bank failures as problem descriptions, the koruna rate), so C7a and C7b ([#42](https://github.com/jakubbohm/RevolutReader/issues/42)) run side by side; C7a owns the account screen and merges first (roadmap § Working in parallel). Every decision below was made with the user in explore, 2026-11-08 (design.md D1–D9), as one linked round.

## What Changes

- **`GET /api/balance`** (design.md D1), allowed users only:
  - reads the available balance live, as the signed-in user present: their address and browser go to the bank (ADR-0001 § Decision, item 1; C13's `PresentUser`);
  - answers exactly the amount in euros, the time the server read it, and the CZK per EUR rate (C13's constant, 24.3); the app works out the koruna line;
  - a request without a browser name reads nothing at the bank and answers 400 (C13's rule), so it never counts against the 4 reads a day without the user;
  - the bank's three failures answer C13's problem descriptions, each with its own `type`, because two of them share status 503;
  - a balance in a currency other than euros is a bug: 500.
- **The 500 for unexpected failures** (D1): today an unhandled exception answers 500 with an empty body, against `api-errors`' requirement. `UseExceptionHandler()` makes it a problem description that reveals nothing (C13's research).
- **The account screen's header** (D3): "Na účtu máš", the balance, `≈ … Kč`, "Aktualizováno …" and "Obnovit"; "Obnovuji…" while a read runs, with the balance kept; a placeholder while the first read loads.
- **Refresh** (D3): on "Obnovit", on every return to the app and when the phone comes back online; never two reads at once; a refresh with no answer for 60 s counts as offline.
- **The balance kept on the phone** (D4, ADR-0007): the amount, the read time and the rate, in IndexedDB through idb-keyval. It is written after every successful read and shown at once while the server wakes and when offline. It is deleted after a confirmed sign-out and whenever the server says the device has no allowed login (401 or 403).
- **Start-up, waiting and offline** (D2): `GET /api/me` first, then the balance.
  - After 1.5 s without an answer: the waking-up screen ("Server se probouzí"), below the stored balance's header when there is one.
  - After 30 s: the slow variant with "Zkusit znovu".
  - Offline: the stored balance with the "Jsi offline" banner and a note in the list's place, or "Jsi offline" alone.
  - Coming back online repeats what was under way.
- **Errors** (D5):
  - the bank's three banners ("Banka teď neodpovídá", "Příliš mnoho obnovení", "Propojení s bankou vypršelo"), without the header when there is nothing to show;
  - "Zůstatek se nepodařilo načíst" for any unexpected answer, also to `GET /api/me`. It replaces C6's empty frame on a server error.
  - A 401 or 403 on a refresh leads to the sign-in or no-access screen.
- **Sign-out** (D6):
  - a failed sign-out shows "Odhlášení se nepovedlo", with a sentence for offline and one for a server error;
  - while it runs, the menu stays open and "Odhlásit se" shows a spinner;
  - a failed sign-out keeps the stored balance.
- **Seams with C7b** (D7): a place for the list under the header, one refresh signal, and one banner for the screen's current problem.
- **Keeping the server awake** (D9): while the app is on screen it asks `GET /health` when it appears and every 4 minutes, without waiting for the answer. It stops after 30 minutes without a tap or key press and resumes on the next one; nothing while hidden. Vite's dev server forwards `/health` too.
- **Records:**
  - dated notes in ADR-0007 (the rate in the record, deletion on 401/403) and ADR-0006 (the keep-alive);
  - the bank rows and the 500 in docs/conventions/README.md's case → status table;
  - software-factory lessons (design.md § Cross-cutting effects).

## Capabilities

### New Capabilities

- `account-balance`: the account's balance: the API that reads it live for the present user and tells the bank's failures apart, and the account screen's header that shows it with its koruna value and freshness, refreshes it, keeps the last one on the phone, and names the bank's failures and unexpected answers.

### Modified Capabilities

- `app-shell`: the frame now says what the app is waiting for: the waking-up screen (normal and slow) on the app's first request, the offline screens with and without a stored balance, the reload when back online, the 60 s limit on a refresh, a banner for an unexpected answer to who is signed in, and keeping the server awake while the app is on screen.
- `sign-in`: a failed sign-out says so, the sign-out shows that it is under way, and a login that ends while the app is open leads to the sign-in or no-access screen.
- `api-errors`:
  - an unexpected failure answers 500 as a problem description that reveals nothing (a new requirement; today the body is empty);
  - the existing requirement no longer promises plain text to a caller that rules JSON out: problem answers written by the endpoint, such as the bank's, send that caller JSON anyway (C13's code review; the user, 2026-11-08). No client of ours rules JSON out.

  The bank cases' own `type` is part of `account-balance`, where clients need it; the case → status table in docs/conventions/README.md gains a `type` column (C13).

`bank-reads` keeps its requirements: the endpoint uses the port as it is. `service-health`'s `GET /health` is unchanged; the app only calls it more often. `app-delivery` and `app-installation` are untouched.

## Non-goals

- **The transaction list, its loading states and the transaction sheet:** C7b. C7a leaves a place for the list and fills it only with the waking-up screen and the offline note (D7).
- **The banner precedence between the balance and the list:** C7b, at the join (D7).
- **Push notifications and the service worker writing the balance:** C8 and C9 (ADR-0007, item 3). C9's push must carry the rate too, or the service worker keeps the stored one (D1).
- **The rate from an outside service:** [#39](https://github.com/jakubbohm/RevolutReader/issues/39); C13's constant until then.
- **Removing the ~20 s wait after a quiet spell:** only an always-on replica would ([#18](https://github.com/jakubbohm/RevolutReader/issues/18), ADR-0006). The keep-alive only keeps an open app's server awake (D9).
- **Switching to the offline screen on the browser's `offline` event while the app sits open:** the next request finds out (D2).
- **A limit on how often a return to the app refreshes:** the user chose every time (D3).
- **Any design change:** the screens and states come from the Screens design as it is; the error wordings it does not draw are text only (D5).
- **A new manual scenario:** comparing the balance with the Revolut app, checking C12's ready queries and checking the keep-alive on Azure are close-out tasks.

## Open questions

- **Applies Q6** ([ADR-0001-bank-data-access](../../../docs/adr/0001-bank-data-access.md)): every balance read is live and made as the present user, with their real address and browser; no read is ever made unattended in its place.
- **Applies Q10** ([ADR-0007-offline-balance](../../../docs/adr/0007-offline-balance.md)): the phone keeps the last balance and its read time (now with the rate) and shows it at once while the server wakes and when offline; deleted on sign-out, and now also on 401 or 403.

## Impact

- **New code (backend):** `GET /api/balance` in `src/RevolutReader.Api/Account/` (endpoint, response, handler); `UseExceptionHandler()` in `Program.cs`. It uses C13's pieces; no new package.
- **New code (frontend):**
  - in `src/app/`: the balance read, the stored balance, the screen's rules, the refresh triggers, the keep-alive and the Czech formats;
  - in `src/components/`: `BalanceHeader`, `WakingUp`, `Skeleton` and `EmptyState`, with `Banner`, `Button` and `AccountMenu` extended;
  - `AccountScreen` filled and `App` reworked.
- **Tests:**
  - a `BalanceDriver` and `BalanceDsl` (own files, D7), the account-balance and api-errors scenarios, and a unit test for the endpoint's handler;
  - the frontend's fake server learns the balance, the health check, delays and abort; the scenarios run with fake IndexedDB and fake timers;
  - unit tests for every rule module.
- **Packages** (checked on npm 2026-11-08):
  - `idb-keyval` 6.3.0 (Apache-2.0);
  - `@radix-ui/react-progress` 1.2.1 (MIT, React 19), the waking-up bar the design system names;
  - `fake-indexeddb` 6.2.7 (Apache-2.0, dev; 6.2.8 came out on 2026-11-08 and is weighed at the bootstrap).
- **API contract:** `GET /api/balance` added to `openapi.json` and `schema.d.ts` (regenerated).
- **Local development:** Vite forwards `/health` as well as `/api`.
- **Azure:** none. No new resource, setting or secret.
- **Docs:**
  - ADR-0006 and ADR-0007 (dated notes);
  - docs/conventions/README.md (case → status rows);
  - `docs/software-factory/` (lessons, inventory);
  - `pm/progress.md`.
- **Merged by hand at C7b's rebase** (roadmap § Working in parallel, D7): `openapi.json`, `schema.d.ts`, `pm/progress.md`, `App.tsx` and `AccountScreen.tsx`, the frontend fake server, `package.json` and its lock file, `Dsl/ProblemDescription.cs`.
