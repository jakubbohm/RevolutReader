# Design: c010-add-account-transactions

## TL;DR

- **Pages of whole days** (D1): the newest page is the bank's live 31 days; older pages are about 30 transactions of whole days from storage, never from the bank. The next page loads by itself near the list's end. A refresh replaces the newest page and keeps the older ones. Two endpoints: `GET /api/transactions` and `GET /api/transactions/older?before=` (D10).
- **The newest page fails as a whole** with C13's problem descriptions; nothing stored stands in for it (D2).
- **The live read starts** at the earlier of 31 days back and the newest kept day, at most 89 days back; with nothing kept, 89 days. A longer gap is logged as a warning (D3).
- **What a transaction says** (D4): dates only; the counterparty, else a word for the kind; the bank's text without the line repeating the counterparty, cut on the server; refunds by a type code containing `REFUND`; unknown codes logged; the sheet trimmed to option A with the rate's date. The adapter reads `bank_transaction_code.code` (spec `bank-reads`).
- **The store** (D5): one table, one partition, a row per settled transaction keyed by the bank's reference, with its place within its day. Every request reads the whole table and cuts pages in memory. Every live read writes its settled transactions again, which changes nothing for those already kept.
- **The koruna line from the start** (D6); **the list's own states** before the join (D7); **the join** with C7a's screen, refresh and one banner as the last task group (D8); **the history import** as an explicit check the owner runs once after the deploy (D9).
- **New public interfaces:**
  - `GET /api/transactions`, `GET /api/transactions/older`;
  - `ReadNewestTransactionsHandler`, `ReadOlderTransactionsHandler`, `AddTransactions()`;
  - the port `ITransactionStore`, with its Table Storage adapter;
  - `BankTransaction.TypeCode`;
  - the `Transactions` settings and the `tables` connection;
  - DSL `TransactionsDsl`, driver `TransactionsDriver`, `ScenarioCalendar`;
  - frontend `readNewestTransactions`, `readOlderTransactions`, `useTransactionList`, the list's rules;
  - `TransactionList`, `DayGroup`, `DayHeader`, `TransactionRow`, `TransactionSheet`, `ListEnd`.
- **Integration points:** Enable Banking through the existing port (one more field read); C13's present user, problem rules and rate; the app's storage account (a new table and role, Bicep); Azurite through the AppHost and Testcontainers; C7a's screen, refresh signal and banner (the join); the regenerated TS client.
- **Hard to reverse:** the table's keys (a hash of the bank's reference as the row key, one partition), which the import and every stored row carry; the answer's field names and `kind` values, which the client compares exactly.

## Context

- See proposal.md § Why. Decisions D1–D9 were made with the user in explore (2026-11-08) as one linked round: nothing was written until the whole set was agreed. Details marked *(propose)* were settled while writing this design and follow from them.
- **Backend today:**
  - the port `IBankAccount.ReadTransactions(from, trigger, ct)` returns `BankResult<Transactions>`, booked and pending only, in the bank's order (newest first for Revolut), every page joined, a present user's failed page retried (C11);
  - `BankTransaction` carries reference, status, date, amount, currency, counterparty and payment details, and no type code; `EbTransaction` does not read `bank_transaction_code` (c004 design.md D3 left it out until a screen needs it);
  - C13 (merged 2026-11-08, #57): `PresentUserFromRequest.Read`, `BankAnswers.From`, `BankAnswers.NoPresentUser()`, `ProducesBankProblems()`, `KorunaRate.CzkPerEur` (24.3) and `KorunaRate.Date` (2026-11-08, "C7b's sheet only");
  - no database code, no Azure Storage client; the storage account `strevolutreader` exists (C6) with a blob container only (`infra/platform.bicep:114-150`), and its comment says "C7's tables join this account" (`:109`).
- **Frontend today:** `AccountScreen` is the `AppShell` with an empty content area (`src/screens/AccountScreen.tsx`); `App` picks the screen from `GET /api/me`; `Banner` has the error tone only; the test kit's fake server knows `GET /api/me` and the sign-out.
- **C7a** (running alongside in `c009-add-account-balance`, in `/tdd-apply` as of 2026-11-08; its design.md D7 and two messages to this session): the account screen, its refresh signal, its one banner, the list slot, `Skeleton` (balance only) and `EmptyState` (note only) in `src/components/`, `Banner`'s info and warning tones with an action, `src/app/format.ts`, `Dsl/ProblemDescription.cs` with `Type`. C7b builds the list's own files and joins after C7a merges (D8, D13).
- **The bank's data, from the M1 history file** (counts only, the owner's go, 2026-11-08; 116 settled transactions): type codes `CARD_PAYMENT` 100 (all out), `TOPUP` 12 (all in), `TRANSFER` 2, `ATM` 1, `EXCHANGE` 1; no refund, no `sub_code`, `description` empty on all. The text left after dropping the counterparty line: 2 of 100 card payments, all 12 top-ups (up to 2 lines), both transfers, the withdrawal and the exchange. No counterparty on 1 top-up, the withdrawal and the exchange. Dates are calendar dates (c004 design.md D3).
- **Design** (read 2026-11-08, after the design loop for D4 and D14 ran that evening): the design system at version `1794168063-3f72`, its `TransactionRow`, `TransactionSheet`, `DayHeader`, `ListEnd` (new), `EmptyState`, `Skeleton`, `src/tx.ts` (new) and `src/format.ts`; the Screens design at version `1794169491-5406`, whose pinned copy of the design system is that same version, so no loop is pending. Its boards "Account / Detail / Scrolled", "Loading older", "Loading older failed", "End of history", "Empty", "Loading" and "Account / Transaction sheet / Default" ("Option B – compact" deleted in the loop).

## Goals / Non-Goals

**Goals:**

- The 40 scenarios of the two delta specs, each verified at the level § How each scenario is verified gives.
- The history since 2026-08-09 in the deployed table, the M1 file deleted (D9).
- A list that joins C7a's screen without reworking either side's code (D8, D13).

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- **No in-memory fake of `IBankAccount`:** the handlers' unit tests use a hand-written stub of it, as C7a's do. The store has an in-memory fake, because it is a port of ours (§ Ports and contracts).
- **No cache of the newest page on the server or the phone:** every newest page is live (ADR-0001 item 1), and the phone never keeps transactions (ADR-0007).
- **No date-range queries on the table** (D5).
- **No React state library, router or list virtualisation:** a few hundred rows at most.

## Bootstrap (before `/tdd-apply`, committed as `[setup]`)

1. **The design loop has run** (§ Migration plan, step 1). *Done 2026-11-08:* its answer is in these artifacts (D1, D4, D10, D14): the sheet's subtitle is the kind's word, the "Vrácení" chip only before the bank's text, the counterparty's line matched ignoring case, accents and spacing, `ListEnd` with "Žádné starší pohyby" at the end, only its button retrying, and the design's `kind` names. The user agreed to them, choosing the design's button-only retry.
2. **Packages** (versions in proposal.md § Impact): `Aspire.Azure.Data.Tables` in the API, `Aspire.Hosting.Azure.Storage` in the AppHost, `Testcontainers.Azurite` in the acceptance and integration projects, `@radix-ui/react-dialog` in the frontend; the lock files.
3. **Probes,** throwaway, deleted afterwards:
   - Azurite 3.37.0 starts through Testcontainers on this machine and in a CI-like run, and a `TableServiceClient` from its connection string creates a table and upserts a row;
   - the Aspire client integration with health checks off adds nothing to `/health` (spec `service-health`: health never touches storage), and reports at start, with a message naming the setting, when `ConnectionStrings:tables` is missing;
   - the explicit OpenAPI export check (`OpenApiExport`) starts with a made-up tables connection.
4. **Baseline:** the full suite green, except the traceability check naming this change's 40 new scenarios.

