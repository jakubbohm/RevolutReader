---
name: no-personal-ids-in-repo
description: Keep the owner's personal account IDs out of the public repo; grant a person's Azure access by hand with commands that look the ID up at run time
metadata:
  type: feedback
---

The owner's personal identifiers (e.g. the owner's Entra object ID) never go into the public repository, not even as a Bicep parameter, and not into GitHub variables either. When a person needs an Azure role (e.g. Key Vault Secrets Officer for the guided secret tasks), it is granted once by hand on the resource group, with the owner's go, by a command that looks the ID up when it runs (subscription named explicitly). The user chose this in C4's propose review, 2026-11-06 (c005 design.md D17).

**Why:** the repository is public; an ID is not a credential, but the owner does not want personal IDs published. Non-personal identifiers (subscription, tenant, deploy identity) stay public as decided in M3.

**How to apply:** when a change needs a person's access in Azure, propose the hand-made grant recorded in `docs/operations/azure-prerequisites.md`, not a Bicep parameter or a GitHub variable. Related: [[az-always-explicit-subscription]].
