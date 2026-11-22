# Spec Delta

## MODIFIED Requirements

### Requirement: The API answers the newest transactions live
`GET /api/transactions` SHALL read the account's transactions from the bank when asked and answer those dated from 31 days before today, pending ones included, newest first and in the bank's order within a day, with exactly `transactions`, `olderBefore` (the day before which older ones are kept, else null), `czkPerEur` and `rateDate` (the koruna rate and the day it is for, spec koruna-rate). Each transaction SHALL carry exactly `date`, `amount`, `currency`, `pending`, `counterparty`, `details` and `kind`.

#### Scenario: The newest transactions come live with the koruna rate
- **GIVEN** today is 2026-11-20, the CNB's latest rate is 24.38 CZK per euro for 2026-11-19, and Lucie is signed in
- **AND** the bank lists a pending card payment of 8.90 EUR to "Kavárna Na Rohu" on 2026-11-19
- **AND** a booked card payment of 12.30 EUR to "Pekárna U Lípy" on 2026-11-18, with the detail "Praha 2"
- **WHEN** she asks the API for her transactions
- **THEN** it answers the pending card payment of -8.90 EUR on 2026-11-19, then the settled one of -12.30 EUR on 2026-11-18 with the detail "Praha 2", each with its counterparty
- **AND** nothing older kept, the koruna rate 24.38 and its date 2026-11-19
