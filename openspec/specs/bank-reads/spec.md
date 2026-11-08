# bank-reads Specification

## Purpose

Reads the balance and transactions of the one linked bank account through Enable Banking, read-only, with the user headers the bank's limits require, and reports the bank's expected failures as results. It is the contract the account detail and the notifications build on.

## Requirements

### Requirement: Reading the balance
The system SHALL read the balance of the one linked account as the bank's available balance and return its amount and currency. Callers pass no account or session identifier; both come from the configuration.

#### Scenario: The balance is the account's available balance
- **GIVEN** the bank reports an available balance of 1234.56 EUR for the linked account
- **WHEN** the balance is read
- **THEN** the result is the balance 1234.56 EUR

### Requirement: Reading transactions from a given day
The system SHALL read the transactions of the linked account from a given day, inclusive, and return the booked and the pending ones. Transactions with any other status (cancelled, rejected, on hold, scheduled, other) SHALL be left out.

#### Scenario: Pending transactions come back marked pending
- **GIVEN** the bank lists a pending card payment of 8.90 EUR on 2026-11-05, without a reference
- **WHEN** the transactions from 2026-11-01 are read
- **THEN** the result is one pending transaction of -8.90 EUR on 2026-11-05, without a reference

#### Scenario: Cancelled and rejected transactions are left out
- **GIVEN** the bank lists a booked, a cancelled and a rejected transaction since 2026-11-01
- **WHEN** the transactions from 2026-11-01 are read
- **THEN** the result holds only the booked transaction

### Requirement: What a transaction carries
Each returned transaction SHALL carry exactly: its reference (possibly missing while pending), status (booked or pending), date (the transaction date, else the booking date, else the value date), amount (negative for money spent, positive for money received; a negative amount from the bank is an error), currency, counterparty (the payee for money spent, the payer for money received; possibly missing) and payment details (the bank's lines, unchanged, possibly none).

#### Scenario: A spent payment comes back negative, with the payee and its details
- **GIVEN** the bank lists a booked payment of 12.30 EUR with reference "e-101", booked on 2026-11-03, to "Pekárna U Lípy", with the details "Pekárna U Lípy" and "Praha 2"
- **WHEN** the transactions from 2026-11-01 are read
- **THEN** the result is one booked transaction "e-101" of -12.30 EUR on 2026-11-03, payee "Pekárna U Lípy", details "Pekárna U Lípy" and "Praha 2"

#### Scenario: A received transfer comes back positive, with the payer
- **GIVEN** the bank lists a booked transfer of 50.00 EUR received on 2026-11-04 from "Jan Novák"
- **WHEN** the transactions from 2026-11-01 are read
- **THEN** the result is one booked transaction of 50.00 EUR on 2026-11-04, payer "Jan Novák"

### Requirement: Every page is read
A transactions read SHALL follow the bank's pages until the bank signals that no page follows, and return the transactions of all pages as one list, for at most 20 pages; a read whose 20th page still announces another SHALL fail as an error. If any page fails, the read SHALL fail as a whole with that page's failure and return no partial list.

#### Scenario: Transactions on every page are returned
- **GIVEN** the bank lists 25 transactions since 2026-10-06, in three pages
- **WHEN** the transactions from 2026-10-06 are read
- **THEN** the result holds all 25 transactions

#### Scenario: A failure on a later page fails the whole read
- **GIVEN** the bank returns the first page of transactions since 2026-10-06 and then reports an error of its own for the second page
- **WHEN** the transactions from 2026-10-06 are read
- **THEN** the result is bank unavailable

### Requirement: Who triggers a read
Every read SHALL be made either for a present user, in which case the bank receives that user's real IP address and user agent as user headers, or unattended, in which case the bank receives no user headers at all. Every caller SHALL state which; there is no default. A present user SHALL have an IP address and a non-blank user agent. Each character of the user agent outside printable ASCII SHALL reach the bank as "?".

#### Scenario: A read for a present user carries the user's address and browser
- **GIVEN** a present user with the IP address 203.0.113.7 and the browser "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)"
- **WHEN** the balance is read for that user
- **THEN** the bank's request carries the user headers with that IP address and that browser

#### Scenario: An unattended read carries no user headers
- **WHEN** the balance is read unattended
- **THEN** the bank's request carries no user headers

#### Scenario: A browser name with an accent reaches the bank with a question mark
- **GIVEN** a present user with the IP address 203.0.113.7 and the browser "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Čtečka/1.0"
- **WHEN** the balance is read for that user
- **THEN** the bank's request carries the user headers with that IP address and the browser "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) ?te?ka/1.0"

### Requirement: Access expired
A read SHALL return the failure "access expired", instead of a result, when the bank reports that the session has expired, was revoked or closed, or does not exist, or that the bank needs the account holder or no longer gives access to the account. Only the owner can fix it, by linking the account again.

#### Scenario: An expired bank session reads as access expired
- **GIVEN** the bank reports that the session has expired
- **WHEN** the balance is read
- **THEN** the result is access expired

### Requirement: Rate limited, never retried
A read SHALL return the failure "rate limited", instead of a result, when the bank reports that its request limit is reached. The read SHALL NOT repeat the request.

#### Scenario: A reached request limit reads as rate limited, with no second request
- **GIVEN** the bank reports that its request limit is reached
- **WHEN** the balance is read unattended
- **THEN** the result is rate limited
- **AND** the bank received exactly one request

### Requirement: Bank unavailable
A read SHALL return the failure "bank unavailable", instead of a result, when the bank reports an error or a timeout of its own, when it does not answer within the configured request timeout, or when it cannot be reached. A server error without an Enable Banking error code, such as a gateway's error page, counts as the bank's own error. Any other failure (a wrong key or account, a rejected request, a success answer that cannot be read) is an error, not a result.

#### Scenario: A bank error reads as bank unavailable
- **GIVEN** the bank reports an error of its own
- **WHEN** the balance is read
- **THEN** the result is bank unavailable

#### Scenario: A bank that answers too slowly reads as bank unavailable
- **GIVEN** the bank answers only after the configured request timeout
- **WHEN** the balance is read
- **THEN** the result is bank unavailable

#### Scenario: A gateway's error page reads as bank unavailable
- **GIVEN** a gateway in front of the bank answers that the service is unavailable with its own maintenance page, without an Enable Banking error code
- **WHEN** the balance is read
- **THEN** the result is bank unavailable
