# notification-opt-in Specification

## Purpose

Offering and turning on notifications on a device: the card under the balance and its states, "Teď ne", the account menu's item, and what a failure while turning them on shows.

## Requirements

### Requirement: The card offers notifications where the browser can have them
When the account screen shows a signed-in user's balance and the device has never been asked about notifications, the screen SHALL show under the balance the card "Chceš vědět o každé platbě?" with "Hned uvidíš, když přijdou peníze nebo když zaplatíš kartou.", the button "Zapnout upozornění" and "Teď ne". It SHALL show wherever the browser can subscribe to pushes, in a browser tab as in the Home Screen app; elsewhere nothing SHALL offer notifications.

#### Scenario: The card offers notifications under the balance
- **GIVEN** Lucie is signed in on the iPhone's Home Screen app, never asked about notifications
- **WHEN** the account screen shows her balance of 286,40 €
- **THEN** under it the card shows "Chceš vědět o každé platbě?" with "Hned uvidíš, když přijdou peníze nebo když zaplatíš kartou."
- **AND** the buttons "Zapnout upozornění" and "Teď ne"
- **AND** the account menu holds no "Zapnout upozornění"

#### Scenario: The card also shows in a computer's browser
- **GIVEN** Lucie is signed in in a computer's browser that can subscribe to pushes
- **AND** the browser was never asked about notifications
- **WHEN** the account screen shows her balance
- **THEN** the card "Chceš vědět o každé platbě?" shows under it

#### Scenario: Nothing offers notifications where the browser cannot have them
- **GIVEN** Lucie is signed in in a computer's browser that cannot subscribe to pushes
- **WHEN** the account screen shows her balance
- **THEN** no card offers notifications
- **AND** the account menu holds no "Zapnout upozornění"

### Requirement: Nothing offers notifications once they are on
Once the device allows the app's notifications, neither the card nor the account menu SHALL offer them.

#### Scenario: Nothing offers notifications once they are on
- **GIVEN** Lucie turned notifications on, on this phone
- **WHEN** she opens the app again
- **THEN** no card offers notifications
- **AND** the account menu holds no "Zapnout upozornění"

### Requirement: Turning notifications on from the card
Tapping "Zapnout upozornění" SHALL ask the phone for permission right from the tap, the button spinning and "Teď ne" disabled until it is done. Once allowed, the app SHALL subscribe with the server's push key and send the subscription to the server. The card SHALL then read "Upozornění jsou zapnutá" with "Když se na účtu něco změní, přijde ti upozornění." until the next opening of the app (a launch, or a return to it), and never again.

#### Scenario: Turning notifications on from the card asks the phone and says they are on
- **GIVEN** the card offers notifications to Lucie
- **WHEN** she taps "Zapnout upozornění" and allows notifications
- **THEN** the phone was asked from her tap, while the button spun
- **AND** the server receives the phone's subscription, made with the server's push key
- **AND** the card reads "Upozornění jsou zapnutá" with "Když se na účtu něco změní, přijde ti upozornění."

#### Scenario: "Upozornění jsou zapnutá" is gone at the next opening
- **GIVEN** the card reads "Upozornění jsou zapnutá"
- **WHEN** Lucie leaves the app and comes back to it
- **THEN** no card shows

#### Scenario: The iPhone asks for permission when the card's button is tapped
- **GIVEN** the owner is signed in on the iPhone's Home Screen app, never asked about notifications
- **WHEN** the owner taps "Zapnout upozornění" on the card
- **THEN** iOS asks whether the app may send notifications
- **AND** after the owner allows them, the card reads "Upozornění jsou zapnutá"

### Requirement: Declining the phone's question
When the user declines the phone's question, the card SHALL read "Upozornění jsou vypnutá" with "Zapneš je v Nastavení → Oznámení → Tarjeta Papá." and no button, and nothing SHALL be sent to the server. The card SHALL be gone at the next opening, and no later opening SHALL show a card while the phone blocks the app's notifications.

