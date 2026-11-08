# Spec Delta

## MODIFIED Requirements

### Requirement: The app's screens sit under a top bar with the app's name
Every screen of the app, except the install hint (spec app-installation) and the sign-in, no-access and signed-out screens (spec sign-in), which show the app's name large in their middle instead, SHALL sit under a top bar that shows the app's name, "Tarjeta Papá", written exactly so (capital P, with the accent). The name SHALL be marked as Spanish, so a screen reader pronounces it in Spanish; it is the only text in the app that is not Czech.

#### Scenario: The top bar shows the app name
- **GIVEN** the app is opened from the Home Screen of an iPhone
- **AND** someone is signed in
- **WHEN** it shows its first screen
- **THEN** the top bar shows "Tarjeta Papá"
- **AND** the name is marked as Spanish

## ADDED Requirements

### Requirement: The top bar holds the account menu
When someone is signed in, the top bar SHALL hold an account menu, opened from a button labelled "Účet a odhlášení". The menu SHALL show "Přihlášený účet", the account's name and email address, and one item, "Odhlásit se". Nothing else goes in it.

#### Scenario: The account menu shows who is signed in
- **GIVEN** Lucie Nováková, `lucie@example.com`, is signed in
- **WHEN** she opens the account menu in the top bar
- **THEN** it shows "Přihlášený účet", "Lucie Nováková" and `lucie@example.com`
- **AND** the one item "Odhlásit se"
