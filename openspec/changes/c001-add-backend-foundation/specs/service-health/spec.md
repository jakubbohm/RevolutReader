# Spec Delta

## Purpose

Lets a hosting platform or a local orchestrator ask whether the app is up, without signing in and without costing a bank request.

## ADDED Requirements

### Requirement: Health check open to every caller
The system SHALL answer `GET /health` for any caller, signed in or not, with status 200 and the plain-text body `Healthy` while it is running. Answering the health check SHALL NOT call the bank or the storage, because bank requests are limited (ADR-0001-bank-data-access).

#### Scenario: Health check answers while the app runs
- **GIVEN** the app is running
- **WHEN** a caller who has not signed in requests `GET /health`
- **THEN** the app answers with status 200
- **AND** the body is the plain text `Healthy`
