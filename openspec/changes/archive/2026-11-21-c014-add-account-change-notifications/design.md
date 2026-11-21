# Design: c014-add-account-change-notifications

## TL;DR

- **The check endpoint** `POST /api/account/check` (D6–D8): its own key in `X-Check-Key`, checked before anything else; without it, the unknown address's 404; hidden from the API description. The bank read is a present user's, with the phone's address and browser name (C13's 400 without them). The Shortcut waits, but the check runs on the app's lifetime, never the request's, so a caller that leaves never stops it (D8).
- **Reads and keeps** (D3, D4): the balance only, one read per check. Two stored balances of its own, *last seen* and *last notified*, one row in a new table `checkedbalances`. The first check writes both and sends nothing.
- **Notifies** (D2, D5, D12): when the two differ by a cent or more, through C8a's `SendPushHandler`, to every allowlisted account in turn. *Last notified* is written once the sender has run, whatever it reached. **Q8:** "Odešlo 3,80 €" / "Přišlo 100,00 €" over "Zůstatek 45,20 € (≈ 1 098 Kč)", formatted by hand: the runtime image has no culture data (D2).
- **The push carries the balance** (D14, N2): `"mutable": true` at the top level and `notification.data.balance` as `GET /api/balance` answers it; the owner's messages carry neither. `PushMessage` gains an optional balance.
- **Bursts** (D10): an in-process queue, one check running and at most one waiting; later callers join the waiting one. A check with one waiting behind it leaves the notification to it, and the notification is built from the stored balances. **No guard across two app copies** (D13, the owner, 2026-11-21): a change landing during a deploy's swap may notify twice, accepted.
- **No backup check** (D9). **What the Shortcut gets back** (D11): `{ "changed": bool }`, or the balance endpoint's bank problems.
- **New public interfaces:** `POST /api/account/check` (hidden); `AccountCheckEndpoint`, `AccountCheckQueue`, `IAccountCheck`/`AccountCheck`, `ChangeNotifier`, `ChangeNotification`, `CzechAmounts`, `AccountCheckOptions`, the port `ICheckedBalanceStore` and `TableCheckedBalanceStore`; `PushMessage.Balance`/`PushBalance`; DSL `CheckDsl`, driver `AccountCheckDriver`.
- **Integration points:** the bank adapter (one present-user balance read); C8a's sender and the allowlist; the storage account (a new table); Key Vault (one secret); the AppHost's user-secrets; the iPhone's Shortcut (hand-made). No API contract change, so no TS regeneration.
- **Hard to reverse:** the address, the header and the setting and secret names (the Shortcut and the owner's guided block carry them); the push's `data.balance` shape, which C9b builds on (N2).

## Context

- See proposal.md § Why. Every decision below was made with the owner in C9's explore (2026-11-20/21) and handed over in [#52's comment](https://github.com/jakubbohm/RevolutReader/issues/52#issuecomment-7052729352): the shared N1–N4 and C9a's K1–K10. This design copies each one it uses, citing its label, and is their home from now on. Details settled while writing it are marked *(propose)*. K10's three items were Claude's defaults; D11 and D12 keep two of them, and the third, D13, was put to the owner (2026-11-21).
- **What merged before**, read 2026-11-21 on `main` at `5898af9`: c009 (C7a), c011 (C8a) and c012 (C8b) design.md, ADR-0001, ADR-0007, ADR-0008, ADR-0010, and C14 (#83). Nothing contradicts N1–N4 or K1–K10, so no explore was needed. What this change builds on:
  - **The balance read (C7a, C13):** `ReadBalanceHandler.Handle(PresentUser, ct)` → `BankResult<AccountBalance>` (amount, read time from `TimeProvider`, `KorunaRate.CzkPerEur`); `PresentUserFromRequest.Read(HttpContext)` (the forwarded client address and a non-blank `User-Agent`, else `null`); `BankAnswers.From` and `NoPresentUser` (the 400, 429 and 503 with the bank's problem types). Present-user reads are retried up to 3 times (C11).
  - **Sending (C8a):** `SendPushHandler.Send(account, PushMessage, ct)` → `PushSent(delivered, failed, removed)` or `AccountNotAllowed`; the allowlist checked inside it; gone devices deleted; no retries; 24 hours and urgent for every push. `PushMessages.DeclarativeJson` writes `{"web_push":8030,"notification":{"title","body","navigate"}}` and nothing else. `Allowlist.Addresses` lists the accounts.
  - **The message endpoint's pattern (C8a, c011 D10):** anonymous, `ExcludeFromDescription`, binds nothing, `MessageKeyCheck.Matches` (SHA-256 of both, constant time, a repeated or missing header never matches) before anything else, `TypedResults.NotFound()` filled in by `UseStatusCodePages` exactly as an unknown address. Guarded by `Conventions/AnonymousEndpointsTests` and `HiddenEndpointsTests`.
  - **Storage (C7b, C8a):** the tables client `AddTransactionStore` registers; `TableCreation` (the table created once per instance); amounts as invariant decimal strings (`TableTransactionStore`); Storage Table Data Contributor on the whole account (`infra/platform.bicep`), so a new table needs no role.
  - **The phone (ADR-0008, K6):** the probe of 2026-11-20 on the owner's iPhone 15 Pro (iOS 27.2) saw the Shortcut's requests arrive with the browser name `BackgroundShortcutRunner 5114.0`, also when a Revolut notification fired it.
  - **The runtime image** (`mcr.microsoft.com/dotnet/aspnet:11.0.0-resolute-chiseled`) sets `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true` (read from the image, 2026-11-21): no culture data, so `cs-CZ` formatting is not available on the server (D2).
- **The design board:** the Screens design's `Notifications / Lock screen / Default` (`project/notif-lock-a.dc.html`), read 2026-11-21 at version `1795212812-7eac`, the version N4 names: two notifications, "Přišlo 100,00&nbsp;€" over "Zůstatek 145,20&nbsp;€ (≈&nbsp;3&nbsp;528&nbsp;Kč)" and "Odešlo 3,80&nbsp;€" over "Zůstatek 45,20&nbsp;€ (≈&nbsp;1&nbsp;098&nbsp;Kč)". Nothing of it is built in the app: iOS draws the notification. The board fixes the text only.

## Goals / Non-Goals

**Goals:**

- The 15 automated scenarios and the manual row (§ How each scenario is verified).
- A check that is safe to call any number of times: at most two bank reads and one notification per burst, and never a lost change (ADR-0008's constraint), within one app copy.
- The push contract C9b builds on (N2), pinned by a scenario on each side of it.

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- **No queue across processes and no background worker:** the queue lives in the app's memory, because the app runs at most one copy (ADR-0006), and the check runs while its first caller's request is open.
- **No guard across two app copies** (D13).
- **No new frontend code:** C9b writes the push's balance on the phone.

## Decisions

### D1 — The split and the contract with C9b (N1, N2, N3)

- **C9a is the server side:** the endpoint and its key, the bank read with the phone's headers, the two stored balances, the change rule, the notification's text and recipients, bursts, and the Shortcut in `docs/operations/`. **C9b** ([#86](https://github.com/jakubbohm/RevolutReader/issues/86), `c015-store-pushed-balance`, its own worktree) writes the push's balance in the service worker. They share no code file. Either may merge first (N3): with C9a first, today's service worker gets the mutable push, finds the notification Safari proposes, shows nothing of its own, and ignores the data; with C9b first, only the owner's messages reach it, which carry no balance.
- **The contract (N2):** every push the check sends carries `"mutable": true` and, in the notification's `data`, `balance`: the balance exactly as `GET /api/balance` answers it. The owner's messages carry neither. D14 places the members; the C9b session was told the placement on 2026-11-21.
- **The second to merge joins by hand** `pm/progress.md`'s rows and ADR-0007's notes. The roadmap's C9 split and Q8 are this change's (N1); C9b adds only its own progress row.

### D2 — Q8: the notification's content (N4)

- **Title:** the change since the last notification, its size without a sign: "Odešlo 3,80 €" when the balance fell, "Přišlo 100,00 €" when it rose. The change is *last seen* minus *last notified* (D4).
- **Text:** the new balance (*last seen*) with its koruna line: "Zůstatek 45,20 € (≈ 1 098 Kč)". The koruna value is the balance's size at the rate stored with it, rounded half up to whole koruna, as the app rounds it (`format.ts`, `wholeCrowns`; c010 D6). A negative balance keeps its minus, U+2212, as the app's header writes it; its koruna value is its size.
- **Spacing, as the board draws it:** a no-break space (U+00A0) before "€" and "Kč", after "≈", and as the thousands separator in both amounts ("1 234,56 €", "≈ 30 000 Kč"); an ordinary space after "Odešlo", "Přišlo" and "Zůstatek" and before "(". Two decimals with a decimal comma.
- **Formatted by hand** *(propose)*, in `CzechAmounts`, never through .NET's cultures: the runtime image runs with invariant globalization (§ Context), and even with culture data, .NET's and the browser's Czech formats could differ in a space. Unit tests pin the board's two examples, a thousands separator, a negative balance and the rounding's halves.
- **A tap opens the start page** `/` (the account screen), as the owner's messages do by default.
- **Lifetime and urgency** *(propose)*: the sender's, 24 hours and urgent, as for every push (c011 D2). A notification the phone gets late still tells a true change.
- **Why** (N4): the balance is the one fact a single quick read is sure of (the M1 spike, step 7, saw it change together with the pending payment); it is what she wants to know after a payment; and a settlement never notifies twice, with no pending payment to match to its settled one (ADR-0001: whether a reference survives settlement is still unknown). **Accepted costs:** no merchant (she opens the app for it); one net amount per burst; changes that cancel out within one burst send nothing. **Dropped:** the board's options A (merchant and amount) and B (discreet).

### D3 — What the check reads (K1)

The balance only: one `ReadBalanceHandler` read per check, through C11's retries for a present user. No transactions, and nothing goes into C7b's transaction store.

### D4 — Two stored balances, a change, the first check (K2, K3)

- **The two balances are the check's own,** never C7b's transaction store (roadmap C9, item 3): **last seen**, written by every successful read, and **last notified**, the balance at the last notification. Each is a whole `AccountBalance` (amount, read time, rate), so a notification built from *last seen* later carries the balance exactly as it was read (D14).
- **A change:** they differ by at least a cent, `|last seen − last notified| ≥ 0.01`.
- **The first check:** with nothing stored, a successful read writes both, and nothing is sent.
- **Storage** *(propose)*:
  - table `checkedbalances` in the app's storage account (ADR-0005), on the tables client C7b registers; one row, partition `check`, row key `balances`;
  - columns `LastSeenAmount`, `LastSeenReadAt`, `LastSeenCzkPerEur`, `LastNotifiedAmount`, `LastNotifiedReadAt`, `LastNotifiedCzkPerEur`; amounts and rates as invariant decimal strings, as `TableTransactionStore` keeps amounts (a double would lose cents); the times as the table's date type;
  - every save replaces the whole row; no row reads as nothing stored;
  - the port `ICheckedBalanceStore` in `Check/`, its adapter `TableCheckedBalanceStore` with `CheckedBalanceStoreOptions` (section `CheckedBalances`, `TableName` default `checkedbalances`, validated as C7b's) in `Storage/`; `StorageRegistration.AddCheckedBalanceStore`, called after `AddTransactionStore`.
- **Bank data at rest:** two balances and their times, in the app's own private storage account, like the stored transactions. Never logged (D15).

### D5 — Who gets the notification (K4)

- **The same message goes to every account on the allowlist** (`Allowlist.Addresses`, in the order written) **that has a registered device, the owner included:** the owner's proof that the chain works, and M7's check. The owner can mute the app in iOS Settings.
- **One account at a time** through `SendPushHandler.Send` (`ChangeNotifier`). An account with no device answers three zeros and costs one read of the device table. The allowlist check inside the sender always passes here.
- **Not chosen:** everyone but the owner, or the daughter only. Each needs a new setting naming an email address, which must stay out of the public repository.

### D6 — The check's key and its endpoint (K5)

- **A key of its own, not the message key:** a key on the phone must not be able to send any text to the daughter. It can only start a check, whose notification says what the bank says.
- **Names** *(propose)*:

  | What | Name |
  |---|---|
  | The address | `POST /api/account/check` |
  | The header | `X-Check-Key` |
  | The setting | `AccountCheck:Key` (section `AccountCheck`, `AccountCheckOptions`), declared `"<secret>"` |
  | Key Vault | `AccountCheck--Key` |
  | Container Apps secret | `accountcheck-key`, reaching the app as `AccountCheck__Key` |
  | AppHost parameter | `accountcheck-key` |

- **The key:** at least 32 random bytes, base64url without padding, as the message key; the app refuses to start without it (`[NotSecretPlaceholder]`, `AccountCheckOptionsValidator` with `StrictBase64Url`, the message naming the setting, never a value). No expiry; `docs/operations/` says how to replace it.
- **A missing or wrong key answers exactly as an unknown `/api` address does** (404), checked before anything else, so nothing is read at the bank. The comparison is `MessageKeyCheck.Matches` *(propose: reused as it is; it compares any sent header with any key, and its comment is widened to say so)*. The endpoint is anonymous, on the anonymous-endpoint list, binds nothing (`EndpointWithoutRequest`; a body is ignored), and stays out of the API description (`ExcludeFromDescription`), so a probe cannot tell it exists.
- **The cross-site rule** (C6) lets the Shortcut's POST through: a request that carries neither `Sec-Fetch-Site` nor `Origin` is no browser's. The Shortcut's "Get Contents of URL" is Apple's URL loading, not a web page, so it is expected to send neither (riskiest assumption; § Risks).

### D7 — The phone's headers (K6)

- **The bank read is a present user's,** with the request's address and browser name, through `PresentUserFromRequest.Read`, as `GET /api/balance` reads them. A request missing either answers C13's 400 (`BankAnswers.NoPresentUser`), and nothing is read.
- **Every bank read is caused by one call from the phone** (ADR-0008's constraint): a waiting check reads with the headers of the call that made it wait (D10); a call that joins it causes no read.
- **The probe** (2026-11-20, § Context) saw the browser name `BackgroundShortcutRunner 5114.0`, the same whether run by hand or from a Revolut notification. For a later probe: `/health` is not in the telemetry (ServiceDefaults filters it out), so call the start page instead.

### D8 — The Shortcut waits; the check never stops for its caller (K7)

- **The Shortcut waits for the answer, and the check runs inside the request:** the first caller's request starts it and waits for its end, so the wake-up from zero (about 20 s) is just a longer wait.
- **The check never takes the request's cancellation token.** It runs on the app's stopping token (`IHostApplicationLifetime.ApplicationStopping`). Neither a phone that gives up (the Shortcut's own timeout is unknown) nor a joined caller that leaves stops it. Each caller only stops *waiting*, on its own token. The bank's 15 s timeout still applies to the read.
- **A stop of the app** cancels the running check. Whatever it kept is caught up by the next trigger (roadmap C9, item 5; D10).
- **A scenario proves it:** the caller drops while its check reads the bank, and the push still arrives.
- **Not chosen:** answering at once (202) and checking in the background. The phone waits out the wake-up anyway, and it needs a worker, tests that wait for it, and an outcome visible only in the logs.

### D9 — No backup check (K8)

- When the phone is off or its automation breaks, nothing is lost, only delayed: the next trigger notifies the whole difference since the last notification, and the daughter sees live data whenever she opens the app.
- **Not chosen:** an unattended check up to 4 times a day (a clock in the Bicep again, and an unattended path with its rate limit), or a watchdog warning the owner.

### D10 — Bursts: one check at a time (K9)

As roadmap C9, items 1–5:

1. **One check at a time:** a check's three steps (read and compare, store, notify) run before the next check starts.
2. **At most one waits:** a call while a check runs starts nothing yet; it becomes the *waiting* check, to run with its own headers once the running one ends. A call while one already waits **joins** it and gets its answer, so a burst of any size costs at most two bank reads.
3. **Only the last check of a burst notifies:** after its store step, a check with another waiting behind it leaves the notification to that one.
4. **The notification comes from the stored balances,** not the read: a check whose read fails still sends what an earlier check kept, and a stop between storing and notifying is caught up by the next trigger.
5. **Last notified is written only after the push has gone out** (D12): at worst one notification repeats (a stop between the two), none is lost.

*(propose)* **How:** `AccountCheckQueue`, a singleton, holds the running check's task and the waiting one's under a lock. Each check runs in its own DI scope (`IAccountCheck` resolved from it; the handlers are scoped) on the stopping token. "Another check waits" is read under the same lock right after the store step. A check that fails (an exception) never blocks the next: the waiting one starts once the running one has ended in any way. The queue logs a failed check itself, since its caller may have left (D15). A read-only `CallersWaiting` count lets the acceptance driver see that a burst's calls have arrived before it releases the bank (D16).

**Not chosen** (the roadmap, 2026-11-08): a quiet period before checking (a debounce). It delays every notification and needs a timer that outlives the phone's request, and the payment is already readable when its notification arrives. Accepted: two real payments a few seconds apart can still bring two notifications.

### D11 — What the Shortcut gets back (K10, item 1)

- **200 with exactly `{ "changed": true | false }`:** whether, after this check's read and store, *last seen* differs from *last notified*, so a notification has gone out or is left to the check waiting behind. A joined caller gets the answer of the check it joined. The Shortcut does nothing with it; it shows when the owner runs the Shortcut by hand.
- **A failed bank read answers as `GET /api/balance` does:** 503 or 429 with C13's problem types, through `BankAnswers.From`, also when the check then sent what an earlier check kept (D10, item 4). If that send fails (the sender or the store throws), the send's failure decides the answer: the 500 below, logged once by the queue as `CheckFailed`, *last notified* left as it was (D12). As the error model says, the store's and the sender's failures throw from `AccountCheck.Run`, whatever the read did (the owner, 2026-11-21, PR #88 review finding 2).
- **An unexpected failure** (storage, an unreadable bank answer) answers C7a's 500 problem description. *(propose)* The endpoint turns a failed check into that answer itself, so the failure is logged once, by the queue. A check the app's stop cancels while its caller still waits answers the same 500, with no line logged (D15): the Shortcut does nothing with the answer and the next trigger catches up, so a 503 of its own would buy only a truer status for someone running the Shortcut by hand at that moment (the owner, 2026-11-21).

### D12 — Last notified is written once the sender has run (K10, item 2)

- *Last notified* becomes *last seen* once `SendPushHandler.Send` has returned for every allowed account, **whatever its per-device counts:** a device whose push failed misses that notification, and the sender never retries (ADR-0010). A scenario pins it.
- **If the sender throws** (the device table cannot be read), *last notified* stays, and the next trigger sends the change again.

### D13 — No guard across two app copies (K10, item 3; the owner, 2026-11-21)

- **The finding:** K10 suggested a conditional write (ETag) on the stored balances, so two app copies during a deploy could not send the same change. But the write it would guard, *last notified*, happens only after the push has gone out (D12), so by the time it fails both copies have sent. A conditional write there stops nothing.
- **The window is small:** two copies run at once only while a deploy swaps revisions, and the old copy's checks are cancelled as soon as it is told to stop (D8). A duplicate needs a Revolut notification inside that window and costs one repeated notification with the same text.
- **Chosen by the owner: no guard.** One row, saved whole, last write wins, as the other stores do. The duplicate is accepted next to roadmap C9 item 5's (a stop between the push and its record), and ADR-0008's "at most one notification" constraint names both (D18).
- **Not chosen:** a short claim before sending. A check claims the notification with a conditional write and a time stamp; another copy seeing a fresh claim skips; a claim older than about a minute is taken over. No duplicate and none lost, for an extra column, the store's conditional-write contract on the fake and on Azurite, and unit tests (about half a day). It is the software factory's full version (D20).

### D14 — The push carries the balance (N2)

- **Placement,** checked against the [W3C Push API draft](https://w3c.github.io/push-api/)'s declarative push parser (read 2026-11-21): `mutable` is read from the message's top level, a boolean, false by default; `data` is a member of `notification`, any JSON value, and becomes the notification's data. Members the parser does not know are ignored and never make a message invalid. So:
  ```text
  {"web_push":8030,
   "notification":{"title":"Odešlo 3,80 €","body":"Zůstatek 45,20 € (≈ 1 098 Kč)","navigate":"https://<the app's address>/",
                   "data":{"balance":{"amount":45.20,"readAt":"2026-11-21T09:14:03.5123456+00:00","czkPerEur":24.3}}},
   "mutable":true}
  ```
- **`balance` is exactly as `GET /api/balance` answers it:** `amount` and `czkPerEur` JSON numbers, `readAt` the ISO 8601 text `System.Text.Json` writes for a `DateTimeOffset`; the same values give the same text. It is *last seen*, with its own read time (D4), which can be older than a balance the app read in between; C9b decides what to do then.
- *(propose)* **`PushMessage` gains an optional `Balance`** (`PushBalance(Amount, ReadAt, CzkPerEur)`, in `Push/`, so the sender does not depend on `Account/`). `PushMessages.DeclarativeJson` writes `mutable` and `notification.data.balance` when it is set, and neither otherwise. The size check (3993 bytes) counts them: the check's JSON is under 400 bytes.
- **The owner's message endpoint never sets it** (its request has no balance), so the owner's messages carry neither member. This **modifies `push-sending`**'s requirement "Every push is a Declarative Web Push message" (ADR-0010 asked C9 to add `mutable` through its own push-sending spec change), with a new scenario for the owner's message.
- **What C8b's service worker does with it today** (N3): on the iPhone it now gets the push event, finds Safari's proposed notification and shows nothing of its own, so the notification shows once. On a computer's Chrome it shows the message itself. It ignores `data`.

### D15 — Logs *(propose)*

- **Never an amount, a balance, a time read, an email address or a key** in the app's own lines (CLAUDE.md, ADR-0004).
- Source-generated in `CheckLog`:
  - `CheckEnded` (Information), with what the check came to: `FirstBalanceKept`, `Unchanged`, `ChangeLeftToTheNextCheck`, `ChangeNotified` or `BankReadFailed`. A check whose read fails comes to `BankReadFailed` also when it still sends a change an earlier check kept, or leaves it to the check waiting behind (D10 item 4): the line agrees with its answer (D11) and keeps the bank problem visible, and `ChangeSent` shows the send (the owner, 2026-11-21);
  - `ChangeSent` (Information): accounts, and the devices reached, failed and removed, summed;
  - `CheckFailed` (Error, with the exception): a check that threw. Exceptions carry no bank data (README.md § Backend code). A check the app's stop cancels writes no line of its own, neither `CheckFailed` nor any Error: a stop is the app ending (a deploy, Azure stopping it), not a fault, and *last notified* stays, so the next trigger sends the change (the owner, 2026-11-21).
- The bank adapter's line per read and C8a's `PushSent` lines stay as they are.
- **A guard test** (`Conventions/AccountCheckTelemetryTests`) captures every line a notifying check writes and finds no amount in any of its forms ("45.20", "45,20", "3,80", "1 098"), no email and no key.

### D16 — Tests *(propose)*

- **Every app copy gets a made-up check key** (the app refuses to start without one): `Drivers/AccountCheckDriver.Configure` writes `AccountCheck:Key`, a new random key per test, next to `FakeBank.Configure` and `FakePushService.Configure`. `Drivers/AzuriteStorage.Configure` also gives each app copy a `CheckedBalances:TableName` of its own.
- **The phone:** an anonymous `HttpClient` with the check key, a `User-Agent` and the address in `X-Forwarded-For` (the harness takes the client address from it, c009's probe), no fetch metadata, and a cancellation token the scenario can cancel.
- **The stored balances in a GIVEN are written into the app's own store** (C8a's precedent for a state the API reaches only one way), not made by an earlier check. An earlier check would add a bank request to the burst scenario's count, and *last seen ≠ last notified* is reached through the API only by a stop or a burst.
- **Holding the bank:** the fake bank can hold a balance answer until the test releases it, and counts the balance requests it received. **A burst:** the driver holds the first read, sends the other calls, waits until `AccountCheckQueue.CallersWaiting` (read through the app copy's services) counts them, then releases. **A caller that stops waiting:** it waits until the bank has the request, cancels its call, releases the bank, then waits (bounded, real time) for the push.
- **The fake push service and the test device** read `mutable` and `notification.data.balance` (`PushReceived` gains them). They are the test-writer's (c011 D7), which now accept these two members; the owner's message scenario pins their absence.
- **Unit tests** use C8a's `InMemoryPushDeviceStore` and `StubPushDelivery` under a real `SendPushHandler`, a hand-written `IBankAccount` fake under a real `ReadBalanceHandler`, an in-memory `ICheckedBalanceStore` (also compiled into the integration project, as C7b's fake is), and, for the queue, a gated `IAccountCheck` whose runs the test starts and ends.
- **No test needs a real secret** and none reaches a real phone: the iPhone row is manual.

### D17 — Deployment, the key and the Shortcut *(propose)*

- **`infra/platform.bicep`:** the table `checkedbalances` beside `transactions` and `pushdevices`; C7b's Storage Table Data Contributor on the account covers it, so no role and no change to the deploy identity's condition.
- **`infra/features.bicep`,** section "Account check (C9a)": a Key Vault reference `accountcheck-key` → `AccountCheck--Key` and the setting `AccountCheck__Key` from it, in the push secrets' pattern. The read-only preview should show exactly one table, one secret and one setting.
- **The guided task** (the owner, as C8a's push keys): one PowerShell 7 block makes 32 random bytes in base64url and writes them straight into Key Vault (production) or into the AppHost's user-secrets and the backup vault (the laptop), never printed. Separate values for the laptop and production; the production key needs no backup, since a lost one is replaced in the vault and the Shortcut. **It runs before the merge:** a Key Vault reference to a missing secret stops the new revision.
- **The Shortcut** (after the merge, by the owner, on the iPhone; `docs/operations/iphone-shortcut.md`):
  - the automation from #12's phone test, "when a notification arrives from Revolut", run immediately, no text filter (ADR-0008);
  - its one action, "Get Contents of URL": `POST` to the app's `/api/account/check`, with the header `X-Check-Key` holding the production key; no body;
  - the key reaches the phone through the Azure portal on the iPhone (Key Vault, the secret's current version, "Show Secret Value", copy), signed in with the owner's own login, or typed by hand; never through a chat, an email, a note or the repository;
  - the page also says how to check it by hand (run the Shortcut: `{"changed":false}`), how to restore it on a new phone, and how to replace the key.
- **A check by Claude Code** reads the bank with the caller's own address and browser name as a present user's, so Claude runs one only on the owner's go, each time, from the owner's own machine (deployment.md § The account check).

### D18 — Records *(propose)*

- **ADR-0008** answers its "C9 decides" points in a dated amendment: the Shortcut proves itself with a key of its own and gets the unknown address's answer without it (D6); no fallback check (D9); the Shortcut waits through the wake-up and the check never stops for its caller (D8). Its constraint "at most one notification" names the two accepted repeats: a stop between the push and its record (D10, item 5), and a change landing during a deploy's swap (D13).
- **Dated notes:** ADR-0005 item 4 (the check's two balances, table `checkedbalances`, one row); ADR-0007 (the check's push carries `data.balance`, the record's three fields, D14; C9b writes it); ADR-0010 (the check's notifications: `mutable` and `data.balance`, every allowed account, through the same sender, 24 hours and urgent).
- **`pm/progress.md`:** Q8 decided (outcome: N4; record: this design's D2); the roadmap change log (C9 split into C9a and C9b, N1); C9a's row in place of C9's. C9b's row is its own session's (agreed with it, 2026-11-21). Written at propose, 2026-11-21, with the roadmap below.
- **`pm/roadmap.md`** (N1): C9 becomes C9a and C9b in the overview, the main path and § 4; v2 needs both deployed; M7's inputs name both; § 3's and § 5's tables follow.
- **Conventions:** configuration.md (the `AccountCheck` and `CheckedBalances` sections; § Hand-provisioned secrets, one row; § Local development and tests, the parameter); testing.md (§ Time and the background job: the check is triggered through its endpoint, and a burst lined up by holding the bank's answer; § Fake bank: holding an answer); README.md § Backend code (the check endpoint beside the message endpoint as a key-protected anonymous address; one check at a time in memory, because the app runs one copy); their `.claude/rules/` mirrors.
- **Operations:** `iphone-shortcut.md` (new, D17); `expiring-approvals.md` § 7, the check key and the Shortcut (no expiry; how to restore and replace them); `local-secrets.md` (the laptop's key and its backup); `deployment.md` § The account check (the guided task, the table, the after-merge checks, a ready query of the checks and their answers per day, the check by hand).
- **Carried along, asked by C14's session:** in deployment.md § Requests per account (C14), the Prague times as plain text (`format_datetime(…, 'yyyy-MM-dd HH:mm')`, each query string on one line), because `az … --output table` prints them with a `Z` that reads as UTC; checked once, read-only.
- **`CLAUDE.md` § Commands:** the image quick start gets a made-up `AccountCheck__Key`; "Run the app" names the new parameter.

### D19 — Capabilities and scenarios *(propose)*

- **A new capability `account-check`:** the check is a behaviour of its own that later changes may extend (a backup check, another recipient rule). `push-sending` keeps the sender and gains the two members (D14).
- **15 automated scenarios and 1 manual row.** Explore's estimate was about 12. The four beyond it: the push carrying the balance (N2) and the owner's message carrying none, one on each side of C9b's contract; the change notified once after a failed push (D12); and the iPhone row explore named. "Every allowed account" is its own requirement, since it is K4's rule, not the change rule's.
- **Not scenarios:** the anonymous-endpoint list and the absence from `openapi.json` (convention tests); the log guard (D15); the start-up refusal without a key (unit tests, as C8a's settings); the queue's ordering rules beyond the two burst scenarios (unit tests).

### D20 — Software-factory records *(propose)*

The next free numbers when written:

- *(New)* A trigger that arrives in bursts: one check at a time, at most one waiting, later calls joining it, only the last notifying, and the notification built from two stored markers, never the live read (D10, D4). Links R-45 (the phone-triggered check).
- *(New)* Work a request starts but must finish: run it on the app's stopping token, never the request's, and let each caller only stop waiting (D8).
- *(New, and a divergence)* A conditional write after a side effect cannot stop the side effect repeating; a guard against two copies must claim before it acts. The project runs without one and accepts a rare duplicate (D13); the full version is the claim with a lease.
- *(New)* Text the server writes in the app's language and number format is formatted by hand when the image has no culture data (the chiseled .NET images run with invariant globalization), mirroring the frontend's rounding in whole numbers (D2).
- Inventory line: the acceptance driver's held bank answer and the queue count it waits for (template).

## Public API sketch

```csharp
// ---- src/RevolutReader.Api/Check/ ----

/// <summary>The AccountCheck section (D6), validated on start with AccountCheckOptionsValidator.</summary>
public sealed class AccountCheckOptions {
  public const string SECTION = "AccountCheck";
  [Required, NotSecretPlaceholder] public required string Key { get; init; }   // ≥ 32 bytes, base64url without padding
}
/// <summary>The key decodes (StrictBase64Url) to at least 32 bytes; the message names the setting, never a value.</summary>
public sealed class AccountCheckOptionsValidator : IValidateOptions<AccountCheckOptions>;

/// <summary>The two stored balances (D4).</summary>
public sealed record CheckedBalances(AccountBalance LastSeen, AccountBalance LastNotified) {
  /// <summary>They differ by at least a cent.</summary>
  public bool Changed { get; }
}

/// <summary>The stored balances (§ Ports and contracts).</summary>
public interface ICheckedBalanceStore {
  /// <summary>Both balances; null when nothing is stored yet.</summary>
  Task<CheckedBalances?> Read(CancellationToken cancellationToken);
  /// <summary>Replaces both, whole.</summary>
  Task Save(CheckedBalances balances, CancellationToken cancellationToken);
}

/// <summary>What a check came to (D11): whether last seen and last notified differ after its read and store.</summary>
public sealed record CheckOutcome(bool Changed);

/// <summary>One check (D3, D4, D10, D12), its three steps.</summary>
public interface IAccountCheck {
  /// <summary>
  /// Reads the balance for <paramref name="user"/>; on success keeps it as last seen (both, the first time). Then, unless
  /// <paramref name="anotherCheckWaits"/> says a check waits behind it, notifies a change from the stored balances and
  /// writes last notified. A failed read is the result, whatever the notify step did; storage failures throw.
  /// </summary>
  Task<BankResult<CheckOutcome>> Run(PresentUser user, Func<bool> anotherCheckWaits, CancellationToken cancellationToken);
}
public sealed class AccountCheck(ReadBalanceHandler reader, ICheckedBalanceStore store, ChangeNotifier notifier,
  ILogger<AccountCheck> logger) : IAccountCheck;

/// <summary>
/// One check at a time, at most one waiting, later callers joining it (D10). A singleton. Each check runs in its own DI scope
/// (IAccountCheck) on IHostApplicationLifetime.ApplicationStopping, never a caller's token (D8); a failed check is logged
/// here (CheckFailed) and never blocks the next.
/// </summary>
public sealed class AccountCheckQueue(IServiceScopeFactory scopes, IHostApplicationLifetime lifetime, ILogger<AccountCheckQueue> logger) {
  /// <summary>Starts a check, makes this call the waiting one, or joins the waiting one; the task ends with that check.</summary>
  public Task<BankResult<CheckOutcome>> Check(PresentUser user);
  /// <summary>How many calls wait behind the running check (the waiting one and those joined to it); read by the acceptance driver.</summary>
  public int CallersWaiting { get; }
}

/// <summary>Sends a change to every account on the allowlist, one at a time, through SendPushHandler (D5); sums the counts.</summary>
public sealed class ChangeNotifier(Allowlist allowlist, SendPushHandler sender, ILogger<ChangeNotifier> logger) {
  public Task Send(PushMessage message, CancellationToken cancellationToken);
}

/// <summary>The notification for a change (D2, D14), pure.</summary>
public static class ChangeNotification {
  /// <summary>Title "Odešlo …"/"Přišlo …" (the size of last seen − last notified), text "Zůstatek … (≈ … Kč)" of last seen,
  /// page "/", Balance = last seen. Throws ArgumentException when the two do not differ (a caller's bug).</summary>
  public static PushMessage For(CheckedBalances balances);
}

/// <summary>Czech amounts as the app writes them (D2), by hand: no-break spaces, decimal comma, U+2212.</summary>
public static class CzechAmounts {
  public static string Euros(decimal amount);                         // "45,20 €", "1 234,56 €", "−5,00 €"
  public static string WholeKoruna(decimal euros, decimal czkPerEur);  // the size, half up: "1 098 Kč"
}

/// <summary>Source-generated log lines (D15): no amount, time, email or key.</summary>
public static partial class CheckLog {
  public static partial void CheckEnded(ILogger logger, CheckEnd end);                                   // Information
  public static partial void ChangeSent(ILogger logger, int accounts, int delivered, int failed, int removed);   // Information
  public static partial void CheckFailed(ILogger logger, Exception exception);                          // Error
}
public enum CheckEnd { FirstBalanceKept, Unchanged, ChangeLeftToTheNextCheck, ChangeNotified, BankReadFailed }

/// <summary>
/// POST /api/account/check (D6–D8, D11): AllowAnonymous, Description(x => x.ExcludeFromDescription()), binds nothing.
/// MessageKeyCheck.Matches(X-Check-Key, AccountCheckOptions.Key) first → TypedResults.NotFound(); PresentUserFromRequest.Read
/// null → BankAnswers.NoPresentUser(); then AccountCheckQueue.Check(user).WaitAsync(ct): BankAnswers.From(result,
/// o => new AccountCheckResponse(o.Changed)); a failed check → 500 problem (already logged by the queue); the caller's
/// cancellation → nothing written (the request is gone).
/// </summary>
public sealed class AccountCheckEndpoint(AccountCheckQueue queue, IOptions<AccountCheckOptions> options) : EndpointWithoutRequest {
  public const string KEY_HEADER = "X-Check-Key";
}
public sealed record AccountCheckResponse(bool Changed);

public static class AccountCheckRegistration {
  /// <summary>AccountCheckOptions (+ validator, on start); AccountCheckQueue (singleton); AccountCheck as IAccountCheck and
  /// ChangeNotifier (scoped). The store comes from AddCheckedBalanceStore; the reader from AddBalance; the sender from AddPush.</summary>
  public static IServiceCollection AddAccountCheck(this IServiceCollection services);
}

// ---- src/RevolutReader.Api/Push/ (changed) ----
/// <summary>The balance a notification about the account carries (D14), as GET /api/balance answers it.</summary>
public sealed record PushBalance(decimal Amount, DateTimeOffset ReadAt, decimal CzkPerEur);   // JSON: amount, readAt, czkPerEur
public sealed record PushMessage(string Title, string? Text, string Page = "/", PushBalance? Balance = null);
// PushMessages.DeclarativeJson: with a Balance, "mutable": true at the top level and notification.data.balance; else neither.

// ---- src/RevolutReader.Api/Storage/ ----
public sealed class CheckedBalanceStoreOptions { public const string SECTION = "CheckedBalances"; public required string TableName { get; init; } }
/// <summary>ICheckedBalanceStore on Table Storage (D4): partition "check", row "balances"; six columns, amounts and rates as
/// invariant decimal strings; Save upserts the whole row; no row → null; a row it cannot read → InvalidOperationException
/// naming the column, never its value; the table created if missing, once per instance (TableCreation).</summary>
public sealed class TableCheckedBalanceStore(TableServiceClient tables, IOptions<CheckedBalanceStoreOptions> options) : ICheckedBalanceStore;
// StorageRegistration.AddCheckedBalanceStore(this IHostApplicationBuilder): the options (validated on start) and the store,
// on the tables client AddTransactionStore registered.

// Program.cs: builder.AddCheckedBalanceStore() after AddPushDeviceStore(); builder.Services.AddAccountCheck().
// AppHost: accountcheck-key (secret) → AccountCheck__Key.
```

```csharp
// ---- tests/RevolutReader.UnitTests/Check/ ----
// InMemoryCheckedBalanceStore : ICheckedBalanceStore — the fake, also compiled into the integration project.
// GatedAccountCheck : IAccountCheck — each Run waits until the test lets it end, records its user and what anotherCheckWaits said.
// AccountCheck's tests: a hand-written IBankAccount fake under ReadBalanceHandler (a FakeTimeProvider), the in-memory store,
//   a real SendPushHandler over InMemoryPushDeviceStore and StubPushDelivery (C8a's), Allowlist.Parse.

// ---- tests/RevolutReader.IntegrationTests ----
// Check/CheckedBalanceStoreContract.cs — abstract; InMemoryCheckedBalanceStoreContract and TableCheckedBalanceStoreContract (Azurite).

// ---- tests/RevolutReader.AcceptanceTests ----
// Drivers/AccountCheckDriver — Configure writes AccountCheck:Key (random per test); the phone (anonymous HttpClient:
//   X-Check-Key, User-Agent, X-Forwarded-For, no fetch metadata); a call with a wrong key and the same request to an
//   unknown /api address (WholeAnswer, as PushDriver); a call that names no browser; a call it cancels; the app copy's
//   ICheckedBalanceStore for GIVEN states; AccountCheckQueue.CallersWaiting through the app copy's services.
// Drivers/FakeBank + BankDriver — hold the balance answer until released; the balance requests received (exists).
// Drivers/FakePushService, TestDevice, ReceivedPush (the test-writer's) — read mutable and notification.data.balance.
// Drivers/AzuriteStorage.Configure also sets CheckedBalances:TableName.
// Dsl/CheckDsl.cs — AcceptanceTest.Check, calling only the driver:
public sealed class CheckDsl(AccountCheckDriver driver) {
  public Task HasKeptNothing();                                              // GIVEN: nothing stored (verifies)
  public Task HasKept(decimal lastSeen, decimal lastNotified);               // GIVEN: written into the app's store, read times "earlier"
  public Task<CheckAnswer> PhoneAsksForACheck();                             // the default phone: Shortcut browser name, a documentation address
  public Task<CheckAnswer> PhoneAsksForACheckFrom(UserAtDevice phone);
  public Task<CheckAnswer> AsksForACheckNamingNoBrowser();
  public Task<WholeAnswer> SomeoneAsksWithAWrongKey();
  public Task<WholeAnswer> AnUnknownApiAddressAnswers();                     // the same request, to an unknown /api address
  public Task<IReadOnlyList<CheckAnswer>> ChecksArriveWhileTheFirstReadsTheBank(int checks);   // holds, waits for CallersWaiting, releases
  public Task PhoneStopsWaitingWhileTheCheckReadsTheBank();                  // holds, cancels the call, releases
}
// Dsl/CheckAnswer(Changed, Problem): Changed true/false, or the problem (ProblemDescription) for a refusal or a bank failure.
// Dsl/PushReceived gains MarkedForServiceWorker (bool) and Balance (BalanceReading? : Amount, ReadAt, CzkPerEur).
// Dsl/PushDsl gains Eventually(PhoneForPush, count): waits (bounded, real time) until that many pushes reached the phone.
// Conventions/: AnonymousEndpointsTests gains "POST /api/account/check"; HiddenEndpointsTests (openapi.json has no
//   /api/account/check); AccountCheckTelemetryTests (D15).
```

## Rule ownership

| Rule (spec, ADR or decision) | Enforced by |
|---|---|
| Only with the check key; otherwise the unknown address's 404, before anything else | `AccountCheckEndpoint`, `MessageKeyCheck`; the catch-all's 404 through `UseStatusCodePages` |
| Hidden from the API description; on the anonymous list | `AccountCheckEndpoint` (`ExcludeFromDescription`); `HiddenEndpointsTests`, `AnonymousEndpointsTests` |
| The app refuses to start without a valid check key | `AccountCheckOptions`, `AccountCheckOptionsValidator`, `[NotSecretPlaceholder]` |
| One balance read, as the present user with the phone's headers; 400 without them | `AccountCheckEndpoint` (`PresentUserFromRequest`, `BankAnswers.NoPresentUser`), `AccountCheck` (`ReadBalanceHandler`) |
| Last seen written by every successful read; both on the first | `AccountCheck`, `ICheckedBalanceStore.Save` |
| A change is a difference of a cent or more | `CheckedBalances.Changed` |
| Notify only when no check waits behind; from the stored balances | `AccountCheck` (with `anotherCheckWaits` from `AccountCheckQueue`) |
| Title, text, spacing, rounding, start page | `ChangeNotification`, `CzechAmounts` |
| Every allowed account, one at a time | `ChangeNotifier` (`Allowlist.Addresses`, `SendPushHandler`) |
| `mutable` and `data.balance` on the check's pushes only | `PushMessages.DeclarativeJson` (`PushMessage.Balance`), set by `ChangeNotification` only |
| Last notified written once the sender has run, whatever its counts | `AccountCheck` |
| A failed read answers as the balance endpoint | `AccountCheckEndpoint` (`BankAnswers.From`) |
| One check at a time, at most one waiting, callers joining | `AccountCheckQueue` |
| A check never stops for its caller; the app's stop ends it | `AccountCheckQueue` (`ApplicationStopping`), `AccountCheckEndpoint` (`WaitAsync` on the caller's token) |
| Logs: no amount, time, email or key | `CheckLog`; guarded by `AccountCheckTelemetryTests` |
| Every scenario claimed exactly once | `TraceabilityTests` |

## Error model

| Operation | Value | Expected outcomes | Exceptions (bugs, infrastructure) |
|---|---|---|---|
| `AccountCheck.Run` | `CheckOutcome` | `BankAccessExpired`, `BankRateLimited`, `BankUnavailable` (the read's, `BankResult`) | the store's and the sender's failures; `BankReadException` (an answer the adapter cannot read); a non-euro balance (`ReadBalanceHandler`) |
| `AccountCheckQueue.Check` | the check's result | as above | as above, after logging `CheckFailed`; `OperationCanceledException` when the app stops |
| `ChangeNotifier.Send` | — | — (an account with no device is three zeros) | the sender's: the device table's failures |
| `ChangeNotification.For` | `PushMessage` | — | `ArgumentException` when the balances do not differ |
| `ICheckedBalanceStore` | the balances / — | — (nothing stored reads as `null`) | the adapter's `RequestFailedException`; a row it cannot read → `InvalidOperationException` naming the column, never its value |
| `POST /api/account/check` | 200 `{ changed }` | 404 (no key, as an unknown address), 400 (no present user), 429 and 503 (C13's bank problems) | → 500 problem description (the endpoint's, D11) |

- **No new union:** the check's result is `BankResult<CheckOutcome>`, so C13's `BankAnswers.From` maps it.
- **README.md's case → status table** gains no row: the check's answers are the existing rows (unknown address, no present user, the three bank cases).

## Ports and contracts

**`ICheckedBalanceStore`** (new; the in-memory fake `InMemoryCheckedBalanceStore` serves the unit tests):

- **`Read`:** both balances as saved (amount, read time and rate, to the cent and the tick of the stored time's precision); `null` when nothing was ever saved.
- **`Save`:** replaces both, whole; saving again leaves one record with the latest values.
- **Concurrency:** last write wins. One app copy runs one check at a time (D10), so its own writes never interleave; two copies during a deploy are not guarded (D13).
- **Failures:** an exception, never a result.
- **Real adapter:** `TableCheckedBalanceStore` on `Azure.Data.Tables` through C7b's tables client; Azurite locally and in tests; the deployed table with the app's managed identity.
- **Contract tests:** `[integration]`, the fake and the adapter against the same tests (testing.md § Integration tests): nothing stored reads `null`; a save reads back whole (a negative amount, a rate with decimals, a read time with its offset); a second save replaces the first.

**`IAccountCheck`** (new; a seam for the queue's rules, not an outside system): `GatedAccountCheck` in the queue's unit tests.

**Unchanged ports:** `IBankAccount` (one present-user balance read), `IPushDeviceStore` and `IPushDelivery` (through `SendPushHandler`).

## How each scenario is verified

| Scenarios | Level | Why |
|---|---|---|
| `account-check`: 14 of 15 | API acceptance tests in `Scenarios/AccountCheck/AccountCheckScenarios.cs`, with the fake bank, the fake push service and test devices | the default level: everything they assert is an answer of the API, a request the bank received or a push a push service received. The GIVEN of the stored balances is written through the app copy's own store (D16) |
| `account-check` / A real payment brings the notification on the iPhone | manual row in `tests/manual-scenarios.md`, on the owner's iPhone after the deploy; again at M7 on the daughter's | only a real Revolut notification fires the Shortcut, and only Apple's push service and the lock screen show the result |
| `push-sending` / The owner's message carries no balance | API acceptance test in `Scenarios/PushSending/PushSendingScenarios.cs` | as C8a's other sending scenarios |
| `push-sending` / Every push lives 24 hours and is urgent | unchanged, its existing test | the requirement's text changed, not this scenario |

## Cross-cutting effects

- **API contract / TS client:** none. The endpoint is excluded from the description; `openapi.json` and `schema.d.ts` stay as they are, and CI's drift check proves it.
- **Bicep:** D17. Linted (`az bicep lint`; a warning fails CI) and previewed before the PR.
- **AppHost and settings:** the parameter `accountcheck-key`; `appsettings.json` gains `AccountCheck` (`Key` `"<secret>"`) and `CheckedBalances` (`TableName` `checkedbalances`), each with its provenance comment.
- **Made-up values:** the OpenAPI export check, the CI image smoke run (`.github/workflows/ci.yml`) and `CLAUDE.md`'s image quick start get a made-up check key (any 32 random bytes in base64url).
- **ADRs, conventions, operations, the roadmap:** D18. **Software factory:** D20.

## Risks / Trade-offs

- **[The Shortcut's POST is refused by the cross-site rule]** (it sends `Sec-Fetch-Site` other than `same-origin` or `none`, or an `Origin`) → not expected: the Shortcut's request comes from Apple's URL loading, not a web page. The iPhone row would show a 403; the fix is to exempt this key-protected address from the rule, as the sign-in return is.
- **[The Shortcut gives up before a cold start ends]** → nothing is lost: the check runs on (D8), and the next notification's check finds nothing new or the rest.
- **[A burst during a deploy notifies twice]** → accepted (D13).
- **[The text differs from the app's in a space or a rounding]** → `CzechAmounts` is unit-tested on the board's examples and the app's rounding cases; the iPhone row shows the real thing.
- **[A leaked check key]** → someone could start checks: bank reads that carry their own address and browser name as the owner's, and a notification only when the balance really changed, never their text. No rate limit (as the message key). Replace the key in Key Vault and the Shortcut (`expiring-approvals.md` § 7).
- **[The first check after the deploy notifies nothing]** → by design (K3): a payment between the deploy and the first trigger is in the first stored balance. The daughter sees it in the app.
- **[C9b's service worker meets a balance older than its stored one]** → the push's `readAt` is *last seen*'s (D14); C9b compares it (its W2).
- **[Timing in the burst tests]** → the driver waits for the queue's count and holds the bank, never for real time, except a bounded wait for a push after the caller left.
- **[15 slices make a long `/tdd-apply`]** → several slices only close, because earlier ones turned them green (tasks.md).

## Bootstrap (before `/tdd-apply`)

No package and no probe: everything this change builds on is merged and was probed by C7a and C8a (the key's 404, `ExcludeFromDescription`, the harness's client address from `X-Forwarded-For`), and the push format was checked against the W3C draft (D14). The baseline: the full suite green, except the traceability check naming this change's 16 new scenarios.

## Migration plan

1. **Before `/tdd-apply`:** the baseline.
2. **During it,** after the last API slice: the guided task for the laptop's key (D17), then a local check with `aspire start --isolated` (the key passed as a `Parameters__*` environment variable from a worktree, never written to the shared user-secrets): a check with the laptop's key answers `changed` false twice (the Mock ASPSP's balance does not move), and a wrong key answers as an unknown address. The app's lines show `CheckEnded` with no amount.
3. **Before the merge** (workflow.md § 6, a change's path): the Bicep lint and the read-only preview (D17); the guided task for the production key, run by the owner, its read-back the secret's name; the push and a draft PR on the owner's go; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; the archive on the branch.
4. **After the merge:**
   - the deploy runs and the new revision starts (no missing secret);
   - read-only: the table `checkedbalances`, the container app's `accountcheck-key` secret and `AccountCheck__Key` setting;
   - the owner sets up the Shortcut (`docs/operations/iphone-shortcut.md`) and runs it by hand once: `{"changed":false}`, the first check keeping the balance;
   - the manual row: a real card payment brings the notification on the owner's iPhone, with the decided text; Claude reads the checks' requests and `CheckEnded` lines read-only.

   C9a's row stays `in progress` until the iPhone row, recorded through a small docs PR (workflow.md § 6, the exception for work on a real phone).
5. **Rollback:** revert the merge. The endpoint disappears, so the Shortcut's calls get the unknown address's 404 (harmless; the owner can switch the automation off). The stack deletes `checkedbalances`, which holds only the two balances: when the change returns, its first check writes both again and sends nothing. The Key Vault secret stays (hand-provisioned) and is reused.

## Open questions

None. D13 was decided by the owner on 2026-11-21.
