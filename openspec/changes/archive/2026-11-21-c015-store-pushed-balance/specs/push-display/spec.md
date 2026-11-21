# Spec Delta: push-display

## ADDED Requirements

### Requirement: A push's balance replaces the balance the phone keeps
When a push from the app carries a balance (its amount, the time the server read it and the koruna rate), the device SHALL keep it in place of the balance it keeps (spec account-balance), whether the browser or the app's service worker shows the notification. It SHALL do so only when the device already keeps a balance and the push's was not read earlier than it, so a balance forgotten when a login ended never comes back by a push.

#### Scenario: A push with a balance replaces the balance the phone keeps
- **GIVEN** the phone keeps a balance of 250,00 € read two hours ago
- **WHEN** a push arrives with a balance of 286.40 EUR read a minute ago
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A push with a balance read earlier than the kept one leaves it as it was
- **GIVEN** the phone keeps a balance of 286,40 € read a minute ago
- **WHEN** a push arrives with a balance of 250.00 EUR read ten minutes ago
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A push with a balance stores none on a phone that keeps none
- **GIVEN** the phone keeps no balance
- **WHEN** a push arrives with a balance of 286.40 EUR read a minute ago
- **THEN** the next time the app is opened offline, it shows only "Jsi offline" and "Zůstatek a pohyby se načtou, jakmile budeš online."

### Requirement: A push without a valid balance leaves the kept balance alone
A push that carries no balance, such as the owner's test messages (spec push-sending), or one whose balance has the wrong shape, SHALL leave the balance the device keeps as it was. A balance has the shape of the API's answer (spec account-balance): the amount and the rate as numbers, and the read time as a date and time.

#### Scenario: A push without a balance leaves the kept balance as it was
- **GIVEN** the phone keeps a balance of 286,40 €
- **WHEN** a push titled "Ahoj" arrives with no balance
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A push with a balance of the wrong shape leaves the kept balance as it was
- **GIVEN** the phone keeps a balance of 286,40 €
- **WHEN** a push arrives with a balance of 250.00 EUR that has no read time
- **THEN** the next time the app is opened offline, it shows 286,40 €

### Requirement: Keeping the balance never stops the notification
A failure to keep a push's balance SHALL be ignored, and the notification SHALL show as it would for a push without a balance (requirement "A push shows as one notification").

#### Scenario: A push still shows its notification when the phone's storage fails
- **GIVEN** the app's service worker runs in a browser that does not show Declarative Web Push messages itself
- **AND** the phone's storage fails
- **WHEN** a push arrives titled "Odešlo 3,80 €" with the text "Zůstatek 282,60 € (≈ 6 867 Kč)" and a balance of 282.60 EUR
- **THEN** the device shows the notification "Odešlo 3,80 €" with "Zůstatek 282,60 € (≈ 6 867 Kč)"

### Requirement: The app opened from a push's notification shows its balance at once
When the app is opened from the notification of a push whose balance the device kept, it SHALL show that balance with its time at once, while the server wakes up (spec app-shell, requirement "A kept balance shows at once").

#### Scenario: The app opened from a push's notification shows its balance while the server wakes
- **GIVEN** the phone keeps a balance of 250,00 € read two hours ago
- **AND** a push with a balance of 286.40 EUR read a minute ago showed its notification
- **AND** the server takes 20 seconds to wake up
- **WHEN** the notification is tapped and the app opens
- **THEN** it shows 286,40 € with "Aktualizováno před 1 min" at once

### Requirement: A payment's notification brings its balance to the iPhone
On the iPhone's Home Screen app, the notification of a change on the account SHALL bring its balance to the phone, also while the app is closed, so that a tap opens the app on that balance before any answer from the server.

#### Scenario: A payment's notification on the iPhone opens the app on its balance
- **GIVEN** the owner turned notifications on in the iPhone's Home Screen app
- **AND** the app is closed
- **WHEN** a payment from the account brings the app's notification to the lock screen
- **AND** the phone is then taken offline
- **THEN** a tap on the notification opens the app on the balance the notification names, with "Jsi offline"