#### Scenario: Declining the phone's question says where to turn notifications on
- **GIVEN** the card offers notifications to Lucie
- **WHEN** she taps "Zapnout upozornění" and declines
- **THEN** the card reads "Upozornění jsou vypnutá" with "Zapneš je v Nastavení → Oznámení → Tarjeta Papá."
- **AND** it has no button
- **AND** nothing was sent to the server

#### Scenario: The card saying notifications are off is gone at the next opening
- **GIVEN** the card reads "Upozornění jsou vypnutá"
- **WHEN** Lucie closes the app and opens it again
- **THEN** no card shows

#### Scenario: The card's path to the iPhone's Settings is right
- **GIVEN** the owner declined iOS's question on the iPhone's Home Screen app
- **AND** the card reads "Zapneš je v Nastavení → Oznámení → Tarjeta Papá."
- **WHEN** the owner follows that path in the iPhone's Settings
- **THEN** it leads to the switch that allows the app's notifications

### Requirement: "Teď ne" hides the card for good on the device
Tapping "Teď ne" SHALL hide the card without asking the phone. The device SHALL remember it, so the card does not come back by itself.

#### Scenario: "Teď ne" hides the card for good on this device
- **GIVEN** the card offers notifications to Lucie
- **WHEN** she taps "Teď ne"
- **THEN** the card is gone and the phone was not asked
- **AND** after the app is closed and opened again, no card shows

### Requirement: The account menu offers notifications while the card does not
While notifications are off on a device that can have them and no card is on screen, the account menu SHALL hold "Zapnout upozornění" above "Odhlásit se". Tapping it SHALL ask the phone right from the tap, and the card SHALL come back to show the result. While the phone blocks the app's notifications, it SHALL ask nothing and bring back the card that says where to turn them on.

#### Scenario: The account menu offers notifications after "Teď ne"
- **GIVEN** Lucie tapped "Teď ne" on this phone earlier
- **WHEN** she opens the account menu
- **THEN** it holds "Zapnout upozornění" above "Odhlásit se"

#### Scenario: Turning notifications on from the account menu shows the result in the card
- **GIVEN** Lucie tapped "Teď ne" on this phone earlier
- **WHEN** she taps "Zapnout upozornění" in the account menu and allows notifications
- **THEN** the phone was asked from her tap
- **AND** the server receives the phone's subscription
- **AND** the card comes back reading "Upozornění jsou zapnutá"

#### Scenario: The account menu, with notifications blocked, says where to turn them on
- **GIVEN** the phone blocks the app's notifications
- **WHEN** Lucie taps "Zapnout upozornění" in the account menu
- **THEN** the card comes back reading "Upozornění jsou vypnutá" with "Zapneš je v Nastavení → Oznámení → Tarjeta Papá."
- **AND** the phone was not asked

#### Scenario: The iPhone asks for permission when the account menu's item is tapped
- **GIVEN** the owner tapped "Teď ne" on the iPhone's Home Screen app, never asked about notifications
- **WHEN** the owner taps "Zapnout upozornění" in the account menu
- **THEN** iOS asks whether the app may send notifications

### Requirement: A failure while turning notifications on
When turning notifications on fails after the phone allowed them, because the phone is offline or the server fails, the screen's one banner SHALL show the error "Upozornění se nepodařilo zapnout" in place of any other, with "Zkus to znovu, až budeš online." when offline or "Zkus to prosím za chvíli." otherwise. The card SHALL return to its default state, so the user can try again.

#### Scenario: Turning notifications on offline says to try again online
- **GIVEN** the card offers notifications to Lucie
- **AND** the phone is offline
- **WHEN** she taps "Zapnout upozornění" and allows notifications
- **THEN** the error "Upozornění se nepodařilo zapnout" shows with "Zkus to znovu, až budeš online."
- **AND** the card offers "Zapnout upozornění" again

#### Scenario: Turning notifications on when the server fails says to try again later
- **GIVEN** the card offers notifications to Lucie
- **AND** the server fails to keep the subscription
- **WHEN** she taps "Zapnout upozornění" and allows notifications
- **THEN** the error "Upozornění se nepodařilo zapnout" shows with "Zkus to prosím za chvíli."
- **AND** the card offers "Zapnout upozornění" again
