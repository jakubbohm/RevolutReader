# ADR-0007: Offline scope — the phone keeps the app's files and the last balance, never transactions

**Status:** Accepted (the user's decision, 2026-11-06) · **Date:** 2026-11-06 · **Roadmap:** C3; applied in C3, C7, C9 · **Questions:** Q10

## Context

- **Q10** (kickoff ch. 10) asks whether installation on a phone and notifications are enough, or whether an offline mode is needed too.
- **The app's own files are already settled.** The service worker serves the cached app shell, so the screen appears without waiting for the backend ([ADR-0002-frontend-hosting § Decision](0002-frontend-hosting.md#decision)). What was open is the bank data.
- **The server sleeps.** The app scales to zero, and the first request after a quiet spell waits about 20 seconds ([ADR-0006-hosting-registry-and-job](0006-hosting-registry-and-job.md)). The main user opens the app a few times a day, so most of her opens hit that wait.
- **The design already planned for cached data** (read 2026-11-05):
  - the design system's WakingUp guideline said to show cached data while the server wakes;
  - the Screens design drew an offline board with cached transactions.
- **A service worker cannot use Web Storage** (`localStorage`); it is fully asynchronous ([MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), read 2026-11-06). IndexedDB is available both to the page and to workers ([MDN: IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)).
- **Transactions stay on the server.** It stores every settled transaction and reads the pending ones live ([ADR-0001-bank-data-access § Decision](0001-bank-data-access.md#decision), item 6).

## Decision

Decided by the user, 2026-11-06 ("limited B"):

1. **The service worker keeps only the app's own files** (the build's HTML, JavaScript, CSS, manifest and icons). It never caches an answer from the API.
2. **The phone keeps the last known balance and the time the server read it, and nothing else of the bank data. Never transactions:** they stay in memory while the app is open and load again on every launch.
3. **The stored balance is replaced:**
   - after every successful refresh: opening the app, `Obnovit`, coming back to it;
   - whenever a push notification arrives, because the push carries the balance and its read time, and the service worker writes them.
4. **It is deleted on sign-out.**
5. **It lives in IndexedDB,** because the service worker has to write it from its push handler.
6. **With a stored balance, the app shows it at once,** with its time, while the server wakes up, and when the phone is offline. The transaction list waits for the server (WakingUp in its place) or says it loads once online. Without one, the app shows the waking-up or offline screen alone.

The design follows the same rule: the design system's "What the phone stores" section and the Screens boards "Shell / Offline / Balance stored", "Shell / Offline / Nothing stored" and "Account / Detail / Waking up, balance stored" (design loop of 2026-11-06).

## Alternatives considered

- **A. Live only:** nothing of the bank data on the phone. Most opens would then show the ~20 s waking-up screen with nothing in it, and there would be nothing to show offline.
- **B. The last balance and the last transactions.** The most to show, but more bank data at rest on the phone, and a cache of the list to keep consistent with the server's store and the live pending ones.
- **The always-on replica** that ADR-0006 keeps as the cold-start fallback (about $4–6 a month). It removes the wait but not the offline case. It stays available if the wait still bothers.

## Consequences

- **C3:** the service worker caches the app shell only, with no runtime caching of API answers. It's our own file (vite-plugin-pwa `injectManifest`), so C9 can add the push handler to it (c003 design.md D9).
- **C7:**
  - the stored balance in IndexedDB, written after every successful balance read and deleted on sign-out;
  - the waking-up and offline screens with and without it, as the Screens design draws them;
  - the freshness line names the day of an older balance ("Aktualizováno včera v 14:05").
- **C9:** the push payload carries the balance and its read time. Web Push encrypts it for the device, so the push service cannot read it. What the lock screen shows stays a separate choice (Q8). The service worker writes the payload into the stored balance.
- **Data at rest:** one balance and one time, on the user's own phone, inside the Home Screen app's storage, which is separate from Safari's (ADR-0003-sign-in § Context). Logs and the repository still never hold bank data (CLAUDE.md).
- **Software factory:** [lessons.md R-39](../software-factory/lessons.md).
