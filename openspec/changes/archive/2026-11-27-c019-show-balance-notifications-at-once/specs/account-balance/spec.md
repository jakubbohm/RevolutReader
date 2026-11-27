# Spec Delta

## ADDED Requirements

### Requirement: The header shows the balance in ink only once the server confirmed it
The header SHALL show the balance in ink only when the latest balance read of the current opening succeeded, an opening being a launch of the app or a return to it. Every other balance, the one the phone keeps or one a notification brought, SHALL show in grey. While a refresh of a balance in ink runs ("Obnovit"), it SHALL stay in ink; a read that fails SHALL turn it grey.

#### Scenario: The balance turns ink when the server's balance arrives
- **GIVEN** the phone keeps a balance of 250,00 € read two hours ago
- **AND** Lucie is signed in, and the bank holds 286.40 EUR
- **WHEN** she opens the app and the balance arrives
- **THEN** 286,40 € shows in ink

#### Scenario: A refresh keeps a confirmed balance in ink
- **GIVEN** Lucie sees 286,40 € in ink on the account screen
- **WHEN** she taps "Obnovit"
- **THEN** while the balance is read again, 286,40 € stays in ink, with "Obnovuji…"

#### Scenario: A failed refresh turns the balance grey
- **GIVEN** Lucie sees 286,40 € in ink on the account screen
- **AND** the bank does not answer
- **WHEN** she taps "Obnovit"
- **THEN** 286,40 € shows in grey, with the error "Banka teď neodpovídá"

#### Scenario: Coming back to the app turns the balance grey until the answer
- **GIVEN** Lucie sees 286,40 € in ink on the account screen
- **AND** the bank now holds 301.90 EUR
- **WHEN** she leaves the app and comes back to it
- **THEN** 286,40 € shows in grey until 301,90 € arrives in ink

### Requirement: A grey balance moves while it is being read
A balance in grey SHALL move while a request that can confirm it is under way: a band of ink crosses it on the same clock as the bar under "Server se probouzí", in step with it. With no such request (offline, or after a failed read) it SHALL stand still.

#### Scenario: A stored balance is grey and moving while the server wakes
- **GIVEN** the phone keeps a balance of 286,40 € read two hours ago
- **AND** the server takes 20 seconds to wake up
- **WHEN** the app is opened
- **THEN** 286,40 € shows in grey and moving, with "Server se probouzí" below it after 1.5 seconds

#### Scenario: A stored balance is grey and moving while an awake server answers
- **GIVEN** the phone keeps a balance of 286,40 € read two hours ago
- **AND** the server is awake, and the bank takes a second to answer
- **WHEN** the app is opened
- **THEN** while the balance is read, 286,40 € shows in grey and moving, with "Obnovuji…"

#### Scenario: Offline, the stored balance is grey and still
- **GIVEN** the phone keeps a balance of 286,40 € read two hours ago
- **AND** the phone is offline
- **WHEN** the app is opened
- **THEN** 286,40 € shows in grey and still, with the warning "Jsi offline"

#### Scenario: After a failed read, the stored balance is grey and still
- **GIVEN** the phone keeps a balance of 286,40 € read two hours ago
- **AND** the bank does not answer
- **WHEN** Lucie opens the app
- **THEN** once the read has failed, 286,40 € shows in grey and still, with the error "Banka teď neodpovídá"

#### Scenario: The grey balance moves in step with the waking-up bar
- **GIVEN** the owner's iPhone keeps a balance, and the server is asleep
- **WHEN** the owner opens the app from the Home Screen
- **THEN** the band crossing the grey balance and the bar under "Server se probouzí" move as one, from the moment the bar appears

### Requirement: A grey balance adds nothing a screen reader says
Whether the balance shows in grey or in ink SHALL change nothing a screen reader says about it: the freshness line read after it gives its age or says "Obnovuji…", and the waking-up screen or the banner says why it is not confirmed.

#### Scenario: A grey balance is spoken as a balance in ink
- **GIVEN** the phone keeps a balance of 286,40 € read two hours ago, at 24.3 CZK per euro
- **AND** Lucie is signed in, and the bank holds 286.40 EUR at the same rate
- **WHEN** she opens the app and the balance arrives
- **THEN** a screen reader hears "286,40 €" and "přibližně 6 960 Kč" while the balance is grey, and the same once it is in ink

### Requirement: A grey balance stands still under reduced motion
Where the device asks for reduced motion, a balance in grey SHALL never move, and SHALL not fade when it turns ink; it SHALL still show in grey until the server confirms it.

#### Scenario: Under reduced motion the grey balance stands still
- **GIVEN** Reduce Motion is on on the owner's iPhone, which keeps a balance
- **AND** the server is asleep
- **WHEN** the owner opens the app from the Home Screen
- **THEN** the balance shows in grey and does not move until it turns ink
