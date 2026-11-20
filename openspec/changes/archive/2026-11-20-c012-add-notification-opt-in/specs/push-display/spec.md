# Spec Delta

## Purpose

What a device does with a push from the app: showing it where the browser does not show it itself, and what a tap on its notification opens.

## ADDED Requirements

### Requirement: A push shows as one notification
Every push from the app is a Declarative Web Push message (spec push-sending). Where the browser shows such a message itself, the app SHALL leave it as it is, so it shows once. Where the browser does not, the app's service worker SHALL show it as a notification with the message's title and text.

#### Scenario: A push shows as a notification where the browser does not show it itself
- **GIVEN** the app's service worker runs in a browser that does not show Declarative Web Push messages itself
- **WHEN** a push arrives titled "Ahoj" with the text "Zkušební zpráva", opening the page `/`
- **THEN** the device shows the notification "Ahoj" with "Zkušební zpráva"

#### Scenario: A push the browser shows itself shows once
- **GIVEN** the app's service worker runs in a browser that shows Declarative Web Push messages itself
- **WHEN** a push arrives titled "Ahoj"
- **THEN** the service worker shows no notification of its own

### Requirement: A tap on a notification opens the app
A tap on a notification the service worker showed SHALL open the app at the message's page, on the app's own address. When the app is already open, the tap SHALL bring its window to the front instead of opening another.

#### Scenario: A tap on a notification opens the app at its page
- **GIVEN** the service worker showed a notification for a push opening the page `/`
- **AND** the app is not open
- **WHEN** the notification is tapped
- **THEN** the app opens at the page `/` on its own address

#### Scenario: A tap on a notification brings the open app to the front
- **GIVEN** the service worker showed a notification
- **AND** the app is open in a window
- **WHEN** the notification is tapped
- **THEN** that window comes to the front
- **AND** no other window opens

### Requirement: A message reaches the iPhone
A message sent to an account SHALL show on the iPhone of a user who turned notifications on in the Home Screen app, also while the app is closed, and a tap on it SHALL open the app.

#### Scenario: A message sent to the account shows on the iPhone and a tap opens the app
- **GIVEN** the owner turned notifications on in the iPhone's Home Screen app
- **AND** the app is closed
- **WHEN** a message titled "Ahoj" is sent to the owner's account through the owner's message endpoint
- **THEN** it shows on the iPhone's lock screen
- **AND** a tap on it opens the app
