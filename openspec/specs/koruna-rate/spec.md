# koruna-rate Specification

## Purpose

The euro's rate in Czech koruna that the app converts euro amounts with: the Czech National Bank's (CNB) latest daily rate, kept between the app's sleeps, asked for again only once a newer one may be out, and what a failed ask leaves in its place.

## Requirements

### Requirement: The koruna rate is the CNB's latest, kept
The rate the API answers with a balance (spec account-balance) or a page of transactions (spec account-transactions), and the account check writes a koruna value with (spec account-check), SHALL be the euro's rate in the CNB's latest daily rates: koruna per one euro, with the day the CNB gives it for. A rate the CNB answers SHALL be kept, so it outlives the app's sleep. It SHALL replace the kept rate only when it is for a later day.

#### Scenario: Monday's rate replaces Friday's and is not asked for again that day
- **GIVEN** today is Monday 2026-11-23 at 15:00 UTC and Lucie is signed in
- **AND** the kept rate is 24.41 CZK per euro, for Friday 2026-11-20
- **AND** the CNB's latest rate is 24.52 CZK per euro, for 2026-11-23
- **WHEN** she asks the API for the balance twice
- **THEN** both answers carry `czkPerEur` 24.52
- **AND** the CNB receives one request

#### Scenario: A rate for an earlier day than the kept one is ignored
- **GIVEN** today is Tuesday 2026-11-24 at 09:00 UTC and Lucie is signed in
- **AND** the kept rate is 24.52 CZK per euro, for 2026-11-23
- **AND** the CNB's latest rate is 24.41 CZK per euro, for 2026-11-20
- **WHEN** she asks the API for her transactions
- **THEN** the answer carries the koruna rate 24.52 and its date 2026-11-23

### Requirement: The CNB is asked only once a newer rate may be out
The API SHALL NOT ask the CNB before 08:00 UTC on the first day from Monday to Friday after the kept rate's day. From then on, every request that answers a rate SHALL ask, alongside its own reads, until the CNB answers a rate for a later day. Requests that need the rate at the same time SHALL share one ask. Czech public holidays count as working days.

#### Scenario: Friday's rate is not asked for again over the weekend
- **GIVEN** today is Saturday 2026-11-21 at 10:00 UTC and Lucie is signed in
- **AND** the kept rate is 24.41 CZK per euro, for Friday 2026-11-20
- **WHEN** she asks the API for the balance
- **THEN** the answer carries `czkPerEur` 24.41
- **AND** the CNB receives no request

#### Scenario: From 08:00 UTC on Monday every request asks until Monday's rate comes
- **GIVEN** today is Monday 2026-11-23 at 09:00 UTC and Lucie is signed in
- **AND** the kept rate is 24.41 CZK per euro, for Friday 2026-11-20
- **AND** the CNB's latest rate is still that one, 24.41 for 2026-11-20
- **WHEN** she asks the API for the balance twice
- **THEN** both answers carry `czkPerEur` 24.41
- **AND** the CNB receives two requests

### Requirement: A failed ask leaves the kept rate
An ask SHALL count as failed when the CNB gives no answer within 2 s, cannot be reached, answers with any status but 200, or answers without a readable euro rate: a positive rate and amount, and a day. A failed ask SHALL leave the kept rate in the answer and SHALL never fail the request. It SHALL NOT be retried: the next request asks again.

#### Scenario: A CNB that answers with an error leaves the kept rate
- **GIVEN** today is Monday 2026-11-23 at 09:00 UTC and Lucie is signed in
- **AND** the kept rate is 24.41 CZK per euro, for Friday 2026-11-20
- **AND** the CNB answers with a server error
- **WHEN** she asks the API for her transactions
- **THEN** the answer carries the koruna rate 24.41 and its date 2026-11-20

#### Scenario: A CNB that does not answer within 2 s leaves the kept rate
- **GIVEN** today is Monday 2026-11-23 at 09:00 UTC and Lucie is signed in
- **AND** the kept rate is 24.41 CZK per euro, for Friday 2026-11-20
- **AND** the CNB does not answer within 2 s
- **WHEN** she asks the API for the balance
- **THEN** the answer carries `czkPerEur` 24.41

### Requirement: With no rate kept, the app's own rate stands in
When no rate is kept and the ask fails, the answer SHALL carry the app's own rate, 24.47 CZK per euro for 2026-11-20 (the CNB's rate for that day). The app's own rate SHALL NOT be kept, so the next request asks the CNB again.

#### Scenario: With no rate kept and the CNB failing, the app's own rate of 24.47 is answered
- **GIVEN** Lucie is signed in
- **AND** no rate is kept, and the CNB answers with a server error
- **WHEN** she asks the API for her transactions
- **THEN** the answer carries the koruna rate 24.47 and its date 2026-11-20
