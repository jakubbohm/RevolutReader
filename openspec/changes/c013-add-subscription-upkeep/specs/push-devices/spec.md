# Spec Delta

## ADDED Requirements

### Requirement: The subscription is sent to the server again at every opening
At every opening of the app, a launch or a return to it from another app, while a user is signed in and notifications are allowed on the device, the app SHALL send the device's push subscription to the server again when it was made with the server's current public key. The server then keeps it under the account signed in now (requirement "A device is registered under the account signed in"). It SHALL do so quietly: no permission prompt, no tap, nothing on screen.

#### Scenario: The subscription is sent to the server again when the app opens
- **GIVEN** Lucie allowed notifications on her phone
- **AND** the phone holds a subscription at `https://web.push.apple.com/lucies-phone`, made with the server's key
- **WHEN** she opens the app
- **THEN** the app sends that subscription to the server
- **AND** the phone keeps it, without subscribing again or asking her anything

#### Scenario: The subscription is sent to the server again on every return to the app
- **GIVEN** Lucie is on the account screen, with notifications allowed and her phone subscribed
- **WHEN** she leaves the app and returns to it
- **THEN** the app sends the subscription to the server again

### Requirement: A subscription the phone has lost is made again quietly
At an opening with a signed-in user, when notifications are allowed but the device holds no push subscription (a browser can drop one without telling the page), the app SHALL subscribe again with the server's current public key and send the new subscription to the server, quietly: no permission prompt, no tap, nothing on screen.

#### Scenario: A subscription the phone has lost is replaced quietly
- **GIVEN** Lucie allowed notifications on her phone
- **AND** the phone holds no subscription
- **WHEN** she opens the app
- **THEN** the phone subscribes with the server's key without asking her
- **AND** the new subscription is sent to the server

### Requirement: A subscription made with another key is replaced quietly
At an opening with a signed-in user and notifications allowed, when the device says its push subscription was made with a key other than the server's current public key, the app SHALL replace it quietly. It unsubscribes the old one and asks the server to forget the old push address, then subscribes with the current key and sends the new subscription, so a replaced server key heals itself at each device's next opening.

#### Scenario: A subscription made with another key is replaced quietly
- **GIVEN** Lucie allowed notifications on her phone
- **AND** the phone holds a subscription at `https://web.push.apple.com/lucies-old-subscription`, made with an old key
- **WHEN** she opens the app
- **THEN** the phone unsubscribes it and the server is asked to forget that push address
- **AND** the phone subscribes with the server's key without asking her, and the new subscription is sent to the server

### Requirement: Nothing is subscribed while notifications are not allowed
Where notifications are not allowed on the device (never asked, or declined), or the browser cannot receive pushes, the app SHALL neither ask for the permission at an opening nor subscribe nor send anything to the server for push. The permission is asked for only from a tap on the notification card or the account menu's item (C8b).

#### Scenario: Nothing is subscribed while notifications are not allowed
- **GIVEN** Lucie is signed in and has never turned notifications on
- **WHEN** she opens the app
- **THEN** the app does not ask to allow notifications
- **AND** nothing is subscribed and no subscription is sent to the server

### Requirement: Signing out removes the phone's subscription
Signing out from the account menu SHALL first ask the server to forget the device's push address, while the login still allows it, and SHALL unsubscribe the device's push subscription once the server has confirmed the sign-out. A signed-out device thus gets no more pushes even if the server never heard the request to forget it. A failed request to forget SHALL never make the sign-out fail.

#### Scenario: Signing out asks the server to forget the phone and unsubscribes it
- **GIVEN** Lucie's phone is subscribed at `https://web.push.apple.com/lucies-phone`
- **WHEN** she signs out from the account menu
- **THEN** the app asks the server to forget that push address before it signs out
- **AND** once the sign-out is confirmed, the phone holds no subscription

#### Scenario: A failed request to forget the phone does not fail the sign-out
- **GIVEN** Lucie's phone is subscribed for pushes
- **AND** the server fails the request to forget it
- **WHEN** she signs out from the account menu
- **THEN** the signed-out screen shows
- **AND** the phone holds no subscription

### Requirement: A failed sign-out keeps the subscription
A sign-out that fails (offline, or a server error) SHALL keep the device's push subscription, as it keeps the stored balance (spec account-balance): the user is still signed in. When the server had already forgotten the device, the next opening sends the subscription again (requirement "The subscription is sent to the server again at every opening").

#### Scenario: A failed sign-out keeps the subscription
- **GIVEN** Lucie's phone is subscribed for pushes
- **AND** the server fails the sign-out
- **WHEN** she taps "Odhlásit se" in the account menu
- **THEN** the error "Odhlášení se nepovedlo" shows
- **AND** the phone still holds its subscription

### Requirement: A login that has ended removes the phone's subscription
Whenever the server answers that the device has no allowed login (401 or 403), the app SHALL unsubscribe the device's push subscription, as it forgets the stored balance (spec account-balance). It cannot ask the server to forget the device, since the server accepts no request from it. The server deletes the device when its push service reports it gone (spec push-sending).

#### Scenario: A login that has ended unsubscribes the phone
- **GIVEN** Lucie's phone is subscribed for pushes
- **AND** her login has ended on the server
- **WHEN** the app is opened
- **THEN** it shows the sign-in screen
- **AND** the phone holds no subscription

### Requirement: The subscription comes back by itself after signing in again
A device keeps the notification permission across a sign-out, so after signing in again the app SHALL subscribe the device again at the first opening, with no tap (requirement "A subscription the phone has lost is made again quietly"). Messages to the account then reach the device again.

#### Scenario: After signing in again, the phone subscribes without a tap
- **GIVEN** Lucie allowed notifications on her phone, then signed out from the account menu
- **WHEN** she signs in again and the app opens
- **THEN** the phone subscribes with the server's key without asking her
- **AND** the new subscription is sent to the server

#### Scenario: After signing out and in again on the iPhone, a message arrives without a tap
- **GIVEN** the owner turned notifications on in the Home Screen app on the iPhone
- **AND** signed out from the account menu and signed in again
- **WHEN** a message is sent to the owner's account
- **THEN** it shows on the iPhone
- **AND** nobody tapped anything to turn notifications on again
