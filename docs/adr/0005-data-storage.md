# ADR-0005: Data storage — Azure Table Storage in the app's own storage account

**Status:** Accepted (the user's decision, 2026-11-05) · **Date:** 2026-11-05 · **Roadmap:** F0-2; applied in M3, M6, C7, C8, C9, M8 · **Questions:** — (follows from [ADR-0001-bank-data-access § Decision](0001-bank-data-access.md#decision), items 4 and 6; replaces the kickoff's assumption of Cosmos DB, ch. 6–7)

> Findings verified on 2026-11-05 against the sources linked with each one. Prices are Azure list prices for West Europe from the [Azure Retail Prices API](https://prices.azure.com/api/retail/prices).

## Context

- **What is stored:**
  - the settled transactions since 2026-08-09, keyed by Enable Banking's `entry_reference` and read by date;
  - the time of each user's last view;
  - later, the push subscriptions (UC3, C8).

  That is a few hundred items in all.
- **Constraints:** the budget is free tiers only and the repository is public (the user, 2026-11-04). The owner's subscription already has a Cosmos DB free-tier account, used by another project.

### Azure Table Storage

- **Cost:** about $0.00–0.01 a month at this volume (Standard LRS: $0.045 per GB-month and $0.00036 per 10,000 transactions).
- **Local development:** `Aspire.Hosting.Azure.Storage` 13.6.4 runs the Azurite emulator, and `Aspire.Azure.Data.Tables` 13.6.4 is the client integration (both 2026-10-24, [aspire.dev](https://aspire.dev/integrations/cloud/azure/azure-storage-tables/azure-storage-tables-host/)).
- **Tests:** `Testcontainers.Azurite` 4.16.0 (2026-10-08). Its default image constant is obsolete, so the image is set explicitly.
- **Access without keys:** the data role is Storage Table Data Contributor. Shared-key access can be switched off while Entra authentication keeps working ([Microsoft Learn](https://learn.microsoft.com/azure/storage/common/shared-key-authorization-prevent)).

### The shared Cosmos DB free tier

- **What is free:** the first 1,000 RU/s and 25 GB *in the account*. Anything beyond is "billed at regular price", and there is one free-tier account per subscription ([Microsoft Learn: free tier](https://learn.microsoft.com/azure/cosmos-db/free-tier), updated 2026-04-27).
- **What a new database costs:** at least 400 RU/s, at €0.0072 per 100 RU/s per hour, which is about €21 a month if the other project already uses more than 600 RU/s.
- **The Linux emulator** has been generally available since 2026-06-02 ([Microsoft Learn](https://learn.microsoft.com/azure/cosmos-db/emulator-linux), 2026-10-07), but it has gaps:
  - range and composite indexes are "planned, not yet available";
  - the .NET SDK needs it in HTTPS mode;
  - reported start-up times range from seconds to about 2 minutes.
- **Deployment stacks:** how a stack treats a database declared under an `existing` account that it does not manage is not documented.

### Other candidates

- **Azure SQL free offer:** it auto-pauses after 15 minutes idle, which can't be changed. Resuming takes "generally about one minute", and the first connection fails ([free offer](https://learn.microsoft.com/azure/azure-sql/database/free-offer), [auto-pause](https://learn.microsoft.com/azure/azure-sql/database/serverless-tier-auto-pause-resume)).
- **Neon:**
  - Free plan ([plans](https://neon.com/docs/introduction/plans), 2026-11-04): 1 GB and 100 CU-hours per project each month, compute that sleeps after 5 minutes (can't be turned off on Free), and a 6-hour restore window.
  - Regions ([regions](https://neon.com/docs/introduction/regions), 2026-10-14): Azure regions are deprecated and take no new projects. In Europe the choice is AWS Frankfurt or AWS London.
  - The Npgsql EF Core 11 provider is at release-candidate stage.

## Decision

Decided by the user, 2026-11-05:

1. **Azure Table Storage, in a storage account owned by the app.** It is declared in the app's Bicep and is part of its deployment stack.
2. **Access through the app's managed identity** with the Storage Table Data Contributor role. Shared-key access is off, so there are no keys and no secret.
3. **Locally, Aspire runs Azurite. Tests use Azurite in a test container** with the image pinned explicitly.
4. **What the tables hold:** settled transactions, keyed so that a date range is a key query; the last view per user; and the push subscriptions (C8). Each change designs its own tables. *(2026-11-08: no last view is stored, [ADR-0001-bank-data-access § Decision](0001-bank-data-access.md#decision) items 4–5 amended; the notification check keeps its own record instead, C9.)* *(2026-11-09, C7b, c010 design.md D5: the settled transactions are one table, `transactions`, with one partition, `account`, and no key is a date range. The row key is the SHA-256 of the bank's `entry_reference` (its UTF-8 bytes) in lowercase hex: Table Storage forbids `/`, `\`, `#` and `?` in keys, and escaping them would put `%` in the key; the reference itself is kept unchanged in a column. Every request reads the whole table and cuts its page in memory, because the data is small, a few hundred rows (Consequences: "Tables answer key lookups only").)*
5. **The shared Cosmos DB free-tier account is not used.**

## Alternatives considered

- **The shared Cosmos DB free-tier account** (the kickoff's assumption). Rejected:
  - it is free only while the whole account fits in 1,000 RU/s, and ours would add at least 400;
  - access to it is a manual step, and the stack's behaviour for our database inside it is undocumented;
  - the emulator has gaps;
  - the bank data would sit in an account shared with another project.
- **Azure SQL free offer.** Rejected: after 15 minutes idle, opening the app could take up to a minute longer.
- **A Cosmos DB serverless account of our own.** Pennies and inside the stack, but rejected for the same emulator friction, with no gain over tables.
- **Neon (serverless Postgres).** The user considered it for learning. It is free, offers full SQL and has standard Postgres tests. Rejected on speed and operations:
  - about half a day more in C7 (schema, migrations);
  - a connection-string secret;
  - creating and deleting it by hand, outside the stack;
  - the bank data with another company on another cloud.

## Consequences

- **Not strictly free:** about $0.01 a month, like Key Vault.
- **No manual step for storage:**
  - M3 and M6 no longer prepare access to the shared Cosmos DB account;
  - M8's stack deletion deletes the stored bank data with everything else (kickoff ch. 9.6).
- **C6 creates the storage account,** for the sign-in cookie's Data Protection keys in Blob Storage ([ADR-0006-hosting-registry-and-job § Decision](0006-hosting-registry-and-job.md#decision), item 2). That covers the Bicep, the `.bicepparam` and the AppHost.
- **C7, or its first slice** (C7b since C7's split, 2026-11-08)**:**
  - the table role assignment and the table design in that account;
  - importing the M1 history file.
- **C8:** the push subscriptions go into a table.
- **Tables answer key lookups only.** If C7 or C9 needs more, the data is small enough to move with a script.
- **Database tests** run against Azurite ([testing.md § Decided later](../conventions/testing.md#decided-later)). Health probes still never touch storage ([README.md § Backend code](../conventions/README.md#backend-code)).
- **Software factory:** [lessons.md R-26](../software-factory/lessons.md), and the project's shortcut in [divergences.md R-26](../software-factory/divergences.md).
