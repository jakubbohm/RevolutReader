# account-balance Specification

## Purpose

The account's balance: the API that reads it live for the signed-in user and tells the bank's failures apart, and the account screen's header that shows it with its koruna value and freshness, refreshes it, keeps the last one on the phone, and names what went wrong.

## Requirements

### Requirement: The API reads the balance live
`GET /api/balance` SHALL read the account's available balance from the bank when asked, and answer exactly three fields: `amount`, the balance in euros; `readAt`, the time the server read it; and `czkPerEur`, the koruna rate the app converts with. Like every API address, it is for allowed, signed-in users only (spec sign-in).

#### Scenario: The balance comes with the time it was read and the koruna rate
- **GIVEN** Lucie is signed in
- **AND** the bank holds an available balance of 286.40 EUR
- **WHEN** she asks the API for the balance
- **THEN** the answer is exactly `amount` 286.40, `readAt` the time the server read it, and `czkPerEur` 24.3

### Requirement: The balance is read as the user present
Every balance read SHALL be made as the signed-in user present: the bank receives the address and the browser the request came from (ADR-0001). A request that names no browser SHALL be refused with 400 and SHALL read nothing at the bank. It is never read without the user in its place, which would count against the bank's 4 reads a day without the user.

#### Scenario: The bank sees the signed-in user's address and browser
- **GIVEN** Lucie is signed in on a phone at the address 203.0.113.7, whose browser names itself `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)`
- **WHEN** she asks the API for the balance
- **THEN** the bank receives one balance request as from a present user
- **AND** it carries the address 203.0.113.7 and that browser name

#### Scenario: A balance request without a browser name reads nothing at the bank
- **GIVEN** Lucie is signed in
- **WHEN** a request for the balance comes with her login but names no browser
- **THEN** the answer is 400 with a problem description titled `Bad Request`
- **AND** the bank receives no request

### Requirement: The bank's failures are told apart
When a balance read fails at the bank, the API SHALL answer a problem description whose `type` names the case, because two of the cases share a status:
- the bank's access to the account has expired: 503, `type` `/problems/bank-access-expired`;
- the bank's request limit is reached: 429, `type` `/problems/bank-rate-limited`;
- the bank is unavailable: 503, `type` `/problems/bank-unavailable`.

#### Scenario: Expired bank access answers its own problem
- **GIVEN** Lucie is signed in
- **AND** the bank reports that its access to the account has expired
- **WHEN** she asks the API for the balance
- **THEN** the answer is 503 with a problem description titled `Bank access expired`
- **AND** its `type` is `/problems/bank-access-expired`

#### Scenario: A reached bank limit answers its own problem
- **GIVEN** Lucie is signed in
- **AND** the bank reports that its request limit is reached
- **WHEN** she asks the API for the balance
- **THEN** the answer is 429 with a problem description titled `Bank rate limit reached`
- **AND** its `type` is `/problems/bank-rate-limited`

#### Scenario: A bank that does not answer is its own problem
- **GIVEN** Lucie is signed in
- **AND** the bank reports an error of its own on every attempt
- **WHEN** she asks the API for the balance
- **THEN** the answer is 503 with a problem description titled `Bank unavailable`
- **AND** its `type` is `/problems/bank-unavailable`

### Requirement: The balance header
The account screen SHALL show at its top "Na účtu máš", the balance in euros, its value in koruna rounded to whole crowns and marked as approximate, when the server read it, and the button "Obnovit".

#### Scenario: The account screen shows the balance, its koruna value and when it was read
- **GIVEN** Lucie is signed in
- **AND** the server read the balance two minutes ago: 286.40 EUR, at 24.3 CZK per euro
- **WHEN** she opens the app from the Home Screen
- **THEN** the screen shows "Na účtu máš", "286,40 €" and "≈ 6 960 Kč"
- **AND** "Aktualizováno před 2 min" with the button "Obnovit"

### Requirement: Refreshing the balance
The balance SHALL be read again when the user taps "Obnovit" and whenever the app comes back to the screen. While a read is under way, the header SHALL read "Obnovuji…" and keep the balance shown, and no second read SHALL start.

