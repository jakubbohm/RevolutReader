# api-errors Specification

## Purpose

Defines how the API answers when a request fails, so every client reads errors one way: a problem description (RFC 9457) with the status from the case → status table in docs/conventions/README.md.

## Requirements

### Requirement: Error responses are problem descriptions
Every error response of the API (status 400 to 599) to a caller that accepts JSON SHALL be a problem description: content type `application/problem+json`, with a `status` equal to the response status and a `title` naming the case. Browsers and HTTP clients accept JSON by default; a caller that rules JSON out may get a plain-text status line instead. A request for an address the API does not serve SHALL answer 404 Not Found, whatever its method and whether or not the caller is signed in.

#### Scenario: Unknown API address answers with a problem description
- **GIVEN** the app is running
- **WHEN** a caller requests `GET /api/no-such-address`
- **THEN** the app answers with status 404 and content type `application/problem+json`
- **AND** the body's `status` is 404 and its `title` is `Not Found`

#### Scenario: A write to an unknown API address answers with a problem description
- **GIVEN** the app is running
- **WHEN** a caller who has not signed in sends `POST /api/no-such-address`
- **THEN** the app answers with status 404 and content type `application/problem+json`
- **AND** the body's `status` is 404 and its `title` is `Not Found`

### Requirement: An unexpected failure answers with a problem description
When the API fails in a way it does not expect (a bug, an infrastructure failure), it SHALL answer 500 with a problem description titled `Internal Server Error` that says nothing about the failure: no exception, no message, no data it was handling.

#### Scenario: An unexpected failure answers with a problem description that reveals nothing
- **GIVEN** Lucie is signed in
- **AND** the bank answers her balance read with an error the app does not know
- **WHEN** she asks the API for the balance
- **THEN** the answer is 500 with a problem description titled `Internal Server Error`
- **AND** it says nothing about the bank's answer
