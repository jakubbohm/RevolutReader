# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: The check reads the balance as the phone present`
- TO: `### Requirement: The check reads the balance and the recent transactions as the phone present`

## MODIFIED Requirements

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

## ADDED Requirements

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
