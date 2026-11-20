# push-devices Specification

## Purpose

A device's push registration with the app: the public key a browser subscribes with, storing and forgetting a device's push subscription under the signed-in account, and which subscriptions the app accepts.

## Requirements

### Requirement: The app gets the public push key
`GET /api/push/key` SHALL answer exactly one field, `publicKey`: the server's public push key (VAPID, RFC 8292), the base64url form a browser subscribes with. Like every API address, it is for allowed, signed-in users only (spec sign-in).

#### Scenario: The app gets the public push key
- **GIVEN** Lucie is signed in
- **WHEN** she asks the API for the push key
- **THEN** the answer is exactly `publicKey`, the server's public push key

### Requirement: A device is registered under the account signed in
`PUT /api/push/subscription` SHALL store the device's push subscription, its push address and its two keys, under the signed-in account, and answer 204. A device is known by its push address, so registering the same address again SHALL replace its keys and move it to the account signed in now. Messages to an account go to the devices registered under it (spec push-sending).

#### Scenario: Registering the same device again moves it to the account signed in now
- **GIVEN** Lucie registered her phone for pushes, then signed out
- **AND** Petr, also allowed, signed in on the same phone and registered it again
- **WHEN** the owner sends a message to Lucie and one to Petr
- **THEN** Lucie's message reaches no device
- **AND** Petr's message reaches the phone

### Requirement: Only push addresses at known push services are accepted
The app SHALL accept a push address only when it is an `https://` address at one of the known push services: Apple's, Google's, Mozilla's and Microsoft's. Any other address SHALL be refused with 400 and a problem description naming the push address as the refused member, never its value, and nothing SHALL be stored, so a signed-in user can never make the server send requests to an address of their choosing.

#### Scenario: A push address outside the known push services is refused
- **GIVEN** Lucie is signed in
- **WHEN** her browser registers a subscription whose push address is `https://push.example.com/device-1`
- **THEN** the answer is 400 with a problem description titled `Bad Request` naming the push address
- **AND** a message to Lucie reaches no device

### Requirement: A malformed subscription is refused
The app SHALL refuse with 400 a subscription whose keys are missing or the wrong size: the device's public key must be a P-256 public point (65 bytes) and its secret 16 bytes, both in base64url. The problem description SHALL name the refused member, never its value, and nothing SHALL be stored.

#### Scenario: A subscription with missing or wrong-sized keys is refused
- **GIVEN** Lucie is signed in
- **WHEN** her browser registers a subscription at a known push service whose secret is 8 bytes instead of 16
- **THEN** the answer is 400 with a problem description titled `Bad Request` naming the secret
- **AND** a message to Lucie reaches no device

### Requirement: A device can be forgotten
`DELETE /api/push/subscription`, naming the device's push address, SHALL forget that device, so it gets no more messages, and answer 204. Forgetting a device that is not stored SHALL answer 204 too, so a browser can always forget its device, e.g. at sign-out.

#### Scenario: A forgotten device gets no more messages
- **GIVEN** Lucie registered her phone for pushes
- **WHEN** her browser forgets the phone
- **AND** the owner sends a message to Lucie
- **THEN** the message reaches no device
- **AND** the answer counts no device as reached, failed or removed

#### Scenario: Forgetting a device that was never registered is fine
- **GIVEN** Lucie is signed in and her phone was never registered
- **WHEN** her browser forgets the phone
- **THEN** the answer is 204

### Requirement: The subscription is sent to the server again at every opening
At every opening of the app, a launch or a return to it from another app, while a user is signed in, no sign-out is under way, and notifications are allowed on the device, the app SHALL send the device's push subscription to the server again when it was made with the server's current public key. The server then keeps it under the account signed in now (requirement "A device is registered under the account signed in"). It SHALL do so quietly: no permission prompt, no tap, nothing on screen.

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
