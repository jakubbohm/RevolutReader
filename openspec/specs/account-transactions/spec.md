# account-transactions Specification

## Purpose

The account's transactions: the API that reads the newest ones live for the signed-in user, keeps the settled ones and pages back through them, and the account screen's list that shows them by day, opens their details, loads older ones by itself and names what went wrong.

## Requirements

### Requirement: The API answers the newest transactions live
`GET /api/transactions` SHALL read the account's transactions from the bank when asked and answer those dated from 31 days before today, pending ones included, newest first and in the bank's order within a day, with exactly `transactions`, `olderBefore` (the day before which older ones are kept, else null), `czkPerEur` and `rateDate`. Each transaction SHALL carry exactly `date`, `amount`, `currency`, `pending`, `counterparty`, `details` and `kind`.

#### Scenario: The newest transactions come live with the koruna rate
- **GIVEN** today is 2026-11-20 and Lucie is signed in
- **AND** the bank lists a pending card payment of 8.90 EUR to "Kavárna Na Rohu" on 2026-11-19
- **AND** a booked card payment of 12.30 EUR to "Pekárna U Lípy" on 2026-11-18, with the detail "Praha 2"
- **WHEN** she asks the API for her transactions
- **THEN** it answers the pending card payment of -8.90 EUR on 2026-11-19, then the settled one of -12.30 EUR on 2026-11-18 with the detail "Praha 2", each with its counterparty
- **AND** nothing older kept, the koruna rate 24.3 and its date 2026-11-08

### Requirement: The live read reaches back to what is kept
The live read SHALL start at the earlier of 31 days before today and the newest day of the kept transactions, but never more than 89 days before today, so that a pause in use leaves no gap in the history while the bank still serves it. With nothing kept, it SHALL start 89 days before today.

#### Scenario: The live read covers the last 31 days
- **GIVEN** today is 2026-11-20 and Lucie is signed in
- **AND** the newest kept transaction is from 2026-11-19
- **WHEN** she asks the API for her transactions
- **THEN** the bank is asked for the transactions from 2026-10-20

#### Scenario: After a long pause, the live read reaches back to the newest kept day
- **GIVEN** today is 2026-11-20 and Lucie is signed in
- **AND** the newest kept transaction is from 2026-09-30
- **WHEN** she asks the API for her transactions
- **THEN** the bank is asked for the transactions from 2026-09-30

#### Scenario: With nothing kept, the live read reaches back 89 days
- **GIVEN** today is 2026-11-20 and Lucie is signed in
- **AND** no transaction is kept
- **WHEN** she asks the API for her transactions
- **THEN** the bank is asked for the transactions from 2026-08-23

### Requirement: Settled transactions are kept, pending ones never
Every settled transaction a live read returns SHALL be kept, so that it stays in the history after the bank stops listing it. Keeping one again SHALL change nothing. A pending transaction SHALL never be kept.

#### Scenario: A settled transaction stays in the history after the bank stops listing it
- **GIVEN** on 2026-11-20 Lucie was answered a settled payment of 12.30 EUR to "Pekárna U Lípy" on 2026-11-18
- **AND** on 2026-12-30 the bank no longer lists it
- **WHEN** she asks the API for her transactions before 2026-11-29
- **THEN** the answer holds the payment of -12.30 EUR to "Pekárna U Lípy" on 2026-11-18

#### Scenario: A pending transaction is never kept
- **GIVEN** on 2026-11-20 Lucie was answered a pending card payment of 8.90 EUR on 2026-11-19 and nothing else
- **AND** the bank no longer lists it
- **WHEN** she asks the API for her transactions before 2026-11-21
- **THEN** the answer holds no transaction

### Requirement: Older transactions come from storage
`GET /api/transactions/older?before=<date>` SHALL answer the kept transactions dated before that date, newest first, in whole days: it adds days until the page holds at least 30 transactions or nothing older is left. It SHALL answer the same fields as the newest page, `olderBefore` naming the page's oldest day while older ones are kept, and SHALL NOT read the bank.