#### Scenario: Tapping "Obnovit" reads the balance again
- **GIVEN** Lucie sees 286,40 € on the account screen
- **AND** the bank now holds 301.90 EUR
- **WHEN** she taps "Obnovit"
- **THEN** the header reads "Obnovuji…" with 286,40 € still shown
- **AND** then shows 301,90 €

#### Scenario: Coming back to the app reads the balance again
- **GIVEN** Lucie sees 286,40 € on the account screen
- **AND** the bank now holds 301.90 EUR
- **WHEN** she leaves the app and comes back to it
- **THEN** the screen shows 301,90 €

### Requirement: The bank's failures on the screen
When a balance read fails at the bank, the screen SHALL keep the balance it shows and add one banner naming the case: "Banka teď neodpovídá" with "Zkusit znovu" when the bank does not answer, the warning "Příliš mnoho obnovení" when its limit is reached, "Propojení s bankou vypršelo" when its access has expired. With no balance to show, the banner SHALL stand alone under the top bar.

#### Scenario: A bank that does not answer shows a banner with a retry
- **GIVEN** the phone keeps a balance of 286,40 € read two hours ago
- **AND** the bank does not answer
- **WHEN** Lucie opens the app
- **THEN** it shows 286,40 € with "Aktualizováno před 2 h"
- **AND** the error "Banka teď neodpovídá" with "Zkus to prosím za chvíli." and the button "Zkusit znovu"

#### Scenario: Too many refreshes shows a warning with no action
- **GIVEN** Lucie sees 286,40 € on the account screen
- **AND** the bank's request limit is reached
- **WHEN** she taps "Obnovit"
- **THEN** 286,40 € stays shown
- **AND** the warning "Příliš mnoho obnovení" with "Banka teď další dotazy nepřijímá. Zkus to znovu později." and no button

#### Scenario: Expired bank access asks to let Dad know
- **GIVEN** the phone keeps no balance
- **AND** the bank's access to the account has expired
- **WHEN** Lucie opens the app
- **THEN** only the error "Propojení s bankou vypršelo" with "Obnovit propojení musí táta, dej mu prosím vědět." shows under the top bar
- **AND** it has no button

### Requirement: An unexpected answer to a balance read
When the server answers a balance read with anything the app does not expect (a server error, a hosting error page, an unreadable answer), the screen SHALL keep what it shows and add the error banner "Zůstatek se nepodařilo načíst" with "Zkus to prosím za chvíli." and "Zkusit znovu", which reads the balance again.

#### Scenario: An unexpected answer to the balance read shows a banner with a retry
- **GIVEN** Lucie is signed in
- **AND** the server answers the balance read with an error of its own
- **WHEN** she opens the app
- **THEN** it shows the error "Zůstatek se nepodařilo načíst" with "Zkus to prosím za chvíli." and "Zkusit znovu"
- **AND** tapping "Zkusit znovu" reads the balance again

### Requirement: The phone keeps the last balance
After every successful read, the phone SHALL keep the balance, the time the server read it and the rate, replacing the one kept before, so the app can show it while the server wakes up and when the phone is offline (spec app-shell).

#### Scenario: A balance read replaces the one the phone keeps
- **GIVEN** the phone keeps a balance of 250,00 € read two hours ago
- **AND** the server reads 286.40 EUR
- **WHEN** Lucie opens the app and the balance arrives
- **THEN** the next time she opens the app offline, it shows 286,40 €

### Requirement: The kept balance is forgotten when the login ends
The phone SHALL forget the kept balance after a sign-out the server confirmed, and whenever the server answers that the device has no allowed login (401 or 403), so a device without a login holds no bank data. A sign-out that failed SHALL keep it.

#### Scenario: Signing out forgets the balance on the phone
- **GIVEN** Lucie sees 286,40 € on the account screen
- **WHEN** she signs out from the account menu
- **THEN** the next time the app is opened offline, it shows no balance

#### Scenario: A login that has ended forgets the balance on the phone
- **GIVEN** the phone keeps a balance of 286,40 €
- **AND** the server answers that nobody is signed in
- **WHEN** the app is opened
- **THEN** it shows the sign-in screen
- **AND** the next time it is opened offline, it shows no balance
