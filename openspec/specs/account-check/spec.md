# account-check Specification

## Purpose

The account check the owner's iPhone triggers on every Revolut notification: who may ask for it, how it reads the balance, the two balances it keeps, when and to whom it sends a notification and what that says, and how a burst of checks is run.

## Requirements

### Requirement: The check answers only with its key
`POST /api/account/check` SHALL run a check only when the request carries the check key, a key of its own, never the message key. Without the right key it SHALL answer exactly as an unknown `/api` address does, and SHALL read nothing at the bank and send nothing. The key is checked before anything else.

#### Scenario: A check without the right key gets the answer of an unknown address
- **GIVEN** the bank holds an available balance of 45.20 EUR
- **WHEN** someone asks for a check with a wrong check key
- **THEN** the answer is the same 404 problem description an unknown `/api` address gets
- **AND** the bank receives no request

### Requirement: The check reads the balance and the recent transactions as the phone present
Every check SHALL read, and read nothing else, the account's balance once and its transactions dated from the day before today once, both as a present user: the bank receives the address and the browser name the request came from (ADR-0008). A request that names no browser SHALL be refused with 400 and SHALL read nothing at the bank; it is never read without the user in its place.

#### Scenario: The bank sees the phone's address and browser name
- **GIVEN** the owner's phone is at the address 203.0.113.7, and its Shortcut names itself `BackgroundShortcutRunner/5114.0`
- **WHEN** the phone asks for a check with the check key
- **THEN** the bank receives one balance request and one transactions request, each as from a present user
- **AND** each carries the address 203.0.113.7 and that browser name

#### Scenario: A check that names no browser reads nothing at the bank
- **WHEN** a request asks for a check with the check key but names no browser
- **THEN** the answer is 400 with a problem description titled `Bad Request`
- **AND** the bank receives no request

#### Scenario: The check reads the transactions from yesterday on
- **GIVEN** today is 2026-11-20
- **WHEN** the owner's phone asks for a check
- **THEN** the bank is asked for the transactions from 2026-11-19

### Requirement: The check keeps two balances
The check SHALL keep two balances of its own, apart from the stored transactions: *last seen*, written by every successful balance read, and *last notified*, the balance at the last notification. When it holds neither, the first successful balance read SHALL write both and send nothing. Its answer SHALL be 200 with exactly `changed`: whether, after its balance read, last seen and last notified differ.

#### Scenario: The first check sends nothing
- **GIVEN** the check has kept no balance yet
- **AND** Lucie registered her phone for pushes
- **AND** the bank holds an available balance of 45.20 EUR
- **WHEN** the owner's phone asks for a check
- **THEN** her phone receives nothing
- **AND** the answer says nothing changed

### Requirement: A change since the last notification is notified
When last seen and last notified differ by at least a cent, the check SHALL send one notification. Its title SHALL be the difference without a sign, "Odešlo" when the balance fell and "Přišlo" when it rose; its text SHALL be the new balance with its koruna value at the app's rate (spec koruna-rate), rounded half up to whole koruna, as the app writes amounts; a tap SHALL open the app's start page. Then last notified becomes last seen.

#### Scenario: Money out is notified with the new balance
- **GIVEN** the check's last seen and last notified balances are 49.00 EUR
- **AND** Lucie registered her phone for pushes, and the bank holds an available balance of 45.20 EUR
- **AND** the CNB's latest rate is 24.6 CZK per euro
- **WHEN** the owner's phone asks for a check
- **THEN** her phone receives one notification titled "Odešlo 3,80 €" with the text "Zůstatek 45,20 € (≈ 1 112 Kč)", opening the app's address of the page `/`
- **AND** the answer says the balance changed

#### Scenario: Money in is notified with the new balance
- **GIVEN** the check's last seen and last notified balances are 45.20 EUR
- **AND** Lucie registered her phone for pushes, and the bank holds an available balance of 145.20 EUR
- **AND** the CNB's latest rate is 24.6 CZK per euro
- **WHEN** the owner's phone asks for a check
- **THEN** her phone receives one notification titled "Přišlo 100,00 €" with the text "Zůstatek 145,20 € (≈ 3 572 Kč)"

