# Spec Delta

## MODIFIED Requirements

### Requirement: The top bar holds the account menu
When someone is signed in, the top bar SHALL hold an account menu, opened from a button labelled "Účet a odhlášení". The menu SHALL show "Přihlášený účet", the account's name and email address, and the item "Odhlásit se". It SHALL hold "Zapnout upozornění" above "Odhlásit se" only while notifications are offered there (spec notification-opt-in). Nothing else goes in it.

#### Scenario: The account menu shows who is signed in
- **GIVEN** Lucie Nováková, `lucie@example.com`, is signed in
- **AND** her browser cannot have notifications
- **WHEN** she opens the account menu in the top bar
- **THEN** it shows "Přihlášený účet", "Lucie Nováková" and `lucie@example.com`
- **AND** the one item "Odhlásit se"
