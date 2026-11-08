# Design: c009-add-account-balance

## TL;DR

- **`GET /api/balance` answers `{ amount, readAt, czkPerEur }`.** The app works out the koruna line; a balance in another currency is a bug (500); the read is always the present user's, and a request naming no browser reads nothing (400). The bank's failures use C13's problem descriptions, told apart by `type` (D1).
- **The 500 becomes a problem description:** `UseExceptionHandler()` right after `UseStatusCodePages()`, from C13's research (D1).
- **Start-up runs `GET /api/me`, then the balance.** Waiting after 1.5 s, slow after 30 s with a retry. Once the server woke, the waiting screen stays until the data comes. Offline means the phone says so or no answer came, never an error status (D2).
- **Refresh** on "Obnovit", on every return and back online; never two at once; 60 s with no answer counts as offline (D3).
- **The phone keeps one record** `{ amount, readAt, czkPerEur }` through idb-keyval. It is written after every read and forgotten on a confirmed sign-out and on any 401 or 403 (D4, ADR-0007 note).
- **Errors the design does not draw** (D5): banners only; one "Zůstatek se nepodařilo načíst" for every unexpected answer. **Failed sign-out** (D6): a banner; a busy menu item while it runs. **Seams with C7b** (D7): a list slot, one refresh signal, one banner.
- **31 scenarios in one change, sliced per scenario:** 7 API, 24 frontend on fake timers and fake IndexedDB (D8). **Keep-alive** (D9): `/health` every 4 minutes while on screen, stopped after 30 idle minutes.
- **New public interfaces:**
  - `GET /api/balance`;
  - `ReadBalanceHandler`, `AddBalance()`;
  - DSL `BalanceDsl`, driver `BalanceDriver`;
  - frontend `readBalance`, the stored-balance module, `shown`, `useAccountScreen`, `watchRefreshTriggers`, `keepServerAwake`, the Czech formats;
  - `BalanceHeader`, `WakingUp`, `Skeleton`, `EmptyState`, with `Banner`, `Button` and `AccountMenu` extended (D10).
- **Integration points:** Enable Banking through the existing port; C13's present user, problem rules and rate; the browser's IndexedDB; `GET /health`; the regenerated TS client.
- **Hard to reverse:** the answer's field names (the stored record, and later C9's push, carry them); the problem `type` strings, which clients compare exactly.

## Context

- See proposal.md § Why. Decisions D1–D9 were made with the user in explore (2026-11-08) as one linked round: nothing was written until the whole set was agreed. Details marked *(propose)* were settled while writing this design and follow from them.
- **Backend today:**
  - no endpoint reads the bank; the port `IBankAccount.ReadBalance(ReadTrigger, ct)` returns `BankResult<Balance>`, and `Balance(decimal Amount, string Currency)` carries the account's currency;
  - `Program.cs` has `AddProblemDetails` and `UseStatusCodePages` but no exception handler. An unhandled exception answers 500 with an empty body, against the `api-errors` requirement. In the in-process acceptance harness there is no 500 at all: the exception is rethrown into the test's `HttpClient` call (C13's research, 2026-11-08).
- **C13** (`feat/c13-account-read-groundwork`, not merged at propose time; its merged names are final):
  - `Account/PresentUserFromRequest.Read(HttpContext)` returns `PresentUser?`: the client address after forwarded headers, IPv4 out of its IPv6 form, and the `User-Agent` as given. It returns `null` without an address or with a blank browser, and the endpoint then answers 400;
  - the rules that turn a bank failure into a problem description:
    - access expired: 503, `/problems/bank-access-expired`, "Bank access expired";
    - rate limited: 429, `/problems/bank-rate-limited`, "Bank rate limit reached";
    - unavailable: 503, `/problems/bank-unavailable`, "Bank unavailable";
    - no `detail` and no `Retry-After`;
  - the rate, a static class: 24.3 CZK per euro, dated 2026-11-08;
  - a `type` column in docs/conventions/README.md's case → status table.
- **Frontend today:**
  - `App` asks `GET /api/me` once; `unknown` (pending, offline, any error) shows the empty frame;
  - `signOutFromMenu` swallows a failure with a bare `return` (#33 finding 7);
  - `Banner` has the error tone only, `Button` the primary variant only, and `AccountMenu`'s item closes the menu on select;
  - `watchForUpdates` (`app/updates.ts`) already listens to `visibilitychange` and reads `navigator.onLine`;
  - the test kit's fake server (`test/server.ts`) knows `GET /api/me` and the sign-out, with no delays and no abort.
- **Hosting:** the container app scales to zero after a 300 s cool-down (`infra/features.bicep:105-109`); a wake takes about 20 s (ADR-0006).
- **Design** (read 2026-11-08): the design system at version `1794081633-ee61`; the Screens design at version `1794081622-ddc3`, whose pinned copy of the design system is identical (sha256 of `tokens.json` and `index.d.ts`), so no design loop is pending.

## Goals / Non-Goals

**Goals:**

- The 31 scenarios of the four delta specs, each verified at the level § How each scenario is verified gives.
- A screen that never sits empty: something to read within 1.5 s of opening, whatever the server, the network or the bank do.
- Seams that let C7b's list join after the rebase without reworking C7a's code (D7).

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- **No in-memory fake of `IBankAccount` and no `[integration]` group:** the endpoint uses the port as it is, and the port is tested against the fake bank (c004 design.md D1). The handler's unit tests use a stub of the port.
- **No server-side cache of the balance:** every read is live (ADR-0001 § Decision, item 1).
- **No React state library or router:** one screen, one hook, pure rules beside it.
- **No `list` variants of `Skeleton` and no default `EmptyState` ("Zatím žádné pohyby"):** C7b builds what its list needs.

## Decisions

### D1 — `GET /api/balance` answers the amount, the read time and the rate

- **The answer** is exactly `{ amount, readAt, czkPerEur }` (option A in explore):
  - `amount` in euros, as the bank gives it;
  - `readAt`, the server's time when the bank answered (the app's `TimeProvider`), not when the phone received it, which is what the design system's `updatedAt` means;
  - `czkPerEur`, C13's constant.

  The app computes the koruna line with the design system's formula (rounded to whole crowns, `≈`). Rejected:
  - B, the server sends the koruna amount: the transaction rows (C7b) need the rate anyway, and the stored record would hold two amounts that must agree;
  - C, a separate rate endpoint: one more request on every open, for one number.
