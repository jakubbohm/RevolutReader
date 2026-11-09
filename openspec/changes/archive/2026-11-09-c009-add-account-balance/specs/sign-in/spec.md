# Spec Delta

## ADDED Requirements

### Requirement: A failed sign-out says so
When the sign-out from the account menu fails, the app SHALL stay on the account screen, still signed in and keeping the stored balance, and show the error banner "Odhlášení se nepovedlo", with "Zkus to znovu, až budeš online." when the phone is offline, or "Zkus to prosím za chvíli." when the server fails. The account menu stays the way to try again.

#### Scenario: A sign-out that fails offline says to try again online
- **GIVEN** Lucie sees 286,40 € on the account screen
- **AND** the phone is offline
- **WHEN** she taps "Odhlásit se" in the account menu
- **THEN** the error "Odhlášení se nepovedlo" with "Zkus to znovu, až budeš online." shows
- **AND** 286,40 € stays shown, with the account menu

#### Scenario: A sign-out the server fails says to try again later
- **GIVEN** Lucie is signed in and her account menu is open
- **AND** the server fails the sign-out
- **WHEN** she taps "Odhlásit se"
- **THEN** the error "Odhlášení se nepovedlo" with "Zkus to prosím za chvíli." shows
- **AND** she is still on the account screen

### Requirement: The sign-out shows that it is under way
While the sign-out runs, the account menu SHALL stay open, and "Odhlásit se" SHALL show a spinner beside its label, be marked busy and ignore further taps. A tap outside closes the menu; the sign-out still finishes and its result still shows.

#### Scenario: The menu shows the sign-out under way
- **GIVEN** Lucie's account menu is open
- **AND** the server takes a while to answer the sign-out
- **WHEN** she taps "Odhlásit se"
- **THEN** the menu stays open with "Odhlásit se" marked busy
- **AND** tapping it again sends no second sign-out

### Requirement: A login that ends while the app is open
When the server answers a balance read that nobody is signed in, the app SHALL show the sign-in screen without the signed-out note; when it refuses the account, the no-access screen naming it, as when the app is opened.

#### Scenario: A login that ends while the app is open shows the sign-in screen
- **GIVEN** Lucie sees 286,40 € on the account screen
- **AND** her login has ended on the server
- **WHEN** she taps "Obnovit"
- **THEN** the app shows the sign-in screen
- **AND** without the note "Odhlášení proběhlo. Pro návrat se znovu přihlas."