#### Scenario: Older transactions come from storage in pages of whole days
- **GIVEN** Lucie is signed in
- **AND** 45 settled transactions are kept: 10 on 2026-10-19, 15 on 2026-10-18, 10 on 2026-10-17 and 10 on 2026-10-16
- **WHEN** she asks the API for her transactions before 2026-10-20
- **THEN** the answer holds the 35 transactions of 2026-10-19 to 2026-10-17, newest first, and says older ones are kept before 2026-10-17
- **AND** the bank receives no request

#### Scenario: The oldest page says nothing older is kept
- **GIVEN** Lucie is signed in
- **AND** 12 settled transactions are kept, all from before 2026-10-20
- **WHEN** she asks the API for her transactions before 2026-10-20
- **THEN** the answer holds the 12 transactions and says nothing older is kept

### Requirement: What a transaction says
A transaction's `details` SHALL be the bank's lines without blank lines and without any line that repeats its counterparty, compared ignoring letter case, accents and spacing. Its `kind` SHALL come from the bank's type code: a card payment, a top-up, a transfer, a cash withdrawal or an exchange; a refund for any code containing `REFUND`; otherwise other.

#### Scenario: The bank's text leaves out the line that repeats the counterparty
- **GIVEN** Lucie is signed in
- **AND** the bank lists a booked card payment of 12.30 EUR to "Pekárna U Lípy" with the details "PEKARNA U LIPY" and "Praha 2"
- **WHEN** she asks the API for her transactions
- **THEN** the payment's details are only "Praha 2"

#### Scenario: A refund is told by the bank's type code
- **GIVEN** Lucie is signed in
- **AND** the bank lists 5.95 EUR received from "Lékárna Benu" with the type code "CARD_REFUND"
- **WHEN** she asks the API for her transactions
- **THEN** that transaction's kind is a refund

### Requirement: The transactions are read as the user present
Every live read SHALL be made as the signed-in user present: the bank receives the address and the browser the request came from (ADR-0001). A request for the newest transactions that names no browser SHALL be refused with 400 and SHALL read nothing at the bank. It is never read without the user in its place, which would count against the bank's 4 reads a day without the user.

#### Scenario: The bank sees the signed-in user's address and browser
- **GIVEN** Lucie is signed in on a phone at the address 203.0.113.7, whose browser names itself `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)`
- **WHEN** she asks the API for her transactions
- **THEN** the bank receives one transactions request as from a present user
- **AND** it carries the address 203.0.113.7 and that browser name

#### Scenario: A transactions request without a browser name reads nothing at the bank
- **GIVEN** Lucie is signed in
- **WHEN** a request for her transactions comes with her login but names no browser
- **THEN** the answer is 400 with a problem description titled `Bad Request`
- **AND** the bank receives no request

### Requirement: The bank's failures are told apart
When the live read fails at the bank, the API SHALL answer no transactions but a problem description whose `type` names the case:
- the bank's access to the account has expired: 503, `type` `/problems/bank-access-expired`;
- the bank's request limit is reached: 429, `type` `/problems/bank-rate-limited`;
- the bank is unavailable: 503, `type` `/problems/bank-unavailable`.

#### Scenario: Expired bank access answers its own problem
- **GIVEN** Lucie is signed in
- **AND** the bank reports that its access to the account has expired
- **WHEN** she asks the API for her transactions
- **THEN** the answer is 503 with a problem description titled `Bank access expired`
- **AND** its `type` is `/problems/bank-access-expired`

#### Scenario: A reached bank limit answers its own problem
- **GIVEN** Lucie is signed in
- **AND** the bank reports that its request limit is reached
- **WHEN** she asks the API for her transactions
- **THEN** the answer is 429 with a problem description titled `Bank rate limit reached`
- **AND** its `type` is `/problems/bank-rate-limited`

#### Scenario: A bank that does not answer is its own problem
- **GIVEN** Lucie is signed in
- **AND** the bank reports an error of its own on every attempt
- **WHEN** she asks the API for her transactions
- **THEN** the answer is 503 with a problem description titled `Bank unavailable`
- **AND** its `type` is `/problems/bank-unavailable`

### Requirement: The list on the account screen
The account screen SHALL list the transactions under the balance, grouped by day, newest first. Each day SHALL have a heading ("Dnes", "Včera", else the weekday and the date, with the year outside the current year) with that day's money received and spent, and its transactions in the order the API answered them.