- **Currency:** not in the answer. The account is a euro account, so a balance in any other currency is a bug: the handler throws `InvalidOperationException` and the answer is a 500. The message names neither the amount nor the currency (docs/conventions/README.md, never log bank data). Unit-tested, no scenario.
- **The present user:** the endpoint reads it with C13's `PresentUserFromRequest.Read`. When that returns `null`, the endpoint answers C13's `BankAnswers.NoPresentUser()` (400, ASP.NET Core's default `type`, title "Bad Request") and never calls the handler, so nothing is read unattended in its place (C13's rule, the user, 2026-11-08). C13's `ProducesBankProblems()` declares that 400 together with the 429 and 503, so the endpoint's description adds no 400 of its own (C13's message, 2026-11-08).
- **Bank failures:** C13's rules map `BankAccessExpired`, `BankRateLimited` and `BankUnavailable` to their problem descriptions. Clients compare `type` exactly, as written (a relative path, never resolved), because two cases share 503, and the ingress and Vite's dev server answer 502, 503 and 504 in plain text when the app is down.
- **The 500** (C13's research, checked against the ASP.NET Core 11 RC3 sources and a scratch copy of the API):
  - `app.UseExceptionHandler()` with no arguments (`AddProblemDetails` is already registered), placed directly after `app.UseStatusCodePages()` and before `app.UseAppPages()`; forwarded headers stay first;
  - it answers 500 `application/problem+json` with the title "Internal Server Error", RFC 9110's `type` and a `traceId`, and no exception text;
  - one Error log line (message and stack) replaces Kestrel's equivalent one, so privacy is unchanged;
  - not FastEndpoints' `UseDefaultExceptionHandler`, which logs twice and echoes the exception message in the body;
  - in Microsoft's order (before `UseStatusCodePages`) a caller that rules JSON out gets an empty 500; after it, the plain-text line;
  - nothing that works changes (404, 401, 403, 400 and `/health` were checked). Side effects:
    - starting a sign-in while Microsoft is unreachable shows the problem JSON instead of the browser's error page;
    - locally the developer exception page no longer shows these errors; the stack is in the Aspire dashboard's log.
- **A caller that rules JSON out** (C13's code review, the user's decision, 2026-11-08): problem answers an endpoint writes itself (`TypedResults.Problem`, as C13's bank answers are) send `application/problem+json` to such a caller anyway, without the trace id. Only the body-less errors that `UseStatusCodePages` fills in fall back to the plain-text line. The `api-errors` requirement claimed "only … a plain-text status line"; C7a's delta rewords it to "may get". No client of ours rules JSON out, so no code changes.
- **Scenario for the 500:** the fake bank answers an Enable Banking error code no case maps. The adapter throws `BankReadException` (c004 design.md D4), and the answer must be the 500 problem description with nothing from the bank's answer in it.
- **Note for C9:** its push must carry the rate too, or the service worker keeps the stored rate (ADR-0007, item 3).

### D2 — Start-up: who is signed in, then the balance; waiting and offline

- **Order:** `GET /api/me` first, then, for a signed-in user, `GET /api/balance`. Sending them in parallel would read the bank for a request whose answer may lead to the sign-in screen, and the screen to show depends on the first answer anyway.
- **Phases of the first load:**
  - **under 1.5 s without an answer:** with a stored balance, its header at once, in the default state (its time visible); with none, the empty frame;
  - **from 1.5 s:** the waking-up screen, in the list's place below the stored header, or the whole screen under the top bar with nothing stored;
  - **from 30 s:** its slow variant with the secondary button "Zkusit znovu". It sends the request again and starts the 30 s over; it never reloads the page;
  - **once the server has answered within 1.5 s** (it was awake) and the balance is being read: the stored header in "Obnovuji…", or the balance placeholder (`Skeleton`) with nothing stored;
  - **once the server woke** (the first answer took 1.5 s or more): the waking-up screen stays until the balance arrives, and the data replaces it directly, never through placeholders (the design system's WakingUp note).
- **The account menu** joins only when `GET /api/me` has answered, as in C6. The design's waiting board draws the menu; for behaviour, the specs win (`.claude/rules/design.md`).
- **The stored balance shows before `GET /api/me` answers.** That is safe only because a device without a login keeps none (D4).
- **Offline** (2b in explore):
  1. when a request is due and `navigator.onLine` is `false`, nothing is sent and the offline screen shows at once;
  2. a request that fails with no answer counts as offline;
  3. an answer with an error status (a 502 or 503 from the hosting proxy) is not offline: it is unexpected (D5);
  4. the `online` event repeats what was under way, `GET /api/me` or the balance read; "Zkusit znovu" does it at once. The app does not switch to the offline screen on the `offline` event while it sits open; the next request finds out.

  This holds for `GET /api/me` and every balance read, refreshes included: a failed refresh keeps the balance shown and adds the banner.
- **Boards:** "Sign-in / Waiting / Default" and "… / Slow"; "Account / Detail / Waking up, balance stored"; "Shell / Offline / Balance stored" and "… / Nothing stored"; "Account / Detail / Loading".

### D3 — Refresh

- **Triggers:**
  - "Obnovit";
  - every return to the app (`visibilitychange` to `visible`, no throttle; the user chose "every time");
  - coming back online (D2).

  They are one signal for the screen (D7).
- **Never two at once:** a trigger while a read is under way is ignored, and "Obnovit" ignores taps while it spins.
- **During a refresh** the header reads "Obnovuji…" with the balance still shown. A refresh while the server sleeps shows no waking-up screen; the waking-up screen belongs to the first load only.
- **The 60 s cap:** a refresh with no answer after 60 s ends as offline (the "Jsi offline" banner, balance kept). The first load has no cap; it shows the slow waking-up screen at 30 s. *(propose)* The cap uses `setTimeout` with an `AbortController`, not `AbortSignal.timeout`, so the tests' fake timers drive it.

### D4 — The balance kept on the phone

- **Library:** `idb-keyval` 6.3.0 (Apache-2.0, published 2026-07-08), with `fake-indexeddb` (Apache-2.0) as a dev dependency, so scenario tests run the real storage code. Checked on npm 2026-11-08. Alternatives weighed: `idb` 8.0.4 (ISC), richer than one record needs; hand-written IndexedDB code, more code to test for no gain.
- **The record:** one, `{ amount, readAt, czkPerEur }`, in the app's own database and store *(propose: database `tarjeta-papa`, store `balance`, key `last`)*, so C9's service worker can write it from its push handler (ADR-0007, item 5).
  - **No owner:** every allowed user sees the same account.
  - **No expiry:** the freshness line dates it ("Aktualizováno 3. 11. v 14:05").
  - **A failing store reads as nothing stored,** and a failed write or delete is ignored. A record of the wrong shape reads as nothing.
- **Written** after every successful read.
- **Forgotten:**
  - after a sign-out the server confirmed;
  - whenever the server says the device has no allowed login: `GET /api/me` or a balance read answers 401 or 403.

  A failed sign-out keeps it (D6). A dated note in ADR-0007 records the rate in the record and the deletion on 401 and 403 (it extends item 4).

### D5 — Errors the design does not draw

- **(a) Nothing to show and a bank error:** the same three banners as with data, standing alone under the top bar, without the header. Not "Pohyby se nepodařilo načíst", which fits C7b's list-only failure.
- **(b) An unexpected answer** to `GET /api/me` or a balance read keeps what is shown and adds the error banner "Zůstatek se nepodařilo načíst" / "Zkus to prosím za chvíli." with "Zkusit znovu", which repeats what failed. Unexpected means:
  - any status other than 200, 401 and 403, or for the balance the three bank `type`s;
  - a 200 whose body is not the expected shape;
  - a hosting error page in plain text.

  It replaces C6's dead-end empty frame on an error from `GET /api/me`.
- **(c) A 401 or 403 on a refresh:** the sign-in or no-access screen, as at start, with the stored balance forgotten and no "signed out" note.
- **The bank banners** (Screens boards "Account / Detail / Error – …"):
  - bank unavailable, error tone: "Banka teď neodpovídá" / "Zkus to prosím za chvíli." with "Zkusit znovu";
  - rate limited, warning tone: "Příliš mnoho obnovení" / "Banka teď další dotazy nepřijímá. Zkus to znovu později.", no action;
  - access expired, error tone: "Propojení s bankou vypršelo" / "Obnovit propojení musí táta, dej mu prosím vědět.", no action.

  The board "Error – bank unavailable, no data" gives the layout of (a). Its wording is the list's ("Pohyby se nepodařilo načíst"), so C7a uses the bank banner's own.
- **No design loop:** these are texts with no visual change. The owner may still ask for boards.

### D6 — The failed sign-out (#33 finding 7)

- **Failure:** the menu closes and an error banner replaces any other: "Odhlášení se nepovedlo", with "Zkus to znovu, až budeš online." when offline (nothing sent because the phone says offline, or no answer), or "Zkus to prosím za chvíli." when the server answered an error. No retry button, since the menu is right there. No gendered forms.
- **Busy:**
  - the menu stays open (Radix `onSelect` with `preventDefault`);
  - "Odhlásit se" shows the spinner beside its label, is `aria-busy` and ignores taps (the design system's general loading state);
  - a tap outside closes the menu, the sign-out continues, and its result still shows.
- **The stored balance:** kept after a failed sign-out (still signed in), forgotten after a confirmed one (D4).
- *(propose)* `signOut()` keeps rejecting on failure, so the no-access screen's "Zkusit jiný účet" is unchanged; it now rejects with a `SignOutFailed` error that says whether the phone was offline.

### D7 — Seams with C7b

- **(a) A list slot under the header:**
  - empty in C7a; C7b's list goes there;
  - while the server wakes with a stored balance, it holds `WakingUp`;
  - offline with a stored balance, it holds the note "Pohyby se načtou, jakmile budeš online.".

  C7b decides at the join when its list wins over these.
- **(b) One refresh signal for the screen** ("Obnovit", return, online). C7a reloads the balance on it; C7b's list listens to the same signal, and both requests go out together. Whether "Obnovuji…" waits for both is C7b's call.
- **(c) One banner,** the screen's one current problem: the balance read, offline, a failed sign-out. A new action clears the old one. C7b adds its list's problem and decides the precedence.
- **(d) Own files per change:**
  - backend: `Account/Balance*` here, `Account/Transactions*` in C7b;
  - acceptance tests: a new `BalanceDriver` and `BalanceDsl` instead of extending C5's `BankDsl` or `FakeBank`;
  - frontend: C7a's own modules and components.

  Merged by hand at C7b's rebase:
  - `openapi.json` and `schema.d.ts` (regenerated, not merged line by line);
  - `pm/progress.md`;
  - `App.tsx` and `AccountScreen.tsx` (the join);
  - the frontend test server's answers;
  - `package.json` and its lock file;
  - `Dsl/ProblemDescription.cs`, `Drivers/AcceptanceTest.cs` and `Program.cs` (one line each).
- **Told to the C7b session** (2026-11-08, both messages logged): the change numbers c009 and c010, the rate in each answer, 7a–7d, the request rules of D2, D3 and D5, and the 500 being C7a's.

### D8 — One change, sliced per scenario

- **One change** (option 1 in explore; trimming and splitting were weighed). 31 scenarios, a little over C6's 20:
  - **`account-balance`:** 6 API acceptance tests (the read; address and browser; no browser; the three bank failures) and 10 frontend tests (the header; "Obnovit"; the return; the three bank banners; the unexpected answer; the record replaced; forgotten on sign-out and on an ended login);
  - **`app-shell`:** 10 frontend tests (waiting at 1.5 s; slow at 30 s with the retry; the stored balance at once; offline with and without a stored balance; back online; the 60 s refresh; the unexpected answer to who is signed in; the keep-alive and its cap);
  - **`sign-in`:** 4 frontend tests (sign-out failing offline and on the server; the busy item; a login ending while the app is open);
  - **`api-errors`:** 1 API acceptance test (the 500).
- **Compared with explore's estimate of about 28:**
  - +1 for the 400 without a browser (C13's rule);
  - +1 for the unexpected answer to who is signed in, as its own `app-shell` scenario;
  - the 500 is an `api-errors` scenario, and the euro check a unit test;
  - forgetting the stored balance is two scenarios.
- **No new manual scenario.** Comparing the balance with the Revolut app, C12's ready queries and the keep-alive on Azure are close-out checks (§ Migration plan).
- **The frontend tests** run with fake timers (the 1.5 s, 30 s, 60 s, 4 min and 30 min waits) and `fake-indexeddb` (the stored record). Every scenario that shows a time names it relative to the test's clock ("před 2 min", "před 2 h"), so no time zone is needed.

### D9 — Keeping the server awake while the app is on screen

- Instead of the user's first idea (2026-11-08), the sign-in button waking the server first, the app keeps the server awake while it is on screen:
  - it asks `GET /health` (anonymous, no bank, no storage) when it comes on screen, on open or return;
  - it asks again every 4 minutes while it stays visible: the cool-down is 300 s (`infra/features.bicep:105-109`);
  - fire and forget, never awaited and never shown;
  - nothing while hidden or while the phone says it is offline;
  - every screen counts except the install hint, so the sign-in screen keeps the server awake too, which answers C6's heads-up about the button's 20 s spinner.
- **Why visible only:** iOS suspends a Home Screen app in the background anyway. A computer's background tab would otherwise keep the server up, which is always-on cost (ADR-0006: roughly $4–6 a month).
- **The cap** (the user): it stops after 30 minutes without a tap or key press (`pointerdown`, `keydown`), and resumes on the next one with an immediate ask.
- **Local development:** Vite's dev server forwards `/health` as well as `/api`.
- **Records:** a dated note in ADR-0006, which accepted "after 5 minutes without use, about 20 s".
- **Limit:** it does not remove the ~20 s at the first open after a quiet spell. Only an always-on replica would ([#18](https://github.com/jakubbohm/RevolutReader/issues/18)).
- **Checked after the merge:** with the app open on a screen for more than 5 minutes, the replica stays up; about 5 minutes after it closes, it scales to zero (§ Migration plan).

### D10 — Screens and components *(propose, from the Screens design and the design system)*

- **Boards implemented** (Screens design `1794081622-ddc3`):
  - "Account / Detail": "Loaded", "Loaded (dark)", "Loaded, 4 digits", "Refreshing", "Loading", "Waking up, balance stored";
  - the errors: "Error – bank unavailable", "– bank unavailable, no data" (layout only, D5), "– too many requests", "– bank link expired";
  - "Shell / Offline": "Balance stored", "Nothing stored";
  - "Sign-in / Waiting": "Default", "Slow".

  **Not here:** "Scrolled", "Empty" and "Transaction sheet" (C7b); "Notifications" (C8).
- **Components in `src/components/`,** rebuilt with Tailwind on the existing tokens. No new token: every colour, type size and duration they use is already in `styles/theme.css`.
  - `BalanceHeader` (new): "Na účtu máš" as the page's `h1`, the amount in `text-amount-xl`, tabular; `≈ … Kč`, spoken "přibližně … Kč"; the freshness line, `aria-live="polite"`; the ghost "Obnovit" with `refresh-cw`. The refreshing state reads "Obnovuji…" with the button spinning and ignoring taps.
  - `Banner` (extended):
    - the info and warning tones;
    - an optional `action` (`{ label, onClick, loading }`) as a ghost button under the text;
    - an optional icon (`wifi-off` for offline);
    - `role="status"` for info and warning, `role="alert"` for errors.
  - `Button` (extended): the `secondary` and `ghost` variants, and an optional leading icon.
  - `WakingUp` (new):
    - the moon disc, "Server se probouzí" and its sentence;
    - the indeterminate bar, Radix `Progress` with `value={null}`, which the design system names: `@radix-ui/react-progress` 1.2.1, MIT, React 19 among its peers, checked 2026-11-08; a new Radix package, behind the component as the oxlint rule requires;
    - `role="status"`;
    - the slow variant;
    - reduced motion shows a static half-tone bar.
  - `Skeleton` (new, `balance` variant only): `role="status"`, labelled "Načítám zůstatek", with a 1.4 s opacity pulse and none under reduced motion.
  - `EmptyState` (new): a title, a sentence and an icon, and the `note` variant. Only the two offline uses here.
  - `AccountMenu` (extended): the busy item (D6).

  The skeleton's pulse and the bar's movement are CSS utilities in the app, like C6's fade-in, not tokens.
- **Formats** (`src/app/format.ts`): `formatEur`, `formatCzkApprox`, `czkApproxLabel` and `formatUpdated` (with `formatTime`), translated from the design system's `format.ts` into the app's code (workflow.md § 8), not copied as they are, whatever that file's header says. The freshness line re-renders every minute.
- **`AccountScreen`** renders what `shown` says (§ Public API sketch). Its content: the header (or placeholder), the banner, and the list slot or a whole-screen state.

## Public API sketch

```csharp
// ---- src/RevolutReader.Api/Account/ (C13's folder; C7b adds Transactions* files beside these) ----

/// <summary>The balance as the app shows it (D1): euros, the server's read time, the koruna rate.</summary>
public sealed record AccountBalance(decimal Amount, DateTimeOffset ReadAt, decimal CzkPerEur);

/// <summary>
/// Reads the balance as the present user (D1). The read time is the TimeProvider's when the bank answered; the rate is
/// C13's constant. A bank failure comes back as the same case. A balance in any currency other than EUR throws
/// InvalidOperationException, whose message names neither the amount nor the currency.
/// </summary>
public sealed class ReadBalanceHandler(IBankAccount bank, TimeProvider time) {
  public Task<BankResult<AccountBalance>> Handle(PresentUser user, CancellationToken cancellationToken);
}

/// <summary>
/// GET /api/balance (D1): the AllowedUser default policy; no PresentUser → C13's BankAnswers.NoPresentUser() (400);
/// otherwise the handler, a value → 200 BalanceResponse, a failure → C13's problem description. Description: 200, 401,
/// 403 and 500, plus C13's ProducesBankProblems() (400, 429, 503).
/// </summary>
public sealed class BalanceEndpoint(ReadBalanceHandler handler) : EndpointWithoutRequest<BalanceResponse>;
public sealed record BalanceResponse(decimal Amount, DateTimeOffset ReadAt, decimal CzkPerEur);

public static class BalanceRegistration {
  /// <summary>ReadBalanceHandler (scoped). TimeProvider comes from AddSignIn.</summary>
  public static IServiceCollection AddBalance(this IServiceCollection services);
}

// C13, its branch's names on 2026-11-08 (confirmed or replaced at the bootstrap, once merged):
// PresentUserFromRequest.Read(HttpContext) → PresentUser?; BankAnswers.NoPresentUser() (the 400) and the bank failure →
// problem description rules; ProducesBankProblems() (declares 400, 429, 503); the rate constant (24.3).

// Program.cs order: UseForwardedHeadersFromIngress → UseStatusCodePages → UseExceptionHandler → UseAppPages →
// MapApiNotFound → UseSignIn → UseFastEndpoints. Services: AddBalance() after AddEnableBanking().
```

```csharp
// ---- tests/RevolutReader.UnitTests/Account/ReadBalanceHandlerTests.cs ----
// A hand-written StubBankAccount (IBankAccount) answering a fixed BankResult<Balance> and recording the trigger;
// FakeTimeProvider for the clock. Its tests: tasks.md group 2.

// ---- tests/RevolutReader.AcceptanceTests ----

// Drivers/BalanceDriver.cs — the signed-in browser (the HttpClient SignInDriver signs in with, cookies kept) asks
//   GET /api/balance with X-Forwarded-For = the user's address and User-Agent = the user's browser, as the ingress and
//   the browser send them. It returns a BalanceReading only when the answer's exact shape fits: a 200 has exactly
//   amount, readAt and czkPerEur; a problem has the status its title belongs to and application/problem+json; a 500
//   has no members but type, title, status and traceId (nothing about the failure). readAt is compared as an instant.
public sealed class BalanceDriver(HttpClient browser, FakeBank bank, FakeTimeProvider clock) {
  public Task<BalanceReading> AskForBalance(UserAtDevice user);
  public Task<BalanceReading> AskForBalanceNamingNoBrowser(string ipAddress);
  public void BankAnswersAnErrorNoCaseFits();   // an Enable Banking error code no case maps → BankReadException
  public DateTimeOffset Now { get; }            // the app's clock; it does not move by itself
}

// Dsl/BalanceReading.cs — what GET /api/balance answered, compared by value.
public sealed record BalanceReading(decimal? Amount, DateTimeOffset? ReadAt, decimal? CzkPerEur, int? Status, ProblemDescription? Problem) {
  public static BalanceReading Of(decimal amount, DateTimeOffset readAt, decimal czkPerEur);
  public static BalanceReading Failed(int status, ProblemDescription problem);
}

// Dsl/ProblemDescription.cs gains Type: the app's own type (/problems/…), null for a plain status's RFC 9110 type, so
// the existing values keep comparing equal. New values: BankAccessExpired, BankRateLimited, BankUnavailable (title and
// type from C13), InternalServerError ("Internal Server Error").
public sealed record ProblemDescription(string Title, string? Type = null);

// Dsl/BalanceDsl.cs — AcceptanceTest.Balance; written in full, calling only the driver. The bank's state and the
// requests it received come from BankDsl as they are (HasAvailableBalance, ReportsExpiredSession,
// ReportsRequestLimitReached, ReportsOwnError, RequestsReceived).
public sealed class BalanceDsl(BalanceDriver driver) {
  public const decimal KORUNA_RATE = 24.3m;                        // C13's constant
  public Task<BalanceReading> AsksForTheBalance();                 // as BankDsl.DefaultUser
  public Task<BalanceReading> AsksForTheBalanceFrom(UserAtDevice user);
  public Task<BalanceReading> AsksForTheBalanceNamingNoBrowser();
  public void BankAnswersAnErrorTheAppDoesNotKnow();
  public DateTimeOffset Now { get; }
}
```

```ts
// ---- src/RevolutReader.Web/src/app ----

// balance.ts — GET /api/balance (D1, D2, D5)
export interface Balance { amount: number; readAt: string; czkPerEur: number }   // as answered and as kept; readAt ISO 8601
export type BalanceRead =
  | { kind: "read"; balance: Balance }
  | { kind: "bank access expired" } | { kind: "bank rate limited" } | { kind: "bank unavailable" }   // by `type`, exactly
  | { kind: "signed out" }                          // 401
  | { kind: "refused"; email: string | null }       // 403
  | { kind: "unexpected" }                          // any other answer, or a body that is not a balance
  | { kind: "offline" };                            // navigator says offline (nothing sent), no answer, or aborted
export function readBalance(options?: { signal?: AbortSignal }): Promise<BalanceRead>;   // never throws

// session.ts — "unknown" splits in two (D2, D5); signOut tells offline from failed (D6)
export type Session =
  | { kind: "signed-out"; justSignedOut: boolean }
  | { kind: "refused"; email: string | null }
  | { kind: "signed-in"; name: string; email: string }
  | { kind: "unexpected" }
  | { kind: "offline" };
export function readSession(): Promise<Session>;                  // never throws; offline → nothing sent
export class SignOutFailed extends Error { readonly offline: boolean }
export function signOut(): Promise<void>;                         // rejects with SignOutFailed

// storedBalance.ts — the record on the phone (D4), idb-keyval in its own store
export function loadStoredBalance(): Promise<Balance | null>;     // null: none, the wrong shape, or a failing store
export function storeBalance(balance: Balance): Promise<void>;    // a failure is ignored
export function forgetStoredBalance(): Promise<void>;             // a failure is ignored

// format.ts — translated from the design system (D10)
export function formatEur(amount: number): string;                          // "286,40 €"
export function formatCzkApprox(eurAmount: number, rate: number): string;   // "≈ 6 960 Kč"
export function czkApproxLabel(eurAmount: number, rate: number): string;    // "přibližně 6 960 Kč"
export function formatUpdated(readAt: Date, now: Date): string;             // "Aktualizováno před 2 min", …

// screenState.ts — what the screen shows (D2, D3, D5, D6, D7), pure
export type Problem =
  | { kind: "bank unavailable" } | { kind: "bank rate limited" } | { kind: "bank access expired" }
  | { kind: "unexpected" } | { kind: "offline" } | { kind: "sign-out failed"; offline: boolean };
export interface Facts {
  session: Session | "waiting";                 // the answer to who is signed in, once it came
  stored: Balance | null;                       // the phone's record, as loaded at start
  balance: Balance | null;                      // the latest read, else the stored one
  reading: "no" | "first" | "refresh";          // a balance read under way
  wait: "short" | "long" | "slow";              // the first load's wait: < 1.5 s, ≥ 1.5 s, ≥ 30 s
  wokeUp: boolean;                              // the first answer took ≥ 1.5 s: the waiting screen stays until data
  problem: Problem | null;                      // the screen's one banner
  signingOut: boolean;
}
export type Shown =
  | { screen: "sign-in"; justSignedOut: boolean }
  | { screen: "no access"; email: string | null }
  | {
      screen: "account";
      account: { name: string; email: string } | null;                  // the menu, once the server named the user
      header: { balance: Balance; refreshing: boolean } | "placeholder" | null;
      banner: Problem | null;
      body: "list" | "waking" | "waking slow" | "offline note" | "offline" | "empty";   // the slot, or a whole-screen state
      signingOut: boolean;
    };
export function shown(facts: Facts): Shown;

// useAccountScreen.ts — the sequence (D2–D6): /api/me then the balance; the 1.5 s and 30 s marks; one read at a time;
// the 60 s cap on a refresh; the stored record loaded at start, written after a read, forgotten on 401/403 and a
// confirmed sign-out; "Zkusit znovu" repeats what failed.
export function useAccountScreen(): {
  shown: Shown; refresh(): void; retry(): void; signOut(): void;
};

// refreshTriggers.ts — return to the screen (the document's visibilitychange to visible) and back online (the window's
// online event), as one signal (D3, D7). The stop function is for React's cleanup: each test renders its own app on the
// same window.
export function watchRefreshTriggers(refresh: () => void, page: Document = document, browser: Window = window): () => void;

// keepAwake.ts — /health on coming on screen and every 4 min while visible and online; stops after 30 min without
// pointerdown or keydown on the document, resumes on the next one with an immediate ask (D9). Timers are
// setTimeout/setInterval, so fake timers drive them.
export const PING_EVERY_MS = 240_000;
export const IDLE_LIMIT_MS = 1_800_000;
export function keepServerAwake(ping: () => void, page: Document = document, network: Network = navigator): () => void;
export function pingServer(): void;   // fetch("/health"), never awaited, failures ignored

// ---- src/RevolutReader.Web/src/components and screens (D10) ----
// BalanceHeader({ amount, rate, readAt: Date, now: Date, refreshing, onRefresh })
// Banner({ tone: "info" | "warning" | "error", title?, children?, action?: { label, onClick, loading? }, icon?: "wifi-off" })
// Button({ …, variant?: "primary" | "secondary" | "ghost", icon? })
// WakingUp({ slow, onRetry })   Skeleton({ variant: "balance" })   EmptyState({ variant?: "default" | "note", title?, children, icon? })
// AccountMenu({ account, onSignOut, signingOut? })   AppShell passes signingOut through
// AccountScreen({ shown, onRefresh, onRetry, onSignOut })   App: install hint, else the screen useAccountScreen picks

// ---- src/RevolutReader.Web/src/test (the test-writer's, group 1) ----
// server.ts gains:
//   - the balance answers: a balance, the three bank problems by type, 401, 403, a 500 problem, a 502 hosting page in
//     plain text, no connection, no answer yet; one per read in order, the last repeating;
//   - `after: <ms>` on any answer, on the test's clock;
//   - requests honour their AbortSignal;
//   - GET /health answers 200;
//   - goOffline() / goOnline(), leaveApp() / returnToApp();
//   - phoneKeeps(balance) and keptBalance(), on a fresh fake IndexedDB per test.
// renderApp.tsx gains reopen(): unmount, then a new launch.
// Scenarios that wait use vi.useFakeTimers (Date included) and userEvent.setup({ advanceTimers }).
```

## Rule ownership

| Rule (spec, ADR or convention) | Enforced by |
|---|---|
| `GET /api/balance` answers exactly `amount`, `readAt`, `czkPerEur` | `BalanceEndpoint`, `BalanceResponse`; the exact shape checked by `BalanceDriver` |
| `readAt` is the server's time of the read; the rate is C13's | `ReadBalanceHandler` (`TimeProvider`, C13's constant) |
| Read as the present user; no browser named → 400 and nothing read | C13's `PresentUserFromRequest.Read`; `BalanceEndpoint` (C13's `BankAnswers.NoPresentUser()` before the handler) |
| A balance in another currency is a bug | `ReadBalanceHandler` (throws) → `UseExceptionHandler` |
| The bank's failures → problem descriptions told apart by `type` | C13's rules, applied by `BalanceEndpoint` |
| An unexpected failure → 500 problem description that reveals nothing | `UseExceptionHandler()` with `AddProblemDetails`; guarded by the `api-errors` scenario |
| Allowed users only | the `AllowedUser` default policy (C6) |
| Never log bank data | no new log line; the exception message names no value; `BankTelemetryTests` unchanged |
| An answer becomes one kind (bank `type` exact, 401, 403, unexpected, offline) | `readBalance`, `readSession` |
| Offline: nothing sent while `navigator.onLine` is false; no answer counts as offline; an error status never does | `readBalance`, `readSession`, `signOut` |
| What the screen shows: the phases, stored or not, placeholder or waking, the banner alone, the offline screens, the menu after `/api/me` | `shown` |
| `/api/me` before the balance; one read at a time; the 60 s cap; "Zkusit znovu" repeats what failed; written after a read; forgotten on 401/403 and a confirmed sign-out | `useAccountScreen` |
| Refresh on return and back online | `watchRefreshTriggers` |
| `/health` every 4 min while visible; stop after 30 idle min | `keepServerAwake` |
| One record; a failing store or a wrong shape reads as none | `storedBalance.ts` |
| Czech formats; koruna rounded to whole crowns | `format.ts` |
| The busy sign-out item | `AccountMenu` |
| Banner tones and roles; one banner | `Banner`; `shown` (one `problem`) |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected outcomes (answers) | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `ReadBalanceHandler.Handle` | `AccountBalance` | `BankAccessExpired`, `BankRateLimited`, `BankUnavailable` (the port's `BankResult` cases, passed on) | `InvalidOperationException` for a balance not in euros; the port's `BankReadException` for an unreadable answer (c004 design.md D4) |
| `GET /api/balance` | 200 `BalanceResponse` | 400 (no browser named), 401, 403 (C6), 429 and 503 ×2 (C13's problem descriptions) | any exception → 500 problem description (`UseExceptionHandler`) |
| `readBalance`, `readSession` | the read kinds | every answer and failure becomes a kind | none; never throw |
| `signOut` | — | — | rejects with `SignOutFailed` (offline or not), as before but typed |
| stored balance | `Balance \| null` | a failing store reads as none | none; never throw |

- **No new Result union:** the handler passes on the port's `BankResult<T>` with its own value type.
- **README.md's case → status table:** C13 adds the bank rows and the `type` column; C7a adds the 500 row ("an unexpected failure: 500, `Internal Server Error`, api-errors / An unexpected failure answers with a problem description that reveals nothing") and the line on the exception handler in § Backend code.

## Ports and contracts

None new or changed. The endpoint uses `IBankAccount` as C5, C12 and C11 left it (spec `bank-reads`); the handler's unit tests use a hand-written stub, which is not a contract fake, so there is no `[integration]` group. On the phone, the browser's IndexedDB is reached through `idb-keyval`; tests use `fake-indexeddb`, which implements the same browser API, so the app's storage code runs unchanged.

## How each scenario is verified

| Scenarios | Level | Why |
|---|---|---|
| `account-balance`: the 6 API scenarios, "The balance comes with the time it was read and the koruna rate" through "A bank that does not answer is its own problem" | API acceptance tests in `Scenarios/AccountBalance/AccountBalanceScenarios.cs`, against the fake bank | the default level; everything they assert is an answer of the API or a request the bank received |
| `api-errors`: "An unexpected failure answers with a problem description that reveals nothing" | API acceptance test in `Scenarios/ApiErrors/ApiErrorsScenarios.cs` | an answer of the API |
| `account-balance`: the 10 screen scenarios, "The account screen shows the balance, its koruna value and when it was read" through "A login that has ended forgets the balance on the phone" | frontend tests in `src/scenarios/account-balance.test.tsx` | what the screen shows and what the phone keeps only the page can show; the server's answers are stubbed, IndexedDB is `fake-indexeddb` |
| `app-shell`: the 10 new scenarios | frontend tests in `src/scenarios/app-shell.test.tsx` | waits, offline and the keep-alive are the page's behaviour; fake timers make the waits instant |
| `sign-in`: the 4 new scenarios | frontend tests in `src/scenarios/sign-in.test.tsx` | as above |

## Cross-cutting effects

- **API contract / TS client:** `GET /api/balance` added; `openapi.json` and `schema.d.ts` regenerated in slice 1, and again whenever the endpoint's description changes (slices 3 and 4).
- **Bicep, AppHost, settings:** none. No new resource, parameter, setting or secret. Vite's config gains the `/health` forwarding.
- **ADRs, each a dated note:**
  - ADR-0007: the rate in the record, deletion on 401 and 403, `idb-keyval`, no owner and no expiry;
  - ADR-0006: the keep-alive while on screen and its cap.
- **Conventions:**
  - README.md § Backend code: the 500 row and the exception handler's place;
  - testing.md § frontend tests: fake timers and `fake-indexeddb` for scenarios that wait or store;
  - their `.claude/rules/` mirrors.
- **Operations:** deployment.md's ready queries checked against the first real bank lines (C12's follow-up), corrected if a column differs.
- **Design:** read only; no change (D5, D10).
- **Software factory** (the next free numbers when written; R-58 was the last on 2026-11-08, and C13 may take more):
  - *(New)* keeping a scale-to-zero server awake only while a client is on screen and in use: a fire-and-forget health ping under the cool-down, with an idle cap;
  - *(New)* the exception handler goes after `UseStatusCodePages` (C13's research), and in-process test hosts rethrow without it;
  - *(New)* a PWA's offline rule: the browser's flag and no answer mean offline; an error status never does, since hosting proxies answer in plain text;
  - inventory lines: the frontend fake server's delays, abort and storage helpers (R-15's row).

## Risks / Trade-offs

- **[A `/health` ask every 4 minutes doesn't keep the replica up]** (the HTTP scale rule's window, or the probe path counting differently) → checked on Azure after the merge (D9). The fallback is a shorter interval, or a real API address such as `GET /api/me`, which also needs no bank.
- **[The keep-alive's cost]:** while the app is on screen and in use, the replica runs at the active rate. Bounded by the cap; the daughter's sessions are minutes long.
- **[Every acceptance request answers 400]:** the in-process test server sets no client address, and the test `HttpClient` sends no `User-Agent` (C13's code review, 2026-11-08, not yet verified). So `BalanceDriver` sends `X-Forwarded-For` and `User-Agent` on every request except the no-browser one, which leaves out `User-Agent` only. Whether `X-Forwarded-For` is applied when the connection has no address at all is probed at the bootstrap; the fallback is a test-only startup filter that sets the connection's address from the driver's header.
- **[C13's merged names or titles differ from this design]** → filled in at the bootstrap. If a title or `type` differs, the account-balance spec is updated and the user told before `/tdd-apply`.
- **[Fake timers and Testing Library deadlock]** (`findBy…` waiting on a frozen clock) → `userEvent.setup({ advanceTimers })` and explicit `advanceTimersByTimeAsync`; the fake server's own delay runs on the same clock. The first frontend slice proves the pattern.
- **[IndexedDB on the iPhone Home Screen app is cleared]** → the app then shows the waking-up or offline screen alone, as on a first open: harmless. WebKit's 7-day storage limit applies to sites in Safari, not to Home Screen apps.
- **[A stored balance shows for a moment before a 401]** (the login ended on the server while the phone still holds it) → the record is forgotten on that 401 and the sign-in screen replaces it within the first answer. Accepted: the same account's data, on the same device, which had a login.
- **[31 slices make a long `/tdd-apply`]** → several slices close only, because earlier slices already turn them green (tasks.md).

## Bootstrap (before `/tdd-apply`, committed as `[setup]`)

1. **After C13 merges:** rebase on `main`, and put C13's merged names into § Public API sketch (the present user, the problem rules, the rate). A title or `type` that differs from the account-balance spec is shown to the user first.
2. **Packages:** `idb-keyval` 6.3.0 and `@radix-ui/react-progress` 1.2.1; `fake-indexeddb` as a dev dependency (6.2.7, or 6.2.8 if its notes show only fixes); the lock file.
3. **Probe:** a balance request through the in-process harness with `X-Forwarded-For` reaches `PresentUserFromRequest` with that address (Risks).
4. **Baseline:** the full suite green, except the traceability check naming this change's 31 new scenarios.

## Migration plan

1. **Before `/tdd-apply`:** C13 merged; the bootstrap.
2. **During it,** after the last frontend slice, a local check with `aspire start --isolated` in a browser:
   - sign in and see the balance from the Mock ASPSP;
   - "Obnovit";
   - offline in DevTools: the offline screen, then the stored balance on reopening;
   - the API stopped: the waking-up screen, then the slow one;
   - the keep-alive's `/health` asks in the network panel.
3. **Before the merge:** the archive in the same PR, as C5 and C6 did.
4. **After the merge:**
   - the deploy runs;
   - the balance at the production address in a desktop browser;
   - the owner compares it once with the Revolut app (C5's follow-up);
   - C12's ready queries are run against the first real bank lines and corrected if a column differs (deployment.md);
   - the keep-alive: with the app open for more than 5 minutes the replica stays up, and about 5 minutes after it closes it scales to zero (the container app's replica count, read-only).

   Findings go into `pm/progress.md` through a small docs PR if they come after the archive.
5. **Rollback:** revert the merge. The endpoint and the screen disappear. A phone keeps its stored record, which the old code neither shows nor deletes. Harmless: the same account's balance, on a device that had a login.

## Open questions

- **Which `fake-indexeddb` patch release:** decided at the bootstrap from its release notes. It changes nothing else.