**Done 2026-11-08** (the user's go):

1. The design loop, as item 1 says.
2. Packages: `Aspire.Azure.Data.Tables` 13.6.4 (API), `Aspire.Hosting.Azure.Storage` 13.6.4 (AppHost), `Testcontainers.Azurite` 4.16.0 (acceptance and integration tests), `@radix-ui/react-dialog` 1.3.1 (frontend), each still unused. `npm audit` reports the same six findings as before, all in the build tooling (`vite-plugin-pwa` through `workbox-build`), none in the new package.
3. The probes, throwaway tests deleted afterwards:
   - Azurite 3.37.0 starts through Testcontainers (Docker 29.6.2, with Testcontainers' own reaper container), and a `TableServiceClient` from its connection string creates a table, writes a row whose key holds an escaped `/` and reads it back;
   - the API with `AddAzureTableServiceClient` and no `ConnectionStrings:tables` still starts, and `/health` answers as before: the client checks its connection only when first resolved, then throwing `InvalidOperationException` naming the setting. So `AddTransactionStore` checks the setting at registration (D11; tasks 5.10–5.12);
   - the OpenAPI export check runs with the client registered and leaves `openapi.json` unchanged.
4. The baseline: build with no warning; `dotnet test` 720 of 721, the one red the traceability check naming exactly the 40 new scenarios; frontend 53 of 53; lint, type check, Prettier, the frontend build and `dotnet format` clean.

## Decisions

> Made in `/opsx:explore` (2026-11-08), as one linked round with the user (D1–D9). D10–D15 collect what those decisions imply and were written in `/opsx:propose`; the propose-time details are marked *(propose)*.

### D1 — Pages of whole days; the newest page is the live window

- **The user's rule:** pages of about 30 transactions, always cut at a day's end: the transactions of one day never split across pages.
- **The newest page is the live read's last 31 days** (option A in explore), however many transactions that is (about 40 at the history's rate of 1.3 a day). Pending transactions are always on it, because they exist only in the live read.
- **Older pages come from storage only,** about 30 transactions of whole days each, with no bank call: days are added, newest first, until the page holds at least 30 transactions or nothing older is left. A busy day can make a page longer; it is never split.
- **The next page loads by itself** when the end of the list comes near (option "automatic" in explore): an `IntersectionObserver` watches a marker under the last day, with a margin so that it starts before the end shows. The design system's `ListEnd` shows the state (D14): "Načítám starší pohyby" while older pages may exist; a failed page leaves "Starší pohyby se nepodařilo načíst" with "Zkusit znovu"; where the history ends, "Žádné starší pohyby", and nothing more is asked. **After a failure only "Zkusit znovu" tries again,** never scrolling or the phone coming back online (the design: a dead connection would loop; the user chose it over C7a's `online` rule after the design loop, 2026-11-08). Offline, nothing is sent and the failed row shows at once (C7a's rule for sending). Rejected: a "Načíst starší" button (one more tap per 30 transactions), and numbered pages.
- **A refresh replaces the newest page only;** older pages already loaded stay, because the boundary between them is a fixed date. *(propose)* The rule that keeps this true when a refresh comes on a later day: after a refresh, the list holds the new newest page plus every day already shown that is older than the new page's `olderBefore`; when `olderBefore` is null, the new page alone. The cursor for the next older page stays the last one loaded. So a day that fell out of the live window between two refreshes stays from the earlier answer.

### D2 — The newest page fails as a whole

- When the live read fails, `GET /api/transactions` answers C13's problem description for the case and no transactions (option A in explore). A list already on the screen stays during a failed refresh (D8). On a fresh launch with the bank down, the screen shows the banner and no list (with C7a, the stored balance above it).
- **Rejected:** answering the stored transactions with a "live part missing" marker. Stored transactions without the pending ones and the last days would look complete when they are not, and the screen would need a state the design does not draw.

### D3 — Where the live read starts

- **Start** = the earlier of 31 days before today and the newest day of the kept transactions, but never earlier than 89 days before today (the user, option A). The newest kept day is read again, because more of its transactions may have settled since.
- **Why:** after a pause longer than 31 days (or a deploy later than about 2026-12-05, roadmap C7b notes), the read reaches back to close the gap while the bank still serves those days (90 days; 89 leaves a day for the bank's UTC dates).
- **Only the newest page's 31 days are shown;** the extra days are only kept, and appear on older pages.
- **A gap longer than 89 days** (the newest kept day earlier than 89 days before today) is logged as a warning, with the number of days and no bank data: those days are lost unless a history file covers them. The number is the gap's length, from the newest kept day to today (always more than 89 when logged; 92 for 2026-08-20 on 2026-11-20), as the sketch's `GapDays` reports it (settled in group 24).
- **With nothing kept, the read starts 89 days back** (the explore summary, shown to the user, no objection): the first open after the deploy, before the import, keeps as much as the bank serves.
- *(propose)* **Today** is the UTC date of the app's `TimeProvider`, as Enable Banking reads dates (spikes/enable-banking/export-history.ps1, line 21). The screen's day headings use the phone's date (D14).

### D4 — What a transaction says

- **(a) No time of day anywhere.** Enable Banking's dates are calendar dates (c004 design.md D3 heads-up 1). The row's second line loses its `· 14:05`, the sheet's date its time, and the spoken label its time (design loop). The order within a day is the bank's (newest first), kept in storage as a position within the day (D5).
- **(b) The row's two lines** (the user):
  - line 1: the counterparty, else the word for the kind;
  - line 2: the bank's text, its lines joined by " · " and cut with an ellipsis; with nothing left, the kind's word unless line 1 shows it already (then line 1 alone, centred);
  - pending: line 2 is "Čeká na zpracování" (the design system).
  - **The kind's words:** `CARD_PAYMENT` "Platba kartou", `TOPUP` "Dobití účtu", `TRANSFER` "Převod", `ATM` "Výběr z bankomatu", `EXCHANGE` "Směna měny", a refund "Vrácení peněz"; any other code "Příchozí platba" or "Odchozí platba" by direction (the design system's `KIND_WORD` and `kindWord`).
  - **The bank's text** is the payment details without blank lines and without any line that repeats the counterparty, compared ignoring letter case, accents and spacing, each kept line with its runs of spaces collapsed (the design system's `descriptionLines`, after the design loop: "PEKARNA U LIPY" repeats "Pekárna U Lípy"). 100 of 116 history transactions carry such a line (c004 design.md D3; the explore check compared ignoring case). *(propose)* The server cuts it, so the answer carries only what the screen shows (openspec/config.yaml, specs rule).
  - This needs the type code, so `bank-reads`' "What a transaction carries" gains it: `bank_transaction_code.code`, unchanged, possibly missing.