#### Scenario: The account screen lists the transactions by day, newest first
- **GIVEN** today is 2026-11-20 and Lucie is signed in
- **AND** the API answers a payment of -3.80 EUR today, a top-up of 50.00 EUR yesterday and a payment of -12.30 EUR on 2026-11-18
- **WHEN** she opens the app
- **THEN** the list shows "Dnes", "Včera" and "středa 18. listopadu" in that order, each with its transaction
- **AND** "Včera" shows 50,00 € received

### Requirement: A transaction's row
Each row SHALL show the counterparty, else the word for the transaction's kind; under it the bank's text, its lines joined by " · ", else the kind's word unless the first line shows it already; for a pending transaction "Čeká na zpracování" instead; and the amount in euros with its sign and its value in koruna, rounded to whole crowns and marked as approximate. A refund whose first line is the counterparty and whose second line is the bank's text SHALL show the mark "Vrácení" before that text.

#### Scenario: A row shows the counterparty, the bank's text and the amount with its koruna value
- **GIVEN** Lucie is signed in
- **AND** the API answers a settled card payment of -12.30 EUR to "Pekárna U Lípy" with the detail "Praha 2"
- **WHEN** she opens the app
- **THEN** its row shows "Pekárna U Lípy", "Praha 2", "−12,30 €" and "≈ 299 Kč"

#### Scenario: A row without the bank's own text names the kind of payment
- **GIVEN** Lucie is signed in
- **AND** the API answers a settled card payment of -12.30 EUR to "Pekárna U Lípy" with no details
- **WHEN** she opens the app
- **THEN** its row shows "Pekárna U Lípy" over "Platba kartou"

#### Scenario: A row without a counterparty names the kind of transaction
- **GIVEN** Lucie is signed in
- **AND** the API answers a settled cash withdrawal of -40.00 EUR with no counterparty and the detail "Bankomat Můstek"
- **WHEN** she opens the app
- **THEN** its row shows "Výběr z bankomatu" over "Bankomat Můstek"

#### Scenario: A pending transaction is marked as waiting
- **GIVEN** Lucie is signed in
- **AND** the API answers a pending card payment of -8.90 EUR to "Kavárna Na Rohu"
- **WHEN** she opens the app
- **THEN** its row shows "Kavárna Na Rohu" over "Čeká na zpracování", and "−8,90 €"

#### Scenario: A refund is marked as one in the list and in its details
- **GIVEN** Lucie is signed in
- **AND** the API answers a settled refund of 5.95 EUR from "Lékárna Benu" with the detail "Reklamace"
- **WHEN** she opens the app and taps its row
- **THEN** the row shows "Vrácení" before "Reklamace", and "+5,95 €"
- **AND** its details say "Vrácení peněz" and "Vráceno na účet"

### Requirement: The words for a transaction's kind
Where a row or its details name a transaction's kind, they SHALL say "Platba kartou" for a card payment, "Dobití účtu" for a top-up, "Převod" for a transfer, "Výběr z bankomatu" for a cash withdrawal, "Směna měny" for an exchange, "Vrácení peněz" for a refund, and otherwise "Příchozí platba" for money received or "Odchozí platba" for money spent.

#### Scenario: A row without a counterparty or text names an unknown kind by its direction
- **GIVEN** Lucie is signed in
- **AND** the API answers a settled transaction of 20.00 EUR received, of the kind other, with no counterparty and no details
- **WHEN** she opens the app
- **THEN** its row shows "Příchozí platba" and "+20,00 €"

### Requirement: A transaction's details
Tapping a row SHALL open its details: the row's first line as the title; under it the word for the transaction's kind, unless the title is that word; the amount with its koruna value; the status ("Zaúčtováno", "Vráceno na účet" or "Čeká na zpracování"); the date; under "Popis" the bank's text, only when there is any; and the rate the koruna value uses, with its date. Escape, the close button or a tap outside SHALL close them.