#### Scenario: An unchanged balance sends nothing
- **GIVEN** the check's last seen and last notified balances are 45.20 EUR
- **AND** Lucie registered her phone for pushes, and the bank holds an available balance of 45.20 EUR
- **WHEN** the owner's phone asks for a check
- **THEN** her phone receives nothing
- **AND** the answer says nothing changed

### Requirement: Every allowed account gets the notification
The notification SHALL go to every device registered under every account on the allowlist, the owner's included, and to no other device (spec push-sending).

#### Scenario: Every allowed account with a registered device gets the notification
- **GIVEN** the check's last seen and last notified balances are 49.00 EUR, and the bank holds an available balance of 45.20 EUR
- **AND** Lucie registered her phone for pushes, and Petr, also allowed, registered his
- **WHEN** the owner's phone asks for a check
- **THEN** Lucie's phone and Petr's phone each receive one notification titled "Odešlo 3,80 €"

### Requirement: The notification carries the new balance
Every notification the check sends SHALL carry the new balance in the fragment of its `navigate` address, never in `data` and never marked for the app's service worker (`mutable`): the balance exactly as `GET /api/balance` answers it, with `amount`, `readAt` and `czkPerEur` (spec account-balance; the rate of spec koruna-rate), and a check code made for the receiving device from its push subscription's secret, so that only that device can tell the server made it (spec push-display).

#### Scenario: The notification carries the new balance for the phone to keep
- **GIVEN** the check's last seen and last notified balances are 49.00 EUR
- **AND** Lucie registered her phone for pushes, and the bank holds an available balance of 45.20 EUR
- **AND** the CNB's latest rate is 24.6 CZK per euro
- **WHEN** the owner's phone asks for a check
- **THEN** the notification her phone receives is not marked for the app's service worker and has no `data`
- **AND** its address carries the balance with `amount` 45.20, `readAt` the time the server read it, and `czkPerEur` 24.6, with a check code her phone accepts

#### Scenario: Each device's notification carries a check code of its own
- **GIVEN** the check's last seen and last notified balances are 49.00 EUR, and the bank holds an available balance of 45.20 EUR
- **AND** Lucie registered her phone and her tablet for pushes
- **WHEN** the owner's phone asks for a check
- **THEN** her phone and her tablet each receive the balance with a check code it accepts
- **AND** the tablet does not accept the phone's check code

### Requirement: A bank failure answers as the balance does
When the check's balance read fails, the check SHALL keep no new balance and SHALL answer as `GET /api/balance` does (spec account-balance): 503 or 429 with the problem description whose `type` names the case. If the check then fails to send a change an earlier check kept, that failure SHALL decide the answer instead, as an unexpected failure does (spec api-errors).

#### Scenario: A failed bank read sends nothing and answers as the balance does
- **GIVEN** the check's last seen and last notified balances are 45.20 EUR
- **AND** Lucie registered her phone for pushes, and the bank reports an error of its own on every attempt
- **WHEN** the owner's phone asks for a check
- **THEN** the answer is 503 with a problem description of `type` `/problems/bank-unavailable`
- **AND** her phone receives nothing

### Requirement: One check at a time, one notification per burst
Checks SHALL run one at a time. While one runs, at most one SHALL wait; a request arriving while one waits joins it and gets its answer. A check with another waiting behind it SHALL leave the notification to that one. The notification SHALL be built from the kept balances, so a check whose own balance read fails still sends a change an earlier check kept.

#### Scenario: A burst of checks sends one notification and reads the bank at most twice
- **GIVEN** the check's last seen and last notified balances are 49.00 EUR
- **AND** Lucie registered her phone for pushes, and the bank holds an available balance of 45.20 EUR
- **WHEN** three checks arrive while the first is still reading the bank
- **THEN** the bank receives two balance requests and two transactions requests
- **AND** her phone receives one notification, titled "Odešlo 3,80 €"