- **(c) Refunds:** a type code containing `REFUND` (ordinal, ignoring case) is a refund: the `undo-2` icon, the sheet's "Vrácení peněz" and "Vráceno na účet" (the user), and the "Vrácení" chip before line 2 when line 1 is the counterparty and line 2 the bank's text, so that no line says "Vrácení" twice (the design loop). Revolut's API reference lists `REFUND` and `CARD_REFUND` types (search summary only; developer.revolut.com answered 403 on 2026-11-08), and the history holds none, so this is the change's riskiest assumption. A wrong guess shows a refund as a plain incoming payment. **Every code the server does not know is logged** as a warning, the code itself only when it looks like one (`^[A-Z0-9_]{1,40}$`), otherwise "a code that does not look like one"; a missing code is logged too. Only the newest page logs, and once per page for each thing it reports: each distinct unknown code once, however many transactions carry it; a code that does not look like one once; a missing code once, with no count (the user, 2026-11-09: about 40 identical warnings per refresh otherwise). **A code containing `REFUND` is shown as a refund and still logged** (the user, 2026-11-09), as the warning `RefundTypeCode` carrying the code, once per distinct code per page (one that does not look like a code, such as `card_refund`, is logged as `TypeCodeNotLikeACode` instead, unquoted like any other), so that the first real refund in the logs confirms the guess; dropping that line once it has is a one-line change.
- **(d) The sheet:** option A, trimmed (the user), now the Screens design's "Transaction sheet / Default":
  - the title is the row's line 1; under it the kind's word, left out when the title already is that word (the design loop; it replaced "Odchozí platba" / "Příchozí platba" / "Vrácení peněz");
  - "Stav": "Zaúčtováno", "Vráceno na účet", or the "Čeká na zpracování" chip;
  - "Datum": the date only ("18. 11. 2026");
  - "Popis": the bank's text in full, line by line, only when there is any (option A drew it always);
  - "Přepočet na koruny": "1 € ≈ 24,30 Kč · orientační kurz z 8. 11. 2026", with `KorunaRate.Date`, kept as drawn (the user, after Claude first said wrongly that C13's rate had no date);
  - "Komu / Od koho": dropped, since the title already names the counterparty.
- **A transaction in another currency** *(propose)*: its amount shows with its ISO code ("12,30 USD") and no koruna line (C13's `KorunaRate` note). The account has had one currency since 2026-08-09, so this is a guard with unit tests, not a scenario.

### D5 — The store: one table, read whole

- **Table `transactions`** in `strevolutreader`, one partition (`account`), one row per settled transaction (the user, "simple").
  - **Row key:** the SHA-256 of the bank's `entry_reference` (its UTF-8 bytes), in lowercase hex: 64 characters, only `0-9a-f` (the user, 2026-11-09). Table Storage forbids `/`, `\`, `#` and `?` in keys, and escaping would put `%` in them, which an older Azure Storage report says causes trouble; a hash has neither, whatever the reference holds. The reference is kept unchanged in its own column, which is what every read uses. Revolut's references have none of these characters as far as the history shows, but nobody promised it. Changing this later would mean rewriting every stored row, so it is decided before the first one is written.
  - **Columns** *(propose)*: `Reference`, `Date` (`yyyy-MM-dd`), `Position` (its place within its day in the bank's order, 0 first), `Amount` (invariant decimal string: tables have no decimal type), `Currency`, `Counterparty`, `Details` (the bank's lines as a JSON array, unchanged), `TypeCode`. The kind and the shown text are worked out when answering, so a later rule change needs no migration.
- **Every request reads every row** and cuts its page in memory (a few hundred rows; ADR-0005's "Tables answer key lookups only … the data is small enough"). So ADR-0005 item 4, "keyed so that a date range is a key query", gets a dated amendment.
- **Every live read writes its settled transactions again,** each day of its range in full with its positions: an upsert by key, so writing one again changes nothing, and two phones reading at once write the same rows. Pending transactions are never written (ADR-0001 item 6).
- *(propose)* **A settled transaction without a reference** is shown but not kept, and logged as a warning (count only). Revolut's settled transactions all carry one (the history; c004 design.md D3); it is a guard, not a scenario.
- *(propose)* **Storage failing** (unreachable, refused) is an exception, so the request answers C7a's 500 problem description and the screen shows "Pohyby se nepodařilo načíst" (unexpected). The live read is not answered without its write: a page that cannot be kept would come back missing later.
- *(propose)* **The table is created by Bicep** in Azure. The adapter also creates it if it is missing, once per process, so Azurite works locally and in tests without a step; the app's role (Storage Table Data Contributor) allows it.

### D6 — The koruna line from the start

- Both answers carry `czkPerEur` and `rateDate` (C13's constant and its date), and the rows show the koruna line from the first frontend slice (the user, option A). The design system's rounding: whole koruna, the size only, half up, done once on the screen (C13).
- **This changes the roadmap's "Working in parallel" item 4,** which put the koruna line into the last task group; the last group is now the join only. Logged in `pm/progress.md`'s change log at this propose.

### D7 — The list's own states before the join

The list builds and tests its own states on today's empty account screen (the user, option "the list's own states"; texts from the Screens design and C7a's D5):

| Case | What shows |
|---|---|
| loading, server awake | `Skeleton` list variant, announced "Načítám pohyby" |
| no transactions | `EmptyState` defaults: "Zatím žádné pohyby" / "Jakmile proběhne první platba, uvidíš ji tady." |
| access expired | error banner "Propojení s bankou vypršelo" / "Obnovit propojení musí táta, dej mu prosím vědět.", no button |
| request limit | warning banner "Příliš mnoho obnovení" / "Banka teď další dotazy nepřijímá. Zkus to znovu později.", no button |
| bank unavailable | error banner "Pohyby se nepodařilo načíst" / "Banka teď neodpovídá. Zkus to prosím za chvíli." with "Zkusit znovu" |
| anything else | error banner "Pohyby se nepodařilo načíst" / "Zkus to prosím za chvíli." with "Zkusit znovu" |
| offline (nothing sent, or no answer within 60 s) | the note "Pohyby se načtou, jakmile budeš online."; loads again on the `online` event |

- **401 and 403** count as "anything else" until the join, where C7a's handling takes them (the sign-in or no-access screen).
- **Offline at opening, before the join** (the user, at the acceptance gate, 2026-11-08): `GET /api/me` fails too, and today's `App` shows the account screen with the session unknown and never asks again. So the list's offline rule is its own until the join: while the phone says it is offline, the list shows its note and sends nothing, even with the session unknown, and reads on `online`. At the join C7a's offline handling takes over (D8). Accepted, never shipped: before the join, someone signed out who opened the app offline sees the unexpected-answer banner instead of the sign-in screen. Rejected: `App` asking `/api/me` again on `online` (C7a's file and work).
- **C7a's request rules apply** (its D2, D3): `GET /api/me` first, then the list's request; offline means the phone says so or no answer came, never an error status; `online` repeats what was under way; never two reads of the newest page at once; a 60 s cap through `setTimeout` and an `AbortController`, so fake timers drive it.
- These banners keep their texts at the join for a failure of the list alone, so their scenarios hold before and after it.

### D8 — The join with C7a (the last task group)

After C7a merges, the branch takes `main` (memory: merge the earlier PR's tip before it squashes, then prove the delta unchanged) and the list joins C7a's screen (the user):

- **The slot:** the list goes into C7a's list slot under the header. A fresh start while the server wakes, with a stored balance: C7a's "Server se probouzí" holds the slot until the newest page comes, and the list then replaces it directly, with no placeholders. A fresh start offline: C7a's note. Once a list is on screen, it stays through every reload (waking, failing, offline) under the banner, with its older pages.
- **The refresh:** the list follows C7a's one refresh signal ("Obnovit", every return, back online); both requests go out together. "Obnovuji…" waits for both answers.
- **One banner, by precedence:** C7a's 401 and 403 screens above everything; then offline; access expired; the request limit; bank unavailable (when both failed, C7a's wording "Banka teď neodpovídá"; the list alone, the list's wording); the balance's unexpected answer ("Zůstatek se nepodařilo načíst"); the list's unexpected answer. A failed sign-out stays above until the next action (C7a's D6). "Zkusit znovu" reloads both. A failed older page stays in its own row and never takes the banner.
- **The list's offline note** gives way to C7a's offline handling (the "Jsi offline" banner with the note in the slot, or C7a's whole offline screen with nothing stored).
- **The pre-join tests** of the list's states get C7a's server setup (a balance answer, and the stored balance where the scenario says the phone keeps one), so their scenarios hold unchanged.

### D9 — The history import

- **An explicit check,** like Check 1 and Check 2, run once by the owner after the merge deploys (the user): `HistoryImport` in the integration project, never in the default run.
  - It reads the M1 file from the main checkout (`spikes/enable-banking/secrets/transactions-2026-11-04.json`: the raw Enable Banking pages, `{exported_utc, history_start, date_from, accounts:[{account, pages:[{transactions, continuation_key}]}]}`).
  - It runs every page through the adapter's own `EbTransactionPage` reading and `TransactionMapping`, keeps the settled transactions dated from 2026-08-09 with their positions within the day, and writes them through the real Table adapter to the deployed table, with the owner's Azure login.
  - It prints counts only (read, settled, kept, days skipped). Running it twice changes nothing (upserts).
- *(propose)* **It never touches a day the table already holds, nor the export's own day,** which the file may hold only in part: positions within a day must come from one complete read. The live reads fill those days (D3). It imports only days before the earlier of the export's day and the oldest kept day.
- **Tested against Azurite** with a made-up file of the same shape, in the default run.
- **The owner's access:** a temporary Storage Table Data Contributor on the storage account for the owner's own account (as the app's role, D11: the import writes through the same store, which creates its table if missing; 2026-11-09). Claude gives the PowerShell 7 block (subscription named, the principal looked up at run time, no personal ID in the repository); the owner runs it; Claude checks read-only; the same for the removal afterwards (memory: Azure grants are run by the owner).
- **Then the owner deletes the file and its backup** (the backup Claude suggested on 2026-11-08, since from 2026-11-09 the file is the only copy of the oldest days). `pm/progress.md` records the counts and the deletion.

### D10 — The API contract *(propose)*

- **Two endpoints,** not one with an optional parameter: they differ in what they read (the bank or storage), in who must be present (only the live read needs the user's address and browser), and in their failures (only the live read has bank problems). Both are for allowed users (the `AllowedUser` default policy).
  - `GET /api/transactions`: the present user through C13's `PresentUserFromRequest.Read`, or C13's 400; then the handler's result through `BankAnswers.From`. Description: 200, 401, 403 and 500, plus `ProducesBankProblems()`.
  - `GET /api/transactions/older?before=yyyy-MM-dd`: `before` is required, a calendar date; anything else answers 400 with a problem description (FastEndpoints' validation, as `api-errors`' unreadable requests). Description: 200, 400, 401, 403, 500.
- **The answer** (both):

  ```json
  {
    "transactions": [
      { "date": "2026-11-19", "amount": -8.90, "currency": "EUR", "pending": true,
        "counterparty": "Kavárna Na Rohu", "details": [], "kind": "card" }
    ],
    "olderBefore": null,
    "czkPerEur": 24.3,
    "rateDate": "2026-11-08"
  }
  ```

  - `kind` is one of `card`, `topup`, `transfer`, `atm`, `exchange`, `refund`, `other`, the design system's `TxKind` names (the design loop), a string enum like C13's `BankProblemType`, so `schema.d.ts` carries the literals and a renamed value fails the type check;
  - `olderBefore`: on the newest page, the first day of the live window when anything older is kept; on an older page, the page's oldest day when anything older is kept; otherwise null. The client asks `older?before=<olderBefore>`.
- **The window:** the newest page holds the live transactions dated on or after 31 days before today (2026-10-20 for 2026-11-20).

### D11 — Settings, AppHost and Bicep *(propose)*

- **Settings:**
  - `ConnectionStrings:tables`, read by `Aspire.Azure.Data.Tables` (`AddAzureTableServiceClient("tables")`): Azurite's connection string locally and in tests; in Azure, the table endpoint, reached with `DefaultAzureCredential`, which picks the app's managed identity through `AZURE_CLIENT_ID` (as Data Protection does). Not a secret. Health checks off, although `/health` is the app's own endpoint and runs no health check. The client checks its connection only when it is first resolved (the bootstrap's probe: the app starts without it, and the first use throws `InvalidOperationException` naming `ConnectionStrings:tables`), so `AddTransactionStore` checks at registration that it is set and throws, naming the setting and never its value, as `AddDataProtectionKeys` does. A missing setting then stops the app at start instead of answering 500 on the first transactions request.
  - `Transactions:TableName`, default `transactions`, validated on start (3–63 letters and digits, starting with a letter), so each acceptance test can use a table of its own (D12).
- **AppHost:** `AddAzureStorage("storage").RunAsEmulator()` with `AddTables("tables")`, referenced by the API, which waits for it. Azurite runs in Docker, which local development and the tests need already.
- **Bicep** (`infra/platform.bicep`, `main.bicep`, `features.bicep`):
  - the table service and the table `transactions` under the existing account;
  - the app identity's Storage Table Data Contributor on the storage account, so on all its tables but nothing else (the deploy identity may grant it: `docs/operations/azure-prerequisites.md` step 5). The user, 2026-11-09: the app creates its table if missing on first use, and whether a role scoped to the one table allows that call is not documented; the account scope surely does, the app is the only user of the account's tables, and C8a's table in the same account needs the same role;
  - the account's table endpoint as an output, passed on and set on the container app as `ConnectionStrings__tables`.
- **No secret, no hand-provisioned value:** the app reaches the table with its managed identity, and shared keys stay off.

### D12 — Tests *(propose)*

- **Azurite for real in the acceptance harness** ("fake only what you don't own", testing.md § Defaults): one Azurite container per test session (Testcontainers, the image pinned to `3.37.0`), and a table of its own for each app copy (`Transactions:TableName` = a unique name from the DSL), so tests stay isolated without cleanup.
- **Scenario dates are relative to the test clock.** The harness clock starts at the real time and can only move forward (the fake Microsoft's tokens are checked against the real clock, testing.md), so a scenario's "today is 2026-11-20" cannot be set. `ScenarioCalendar` maps a scenario's dates onto the clock: the scenario's today is the clock's today, and every other date keeps its distance in days. The fake bank receives the shifted dates, and the driver shifts the answers back. The rules count days only, so the scenario's claims hold unchanged.
- **The store's contract tests** run the in-memory fake and the Table adapter (on Azurite) against the same tests (§ Ports and contracts). The fake lives in the unit-test project; the integration project compiles the same file as a link.
- **The frontend's `IntersectionObserver`:** jsdom has none, so the test kit installs a stand-in whose `scrollToEnd()` reports the marker as visible. The scenarios use fake timers for the 60 s cap and `vi.setSystemTime` for "today".
- **Dates on the phone:** the client reads `yyyy-MM-dd` as a local calendar date (never `new Date("2026-11-18")`, which is UTC midnight and the previous day west of Greenwich).
- **A guard for the logs** (`Conventions/TransactionTelemetryTests`): an unknown type code logs one warning with the code and no other field; a code that does not look like one is not quoted; no captured line holds a counterparty, an amount or a detail.

### D13 — Seams with C7a at the rebase *(propose)*

- **Own files:** backend `Account/Transactions*` and `Storage/`; acceptance `TransactionsDriver` and `TransactionsDsl` (C5's `BankDsl` and `FakeBank` are used as they are, plus a type code on `TransactionAtBank`, which C7a does not touch); frontend `app/transactions*.ts`, `useTransactionList.ts` and the list's components.
- **Built to C7a's published props, so the rebase takes C7a's version:**
  - `Banner`: the warning tone and an optional `action` (`{ label, onClick, loading? }`), as C7a's design sketches them; C7b's action is a plain ghost-styled button inside `Banner`, so `Button` stays untouched;
  - `Dsl/ProblemDescription.cs`: `Type`, and the three bank values, as C7a sketches them.
- **Merged by hand at the rebase** (add/add or both-edited):
  - `Skeleton.tsx` and `EmptyState.tsx`: C7a's file plus the list variant and the default variant, behind C7a's `variant` prop;
  - `src/app/format.ts`: one copy of `formatEur`, `formatCzkApprox`, `czkApproxLabel`, plus C7b's `formatDayHeader`, `formatDate`, `formatRate` and the signed amount;
  - `App.tsx` and `AccountScreen.tsx` (the join, D8); `src/test/server.ts` (both sets of answers); `Drivers/AcceptanceTest.cs`; `Program.cs` (one registration line each);
  - `package.json` and its lock file; `openapi.json` and `schema.d.ts`, regenerated, never merged line by line; `pm/progress.md`.

### D14 — Screens and components *(propose, from the Screens design and the design system)*

- **Boards implemented** (Screens design `1794169491-5406`): "Account / Detail / Scrolled", "… / Loading older", "… / Loading older failed", "… / End of history", "… / Empty", "… / Loading" (the list's half), "… / Error – bank unavailable, no data" (the list's wording), and "Account / Transaction sheet / Default".
- **Components in `src/components/`,** rebuilt with Tailwind on the existing tokens; no new token:
  - `TransactionRow` (new): the icon disc by kind and status, the two lines (D4b), the amount with its sign and the koruna line, the "Vrácení" chip (D4c); a button whose `aria-label` reads what the row shows, in order: line 1, the chip, line 2, the amount, the spoken koruna, without a time ("Pekárna U Lípy, Praha 2, −12,30 €, přibližně 299 Kč");
  - `DayHeader` and `DayGroup` (new): `formatDayHeader`, sticky under the top bar, `h2`, the day's totals by `dayTotals` (in whole cents, pending ones counted, refunds as received) with their spoken twins "Příchozí …" and "Odchozí …";
  - `TransactionSheet` (new): Radix `Dialog`, `@radix-ui/react-dialog` 1.3.1 (MIT, React 19 among its peers, published 2026-10-12, checked 2026-11-08), behind the component as the oxlint rule requires; focus to the sheet on open and back to the row on close;
  - `TransactionList` (new): the day groups, the marker for the next page, and the end rows;
  - `ListEnd` (new in the design system, the loop): `state` `loading | error | end` — "Načítám starší pohyby" with a spinner, "Starší pohyby se nepodařilo načíst" with a ghost "Zkusit znovu", and "Žádné starší pohyby"; one `p` with `aria-live="polite"` and `aria-atomic="true"` kept mounted across the states (announced as `role="status"` would be; the role itself is left out because the account screen's signed-out note is the one `status` there, which C7a's tests find by role; 2026-11-09), focus to it when "Zkusit znovu" is tapped; `overflow-anchor: none`; the observer on it with `rootMargin: '0px 0px 100% 0px'`, one request at a time; never shown with `EmptyState`, `WakingUp` or the offline note;
  - `Skeleton` (list variant, 4 rows, "Načítám pohyby") and `EmptyState` (default variant), to C7a's props (D13);
  - `Banner` (warning tone and action, D13).
- **Formats and text rules** (`src/app/format.ts`, `src/app/transactionText.ts`): translated from the design system's `format.ts` (`localDate`, `formatDate`, `formatDayHeader`, `formatRate`, the euro and koruna formats) and `tx.ts` (`kindWord`, `rowLines`) into the app's code (workflow.md § 8), not copied as they are, whatever their headers say. `descriptionLines` runs on the server instead (D4b), and `formatTime` stays C7a's.
- **The design loop** ran on 2026-11-08 (§ Migration plan, step 1); no new token, one new component (`ListEnd`).

### D15 — One change, sliced per scenario *(propose)*

- **40 scenarios,** more than C7a's 31: 15 API, 19 screen before the join, 5 at the join, 1 in `bank-reads`. Many slices only close, because an earlier slice turned them green (tasks.md).
- **Order:** the adapter's type code first; then the newest page with the store, the harness and the client; the API's rules; the screen; the older pages; deployment and the import; the join last, after C7a merges.
- **No manual scenario.** The deployed checks and the import are close-out steps (§ Migration plan).

## Public API sketch

```csharp
// ---- src/RevolutReader.Api/Bank/ (bank-reads) ----

/// <summary>Gains the bank's type code: bank_transaction_code.code, unchanged; null when the bank gives none.</summary>
public sealed record BankTransaction(
  string? Reference, TransactionStatus Status, DateOnly Date, decimal Amount, string Currency,
  string? Counterparty, IReadOnlyList<string> PaymentDetails, string? TypeCode);

/// <summary>EbTransaction gains BankTransactionCode; only its code is read.</summary>
public sealed record EbBankTransactionCode(string? Code);
// EbTransaction(..., IReadOnlyList<string>? RemittanceInformation, EbBankTransactionCode? BankTransactionCode)

// ---- src/RevolutReader.Api/Account/ (C13's folder; C7a's Balance* files beside these) ----

/// <summary>A transaction's kind (D4), written in the answer as card, topup, transfer, atm, exchange, refund or other (the
/// design system's TxKind), each through JsonStringEnumMemberName, as C13's BankProblemType.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<TransactionKind>))]
public enum TransactionKind { CardPayment, TopUp, Transfer, CashWithdrawal, Exchange, Refund, Other }

/// <summary>The kind of a type code (D4): the five known codes; any code containing REFUND, ignoring case; else Other.</summary>
public static class TransactionKinds {
  public static TransactionKind Of(string? typeCode);
  public static bool IsKnown(string? typeCode);                 // the five codes only; false → the handler logs it, a REFUND code as RefundTypeCode (D4c)
  public static bool LooksLikeACode(string? typeCode);          // ^[A-Z0-9_]{1,40}$ → quoted in the log
}

/// <summary>The bank's lines without blank lines and without any line repeating the counterparty, compared ignoring
/// letter case, accents and spacing; runs of spaces in a kept line collapsed (D4b, the design system's descriptionLines).</summary>
public static class TransactionText {
  public static IReadOnlyList<string> Details(string? counterparty, IReadOnlyList<string> paymentDetails);
}

/// <summary>A settled transaction as kept (D5).</summary>
public sealed record KeptTransaction(
  string Reference, DateOnly Date, int Position, decimal Amount, string Currency,
  string? Counterparty, IReadOnlyList<string> PaymentDetails, string? TypeCode);

/// <summary>The store of settled transactions (§ Ports and contracts).</summary>
public interface ITransactionStore {
  /// <summary>Every kept transaction, newest day first, by position within a day.</summary>
  Task<IReadOnlyList<KeptTransaction>> ReadAll(CancellationToken cancellationToken);
  /// <summary>Inserts or replaces each by its reference; keeping one again changes nothing.</summary>
  Task Keep(IReadOnlyList<KeptTransaction> transactions, CancellationToken cancellationToken);
}

/// <summary>The page rules (D1, D3), pure.</summary>
public static class TransactionPaging {   // not the adapter's Bank.TransactionPages
  public const int WINDOW_DAYS = 31;
  public const int MOST_DAYS_BACK = 89;
  public const int PAGE_SIZE = 30;
  public static DateOnly WindowStart(DateOnly today);                                      // today − 31
  public static LiveReadStart LiveReadStart(DateOnly today, DateOnly? newestKeptDay);       // D3
  /// <summary>Settled ones with a reference, each with its position within its day in the given order; pending ones and
  /// those without a reference left out (the latter counted).</summary>
  public static ToKeep ToKeep(IReadOnlyList<BankTransaction> live);
  /// <summary>Whole days before <paramref name="before"/>, newest first, until ≥ PAGE_SIZE; OlderBefore as D10.</summary>
  public static OlderPage Older(IReadOnlyList<KeptTransaction> allNewestFirst, DateOnly before);
}
public sealed record LiveReadStart(DateOnly From, int? GapDays);   // GapDays when the newest kept day is beyond 89 days
public sealed record ToKeep(IReadOnlyList<KeptTransaction> Transactions, int WithoutReference);
public sealed record OlderPage(IReadOnlyList<KeptTransaction> Transactions, DateOnly? OlderBefore);

/// <summary>A transaction as the app shows it, and a page of them (D10).</summary>
public sealed record ShownTransaction(DateOnly Date, decimal Amount, string Currency, bool Pending,
  string? Counterparty, IReadOnlyList<string> Details, TransactionKind Kind);
public sealed record TransactionPage(IReadOnlyList<ShownTransaction> Transactions, DateOnly? OlderBefore,
  decimal CzkPerEur, DateOnly RateDate);

/// <summary>
/// The newest page (D1–D5): the store's rows → LiveReadStart → the bank, as the present user → keeps ToKeep → the live
/// transactions dated from WindowStart, shown; OlderBefore = WindowStart when a kept one is older, counting those this
/// read has just kept (D3: the extra days are kept to appear on older pages, so the first open, reading 89 days with
/// nothing kept, already names the window's start). Bank failures pass through; nothing is kept then. Logs: a gap beyond 89 days, settled ones without a reference, unknown type codes.
/// </summary>
public sealed class ReadNewestTransactionsHandler(IBankAccount bank, ITransactionStore store, TimeProvider time,
  ILogger<ReadNewestTransactionsHandler> logger) {
  public Task<BankResult<TransactionPage>> Handle(PresentUser user, CancellationToken cancellationToken);
}

/// <summary>An older page from the store only (D1); never reads the bank. Logs no type codes: only the newest page does, for the transactions it shows (D4c).</summary>
public sealed class ReadOlderTransactionsHandler(ITransactionStore store) {
  public Task<TransactionPage> Handle(DateOnly before, CancellationToken cancellationToken);
}

/// <summary>Source-generated log lines (D3, D4c, D5): numbers and code-shaped type codes only, never bank data.</summary>
public static partial class TransactionsLog {
  public static partial void HistoryGap(ILogger logger, int days);                    // Warning
  public static partial void SettledWithoutReference(ILogger logger, int count);      // Warning
  public static partial void UnknownTypeCode(ILogger logger, string code);            // Warning
  public static partial void RefundTypeCode(ILogger logger, string code);             // Warning, until a real refund confirms D4c's guess
  public static partial void TypeCodeNotLikeACode(ILogger logger);                    // Warning
  public static partial void NoTypeCode(ILogger logger);                              // Warning
}

/// <summary>GET /api/transactions (D10).</summary>
public sealed class NewestTransactionsEndpoint(ReadNewestTransactionsHandler handler) : EndpointWithoutRequest<TransactionPageResponse>;
/// <summary>GET /api/transactions/older?before= (D10).</summary>
public sealed class OlderTransactionsEndpoint(ReadOlderTransactionsHandler handler) : Endpoint<OlderTransactionsRequest, TransactionPageResponse>;
public sealed record OlderTransactionsRequest { public required DateOnly Before { get; init; } }
public sealed record TransactionPageResponse(IReadOnlyList<TransactionResponse> Transactions, DateOnly? OlderBefore,
  decimal CzkPerEur, DateOnly RateDate);
public sealed record TransactionResponse(DateOnly Date, decimal Amount, string Currency, bool Pending,
  string? Counterparty, IReadOnlyList<string> Details, TransactionKind Kind);

public static class TransactionsRegistration {
  /// <summary>The two handlers (scoped). The store comes from AddTransactionStore.</summary>
  public static IServiceCollection AddTransactions(this IServiceCollection services);
}

// ---- src/RevolutReader.Api/Storage/ ----

/// <summary>The Transactions section (D11), validated on start.</summary>
public sealed class TransactionStoreOptions { public const string SECTION = "Transactions"; public required string TableName { get; init; } }

/// <summary>ITransactionStore on Azure Table Storage (D5): partition "account", row key = the reference's SHA-256 in hex; creates the
/// table if missing, once per process; Keep upserts in batches of at most 100 (one partition).</summary>
public sealed class TableTransactionStore(TableServiceClient tables, IOptions<TransactionStoreOptions> options) : ITransactionStore;

public static class StorageRegistration {
  /// <summary>Throws at registration when ConnectionStrings:tables is not set (the message names the setting, never a
  /// value); AddAzureTableServiceClient("tables") with health checks off; options; TableTransactionStore as the store.</summary>
  public static IHostApplicationBuilder AddTransactionStore(this IHostApplicationBuilder builder);
}

// Program.cs: builder.AddTransactionStore(); builder.Services.AddTransactions(); after AddEnableBanking().
```

```csharp
// ---- tests/RevolutReader.UnitTests/Account/ ----
// InMemoryTransactionStore : ITransactionStore — the fake, also compiled into the integration project (D12).
// StubBankAccount — answers a fixed BankResult<Transactions> and records the from-date and the trigger.
// FakeTimeProvider for today. Handler tests capture log lines with a hand-written ILogger.

// ---- tests/RevolutReader.IntegrationTests ----
// Account/TransactionStoreContract.cs — abstract contract tests; InMemoryTransactionStoreContract and
//   TableTransactionStoreContract (Azurite, a table per test) run them.
// HistoryImport/HistoryFile.cs — reads the M1 file's shape into EbTransactionPage lists (the adapter's JSON options).
// HistoryImport/HistoryImporter.cs — maps, filters (from 2026-08-09; D9's day rule) and keeps; returns counts.
// HistoryImport/HistoryImporterTests.cs — against Azurite with a made-up file, in the default run.
// HistoryImport/HistoryImportCheck.cs — [Explicit] (named like MockAspspCheck; HistoryImport is the namespace):
//   the owner's file and the deployed table (settings HistoryImport:File and HistoryImport:TableEndpoint,
//   AzureCliCredential with HistoryImport:Subscription, so the login names the subscription as every az command
//   does), or for the local check HistoryImport:TableConnectionString instead of the endpoint
//   (Azurite takes no Azure login); prints counts only. Written by the test-writer (the user, 2026-11-09).

// ---- tests/RevolutReader.AcceptanceTests ----

// Drivers/AzuriteStorage.cs — one container per test session (TUnit shared data source), image pinned; ConnectionString.
//   (Not `Azurite`: a type of that name fails CA1724 against the Testcontainers.Azurite namespace.)
// Drivers/ScenarioCalendar.cs — maps scenario dates onto the app's clock (D12).
public sealed class ScenarioCalendar(DateOnly scenarioToday, FakeTimeProvider clock) {
  public void TodayIs(DateOnly scenarioToday);       // re-anchors the calendar the driver shares; default 2026-11-20
  public DateOnly ToClock(DateOnly scenarioDate);
  public DateOnly FromClock(DateOnly clockDate);
  public void PassDays(int days);                     // moves the clock, and the scenario's today with it
}

// Drivers/TransactionsDriver.cs — the signed-in browser asks GET /api/transactions (X-Forwarded-For, User-Agent as
//   BalanceDriver does) and GET /api/transactions/older; checks the exact shape (a 200 has exactly the four page fields
//   and seven per transaction; a problem as BalanceDriver); keeps rows in the app copy's own table through the real
//   adapter for the GIVENs; reads the from-date of the fake bank's transaction requests.
public sealed class TransactionsDriver(HttpClient browser, FakeBank bank, ScenarioCalendar calendar, IServiceProvider app) {
  public Task<TransactionsReading> AskForNewest(UserAtDevice user);
  public Task<TransactionsReading> AskForNewestNamingNoBrowser(string ipAddress);
  public Task<TransactionsReading> AskForOlder(DateOnly before);
  public void BankLists(params IEnumerable<TransactionAtBank> transactions);   // shifted days, any date_from, replaceable
  public Task Keep(params IEnumerable<KeptAtApp> transactions);
  public IReadOnlyList<DateOnly> DaysTheBankWasAskedFrom();
}

// Dsl/
public sealed record TransactionSeenInApi(DateOnly Date, decimal Amount, bool Pending, string? Counterparty,
  Lines Details, string Kind);                                   // compared by value; currency checked as EUR by the driver
public sealed record TransactionsReading(IReadOnlyList<TransactionSeenInApi>? Transactions, DateOnly? OlderBefore,
  decimal? CzkPerEur, DateOnly? RateDate, ProblemDescription? Problem);   // no status: the driver checks it against its
                                                                          // own table (as C7a's balance reading, its gate)
public sealed record KeptAtApp(DateOnly Date, decimal Amount, string? Counterparty = null);   // a unique reference from the DSL
public sealed class TransactionsDsl(TransactionsDriver driver, ScenarioCalendar calendar) {   // AcceptanceTest.Transactions
  public void TodayIs(DateOnly scenarioToday);
  public void BankLists(params IEnumerable<TransactionAtBank> transactions);
  public Task Kept(params IEnumerable<KeptAtApp> transactions);
  public Task KeptOnDay(DateOnly day, int count);
  public Task<TransactionsReading> AsksForTheTransactions();
  public Task<TransactionsReading> AsksForTheTransactionsFrom(UserAtDevice user);
  public Task<TransactionsReading> AsksForTheTransactionsNamingNoBrowser();
  public Task<TransactionsReading> AsksForTheTransactionsBefore(DateOnly day);
  public void DaysPass(int days);
  public IReadOnlyList<DateOnly> DaysTheBankWasAskedFrom();
}
// TransactionAtBank gains TypeCode (default "CARD_PAYMENT" for Payment, "TRANSFER" for TransferReceived), written as
//   bank_transaction_code.code; Refund(...) and CashWithdrawal(...) factories. ProblemDescription as C7a's (D13).
// Conventions/TransactionTelemetryTests.cs — D12's log guard.
```

```ts
// ---- src/RevolutReader.Web/src/app ----

// transactions.ts — GET /api/transactions and /older (D1, D2, D7, D10)
export type TransactionKind = components["schemas"]["…TransactionKind"];   // the generated literals
export interface Transaction {
  date: string; amount: number; currency: string; pending: boolean;
  counterparty: string | null; details: string[]; kind: TransactionKind;
}
export interface TransactionPage { transactions: Transaction[]; olderBefore: string | null; czkPerEur: number; rateDate: string }
export type TransactionsRead =
  | { kind: "read"; page: TransactionPage }
  | { kind: "bank access expired" } | { kind: "bank rate limited" } | { kind: "bank unavailable" }   // by `type`, exactly
  | { kind: "signed out" } | { kind: "refused"; email: string | null }                               // 401, 403 (join)
  | { kind: "unexpected" } | { kind: "offline" };
export function readNewestTransactions(options?: { signal?: AbortSignal }): Promise<TransactionsRead>;      // never throws
export function readOlderTransactions(before: string, options?: { signal?: AbortSignal }): Promise<TransactionsRead>;

// transactionText.ts — pure (D4)
export function kindWord(kind: TransactionKind, amount: number): string;   // "Platba kartou" … "Příchozí platba"
export function rowLines(tx: Transaction): { first: string; second: string | null };
export function sheetSubtitle(tx: Transaction): string | null;              // the kind's word; null when the title is it
export function showsRefundChip(tx: Transaction): boolean;                  // refund, line 1 the counterparty, line 2 the bank's
export function statusWord(tx: Transaction): "Zaúčtováno" | "Vráceno na účet" | "Čeká na zpracování";
export function rowLabel(tx: Transaction, rate: number): string;            // the spoken sentence, no time

// transactionList.ts — pure (D1, D14)
export interface Day { date: string; transactions: Transaction[]; totals: { incoming: number; outgoing: number } }
export function byDay(transactions: Transaction[]): Day[];                  // in the answer's order
export function dayTotals(transactions: Transaction[]): { incoming: number; outgoing: number };   // whole cents
export interface ListState { days: Day[]; nextBefore: string | null; older: "idle" | "loading" | "error" }
export function withNewestPage(state: ListState | null, page: TransactionPage): ListState;   // D1's refresh rule
export function withOlderPage(state: ListState, page: TransactionPage): ListState;

// listState.ts — what the list shows (D7), pure; extended at the join (D8)
export type ListProblem = { kind: "bank access expired" } | { kind: "bank rate limited" } | { kind: "bank unavailable" }
  | { kind: "unexpected" } | { kind: "offline" };
export type ListShown =
  | { body: "placeholder" } | { body: "empty" } | { body: "offline note" }
  | { body: "list"; list: ListState; rate: number; rateDate: string }
  | { body: "none" };
export function listShown(facts: { list: ListState | null; reading: boolean; problem: ListProblem | null; rate?: number; rateDate?: string }): { shown: ListShown; banner: ListProblem | null };

// useTransactionList.ts — the sequence: the newest page after the session is signed in; one read at a time; the 60 s
// cap; "Zkusit znovu"; reload on `online`; the next page when the marker shows; the failed page's retry.
// At the join it takes C7a's refresh signal and reports its problem and its "reading" to C7a's screen state.
export function useTransactionList(options: { enabled: boolean }): {
  shown: ListShown; banner: ListProblem | null; retry(): void; loadOlder(): void; retryOlder(): void;
};

// format.ts — formatEur(amount, { signed }), formatCzkApprox, czkApproxLabel (C7a's too, D13), formatRate,
// formatDate(date: string) "18. 11. 2026", formatDayHeader(date: string, now: Date), formatAmount(amount, currency).

// ---- components (D14) ----
// TransactionList({ list, rate, rateDate, onLoadOlder, onRetryOlder })  DayGroup({ day, now, rate, onSelect })
// DayHeader({ date, now, totals })  TransactionRow({ tx, rate, onSelect })  TransactionSheet({ tx, rate, rateDate, open, onOpenChange })
// ListEnd({ state: "loading" | "error" | "end", onRetry })  Skeleton({ variant: "list", rows? })  EmptyState({ variant?: "default" })
// Banner({ tone: "warning" | "error", title, children, action? })   AccountScreen hosts the list until the join (D8)

// ---- test kit (the test-writer's, group 1) ----
// server.ts gains the transactions answers: a page, the three bank problems by type, 401, 403, a 500, a 502 hosting
//   page, no connection, no answer yet, `after: <ms>`; older pages by `before`; requests honour their AbortSignal.
// intersection.ts — the IntersectionObserver stand-in, scrollToEnd().
```

## Rule ownership

| Rule (spec, ADR or convention) | Enforced by |
|---|---|
| The newest page: the live transactions from 31 days back, pending included, in the bank's order | `ReadNewestTransactionsHandler`, `TransactionPaging.WindowStart` |
| The answer's exact fields and `kind` values | `TransactionPageResponse`, `TransactionResponse`, `TransactionKind`; exact shape checked by `TransactionsDriver` |
| The live read's start: earlier of 31 days and the newest kept day, at most 89; 89 with nothing kept; a longer gap logged | `TransactionPaging.LiveReadStart`, applied by the handler; `TransactionsLog.HistoryGap` |
| Settled kept with their place within the day, pending never; keeping again changes nothing | `TransactionPaging.ToKeep`; `ITransactionStore.Keep` (upsert by reference) |
| Older pages: whole days, at least 30 or the rest, `olderBefore`; no bank read | `TransactionPaging.Older`, `ReadOlderTransactionsHandler` (no `IBankAccount`) |
| `details` without the counterparty's line | `TransactionText.Details` |
| `kind` from the type code; refunds by `REFUND`; unknown codes logged, quoted only when code-shaped | `TransactionKinds`, `TransactionsLog` |
| The bank's type code read unchanged (bank-reads) | `EbTransaction`, `TransactionMapping` |
| Read as the present user; no browser → 400, nothing read | C13's `PresentUserFromRequest.Read` and `BankAnswers.NoPresentUser()` in `NewestTransactionsEndpoint` |
| The bank's failures → problem descriptions by `type` | C13's `BankAnswers.From` |
| Allowed users only | the `AllowedUser` default policy (C6) |
| Never log bank data | `TransactionsLog` (numbers and code-shaped codes only); guarded by `TransactionTelemetryTests` and `BankTelemetryTests` |
| An answer becomes one kind (bank `type` exact, 401, 403, unexpected, offline) | `readNewestTransactions`, `readOlderTransactions` |
| Day grouping, headings, totals | `byDay`, `dayTotals`, `formatDayHeader`, `DayGroup` |
| A row's lines and words, the refund chip, the koruna line, no time | `rowLines`, `kindWord`, `TransactionRow`, `formatCzkApprox` |
| The sheet's fields; "Popis" only with text; the rate with its date | `TransactionSheet`, `sheetSubtitle`, `statusWord`, `formatRate`, `formatDate` |
| Older pages by themselves; the loading and failed rows; nothing asked past the end | `useTransactionList`, `TransactionList`, `ListEnd` |
| A refresh replaces the newest page and keeps older days | `withNewestPage` |
| The list's states and banners before the join | `listShown`, `Banner`, `Skeleton`, `EmptyState` |
| Offline: nothing sent while the phone says so; no answer within 60 s; reload on `online` | `readNewestTransactions`, `useTransactionList` |
| One banner by precedence; "Obnovuji…" waits for both; the list stays; waking → list directly (join) | C7a's screen state, extended at the join; `useTransactionList` |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected outcomes (answers) | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `ReadNewestTransactionsHandler.Handle` | `TransactionPage` | `BankAccessExpired`, `BankRateLimited`, `BankUnavailable` (the port's cases, passed on; nothing kept) | the port's `BankReadException` (c004 design.md D4); the store's failures (`RequestFailedException` and the like) |
| `ReadOlderTransactionsHandler.Handle` | `TransactionPage` | — (an empty page when nothing is kept before the date) | the store's failures |
| `ITransactionStore` | rows / — | — | the adapter's `RequestFailedException`; a row it cannot read → `InvalidOperationException` naming the column, never its value |
| `GET /api/transactions` | 200 `TransactionPageResponse` | 400 (no browser), 401, 403, 429, 503 ×2 | any exception → 500 problem description (C7a's `UseExceptionHandler`; before the rebase, the harness rethrows, C7a design.md D1) |
| `GET /api/transactions/older` | 200 `TransactionPageResponse` | 400 (no or unreadable `before`), 401, 403 | any exception → 500 |
| `readNewestTransactions`, `readOlderTransactions` | the read kinds | every answer and failure becomes a kind | none; never throw |
| `HistoryImporter` | counts | — | an unreadable file or page → `BankReadException` or `JsonException`, naming what, quoting nothing |

- **No new Result union:** the newest page passes on the port's `BankResult<T>` with its own value type; the older page has no expected failure.

## Ports and contracts

**`ITransactionStore`** (new; the in-memory fake `InMemoryTransactionStore` serves the unit tests):

- **`ReadAll`:** every kept transaction, newest day first, then by `Position` ascending; an empty store answers an empty list. Every field comes back as kept: the amount to the cent, an empty details list as empty, a missing counterparty or type code as null, a reference with `/`, `#`, `?` or `\` unchanged.
- **`Keep`:** inserts or replaces each transaction by its reference, so keeping the same transaction again leaves one row with the latest values, and a list naming one reference twice keeps the later one (Table Storage refuses a batch that names a key twice; added in group 6); an empty list does nothing; more than 100 at once works (Table Storage's batch limit is 100 per partition). Not atomic across batches: a failure part-way leaves some written, and the next live read writes them all again.
- **Concurrency:** two `Keep` calls with the same rows end with one row each (last write wins; the values are the same).
- **Failures:** an exception, never a result (D5).
- **Real adapter:** `TableTransactionStore` on `Azure.Data.Tables` through `Aspire.Azure.Data.Tables`, Azurite locally and in tests, the deployed table with the app's managed identity in Azure.
- **Contract tests:** `[integration]`, the fake and the adapter against the same tests (D12).

**`IBankAccount`:** unchanged in shape; `BankTransaction` gains `TypeCode` (spec `bank-reads`). The adapter's existing tests and Check 1 and Check 2 compile against the new field; Check 2's counts-only evidence may add the type codes' counts.

## How each scenario is verified

| Scenarios | Level | Why |
|---|---|---|
| `account-transactions`: the 15 API scenarios, "The newest transactions come live with the koruna rate" through "A bank that does not answer is its own problem" | API acceptance tests in `Scenarios/AccountTransactions/AccountTransactionsScenarios.cs`, against the fake bank and Azurite | the default level; everything they assert is an answer of the API, a request the bank received, or what storage then answers |
| `bank-reads`: "A transaction comes back with the bank's type code" | API acceptance test in `Scenarios/BankReads/BankReadsScenarios.cs`, through the port as the existing ones | the port's public interface (openspec/config.yaml, specs rule) |
| `account-transactions`: the 19 screen scenarios, "The account screen lists the transactions by day, newest first" through "Offline, the transactions load once the phone is back online" | frontend tests in `src/scenarios/account-transactions.test.tsx` | what the list shows, where a tap goes and what the app asks for only the page can show; the server's answers are stubbed, the observer is a stand-in |
| `account-transactions`: the 5 join scenarios, "Refreshing replaces the newest transactions and keeps the older ones" through "After the server wakes, the transactions replace the waiting screen directly" | frontend tests in the same file, written after the rebase | they need C7a's screen, refresh and test kit |

## Cross-cutting effects

- **API contract / TS client:** two endpoints; `openapi.json` and `schema.d.ts` regenerated in the slices that add or change them, and again at the rebase (D13).
- **Bicep:** D11. Linted (`az bicep lint`, a warning fails CI) and previewed before the merge (docs/operations/deployment.md).
- **AppHost and settings:** D11. `appsettings.json` gains `Transactions:TableName` and an empty `ConnectionStrings:tables`; `CLAUDE.md`'s image quick start gains a made-up `ConnectionStrings__tables`; the OpenAPI export check gets one.
- **ADRs, each a dated amendment:**
  - ADR-0005 item 4: one table, one partition, the reference as the key, read whole (D5); Consequences: C7b's table and role done;
  - ADR-0001 item 6: the live read reaches back to the newest kept day, at most 89 days (D3); the import done, with its counts and the file's deletion, after the run (D9).
- **Q7 decided:** `pm/progress.md` gets the outcome, the record (this design, D1–D7, with the ADR amendments) and the date. The display and paging rules are local to this change (workflow.md § 2); what is kept and how is in the ADRs.
- **Conventions:**
  - testing.md: Azurite in the acceptance harness (§ Decided later becomes decided), scenario dates relative to the clock, the observer stand-in, the store's contract tests with a linked fake;
  - README.md § Backend code: the store port and its adapter's folder; never log type codes that are not code-shaped;
  - configuration.md: the two settings;
  - their `.claude/rules/` mirrors.
- **Operations:** deployment.md: the table and the role in the deployed resources, a read-only check that rows arrive after the first open; the import's steps and the owner's temporary role (granted and removed) in the operations docs, with `expiring-approvals.md` untouched (nothing expires).
- **CLAUDE.md § Commands:** `dotnet test` needs Docker running; the import command; the quick start's setting.
- **CI:** the runners have Docker. The image smoke run gains a made-up `ConnectionStrings__tables` (`UseDevelopmentStorage=true`), since the app refuses to start without it (D11; found at the close, 2026-11-09).
- **Design:** the loop in § Migration plan, step 1.
- **Software factory** (the next free numbers when written):
  - *(New)* scenario dates in a frame relative to a clock that can only move forward;
  - *(New)* two changes in parallel building the same design-system component: build to the other's published props, merge at the rebase;
  - *(New)* a one-time history import as an explicit check that reuses the adapter's own parsing, with a temporary data role run by the owner;
  - *(New)* refunds from a bank's type code that the data has never shown: log every unknown code, quoted only when code-shaped;
  - inventory lines: `ScenarioCalendar`, the Azurite harness, the store's contract tests, the observer stand-in.

## Risks / Trade-offs

- **[`REFUND` is not how Revolut marks refunds]** → a refund shows as a plain incoming payment; the warning log names the code on the first newest page that holds it, and a one-line change in `TransactionKinds` follows. If the guess is right, `RefundTypeCode` shows it the same way.
- **[C7a's components or texts change in its review before it merges]** → the rebase takes C7a's merged version (D13); a text that differs from this spec is shown to the user and fixed as `[plan]`.
- **[Azurite in every acceptance run slows the suite or fails without Docker]** → one container per session; tests that need Docker stop with a message, never skip (testing.md). Locally the owner keeps Docker running, as for the integration tests.
- **[A missing tables connection goes unnoticed until the first request]** (the Aspire client checks it lazily, the bootstrap's probe) → `AddTransactionStore` checks it at registration (D11).
- **[A busy day makes a page long]** → whole days are the user's rule; a day of 60 transactions is still one screenful of scrolling.
- **[Reading the whole table on every request]** → a few hundred rows, one partition, well under a second; if it ever grows, ADR-0005's consequence applies (move it with a script).
- **[A refresh across midnight shows a stale pending row on the oldest day]** (D1's rule keeps the earlier answer's oldest day) → harmless: a pending payment 31 days old drops off on the next launch.
- **[The import overlaps the live reads]** → D9's day rule: it never writes a day the table holds.
- **[Scenario dates shift across a month boundary]** → the rules count days only; the frontend scenarios set their own date with `vi.setSystemTime`, so weekday headings stay exact.
- **[A later Bicep change or a revert drops the table from the stack]** → the stack deletes it with the history, which the bank no longer serves beyond 90 days. The table carries a comment saying so, and § Migration plan's rollback keeps it.
- **[40 slices make a long `/tdd-apply`]** → many close only (tasks.md); the join waits for C7a regardless.

## Migration plan

1. **Before the bootstrap: the design loop** (`.claude/rules/design.md`, workflow.md § 8), walked with the owner step by step: the design-system prompt (no time of day, the type word when there is no counterparty, the trimmed sheet, the end-of-list states), "list what you changed", the Screens update and a screen-only prompt (Option B deleted, Option A renamed "Default", three boards for the end of the list), then Claude Code read both and compared. *Done 2026-11-08* (Bootstrap, item 1).
2. **The bootstrap** (`[setup]`).
3. **`/tdd-apply`** up to the join. After the last pre-join slice, a local check with `aspire start --isolated`: sign in, see the Mock ASPSP's transactions grouped by day, open a sheet, scroll to load older ones (none at first; the table fills from the first open), the bank stopped for the banner.
4. **The join,** once C7a has merged (D8), then the same local check with the balance.
5. **Before the merge:** the Bicep lint and preview; the push and a draft PR on the owner's go; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; the archive on the branch (workflow.md § 6).
6. **After the merge:**
   - the deploy runs: the table and the role appear; the app's log shows no storage error;
   - the first open at the production address keeps 89 days (D3); a read-only look at the row count (the owner's portal or a Claude query with the owner's go);
   - **the import** (D9): the owner's temporary role (PowerShell block from Claude, run by the owner, checked read-only), the explicit check, the counts compared with the export's evidence (116 settled), the role removed, the file and its backup deleted;
   - the list compared once with the Revolut app.

   Findings and the import's counts go into `pm/progress.md` (and ADR-0001's amendment) through a small docs PR, since they come after the archive.
7. **Rollback:** revert the app's code but keep the table and its role in the Bicep. A plain revert of the merge would remove the table from the stack, which deletes it with its rows; after the import, and once the file is deleted, the days older than the bank's 90 would be gone for good. With the table kept, the endpoints and the list disappear and the history waits for the fix.

## Open questions

None. The end of the list, the last one, was answered by the design loop (D14).
