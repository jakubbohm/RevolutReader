# ADR-0008: The account check's trigger — a Revolut notification on the owner's iPhone, with the phone's PSU headers

**Status:** Accepted (the user's decision, 2026-11-05; phone test and no text filter, 2026-11-06) · **Date:** 2026-11-06 · **Roadmap:** C9; supersedes [ADR-0001-bank-data-access § Decision](0001-bank-data-access.md#decision), item 3, and [ADR-0006-hosting-registry-and-job § Decision](0006-hosting-registry-and-job.md#decision), item 4 · **Questions:** Q6 (input to Q8) · **Issue:** [#12](https://github.com/jakubbohm/RevolutReader/issues/12)

> The push sources were checked on 2026-11-05 against the sources linked with each one; the EBA answer was re-read on 2026-11-06. The phone test (2026-11-06) was run by the owner; the delay was measured in the [M1 spike, step 7](../../spikes/enable-banking/README.md) (2026-11-06).

## Context

- **The problem:** UC3's check ran 4 times a day without PSU headers, every 6 hours ([ADR-0001-bank-data-access § Decision](0001-bank-data-access.md#decision), item 3), with a Logic App as the clock ([ADR-0006-hosting-registry-and-job § Decision](0006-hosting-registry-and-job.md#decision), item 4). A notification could come up to about 6 hours after a payment. The user wanted the check to follow a payment almost at once.
- **The limit:** Revolut allows 4 requests a day per account, endpoint and consent when the account holder is not present; PSU headers mark a request as made with the user present ([ADR-0001-bank-data-access § Request limits](0001-bank-data-access.md#request-limits-q6)).

### Push sources for a new payment (checked 2026-11-05)

- **Enable Banking** has webhooks only for payment status (`webhook_url` on `POST /payments`), none for account information (balances, transactions). Sources: [Webhooks](https://enablebanking.com/docs/api/webhooks/), [API reference](https://enablebanking.com/docs/api/reference/).
- **Revolut** has webhooks (`TransactionCreated`, `TransactionStateChanged`) only in the Business API; there is no public API for personal accounts. Source: [About webhooks](https://developer.revolut.com/docs/guides/manage-accounts/webhooks/about-webhooks).
- **Revolut emails:** personal accounts get push notifications only, no email per transaction (checked by the owner, 2026-11-05). So a mail-triggered workflow has nothing to listen to.
- **iOS 27 Shortcuts** has an automation trigger "when a notification arrives" from a chosen app, with optional filters on the notification's title, subtitle and message. Source: [MacStories iOS 27 review](https://www.macstories.net/stories/ios-and-ipados-27-review/13/). The owner's iPhone 15 Pro runs iOS 27.2.

### When a request counts as made by the user

- [EBA Q&A 2018_4172](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2018_4172) (published 2018-12-14, re-read 2026-11-06) on SCA RTS Art. 36(5)(b): an "active request" means "the PSU being in session at the time of the request and proactively performing an action, predefined by the AISP, to request such information". It "does not include the case where the PSU has given a mandate to an AISP to access whenever possible or the case where the AISP is mandated to refresh automatically the information whenever the PSU is accessing the AISP application(s)".
- Enable Banking's FAQ: the PSU headers must belong to the person who triggers the fetch ([ADR-0001-bank-data-access § Request limits](0001-bank-data-access.md#request-limits-q6)).
- The same answer's last case, an automatic refresh whenever the user opens the app, also bears on [ADR-0001-bank-data-access § Decision](0001-bank-data-access.md#decision), item 1 (a live read on open). That decision is unchanged.

### Phone test (the owner, 2026-11-06)

- An automation on Revolut notifications that called a test address and showed a local notification:
  - it runs without a confirmation prompt ("Run Immediately");
  - it fires right after the Revolut notification arrives, also while the phone is locked.
- With no text filter it fires on every Revolut notification, about the account or not (offers, the owner's other activity).

### How soon the bank data shows a payment ([M1 spike, step 7](../../spikes/enable-banking/README.md), 2026-11-06)

- One small card payment, readings 20 s apart with the owner's PSU headers.
- The balance and a new pending transaction were in Enable Banking between 22 s and 2 s *before* the owner marked the notification, so the data is there no later than the notification.
- The payment was not settled 15 minutes later, as expected for a card payment.
- 94 API calls with the owner's PSU headers within 16 minutes, all HTTP 200.
- An incoming transfer was not measured.

## Decision

Decided by the user: items 1 and 3 on 2026-11-05 ([#12](https://github.com/jakubbohm/RevolutReader/issues/12)), item 2 on 2026-11-06 after the phone test.

1. **The owner's iPhone triggers the check.** An iOS Shortcuts automation "when a notification arrives from Revolut", set to run immediately, calls the app's protected check endpoint. The endpoint reads the account, compares it with the stored state and, when something changed, sends the notification (UC3). This replaces the 4 scheduled runs a day (ADR-0001, item 3) and the Logic App clock (ADR-0006, item 4).
2. **No text filter** (the owner, 2026-11-06). Every Revolut notification, marketing included, triggers the check. A check after a notification that is not about the account finds no change and sends nothing.
3. **The phone's requests carry the phone's real PSU headers** (IP address, user agent), and the endpoint forwards them to the bank, so the 4-a-day limit does not apply to these reads. The user's position, in the user's words: "I'm mandating my own personal phone to act on my behalf and call AISP, ie AISP access Revolut on my explicit request (even though done by my personal assistant on my behalf)", and "even if you can say it is automated, it is automated on my phone only. I did it manually myself, and it's not any scheduled job on a server." The user accepts the risk, as in ADR-0001, item 2.

**Constraints (added to ADR-0001's constraints on every bank call):**

- PSU headers on the phone-triggered check come from the phone's own request, with its real values; the endpoint never makes them up or reuses another user's.
- Every bank read the endpoint makes is caused by one call from the phone. A fallback check, if C9 keeps one, is unattended: no PSU headers, within the 4 a day.
- The endpoint is safe to call more than once: several calls for the same payment (several notifications, retries of the Shortcut) produce at most one notification.

**C9 decides:** how the Shortcut proves who it is (e.g. a secret kept in Key Vault and in the Shortcut); whether a fallback check is kept for when the phone is off or offline; how the Shortcut waits through the app's cold start (about 20 s, ADR-0006).

## Alternatives considered

- **Keep the 4 scheduled runs a day** (ADR-0001, item 3, with the Logic App clock). Rejected by the user: a notification can come up to about 6 hours after a payment.
- **Phone-triggered reads without PSU headers, within the 4 a day.** Claude's reading of the EBA answer: the automation is set up once and then fires with no one in session or acting at the time, which is the standing mandate the answer excludes, so the reads are unattended. It would also need a text filter and a daily cap, or offers would use up the 4 reads. Recommended by Claude, rejected by the user: the phone acts on the owner's explicit request, as the owner's personal assistant (Decision, item 3).
- **A text filter on the notification** (only notifications about the account). Not chosen by the owner: triggering the check on other notifications, offers included, is not a problem (the owner, 2026-11-06); such a read finds no change and sends nothing. A filter would also stop working if Revolut changed its wording.
- **Webhooks from Enable Banking or Revolut, or a mail-triggered workflow.** Not available: Enable Banking has no webhooks for account data, Revolut's webhooks are for business accounts only, and Revolut sends personal accounts no transaction emails (§ Context).

## Consequences

- **ADR-0001-bank-data-access:** Decision item 3 and the constraint "never PSU headers on the background job" are superseded by this ADR; the bank adapter forwards PSU headers on user-triggered reads and on the phone-triggered check.
- **ADR-0006-hosting-registry-and-job:** Decision item 4 is superseded: the protected endpoint stays, now called by the phone; the Logic App goes. It is removed from the resource list ([workflow.md § 5](../conventions/workflow.md#5-infrastructure)). The `Microsoft.Logic` resource provider registered in M3 stays registered, unused.
- **Notification delay:** about the app's wake-up time after the Revolut notification. One read finds the payment (one card payment measured), so the endpoint needs no repeated reads.
- **More bank reads:** one per Revolut notification, each with the phone's PSU headers; most find no change.
- **Wakes:** each notification wakes the app. At an assumed 30 notifications a day, that is about 900 wakes a month, within the roughly 2,400 the free grant covers ([ADR-0006-hosting-registry-and-job § Consequences](0006-hosting-registry-and-job.md#consequences)).
- **A single phone:** when the owner's iPhone is off or offline, or the automation stops working (for example after an iOS update), nothing triggers the check. The daughter still sees live data when she opens the app (ADR-0001, item 1). C9 decides on a fallback.
- **Hand-made setup on the phone:** the Shortcut and its secret are set up by hand; C9 records them in [docs/operations/](../operations/) with how to restore them.
- **Accepted risk:** Enable Banking or Revolut may treat these automated reads with PSU headers as unattended reads and cut off the application; the risk accepted in ADR-0001, item 2, now covers them too.
- **Tests:** the check stays ordinary app code that an endpoint calls ([testing.md § Time and the background job](../conventions/testing.md#time-and-the-background-job)).
- **Software factory:** [lessons.md R-45](../software-factory/lessons.md) (including the reversal of R-27's clock), and the project's shortcut in [divergences.md R-45](../software-factory/divergences.md).
