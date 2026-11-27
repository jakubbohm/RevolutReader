# Spec Delta

## REMOVED Requirements

### Requirement: A device reports each push that brings a balance
**Reason**: The reports were built only to measure how late the account's notifications reached the phones, so a fix for #91 could be chosen with the data (c016 design.md D9). The cause is known now, and the fix sends those notifications as plain pushes, for which the iPhone runs no service worker, so no report could leave the phone anyway (c019 design.md D1, D10).
**Migration**: None for users. The service worker sends no report. Whether a notification arrives on time is checked by hand on the iPhone (spec account-check, requirement "The notification reaches the iPhone").

### Requirement: A report never stops the notification or the kept balance
**Reason**: There is no report any more (requirement "A device reports each push that brings a balance" removed). Keeping a notification's balance never stops the notification on its own (spec push-display, requirement "Keeping the balance never stops the notification").
**Migration**: None.

### Requirement: The server records how long each push took to arrive
**Reason**: Nothing sends a report any more (c019 design.md D10).
**Migration**: `POST /api/push/arrivals` is gone and answers as an unknown `/api` address does. The API description and the TypeScript client are regenerated without it. Records already logged (`PushArrived`) age out of telemetry, and `docs/operations/deployment.md` drops their queries.

### Requirement: A report the server cannot read records nothing
**Reason**: The endpoint it guards is removed (requirement "The server records how long each push took to arrive").
**Migration**: None.

### Requirement: Arrivals are measured on the iPhone
**Reason**: The measurement ends with the reports (c019 design.md D10). The owner checks the fix by hand (the owner, 2026-11-27).
**Migration**: The manual row is removed from `tests/manual-scenarios.md`. The iPhone's on-time check is spec account-check's "A real payment brings the notification on the iPhone".
