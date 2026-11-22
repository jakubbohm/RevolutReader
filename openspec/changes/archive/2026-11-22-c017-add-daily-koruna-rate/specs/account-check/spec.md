# Spec Delta

## MODIFIED Requirements

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

### Requirement: The notification carries the new balance
Every notification the check sends SHALL be marked for the app's service worker (`"mutable": true`) and SHALL carry, in the notification's `data`, the member `balance`: the new balance exactly as `GET /api/balance` answers it, with `amount`, `readAt` and `czkPerEur` (spec account-balance; the rate of spec koruna-rate), so the phone can keep it.

#### Scenario: The notification carries the new balance for the phone to keep
- **GIVEN** the check's last seen and last notified balances are 49.00 EUR
- **AND** Lucie registered her phone for pushes, and the bank holds an available balance of 45.20 EUR
- **AND** the CNB's latest rate is 24.6 CZK per euro
- **WHEN** the owner's phone asks for a check
- **THEN** the notification her phone receives is marked for the app's service worker
- **AND** it carries the balance with `amount` 45.20, `readAt` the time the server read it, and `czkPerEur` 24.6
