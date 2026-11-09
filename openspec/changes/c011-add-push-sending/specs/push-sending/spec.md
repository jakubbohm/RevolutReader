# Spec Delta

## Purpose

Sending a push to an account's devices: what a push carries, who gets one, what happens to devices whose push service reports them gone or fails, and the owner's message endpoint, which sends a message to a named account for tests and the owner's own messages.

## ADDED Requirements

### Requirement: A message reaches every device of its account
A message to an account SHALL be sent once to every device registered under that account (spec push-devices) and to no other device, through each device's push service, encrypted for that device (RFC 8291) and signed with the server's push key for that push service (RFC 8292). Nothing SHALL be retried.

#### Scenario: A registered device receives a message sent to its account
- **GIVEN** Lucie registered her phone for pushes
- **WHEN** the owner sends Lucie a message titled "Ahoj" with the text "Zkušební zpráva" and the page `/`
- **THEN** her phone's push service receives one push, signed with the server's push key for that push service
- **AND** the phone decrypts it to a Declarative Web Push message titled "Ahoj", with the text "Zkušební zpráva", opening the app's own address of the page `/`
- **AND** the answer counts 1 device reached, 0 failed, 0 removed

#### Scenario: A message reaches every device of the account and none of another account's
- **GIVEN** Lucie registered her phone and her tablet for pushes
- **AND** Petr, also allowed, registered his phone
- **WHEN** the owner sends a message to Lucie
- **THEN** Lucie's phone and tablet each receive it, and Petr's phone receives nothing
- **AND** the answer counts 2 devices reached

#### Scenario: An allowed account with no devices gets zero counts
- **GIVEN** Petr is on the allowlist and has registered no device
- **WHEN** the owner sends a message to Petr
- **THEN** the answer counts 0 devices reached, 0 failed, 0 removed

### Requirement: Every push is a Declarative Web Push message
Every push SHALL carry a Declarative Web Push message, JSON with `web_push` 8030 and a `notification` holding a non-empty `title`, the text as `body` when there is one, and `navigate`, the address a tap opens, always a page of the app itself. It SHALL never carry a badge. It SHALL wait up to 24 hours at the push service while the device is offline, and SHALL be sent as urgent.

#### Scenario: Every push lives 24 hours and is urgent
- **GIVEN** Lucie registered her phone for pushes
- **WHEN** the owner sends a message to Lucie
- **THEN** her phone's push service receives it with a lifetime of 86400 seconds and the urgency `high`

### Requirement: The owner's message endpoint answers only with its key
`POST /api/push/messages` SHALL send a message to every device of the account it names, with the title, the optional text and the optional page (`/` when none is given), when the request carries the message key. It SHALL answer `delivered`, `failed` and `removed`, each a count of devices. Without the right key it SHALL answer exactly as an unknown `/api` address does, and send nothing.

#### Scenario: A message without the right key gets the answer of an unknown address
- **GIVEN** Lucie registered her phone for pushes
- **WHEN** someone sends a message to Lucie with a wrong message key
- **THEN** the answer is the same 404 problem description an unknown `/api` address gets
- **AND** her phone's push service receives nothing

### Requirement: Only accounts on the allowlist get pushes
The sender SHALL check the allowlist on every send. A message to an account not on the allowlist SHALL be refused with 404 and a problem description of `type` `/problems/push-account-not-allowed`, and every device still registered under that account SHALL be deleted.

#### Scenario: A message to an account not on the allowlist is refused
- **GIVEN** an account that is not on the allowlist
- **WHEN** the owner sends a message to that account
- **THEN** the answer is 404 with a problem description of `type` `/problems/push-account-not-allowed`
- **AND** no push service receives anything

#### Scenario: A message to an account no longer on the allowlist deletes its devices
- **GIVEN** a phone registered for an account that has since left the allowlist
- **WHEN** the owner sends a message to that account
- **THEN** the answer is 404 with a problem description of `type` `/problems/push-account-not-allowed`
- **AND** the phone is no longer registered, and its push service receives nothing

### Requirement: A message a push cannot carry is refused
The message endpoint SHALL refuse with 400 a message without a title or whose title is blank, a message whose page is not a page of the app (a path that starts with a single `/`, outside `/api`), and a message whose push content would be longer than 3993 bytes, the most a push service must carry (RFC 8291). It SHALL refuse with 400 in the same way a request without an account, and a request whose body is not the request's JSON. The problem description SHALL name the refused member (`title`, `page`, `message`, `account` or `body`), never its value, and nothing SHALL be sent.

#### Scenario: A message without a title is refused
- **GIVEN** Lucie registered her phone for pushes
- **WHEN** the owner sends Lucie a message with the text "Zkušební zpráva" and no title
- **THEN** the answer is 400 with a problem description titled `Bad Request` naming the title
- **AND** her phone's push service receives nothing

#### Scenario: A message whose page is not a page of the app is refused
- **GIVEN** Lucie registered her phone for pushes
- **WHEN** the owner sends Lucie a message titled "Ahoj" with the page `https://example.com/`
- **THEN** the answer is 400 with a problem description titled `Bad Request` naming the page
- **AND** her phone's push service receives nothing

#### Scenario: A message too long for a push is refused
- **GIVEN** Lucie registered her phone for pushes
- **WHEN** the owner sends Lucie a message titled "Ahoj" with a text of 4000 characters
- **THEN** the answer is 400 with a problem description titled `Bad Request` naming the message as too long
- **AND** her phone's push service receives nothing

### Requirement: The push service's answers decide what happens to a device
A device whose push service answers that it is gone (404 or 410) SHALL be deleted at once and counted as removed. Any other failure (another error status, no answer in time, no connection) SHALL count the device as failed and keep it. Neither is retried.

#### Scenario: A device the push service reports gone is deleted
- **GIVEN** Lucie registered her phone for pushes
- **AND** her phone's push service answers that the phone is gone
- **WHEN** the owner sends a message to Lucie, then another
- **THEN** the first answer counts 0 devices reached, 0 failed, 1 removed
- **AND** the second counts 0 reached, 0 failed, 0 removed, and the push service receives only the first

#### Scenario: A device whose push service fails is counted as failed and kept
- **GIVEN** Lucie registered her phone for pushes
- **AND** her phone's push service fails with an error of its own once
- **WHEN** the owner sends a message to Lucie, then another
- **THEN** the first answer counts 0 devices reached, 1 failed, 0 removed
- **AND** the second counts 1 reached, and the phone receives it