#### Scenario: A check whose bank read fails still sends what an earlier check found
- **GIVEN** the check's last notified balance is 49.00 EUR and its last seen 45.20 EUR, no notification having gone out for it
- **AND** Lucie registered her phone for pushes, and the bank reports an error of its own on every attempt
- **WHEN** the owner's phone asks for a check
- **THEN** her phone receives one notification titled "Odešlo 3,80 €" with the text "Zůstatek 45,20 € (≈ 1 098 Kč)"

### Requirement: A check goes on without its caller
A check SHALL run to its end once started, whether or not its caller or any request that joined it is still waiting for the answer; only the app stopping ends it early.

#### Scenario: A check goes on when its caller stops waiting
- **GIVEN** the check's last seen and last notified balances are 49.00 EUR
- **AND** Lucie registered her phone for pushes, and the bank holds an available balance of 45.20 EUR
- **WHEN** the owner's phone asks for a check and stops waiting while the check is still reading the bank
- **THEN** her phone still receives one notification, titled "Odešlo 3,80 €"

### Requirement: A change is notified once
Last notified SHALL become last seen once the notification has been handed to every device, whatever each push service answered, so a change is never sent twice, also when a device's push failed and the push is not retried (spec push-sending).

#### Scenario: A change is not notified again after a device's push failed
- **GIVEN** the check's last seen and last notified balances are 49.00 EUR, and the bank holds an available balance of 45.20 EUR
- **AND** Lucie registered her phone for pushes, and her phone's push service fails with an error of its own once
- **WHEN** the owner's phone asks for a check, then another
- **THEN** her phone's push service receives only the first push
- **AND** the second answer says nothing changed

### Requirement: The notification reaches the iPhone
A real change on the account SHALL bring the check's notification to the owner's iPhone within a minute, through the Shortcut set up there, Apple's push service and the Home Screen app.

#### Scenario: A real payment brings the notification on the iPhone
- **GIVEN** the Shortcut is set up on the owner's iPhone, and the Home Screen app's notifications are allowed there
- **WHEN** the owner pays with the card
- **THEN** within a minute of Revolut's own notification, the app's notification shows on the lock screen, titled "Odešlo" with the amount, over "Zůstatek" with the new balance and its koruna value

### Requirement: The check records when it first reads a transaction
A check SHALL record when it first gets each transaction from the bank, by the same rule as the newest transactions read, so that the transaction's `seenAt` is the check's moment when the check read it first (spec account-transactions).

#### Scenario: A payment a check reads first carries the check's time
- **GIVEN** today is 2026-11-20 and it is 13:05:12 UTC
- **AND** the bank lists a pending card payment of 8.90 EUR to "Kavárna Na Rohu" on 2026-11-20, with its reference
- **WHEN** the owner's phone asks for a check, and at 13:20:00 UTC Lucie asks the API for her transactions
- **THEN** the payment's `seenAt` is 2026-11-20 13:05:12 UTC

### Requirement: The check keeps no transaction
A check SHALL keep none of the transactions it reads. Only the newest transactions read keeps them (spec account-transactions), so where that read starts depends on nothing a check read.

#### Scenario: Transactions a check reads are not kept
- **GIVEN** today is 2026-11-20, and the newest kept transaction is from 2026-09-30
- **AND** the bank lists a settled card payment of 12.30 EUR on 2026-11-19, with its reference
- **WHEN** the owner's phone asks for a check, and then Lucie asks the API for her transactions
- **THEN** her read asks the bank for the transactions from 2026-09-30

### Requirement: The transactions read never changes the notification
When a check's transactions read fails, at the bank or in storage, the check SHALL record nothing of it, and SHALL notify and answer exactly as its balance read decides.

#### Scenario: A failed transactions read leaves the check's notification and answer as they were
- **GIVEN** the check's last seen and last notified balances are 49.00 EUR
- **AND** Lucie registered her phone for pushes, and the bank holds an available balance of 45.20 EUR
- **AND** the bank reports an error of its own on every transactions request
- **WHEN** the owner's phone asks for a check
- **THEN** her phone receives one notification titled "Odešlo 3,80 €"
- **AND** the answer says the balance changed
