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
