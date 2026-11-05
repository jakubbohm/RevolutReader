# Spec Delta

## Purpose

Defines how the API answers when a request fails, so every client reads errors one way: a problem description (RFC 9457) with the status from the case → status table in docs/conventions/README.md.

## ADDED Requirements

### Requirement: Error responses are problem descriptions
Every error response of the API (status 400 to 599) to a caller that accepts JSON SHALL be a problem description: content type `application/problem+json`, with a `status` equal to the response status and a `title` naming the case. Browsers and HTTP clients accept JSON by default; only a caller that rules JSON out gets a plain-text status line instead. A request for an address the API does not serve SHALL answer 404 Not Found.

#### Scenario: Unknown API address answers with a problem description
- **GIVEN** the app is running
- **WHEN** a caller requests `GET /api/no-such-address`
- **THEN** the app answers with status 404 and content type `application/problem+json`
- **AND** the body's `status` is 404 and its `title` is `Not Found`
