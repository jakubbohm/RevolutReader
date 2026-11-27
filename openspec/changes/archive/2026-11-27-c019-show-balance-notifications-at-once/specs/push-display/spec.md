# Spec Delta

## MODIFIED Requirements

### Requirement: A push's balance replaces the balance the phone keeps
When a notification from the app carries a balance (its amount, the time the server read it and the koruna rate, in the fragment of its address with a check code, spec account-check), the device SHALL keep it in place of the balance it keeps (spec account-balance): when a tap on the notification opens the app or brings it back; at every opening of the app (a launch, or a return to it) while the notification is still shown; and, where the app's service worker shows the notification itself, when the push arrives. Of several, the one read last SHALL count. It SHALL keep it only when the device already keeps a balance and the notification's was not read earlier than it, so a balance forgotten when a login ended never comes back by a notification, and an older notification never replaces a newer balance. Once the app has read a balance in its own address, the address SHALL no longer carry it.

#### Scenario: A tap on a notification with a balance replaces the balance the phone keeps
- **GIVEN** the phone keeps a balance of 250,00 € read two hours ago, and the phone is offline
- **AND** the app is closed
- **WHEN** a tap on a notification with a balance of 286.40 EUR read a minute ago opens the app
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A tap on a notification while the app is in the background replaces the balance the phone keeps
- **GIVEN** the phone keeps a balance of 250,00 € read two hours ago, and the phone is offline
- **AND** the app is open in the background
- **WHEN** a tap on a notification with a balance of 286.40 EUR read a minute ago brings the app back
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: Opening the app from its icon takes the balance of a notification still shown
- **GIVEN** the phone keeps a balance of 250,00 € read two hours ago, and the phone is offline
- **AND** a notification with a balance of 286.40 EUR read a minute ago is still shown
- **WHEN** the app is opened from its icon
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: Coming back to the app takes the balance of a notification still shown
- **GIVEN** the app is open in the background, offline, on a kept balance of 250,00 € read two hours ago
- **AND** a notification with a balance of 286.40 EUR read a minute ago came since and is still shown
- **WHEN** the app comes back to the front
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: Of several notifications, the balance read last is kept
- **GIVEN** the phone keeps a balance of 250,00 € read two hours ago, and the phone is offline
- **AND** notifications with balances of 286.40 EUR read a minute ago and 280.00 EUR read ten minutes ago are still shown
- **WHEN** the app is opened from its icon
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A push with a balance replaces the balance the phone keeps
- **GIVEN** the app's service worker runs in a browser that does not show Declarative Web Push messages itself
- **AND** the phone keeps a balance of 250,00 € read two hours ago
- **WHEN** a push arrives with a balance of 286.40 EUR read a minute ago
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A push with a balance read earlier than the kept one leaves it as it was
- **GIVEN** the phone keeps a balance of 286,40 € read a minute ago, and the phone is offline
- **WHEN** a tap on a notification with a balance of 250.00 EUR read ten minutes ago opens the app
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A push with a balance stores none on a phone that keeps none
- **GIVEN** the phone keeps no balance, and the phone is offline
- **WHEN** a tap on a notification with a balance of 286.40 EUR read a minute ago opens the app
- **THEN** the next time the app is opened offline, it shows only "Jsi offline" and "Zůstatek a pohyby se načtou, jakmile budeš online."

#### Scenario: The app's address carries no balance once the app has read it
- **GIVEN** the phone keeps a balance of 250,00 € read two hours ago
- **WHEN** a tap on a notification with a balance of 286.40 EUR read a minute ago opens the app
- **THEN** the app's address is its start page, with no balance in it

### Requirement: A push without a valid balance leaves the kept balance alone
A notification that carries no balance, such as the owner's test messages (spec push-sending), one whose balance has the wrong shape, or one whose check code the device's push subscription does not accept, SHALL leave the balance the device keeps as it was. A balance has the shape of the API's answer (spec account-balance): the amount and the rate as numbers, and the read time as a date and time. A balance in the app's address that the server did not make for this device, such as one in a link, has no check code the device accepts.

#### Scenario: A push without a balance leaves the kept balance as it was
- **GIVEN** the phone keeps a balance of 286,40 €
- **WHEN** a push titled "Ahoj" arrives with no balance
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A push with a balance of the wrong shape leaves the kept balance as it was
- **GIVEN** the phone keeps a balance of 286,40 €
- **WHEN** a push arrives with a balance of 250.00 EUR that has no read time
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A balance without this phone's check code leaves the kept balance as it was
- **GIVEN** the phone keeps a balance of 286,40 € read two hours ago, and the phone is offline
- **WHEN** the app is opened from a link whose address carries a balance of 0.00 EUR read a minute ago, with a check code not made for this phone
- **THEN** it shows 286,40 € with "Jsi offline"

### Requirement: A payment's notification brings its balance to the iPhone
On the iPhone's Home Screen app, the notification of a change on the account SHALL bring its balance to the phone, also while the app is closed, so that a tap, or an opening from the app's icon while the notification is still shown, opens the app on that balance before any answer from the server.

#### Scenario: A payment's notification on the iPhone opens the app on its balance
- **GIVEN** the owner turned notifications on in the iPhone's Home Screen app
- **AND** the app is closed
- **WHEN** a payment from the account brings the app's notification to the lock screen
- **AND** the phone is then taken offline
- **THEN** a tap on the notification opens the app on the balance the notification names, with "Jsi offline"

#### Scenario: A payment's notification on the iPhone brings its balance to an opening from the icon
- **GIVEN** the owner turned notifications on in the iPhone's Home Screen app
- **AND** the app is closed
- **WHEN** a payment from the account brings the app's notification to the lock screen
- **AND** the phone is then taken offline
- **THEN** opening the app from its icon, with the notification left untapped, shows the balance the notification names, with "Jsi offline"
