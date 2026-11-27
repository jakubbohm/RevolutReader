# Spec Delta

## MODIFIED Requirements

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

### Requirement: The notification reaches the iPhone
A real change on the account SHALL bring the check's notification to the owner's iPhone within a minute, through the Shortcut set up there, Apple's push service and the Home Screen app.

#### Scenario: A real payment brings the notification on the iPhone
- **GIVEN** the Shortcut is set up on the owner's iPhone, and the Home Screen app's notifications are allowed there
- **WHEN** the owner pays with the card
- **THEN** within a minute of Revolut's own notification, the app's notification shows on the lock screen, titled "Odešlo" with the amount, over "Zůstatek" with the new balance and its koruna value
