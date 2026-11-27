# Spec Delta

## MODIFIED Requirements

### Requirement: Every push is a Declarative Web Push message
Every push SHALL carry a Declarative Web Push message, JSON with `web_push` 8030 and a `notification` holding a non-empty `title`, the text as `body` when there is one, and `navigate`, the address a tap opens, always a page of the app itself. It SHALL never carry a badge, `mutable` or `data`. It SHALL wait up to 24 hours at the push service while the device is offline, and SHALL be sent as urgent. A notification about the account (spec account-check) SHALL carry its balance in the fragment of `navigate`, with a check code made for each device; every other push, the owner's messages included, SHALL carry none.

#### Scenario: Every push lives 24 hours and is urgent
- **GIVEN** Lucie registered her phone for pushes
- **WHEN** the owner sends a message to Lucie
- **THEN** her phone's push service receives it with a lifetime of 86400 seconds and the urgency `high`

#### Scenario: The owner's message carries no balance
- **GIVEN** Lucie registered her phone for pushes
- **WHEN** the owner sends Lucie a message titled "Ahoj"
- **THEN** the push her phone receives is not marked for the app's service worker
- **AND** it carries no balance
