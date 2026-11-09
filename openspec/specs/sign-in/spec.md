# sign-in Specification

## Purpose

Lets the few pre-approved people sign in to the app with their personal Microsoft account and keeps everyone else out: how a sign-in starts and ends, who gets in, how long the login lasts, signing out, the protection of the login against other sites, and the screens around it.

## Requirements

### Requirement: Only allowed accounts use the API
Every API address except those open to all (the health check and the app's pages) SHALL require a signed-in account whose email address is on the allowlist, compared ignoring case and checked on every request against the current list. A visitor who has not signed in SHALL get 401. A signed-in account that is not on the list SHALL get 403, with a problem description that names that account's own email address.

#### Scenario: An anonymous visitor is asked to sign in
- **GIVEN** a visitor who has not signed in
- **WHEN** they ask the API who is signed in
- **THEN** the answer is 401 with a problem description titled `Unauthorized`

#### Scenario: A stranger who signs in is refused, with their own email
- **GIVEN** `cizi.ucet@example.com` is not on the allowlist
- **WHEN** that account signs in through Microsoft
- **AND** asks the API who is signed in
- **THEN** the answer is 403 with a problem description titled `Forbidden`
- **AND** it names `cizi.ucet@example.com`

### Requirement: The API tells a signed-in user who they are
The API SHALL tell a signed-in, allowed user who they are: exactly their name and their email address, as their Microsoft account gives them, and nothing else about the account.

#### Scenario: An allowed user who signs in gets in
- **GIVEN** `lucie@example.com` is on the allowlist
- **WHEN** Lucie Nováková signs in through Microsoft with that account
- **THEN** she lands on the app's start page
- **AND** asking the API who is signed in answers exactly the name "Lucie Nováková" and the email `lucie@example.com`

### Requirement: Signing in goes through Microsoft's personal-account service
The system SHALL sign users in through Microsoft's service for personal Microsoft accounts and then always return them to the app's start page. A sign-in started to try another account SHALL ask Microsoft to show its account picker. Microsoft SHALL be asked to return to the app's own HTTPS address, also when the app runs behind the hosting proxy.

#### Scenario: Signing in again with another account opens Microsoft's account picker
- **WHEN** a visitor starts a sign-in to try another account
- **THEN** they are sent to Microsoft's sign-in
- **AND** Microsoft is asked to show its account picker

#### Scenario: Sign-in returns to the app's own HTTPS address behind the hosting proxy
- **GIVEN** the app runs behind the hosting proxy, which received the visitor's request over HTTPS for `tarjeta.example.net`
- **WHEN** the visitor starts a sign-in
- **THEN** Microsoft is asked to return to `https://tarjeta.example.net/api/auth/signin-oidc`

### Requirement: A sign-in that does not complete signs nobody in
When Microsoft reports a cancelled or failed sign-in, or its answer does not come from the service for personal Microsoft accounts, the system SHALL NOT sign the visitor in and SHALL return them to the app's start page.

#### Scenario: A sign-in cancelled at Microsoft leaves the visitor signed out
- **GIVEN** a visitor started a sign-in
- **WHEN** Microsoft reports that the visitor cancelled it
- **THEN** the visitor is back on the app's start page
- **AND** asking the API who is signed in answers 401

#### Scenario: An account from a work or school directory is not signed in
- **GIVEN** a visitor started a sign-in
- **WHEN** Microsoft's answer carries an account issued by a work or school directory instead of the personal-account service
- **THEN** the visitor is back on the app's start page
- **AND** asking the API who is signed in answers 401

### Requirement: The login lasts 30 days and is renewed while the app is used
A sign-in SHALL keep the user signed in on that device for 30 days, also after the app or the browser is closed. Using the app SHALL renew the login for another 30 days once more than half of its current 30 days have passed, so regular use keeps it alive and a login unused for 30 days has always ended; a login unused for between 15 and 30 days MAY end as well.

#### Scenario: A login unused for 30 days has ended
- **GIVEN** Lucie, an allowed user, signed in
- **AND** she has not used the app for 31 days
- **WHEN** she asks the API who is signed in
- **THEN** the answer is 401

#### Scenario: Using the app keeps the login alive
- **GIVEN** Lucie, an allowed user, signed in
- **AND** she used the app 20 days later
- **WHEN** she asks the API who is signed in 45 days after signing in
- **THEN** the answer is her name and email

#### Scenario: The Home Screen app stays signed in after it is closed
- **GIVEN** the owner signed in from the app on the Home Screen of the owner's iPhone
- **WHEN** the app is closed from the app switcher and opened again
- **THEN** it opens signed in, without asking to sign in

### Requirement: Signing in works in the Home Screen app
Signing in SHALL work in the app opened from an iPhone's Home Screen, and the user SHALL end up signed in inside that app, not in a Safari tab.

#### Scenario: Signing in from the Home Screen app opens the app
- **GIVEN** the app is on the Home Screen of the owner's iPhone and the owner's account is on the allowlist
- **WHEN** the owner opens it, taps "Přihlásit se účtem Microsoft" and signs in at Microsoft
- **THEN** the Home Screen app shows the account page
- **AND** its account menu names the owner's email address

### Requirement: Signing out ends the login on the device
Signing out SHALL end the login on that device. It SHALL NOT sign the user out of their Microsoft account.

#### Scenario: Signing out ends the login
- **GIVEN** Lucie, an allowed user, is signed in
- **WHEN** she signs out
- **THEN** asking the API who is signed in answers 401

### Requirement: A login cannot be used from another site
A write request (POST, PUT, PATCH or DELETE) to an API address that a browser sends on behalf of another site, including another app on the same hosting domain, SHALL be refused with 403 and a problem description, and SHALL change nothing.

#### Scenario: A write request from another site is refused
- **GIVEN** Lucie, an allowed user, is signed in
- **WHEN** a page of another app on the same hosting domain makes her browser send the sign-out request
- **THEN** the answer is 403 with a problem description titled `Forbidden`
- **AND** she is still signed in

### Requirement: The sign-in screen
When nobody is signed in, the app SHALL show the sign-in screen, without the top bar: the app's name (marked as Spanish), "Uvidíš tu zůstatek a pohyby na tátově eurovém účtu.", the Microsoft sign-in button "Přihlásit se účtem Microsoft" and the line "Použij účet Microsoft, který ti táta povolil.". The button SHALL start the sign-in.

#### Scenario: The sign-in screen shows when nobody is signed in
- **GIVEN** the server answers that nobody is signed in
- **WHEN** the app is opened from the Home Screen
- **THEN** it shows "Tarjeta Papá", marked as Spanish, and "Uvidíš tu zůstatek a pohyby na tátově eurovém účtu."
- **AND** the button "Přihlásit se účtem Microsoft" with the line "Použij účet Microsoft, který ti táta povolil."

#### Scenario: Tapping the sign-in button starts the Microsoft sign-in
- **GIVEN** the sign-in screen is shown
- **WHEN** the visitor taps "Přihlásit se účtem Microsoft"
- **THEN** the app goes to the backend's sign-in address

### Requirement: The no-access screen
When the server refuses the signed-in account, the app SHALL show that this account has no access, naming its email address, and SHALL offer "Zkusit jiný účet", which signs out and starts a new sign-in that asks Microsoft for its account picker.

#### Scenario: A refused account sees that it has no access
- **GIVEN** the server refuses the signed-in account `cizi.ucet@example.com`
- **WHEN** the app is opened
- **THEN** it shows the error "Tenhle účet nemá přístup" with "Účet cizi.ucet@example.com tu není povolený. Přihlas se tím, který ti táta povolil."
- **AND** the button "Zkusit jiný účet"

#### Scenario: Trying another account signs out and starts a new sign-in
- **GIVEN** the no-access screen is shown
- **WHEN** the visitor taps "Zkusit jiný účet"
- **THEN** the app signs out
- **AND** then starts a sign-in that asks Microsoft for its account picker

### Requirement: The signed-out screen
After the user signs out from the account menu, the app SHALL show the sign-in screen with the note "Odhlášení proběhlo. Pro návrat se znovu přihlas." above the sign-in button.

#### Scenario: Signing out from the account menu shows the signed-out screen
- **GIVEN** Lucie is signed in and her account menu is open
- **WHEN** she taps "Odhlásit se"
- **THEN** the app signs out
- **AND** shows "Odhlášení proběhlo. Pro návrat se znovu přihlas." with the button "Přihlásit se účtem Microsoft"

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
