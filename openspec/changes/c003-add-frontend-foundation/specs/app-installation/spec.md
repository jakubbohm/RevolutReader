## Purpose

How the app gets onto the iPhone and starts there: a browser tab on an iPhone shows how to add the app to the Home Screen, and the app opened from the Home Screen looks and starts like an installed app.

## ADDED Requirements

### Requirement: A browser tab on an iPhone shows only the install hint
Opened in a browser tab on an iPhone, not from the Home Screen, the app SHALL show only the install hint: the app's icon and name, one sentence on what the app shows, and the steps to add it to the Home Screen from Safari. It SHALL show nothing else, because sign-in and notifications work only in the app opened from the Home Screen.

#### Scenario: iPhone Safari shows only the install hint
- **GIVEN** the app is opened in Safari on an iPhone
- **WHEN** the page appears
- **THEN** it shows the install hint "Nejdřív si appku přidej na plochu" with its three steps
- **AND** it shows no top bar

### Requirement: Outside a browser tab on an iPhone, the app shows itself
Opened from the iPhone's Home Screen, or in a browser on any other device, the app SHALL show the app itself and never the install hint.

#### Scenario: The Home Screen app shows the app, not the install hint
- **GIVEN** the app is opened from the Home Screen of an iPhone
- **WHEN** it shows its first screen
- **THEN** the top bar shows the app's name
- **AND** no install hint is shown

#### Scenario: Other browsers show the app, not the install hint
- **GIVEN** the app is opened in a browser on a computer
- **WHEN** the page appears
- **THEN** the top bar shows the app's name
- **AND** no install hint is shown

### Requirement: The Home Screen app has its own icon, name and launch screen
Added to an iPhone's Home Screen, the app SHALL appear with its own icon and the full name "Tarjeta Papá". It SHALL open full-screen, without Safari's address bar. While it starts, it SHALL show its launch screen: the icon on the app's background colour, light or dark as the phone is set, never a white screen.

#### Scenario: The Home Screen shows the app's icon and name
- **GIVEN** the app has been added to an iPhone's Home Screen
- **WHEN** the owner looks at the Home Screen
- **THEN** the app has its own icon and the full name "Tarjeta Papá"

#### Scenario: The Home Screen app opens with its launch screen
- **GIVEN** the app is on an iPhone's Home Screen
- **WHEN** it is opened, once with the phone in light mode and once in dark mode
- **THEN** it opens full-screen, without Safari's address bar
- **AND** while it starts it shows the icon on the app's background colour, not a white screen
