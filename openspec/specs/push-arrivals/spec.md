# push-arrivals Specification

## Purpose

How long a push about the account takes to reach each device: the device reports every push that brings a balance, the server records how many seconds after the bank read it arrived, and neither the notification nor the kept balance ever depends on the report.

## Requirements

### Requirement: A device reports each push that brings a balance
When a push from the app carries a balance of the shape the device keeps (spec push-display), the app's service worker SHALL send the server one report of its arrival, carrying only the balance's read time exactly as the push gave it, never the amount. It SHALL report whether or not the device keeps a balance. A push without a balance, or with one of the wrong shape, SHALL report nothing.

#### Scenario: A push with a balance reports its arrival with the balance's read time
- **GIVEN** the app's service worker runs in a browser that shows Declarative Web Push messages itself
- **AND** the phone keeps a balance of 250,00 €
- **WHEN** a push arrives with a balance of 286.40 EUR read at `2026-11-21T09:14:03+00:00`
- **THEN** the server receives one report of its arrival, carrying only the read time `2026-11-21T09:14:03+00:00`

#### Scenario: A push with a balance reports its arrival on a phone that keeps no balance
- **GIVEN** the app's service worker runs in a browser that shows Declarative Web Push messages itself
- **AND** the phone keeps no balance
- **WHEN** a push arrives with a balance of 286.40 EUR read a minute ago
- **THEN** the server receives one report of its arrival

#### Scenario: A push without a balance reports nothing
- **GIVEN** the app's service worker runs in a browser that shows Declarative Web Push messages itself
- **WHEN** a push titled "Ahoj" arrives with no balance
- **THEN** the server receives no report

#### Scenario: A push with a balance of the wrong shape reports nothing
- **GIVEN** the app's service worker runs in a browser that shows Declarative Web Push messages itself
- **WHEN** a push arrives with a balance of 250.00 EUR that has no read time
- **THEN** the server receives no report

### Requirement: A report never stops the notification or the kept balance
A report that fails (the device offline, the request refused, a server error) SHALL be ignored and never sent again. The push's balance SHALL be kept as it would be without the report (spec push-display), and its notification SHALL show. Where the app's service worker shows the notification itself, it SHALL show it without waiting for the report. Where the browser shows its own, the browser shows it once the report's request has ended or its own time limit runs out.

#### Scenario: A failed report still keeps the push's balance
- **GIVEN** the app's service worker runs in a browser that shows Declarative Web Push messages itself
- **AND** the phone keeps a balance of 250,00 € read two hours ago
- **AND** the server fails every report with an error of its own
- **WHEN** a push arrives with a balance of 286.40 EUR read a minute ago
- **THEN** the next time the app is opened offline, it shows 286,40 €

#### Scenario: A failed report still shows the notification
- **GIVEN** the app's service worker runs in a browser that does not show Declarative Web Push messages itself
- **AND** the phone is offline
- **WHEN** a push arrives titled "Odešlo 3,80 €" with the text "Zůstatek 282,60 € (≈ 6 867 Kč)" and a balance of 282.60 EUR
- **THEN** the device shows the notification "Odešlo 3,80 €" with "Zůstatek 282,60 € (≈ 6 867 Kč)"

#### Scenario: The notification is shown without waiting for the report
- **GIVEN** the app's service worker runs in a browser that does not show Declarative Web Push messages itself
- **AND** the server is still waking up and has not answered the report
- **WHEN** a push arrives titled "Odešlo 3,80 €" with a balance of 282.60 EUR
- **THEN** the device shows the notification "Odešlo 3,80 €" before the server answers the report

### Requirement: The server records how long each push took to arrive
`POST /api/push/arrivals`, with `readAt` the read time a push's balance carried, SHALL record the push's arrival with its delay and answer 204. The delay is the time from `readAt` to the server's own time when the report arrives, in whole seconds rounded down, never below 0. The record SHALL hold the delay only, never an amount or the read time. Like every API address, it is for allowed, signed-in users only (spec sign-in).

#### Scenario: A report records how long the push took to arrive
- **GIVEN** Lucie is signed in
- **WHEN** her phone reports the arrival of a push whose balance the server read 75 seconds earlier
- **THEN** the answer is 204
- **AND** the server records one arrival, 75 seconds after the read

#### Scenario: A report whose read time lies ahead records 0 seconds
- **GIVEN** Lucie is signed in
- **WHEN** her phone reports the arrival of a push whose read time is 30 seconds after the server's own time
- **THEN** the server records one arrival, 0 seconds after the read

### Requirement: A report the server cannot read records nothing
A report whose `readAt` is missing, or is not a date and time, SHALL be refused with 400 and a problem description titled `Bad Request`, and SHALL record nothing.

#### Scenario: A report without a read time is refused and records nothing
- **GIVEN** Lucie is signed in
- **WHEN** her phone reports an arrival with no read time
- **THEN** the answer is 400 with a problem description titled `Bad Request`
- **AND** the server records no arrival

### Requirement: Arrivals are measured on the iPhone
On the iPhone's Home Screen app, the notification of a change on the account SHALL bring a report of its arrival to the server, also while the app is closed, so that the owner can read its delay per account and device.

#### Scenario: A payment's notification on the iPhone is reported within seconds
- **GIVEN** the owner turned notifications on in the iPhone's Home Screen app
- **AND** the app is closed
- **WHEN** a payment from the account brings the app's notification to the lock screen within seconds
- **THEN** the arrivals query shows that notification's report from the owner's iPhone, with a delay of seconds
