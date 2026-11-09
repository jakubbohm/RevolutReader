# app-shell Specification

## Purpose

The frame every screen of the app sits in: a top bar with the app's name above the screen's content. Later changes add the account menu to it.

## Requirements

### Requirement: The app's screens sit under a top bar with the app's name
Every screen of the app, except the install hint (spec app-installation) and the sign-in, no-access and signed-out screens (spec sign-in), which show the app's name large in their middle instead, SHALL sit under a top bar that shows the app's name, "Tarjeta Papá", written exactly so (capital P, with the accent). The name SHALL be marked as Spanish, so a screen reader pronounces it in Spanish; it is the only text in the app that is not Czech.

#### Scenario: The top bar shows the app name
- **GIVEN** the app is opened from the Home Screen of an iPhone
- **AND** someone is signed in
- **WHEN** it shows its first screen
- **THEN** the top bar shows "Tarjeta Papá"
- **AND** the name is marked as Spanish

### Requirement: The top bar holds the account menu
When someone is signed in, the top bar SHALL hold an account menu, opened from a button labelled "Účet a odhlášení". The menu SHALL show "Přihlášený účet", the account's name and email address, and one item, "Odhlásit se". Nothing else goes in it.

#### Scenario: The account menu shows who is signed in
- **GIVEN** Lucie Nováková, `lucie@example.com`, is signed in
- **WHEN** she opens the account menu in the top bar
- **THEN** it shows "Přihlášený účet", "Lucie Nováková" and `lucie@example.com`
- **AND** the one item "Odhlásit se"

### Requirement: The app says the server is waking up
When the app's first request, asking who is signed in, has no answer after 1.5 seconds, the app SHALL show "Server se probouzí" with "Když ho chvíli nikdo nepoužívá, usne. První načtení trvá asi 20 sekund." under the top bar. It SHALL stay until what it waits for has arrived (the balance, or the sign-in screen when nobody is signed in), which then takes its place.

#### Scenario: A sleeping server shows the waking-up screen after 1.5 seconds
- **GIVEN** the phone keeps no balance
- **AND** the server takes 20 seconds to wake up
- **WHEN** the app is opened
- **THEN** after 1.5 seconds it shows "Server se probouzí" with "Když ho chvíli nikdo nepoužívá, usne. První načtení trvá asi 20 sekund."
- **AND** once the server has answered, the balance takes its place

### Requirement: A slow wake offers to try again
When the first request has no answer after 30 seconds, the waking-up screen SHALL add "Trvá to déle než obvykle. Zkontroluj připojení, nebo to zkus znovu." with the button "Zkusit znovu", which sends the request again and starts the 30 seconds over.

#### Scenario: A slow wake offers to try again after 30 seconds
- **GIVEN** the server does not answer
- **WHEN** the app has waited 30 seconds
- **THEN** the waking-up screen adds "Trvá to déle než obvykle. Zkontroluj připojení, nebo to zkus znovu." and "Zkusit znovu"
- **AND** tapping "Zkusit znovu" asks the server again

### Requirement: A kept balance shows at once
With a balance kept on the phone (spec account-balance), the app SHALL show it with its time as soon as it is opened, before any answer. While the server wakes up, the waking-up screen SHALL stand below it, in the list's place.

#### Scenario: A stored balance shows at once while the server wakes
- **GIVEN** the phone keeps a balance of 286,40 € read two hours ago
- **AND** the server takes 20 seconds to wake up
- **WHEN** the app is opened
- **THEN** it shows 286,40 € with "Aktualizováno před 2 h" at once
- **AND** after 1.5 seconds "Server se probouzí" below it

### Requirement: The app says when the phone is offline
When a request is due while the phone is offline, the app SHALL send nothing; when a request gets no answer at all, it SHALL count as offline. Either way the app SHALL say it is offline: with a kept balance, its header, the warning "Jsi offline" with "Zkusit znovu", and "Pohyby se načtou, jakmile budeš online." below; with none, only "Jsi offline" and "Zůstatek a pohyby se načtou, jakmile budeš online.". An answer with an error status is not offline.

#### Scenario: Offline with a stored balance shows it with the offline banner
- **GIVEN** the phone keeps a balance of 286,40 € read two hours ago
- **AND** the phone is offline
- **WHEN** the app is opened
- **THEN** it shows 286,40 € with "Aktualizováno před 2 h"
- **AND** the warning "Jsi offline" with "Zkusit znovu", and "Pohyby se načtou, jakmile budeš online."

#### Scenario: Offline with nothing stored says the balance loads once online
- **GIVEN** the phone keeps no balance
- **AND** the phone is offline
- **WHEN** the app is opened
- **THEN** it shows only "Jsi offline" and "Zůstatek a pohyby se načtou, jakmile budeš online." under the top bar
- **AND** it sends no request

### Requirement: The app loads again when the phone is back online
When the phone comes back online, the app SHALL repeat what was under way: asking who is signed in, or reading the balance. "Zkusit znovu" on the offline banner SHALL do the same at once.

#### Scenario: Coming back online loads what was waiting
- **GIVEN** the app shows that the phone is offline, with no balance kept
- **AND** Lucie is signed in, and the bank holds 286.40 EUR
- **WHEN** the phone comes back online
- **THEN** the app shows 286,40 €

### Requirement: A refresh with no answer counts as offline
A refresh that has no answer after 60 seconds SHALL end as offline: the balance stays shown and the warning "Jsi offline" appears. The first load has no such limit; it shows the slow waking-up screen instead.

#### Scenario: A refresh with no answer for 60 seconds counts as offline
- **GIVEN** Lucie sees 286,40 € on the account screen
- **AND** the server stops answering
- **WHEN** she taps "Obnovit" and 60 seconds pass
- **THEN** 286,40 € stays shown
- **AND** the warning "Jsi offline" appears

### Requirement: An unexpected answer to who is signed in
When the server answers the app's first request with anything the app does not expect (a server error, a hosting error page, an unreadable answer), the app SHALL show the error banner "Zůstatek se nepodařilo načíst" with "Zkus to prosím za chvíli." and "Zkusit znovu" under the top bar, below a kept balance if there is one. "Zkusit znovu" SHALL ask again.

#### Scenario: An unexpected answer to who is signed in shows a banner with a retry
- **GIVEN** the server answers who is signed in with an error of its own
- **WHEN** the app is opened
- **THEN** it shows the error "Zůstatek se nepodařilo načíst" with "Zkus to prosím za chvíli." and "Zkusit znovu"
- **AND** tapping "Zkusit znovu" asks the server again

### Requirement: The app keeps the server awake while it is on the screen
While the app is on the screen, it SHALL ask the server's health check when it comes on the screen and every 4 minutes after, without waiting for the answer, so the server does not fall asleep while the app is in use. It SHALL ask nothing while it is not on the screen.

#### Scenario: The app keeps the server awake while it is on the screen
- **GIVEN** the app is opened and stays on the screen
- **WHEN** 8 minutes pass, and then it stays in the background for 8 more
- **THEN** it asked the health check when it opened, after 4 minutes and after 8 minutes
- **AND** none while it was in the background

### Requirement: The app lets the server sleep when nobody uses it
After 30 minutes on the screen without a tap or a key press, the app SHALL stop asking the health check, and SHALL start again with the next tap or key press, so an app left open on a screen does not keep the server running.

#### Scenario: The app lets the server sleep after 30 minutes without use
- **GIVEN** the app is opened and stays on the screen
- **AND** nobody taps it or presses a key
- **WHEN** 40 minutes pass
- **THEN** the last health check it asked was the one at 28 minutes
- **AND** it asks again as soon as someone taps it
