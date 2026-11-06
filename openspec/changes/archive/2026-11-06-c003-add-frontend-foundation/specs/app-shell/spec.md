## Purpose

The frame every screen of the app sits in: a top bar with the app's name above the screen's content. Later changes add the account menu to it.

## ADDED Requirements

### Requirement: The app's screens sit under a top bar with the app's name
Every screen of the app, except the install hint (spec app-installation), SHALL sit under a top bar that shows the app's name, "Tarjeta Papá", written exactly so (capital P, with the accent). The name SHALL be marked as Spanish, so a screen reader pronounces it in Spanish; it is the only text in the app that is not Czech.

#### Scenario: The top bar shows the app name
- **GIVEN** the app is opened from the Home Screen of an iPhone
- **WHEN** it shows its first screen
- **THEN** the top bar shows "Tarjeta Papá"
- **AND** the name is marked as Spanish
