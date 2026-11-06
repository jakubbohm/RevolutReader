## Purpose

How the app reaches the phone and stays current: the backend serves the app's pages from the same address as the API, the phone keeps the app's files so it opens without network, and a new version shows on the next open.

## ADDED Requirements

### Requirement: The backend serves the app's pages
The backend SHALL serve the app's page at its root address and at every page address it does not otherwise know, so that a page address opened directly or reloaded still opens the app. The pages SHALL need no sign-in. Addresses under `/api` SHALL never be answered with the page: they keep the API's own answers (spec api-errors).

#### Scenario: The start page opens at the root address
- **GIVEN** the app is running
- **WHEN** a visitor opens `/`
- **THEN** the app's page is served

#### Scenario: An unknown page address opens the app
- **GIVEN** the app is running
- **WHEN** a visitor opens `/no-such-page`
- **THEN** the app's page is served

### Requirement: The app opens without network
After its first visit, the app SHALL open on the phone without a network connection, from the app files the phone keeps.

#### Scenario: The app opens without network after the first visit
- **GIVEN** the app has been opened once from the Home Screen
- **AND** the phone is in airplane mode
- **WHEN** the app is opened again
- **THEN** it shows its top bar, not an error page

### Requirement: A new version shows on the next open
After a new version is deployed, the app SHALL show it during the first open that follows, with no step for the user. The app checks for a new version whenever it is opened or comes back to the screen, and switches to a new version by reloading once.

#### Scenario: A new version shows on the first open after a deploy
- **GIVEN** the app is on the Home Screen and has been opened before
- **AND** a new version with a visible difference has been deployed since
- **WHEN** the app is opened
- **THEN** it reloads once by itself and shows the new version