#### Scenario: Tapping a transaction opens its details
- **GIVEN** Lucie is signed in
- **AND** the API answers a settled card payment of -12.30 EUR on 2026-11-18 to "Pekárna U Lípy" with the detail "Praha 2"
- **WHEN** she taps its row
- **THEN** the details show "Pekárna U Lípy", "Platba kartou", "−12,30 €", "≈ 299 Kč", "Zaúčtováno" and "18. 11. 2026"
- **AND** "Popis" with "Praha 2", and "1 € ≈ 24,30 Kč · orientační kurz z 8. 11. 2026"

#### Scenario: The details leave out the description when the bank gave no text of its own
- **GIVEN** Lucie is signed in
- **AND** the API answers a settled card payment of -12.30 EUR to "Pekárna U Lípy" with no details
- **WHEN** she taps its row
- **THEN** the details show no "Popis"

### Requirement: Older transactions load by themselves
When the end of the list comes near and older transactions are kept, the screen SHALL ask for the next older page by itself and add it at the end, with the row "Načítám starší pohyby" while it comes. A page that fails to load SHALL leave the row "Starší pohyby se nepodařilo načíst" with "Zkusit znovu", which alone tries it again, and keep the list. Where the history ends, the list SHALL end with "Žádné starší pohyby" and the screen SHALL ask for nothing more.

#### Scenario: Older transactions load when the list reaches its end
- **GIVEN** Lucie is signed in and the API says older transactions are kept before 2026-10-20
- **AND** the next older page holds a payment of -7.50 EUR to "Knihkupectví Luxor" on 2026-10-15
- **WHEN** she scrolls to the end of the list
- **THEN** "čtvrtek 15. října" with "Knihkupectví Luxor" joins the end of the list

#### Scenario: Older transactions that failed to load can be tried again
- **GIVEN** Lucie is signed in and the API says older transactions are kept before 2026-10-20
- **AND** the first request for them fails with an error of the server
- **WHEN** she scrolls to the end of the list
- **THEN** the row "Starší pohyby se nepodařilo načíst" with "Zkusit znovu" shows under the list
- **AND** tapping "Zkusit znovu" adds the older transactions

#### Scenario: The list ends where the history ends
- **GIVEN** Lucie is signed in and the API says nothing older is kept
- **WHEN** she scrolls to the end of the list
- **THEN** the list ends with "Žádné starší pohyby"
- **AND** the app asks for no older transactions

### Requirement: The list while it loads and when it is empty
While the newest transactions load and the server is awake, the list SHALL show placeholders, announced as "Načítám pohyby". With no transaction at all, it SHALL say "Zatím žádné pohyby" and "Jakmile proběhne první platba, uvidíš ji tady.".

#### Scenario: The list shows placeholders while the transactions load
- **GIVEN** Lucie is signed in and the server is awake
- **AND** the transactions have not come yet
- **WHEN** she opens the app
- **THEN** the list shows placeholders announced as "Načítám pohyby"

#### Scenario: An account with no transactions says so
- **GIVEN** Lucie is signed in
- **AND** the API answers no transactions and nothing older kept
- **WHEN** she opens the app
- **THEN** the list says "Zatím žádné pohyby" and "Jakmile proběhne první platba, uvidíš ji tady."

### Requirement: The bank's failures on the list
When the newest transactions fail at the bank, the screen SHALL keep any list it shows and add one banner naming the case: "Propojení s bankou vypršelo" when the access has expired; the warning "Příliš mnoho obnovení" when the limit is reached; "Pohyby se nepodařilo načíst" with "Zkusit znovu" when the bank does not answer.

#### Scenario: Expired bank access asks to let Dad know about the transactions
- **GIVEN** Lucie is signed in
- **AND** the bank's access to the account has expired
- **WHEN** she opens the app
- **THEN** the error "Propojení s bankou vypršelo" with "Obnovit propojení musí táta, dej mu prosím vědět." shows, with no button
- **AND** no transactions show

#### Scenario: Too many refreshes shows a warning instead of the transactions
- **GIVEN** Lucie is signed in
- **AND** the bank's request limit is reached for the transactions
- **WHEN** she opens the app
- **THEN** the warning "Příliš mnoho obnovení" with "Banka teď další dotazy nepřijímá. Zkus to znovu později." shows, with no button
- **AND** no transactions show

