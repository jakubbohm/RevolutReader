# Spec Delta

## MODIFIED Requirements

### Requirement: What a transaction carries
Each returned transaction SHALL carry exactly: its reference (possibly missing while pending), status (booked or pending), date (the transaction date, else the booking date, else the value date), amount (negative for money spent, positive for money received; a negative amount from the bank is an error), currency, counterparty (the payee for money spent, the payer for money received; possibly missing), payment details (the bank's lines, unchanged, possibly none) and type code (the bank's code for the kind of transaction, unchanged, possibly missing).

#### Scenario: A spent payment comes back negative, with the payee and its details
- **GIVEN** the bank lists a booked payment of 12.30 EUR with reference "e-101", booked on 2026-11-03, to "Pekárna U Lípy", with the details "Pekárna U Lípy" and "Praha 2"
- **WHEN** the transactions from 2026-11-01 are read
- **THEN** the result is one booked transaction "e-101" of -12.30 EUR on 2026-11-03, payee "Pekárna U Lípy", details "Pekárna U Lípy" and "Praha 2"

#### Scenario: A received transfer comes back positive, with the payer
- **GIVEN** the bank lists a booked transfer of 50.00 EUR received on 2026-11-04 from "Jan Novák"
- **WHEN** the transactions from 2026-11-01 are read
- **THEN** the result is one booked transaction of 50.00 EUR on 2026-11-04, payer "Jan Novák"

#### Scenario: A transaction comes back with the bank's type code
- **GIVEN** the bank lists a booked card payment of 12.30 EUR on 2026-11-03 with the type code "CARD_PAYMENT"
- **WHEN** the transactions from 2026-11-01 are read
- **THEN** the result is one booked transaction of -12.30 EUR on 2026-11-03 with the type code "CARD_PAYMENT"
