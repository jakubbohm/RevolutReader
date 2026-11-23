# Spec Delta

## MODIFIED Requirements

### Requirement: The API answers the newest transactions live
`GET /api/transactions` SHALL read the account's transactions from the bank when asked and answer those dated from 31 days before today, pending ones included, newest first and in the bank's order within a day, with exactly `transactions`, `olderBefore` (the day before which older ones are kept, else null), `czkPerEur` and `rateDate` (the koruna rate and the day it is for, spec koruna-rate). Each transaction SHALL carry exactly `date`, `amount`, `currency`, `pending`, `counterparty`, `details`, `kind` and `seenAt` (its approximate time, below).

#### Scenario: The newest transactions come live with the koruna rate
- **GIVEN** today is 2026-11-20, the CNB's latest rate is 24.38 CZK per euro for 2026-11-19, and Lucie is signed in
- **AND** the bank lists a pending card payment of 8.90 EUR to "Kavárna Na Rohu" on 2026-11-19
- **AND** a booked card payment of 12.30 EUR to "Pekárna U Lípy" on 2026-11-18, with the detail "Praha 2"
- **WHEN** she asks the API for her transactions
- **THEN** it answers the pending card payment of -8.90 EUR on 2026-11-19, then the settled one of -12.30 EUR on 2026-11-18 with the detail "Praha 2", each with its counterparty
- **AND** nothing older kept, the koruna rate 24.38 and its date 2026-11-19

### Requirement: The list on the account screen
The account screen SHALL list the transactions under the balance, grouped by day, newest first. A transaction's day SHALL be the phone's local date of its approximate time when it has one, else its date. Each day SHALL have a heading ("Dnes", "Včera", else the weekday and the date, with the year outside the current year) with that day's money received and spent, and its transactions with newer dates first, each date's in the order the API answered them.

#### Scenario: The account screen lists the transactions by day, newest first
- **GIVEN** today is 2026-11-20 and Lucie is signed in
- **AND** the API answers a payment of -3.80 EUR today, a top-up of 50.00 EUR yesterday and a payment of -12.30 EUR on 2026-11-18
- **WHEN** she opens the app
- **THEN** the list shows "Dnes", "Včera" and "středa 18. listopadu" in that order, each with its transaction
- **AND** "Včera" shows 50,00 € received

#### Scenario: A payment seen after midnight is listed under the next day
- **GIVEN** today is 2026-11-17, Lucie is signed in, and her phone is set to Prague time
- **AND** the API answers a card payment of -3.80 EUR on 2026-11-15, then a transfer of 30.00 EUR from "Táta" on 2026-11-14 with `seenAt` 2026-11-14 23:20:00 UTC
- **WHEN** she opens the app
- **THEN** "neděle 15. listopadu" lists the card payment, then the transfer, and no "sobota 14. listopadu" heading shows
- **AND** "neděle 15. listopadu" shows 30,00 € received and 3,80 € spent

### Requirement: A transaction's details
Tapping a row SHALL open its details: the row's first line as the title; under it the word for the transaction's kind, unless the title is that word; the amount with its koruna value; the status ("Zaúčtováno", "Vráceno na účet" or "Čeká na zpracování"); its day, as the list groups it, followed, when it has an approximate time, by ", kolem" and that time in the phone's local time; under "Popis" the bank's text, only when there is any; and the rate the koruna value uses, with its date. Escape, the close button or a tap outside SHALL close them.

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

#### Scenario: The details show the approximate time after the date
- **GIVEN** Lucie is signed in and her phone is set to Prague time
- **AND** the API answers a settled card payment of -12.30 EUR on 2026-11-18 to "Pekárna U Lípy" with `seenAt` 2026-11-18 13:05:12 UTC
- **WHEN** she taps its row
- **THEN** the details show "18. 11. 2026, kolem 14:05"

#### Scenario: The details of a payment seen after midnight show the next day
- **GIVEN** Lucie is signed in and her phone is set to Prague time
- **AND** the API answers a transfer of 30.00 EUR from "Táta" on 2026-11-14 with `seenAt` 2026-11-14 23:20:00 UTC
- **WHEN** she taps its row
- **THEN** the details show "15. 11. 2026, kolem 0:20"

## ADDED Requirements

### Requirement: A transaction's approximate time
A transaction's `seenAt` SHALL be when the app first got it from the bank, in UTC to the whole second, by any read of the transactions: the newest page's, whoever asks, or an account check's (spec account-check). It SHALL be given only when that moment fell on the transaction's date, which the bank counts in UTC, and otherwise SHALL be null, as for a transaction without the bank's reference. It SHALL stay when the transaction settles, and older pages SHALL carry it too.

#### Scenario: A transaction first read on its own day carries the time it was first read
- **GIVEN** today is 2026-11-20, it is 13:05:12 UTC, and Lucie is signed in
- **AND** the bank lists a pending card payment of 8.90 EUR to "Kavárna Na Rohu" on 2026-11-20, with its reference
- **WHEN** she asks the API for her transactions
- **THEN** the payment's `seenAt` is 2026-11-20 13:05:12 UTC

#### Scenario: A later read keeps the first time
- **GIVEN** today is 2026-11-20 and Lucie is signed in
- **AND** at 13:05:12 UTC she was answered a pending card payment of 8.90 EUR on 2026-11-20, which the bank lists with its reference
- **WHEN** she asks the API for her transactions again at 13:40:00 UTC
- **THEN** the payment's `seenAt` is still 2026-11-20 13:05:12 UTC

#### Scenario: The time stays when the payment settles
- **GIVEN** at 13:05:12 UTC on 2026-11-20 Lucie was answered a pending card payment of 8.90 EUR on 2026-11-20, which the bank lists with its reference
- **AND** on 2026-11-21 the bank lists it settled, under the same reference and date
- **WHEN** she asks the API for her transactions
- **THEN** the settled payment's `seenAt` is 2026-11-20 13:05:12 UTC

#### Scenario: A transaction first read after its own day carries no time
- **GIVEN** today is 2026-11-21, it is 00:10:00 UTC, and Lucie is signed in
- **AND** the bank lists a settled card payment of 12.30 EUR on 2026-11-20 with its reference, which the app has not read before
- **WHEN** she asks the API for her transactions
- **THEN** the payment's `seenAt` is null

#### Scenario: A transaction without the bank's reference carries no time
- **GIVEN** today is 2026-11-20, it is 13:05:12 UTC, and Lucie is signed in
- **AND** the bank lists a pending card payment of 8.90 EUR on 2026-11-20 without a reference
- **WHEN** she asks the API for her transactions
- **THEN** the payment's `seenAt` is null

#### Scenario: A kept transaction on an older page carries its time
- **GIVEN** at 13:05:12 UTC on 2026-11-20 Lucie was answered a settled card payment of 12.30 EUR to "Pekárna U Lípy" on 2026-11-20, which the bank lists with its reference
- **AND** on 2026-12-30 the bank no longer lists it
- **WHEN** she asks the API for her transactions before 2026-11-29
- **THEN** the answer holds the payment with `seenAt` 2026-11-20 13:05:12 UTC
