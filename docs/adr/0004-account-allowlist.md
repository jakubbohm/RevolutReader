# ADR-0004: Account allowlist — personal Microsoft accounts checked against an email list kept out of the repo

**Status:** Accepted (the user's decision, 2026-11-05) · **Date:** 2026-11-05 · **Roadmap:** F0-2; applied in M2, M4, C6 · **Questions:** Q1

> Findings verified on 2026-11-05 against the sources linked with each one.

## Context

- **Who may get in:** only pre-approved accounts: the owner, the daughter and test accounts. The daughter must not face extra steps such as registration or waiting for approval. Only Microsoft accounts; Apple is out of scope (kickoff ch. 3, 4).
- **Sign-in:** the backend signs users in and keeps a login cookie for 30 days ([ADR-0003-sign-in](0003-sign-in.md)).
- **The repository will be public** (the user, 2026-11-04). Email addresses therefore cannot sit in the repo, including `.bicepparam`.
- **Guests in the owner's directory** ("invitations"):
  - on first sign-in a guest gets a "Review permissions" page and must accept it ([Microsoft Learn: redemption experience](https://learn.microsoft.com/entra/external-id/redemption-experience));
  - security defaults, which are on by default, make all users register for MFA with Microsoft Authenticator. B2B guests are treated like the directory's own users, and the 14-day grace period ended on 2024-07-29 ([Microsoft Learn: security defaults](https://learn.microsoft.com/entra/fundamentals/security-defaults)).
- **Claims in personal-account tokens:**
  - The `email` claim is available for personal accounts, but Microsoft says it "isn't guaranteed to be correct, and is mutable… never use it for authorization". `preferred_username` is for display only. The stable identifiers are `oid` or `sub`, together with `tid` ([Microsoft Learn: claims validation](https://learn.microsoft.com/entra/identity-platform/claims-validation), [optional claims](https://learn.microsoft.com/entra/identity-platform/optional-claims-reference)).
  - Personal accounts have the tenant ID `9188040d-6c67-4c5b-b112-36a304b66dad`.
  - Microsoft's warning comes from the "nOAuth" issue: a work or school directory can assert any email for its users.
- **A dedicated customer directory, Microsoft Entra External ID:**
  - It owns its users' accounts, so it needs a user flow that defines sign-up, sign-in methods and pages.
  - Microsoft's pages contradict each other on whether personal Microsoft accounts can sign up there.
  - It has supported Apple sign-in since May 2025 ([Microsoft Learn: Apple in External ID](https://learn.microsoft.com/entra/external-id/customers/how-to-apple-federation-customers)).
- **Sign in with Apple:**
  - it needs the paid Apple Developer Program (US$99 a year, according to third-party sources);
  - its secret must be renewed by hand every 6 months (same source);
  - on first sign-in the user may choose "Hide My Email", which gives the app a random relay address instead of the real one.

## Decision

Decided by the user, 2026-11-05:

1. **The app registration lives in the owner's existing directory and accepts personal Microsoft accounts only.** No users are added to the directory.
2. **The backend checks an allowlist of email addresses:** the owner, the daughter and the test accounts.
   - The check runs at sign-in and on every request, so removing someone takes effect immediately even though the cookie lasts 30 days.
   - The account's tenant must be the personal-accounts tenant.
   - A signed-in stranger gets a Czech "no access" page, and the API answers 403.
3. **The list is kept out of the repository.** In production it lives in Key Vault, reaching the app through a Key Vault reference as an environment variable. Locally it lives in the AppHost's user-secrets. To change it, update the value in Key Vault and restart the app.
4. **Key Vault holds secrets and other values that must not be public.** This widens the kickoff's "Key Vault is for secrets only" (the user: a value kept out of the repo is effectively a secret anyway).
5. **Automated tests use made-up addresses that the harness sets.** The real list never reaches tests, CI or GitHub: there is no GitHub secret for it, and GitHub Actions does not read Key Vault.
6. **No invitations, no External ID, no Apple.**

## Alternatives considered

- **Entra invitations (guests, "assignment required").** The gate would sit in Entra, and no list would be needed in the app. Rejected: the consent page and the forced MFA registration are extra steps for the daughter, and turning security defaults off would weaken the owner's directory.
- **An allowlist of account IDs (`oid`).** This is Microsoft's recommended identifier, and IDs could even be public. Rejected: an ID is known only after the first sign-in, so the daughter would be rejected once and have to wait for approval.
- **Email on the first sign-in, then pinned to the account ID.** Safer if an address changes. Rejected: it needs stored state for little gain over two months.
- **Hashed emails in the repository.** Rejected: anyone who knows an address could confirm that its owner uses the app.
- **External ID with Apple sign-in.** The daughter is used to Apple. Rejected by the user, who chose Microsoft accounts only:
  - it costs US$99 a year, plus a user flow and a 6-month secret;
  - "Hide My Email" can defeat an email allowlist;
  - with the 30-day cookie, she signs in at most about once a month.

## Consequences

- **Accepted risk:** the email claim is not meant for authorization. Accepting only personal Microsoft accounts means no other directory can issue the token. Not verified: that Microsoft requires proof of address ownership before an address can sign in to a personal account.
- **A changed address locks its owner out** until the list is updated.
- **M2:** the repository can be public.
- **M4:**
  - the registration's audience is personal Microsoft accounts only;
  - the app requests the `openid`, `profile` and `email` scopes;
  - the owner creates or names the test accounts.
- **C6:**
  - the allowlist check at sign-in and on every request, the tenant check, and the Czech "no access" page;
  - a guided task puts the list into Key Vault and into the AppHost's user-secrets;
  - the list is recorded in [configuration.md § Hand-provisioned secrets](../conventions/configuration.md#hand-provisioned-secrets).
- **D1:** the reinstatement guide includes restoring the list.
- **Software factory:** [lessons.md R-25](../software-factory/lessons.md), with the project's shortcut in [divergences.md R-25](../software-factory/divergences.md).