#### Scenario: A bank that does not answer the transactions shows a retry
- **GIVEN** Lucie is signed in
- **AND** the bank does not answer the transactions read
- **WHEN** she opens the app
- **THEN** the error "Pohyby se nepodařilo načíst" with "Banka teď neodpovídá. Zkus to prosím za chvíli." and "Zkusit znovu" shows
- **AND** tapping "Zkusit znovu" shows the transactions once the bank answers

### Requirement: An unexpected answer to the transactions read
When the server answers the newest transactions with anything the app does not expect (a server error, a hosting error page, an unreadable answer), the screen SHALL keep any list it shows and add the error banner "Pohyby se nepodařilo načíst" with "Zkus to prosím za chvíli." and "Zkusit znovu", which reads the transactions again.

#### Scenario: An unexpected answer to the transactions read shows a retry
- **GIVEN** Lucie is signed in
- **AND** the server answers the transactions read with an error of its own
- **WHEN** she opens the app
- **THEN** the error "Pohyby se nepodařilo načíst" with "Zkus to prosím za chvíli." and "Zkusit znovu" shows
- **AND** tapping "Zkusit znovu" reads the transactions again

### Requirement: The transactions offline
When the newest transactions are due and the phone says it is offline, or no answer comes within 60 s, the list SHALL say "Pohyby se načtou, jakmile budeš online." and SHALL load by itself once the phone is back online.

#### Scenario: Offline, the transactions load once the phone is back online
- **GIVEN** Lucie is signed in and the phone keeps a balance
- **AND** the phone is offline
- **WHEN** she opens the app
- **THEN** the list says "Pohyby se načtou, jakmile budeš online."
- **AND** once the phone is back online, the transactions show

### Requirement: The transactions refresh with the balance
The transactions SHALL be read again whenever the balance is, at the same time: on "Obnovit", on every return to the app and when the phone is back online. A refresh SHALL replace the newest transactions and keep the older pages loaded. "Obnovuji…" SHALL last until both answers have come. A list on screen SHALL stay through a refresh that fails.

#### Scenario: Refreshing replaces the newest transactions and keeps the older ones
- **GIVEN** Lucie has scrolled back to her transactions of 2026-10-15
- **AND** a payment of -3.80 EUR to "Trafika Můstek" has settled since
- **WHEN** she taps "Obnovit"
- **THEN** "Trafika Můstek" shows at the top of the list
- **AND** the transactions of 2026-10-15 stay

#### Scenario: "Obnovuji…" lasts until the transactions have come too
- **GIVEN** Lucie sees her balance and her transactions
- **AND** on the next refresh the balance answers at once and the transactions after 3 s
- **WHEN** she taps "Obnovit"
- **THEN** the header reads "Obnovuji…" until the transactions have come

#### Scenario: The transactions stay on screen through a failed refresh
- **GIVEN** Lucie sees her transactions
- **AND** the bank now does not answer the transactions read
- **WHEN** she taps "Obnovit"
- **THEN** her transactions stay shown under the error "Pohyby se nepodařilo načíst"

### Requirement: One banner for the balance and the transactions
When both reads have a problem, the screen SHALL show only the most important one, in this order: offline; expired bank access; the request limit; the bank not answering, worded "Banka teď neodpovídá" when both failed; the balance's unexpected answer; the transactions' unexpected answer. "Zkusit znovu" SHALL read both again. An older page's failure SHALL stay in its own row.

#### Scenario: A bank that answers neither read shows one banner
- **GIVEN** Lucie is signed in
- **AND** the bank answers neither the balance read nor the transactions read
- **WHEN** she opens the app
- **THEN** one error shows: "Banka teď neodpovídá" with "Zkus to prosím za chvíli." and "Zkusit znovu"
- **AND** tapping "Zkusit znovu" reads the balance and the transactions again

### Requirement: The transactions while the server wakes
When the server woke on opening, the waiting screen SHALL stay in the list's place until the newest transactions have come, and they SHALL then replace it directly, with no placeholders in between.

#### Scenario: After the server wakes, the transactions replace the waiting screen directly
- **GIVEN** Lucie is signed in and the phone keeps a balance
- **AND** the server takes 20 s to wake up
- **WHEN** she opens the app
- **THEN** "Server se probouzí" shows under the kept balance until the transactions have come
- **AND** the transactions then replace it with no placeholders in between
