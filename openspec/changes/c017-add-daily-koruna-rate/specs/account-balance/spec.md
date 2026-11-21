# Spec Delta

## MODIFIED Requirements

### Requirement: The API reads the balance live
`GET /api/balance` SHALL read the account's available balance from the bank when asked, and answer exactly three fields: `amount`, the balance in euros; `readAt`, the time the server read it; and `czkPerEur`, the koruna rate the app converts with (spec koruna-rate). Like every API address, it is for allowed, signed-in users only (spec sign-in).

#### Scenario: The balance comes with the time it was read and the koruna rate
- **GIVEN** Lucie is signed in
- **AND** the bank holds an available balance of 286.40 EUR
- **AND** the CNB's latest rate is 24.38 CZK per euro
- **WHEN** she asks the API for the balance
- **THEN** the answer is exactly `amount` 286.40, `readAt` the time the server read it, and `czkPerEur` 24.38
