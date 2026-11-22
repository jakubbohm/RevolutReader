# ADR-0011: The koruna rate — the Czech National Bank's daily rate, kept in one row and asked for again inside requests

**Status:** Accepted (the owner's decisions in c017's explore, 2026-11-21) · **Date:** 2026-11-21 · **Roadmap:** none (work after the initial development: [issue #39](https://github.com/jakubbohm/RevolutReader/issues/39)) · **Questions:** none

> The design trail: [c017 design.md D1–D5](../../openspec/changes/archive/2026-11-22-c017-add-daily-koruna-rate/design.md), which records the explore's decisions and is their home. Sources were read on 2026-11-21.

## Context

- **Every euro amount on screen has a koruna value next to it** (UC2, UC3, [pm/kickoff.md](../../pm/kickoff.md)), and the notification's text has one too. Since C13 (2026-11-08) the server answered a constant, 24.3 CZK per euro, dated 2026-11-08. On 2026-11-21 the official rate was 24.47, so the koruna values were 0.7% low, and the transaction sheet's "orientační kurz z 8. 11. 2026" kept getting older.
- **The API already carries the rate** (`czkPerEur`, and on the transaction pages `rateDate`), and the phone converts with whatever rate arrives and keeps it with the balance ([ADR-0007-offline-balance](0007-offline-balance.md)). So the server can change where the rate comes from without touching the API, the frontend or the design.
- **The Czech National Bank (CNB) publishes the official rates** through a public JSON API: `GET https://api.cnb.cz/cnbapi/exrates/daily`, with no key ([the API's description](https://api.cnb.cz/cnbapi/swagger-ui.html)). It answers `{"rates":[…]}` with 30 currencies; the euro's entry was `{"validFor":"2026-11-20","order":223,"country":"EMU","currency":"euro","amount":1,"currencyCode":"EUR","rate":24.47}`. Five requests took 32–60 ms. A request on a weekend answers Friday's rate. The answer carries no `Access-Control-Allow-Origin`, so a browser could not read it.
- **The CNB declares the rates on working days at around 14:30 Prague time**, valid for that day and any weekend or holiday after it ([the CNB's FAQ on its exchange rates](https://www.cnb.cz/cs/casto-kladene-dotazy/Kurzy-devizoveho-trhu-na-www-strankach-CNB)).
- **The CNB's terms** ([Disclaimer and copyright](https://www.cnb.cz/en/privacy-statement-and-disclaimer/disclaimer-copyright/)) allow storing and reproducing its information, but say "The CNB must always be stated as the source of the information (Source: the CNB)".
- **The app scales to zero** ([ADR-0006-hosting-registry-and-job](0006-hosting-registry-and-job.md)) and has no clock of its own, so nothing runs between requests, and memory is lost at every sleep.
- **The container image has no time-zone data:** it is the chiseled ASP.NET image ([Microsoft Learn: .NET container images](https://learn.microsoft.com/dotnet/core/docker/container-images)).

## Decision

Decided by the owner in c017's explore (2026-11-21), item by item:

1. **The rate is the CNB's daily rate for the euro:** its `rate / amount` from the daily rates, with the day it gives the rate for (`validFor`). The transaction sheet shows that day.
2. **The CNB is not named in the app.** The app is private, for two people, so the owner chose not to state the source the CNB's terms ask for. No design change follows.
3. **The rate is kept in one table row** (table `korunarates`, [ADR-0005-data-storage](0005-data-storage.md)), so it outlives the app's sleep. A rate replaces the kept one only when it is for a later day.
4. **The CNB is asked inside the requests that answer a rate, alongside their own bank or storage read,** never by a scheduler or at start. Requests at the same time share one ask, and an ask has a **2 s** limit. A newer rate is asked for only **from 08:00 UTC on the first weekday (Monday to Friday) after the kept rate's day**; from then on every such request asks, until a rate for a later day comes. No time zone and no holiday list: on a Czech holiday the app keeps asking and keeps getting the previous rate.
5. **A failed ask leaves the kept rate** and never fails the request; nothing is retried, so the next request asks again. **With nothing kept yet**, the answer carries the app's own rate, **24.47 CZK per euro for 2026-11-20** (the CNB's latest when this was decided), which is never kept.

## Alternatives considered

- **The ECB's reference rates:** euro-based, published at about 16:00 CET, but not the official Czech rate.
- **Revolut's own rate:** no API for it. **The bank's `exchange_rate` field:** present on 2 of 116 transactions (c004 design.md D3).
- **A hand-updated constant:** the fastest, but it ages again. The owner chose the daily rate.
- **Memory only, no table:** every wake would ask the CNB, and a CNB outage at a wake would fall back to the old constant.
- **A refresh in the background after the answer:** no request would ever wait, but the first answer after a new rate would still carry the old one, and a failure would be seen by no request.
- **Asking from 14:30 Prague time, a minimum interval between asks, a Czech holiday list, or the image's `-extra` variant with time-zone data:** each more exact, each more to build and test. The owner chose the simplest rule; the asks between 08:00 UTC and the CNB's publication only return the kept rate, alongside the bank read.
- **Naming the CNB as the source:** what its terms ask for; the owner chose not to, for a private app.

## Consequences

- The app calls `api.cnb.cz` over HTTPS, outbound only, at most once per request while a newer rate may be due. A local `aspire start` reads the real CNB; no test does (a fake CNB on loopback, [testing.md](../conventions/testing.md)).
- If the CNB changes its API's shape, address or access, the app keeps its last rate and logs a warning per request (`KorunaRateAskFailed`); [deployment.md](../operations/deployment.md) holds the query that shows it.
- The app's own rate in the code is answered only right after the first deploy, if the first ask fails. It is not meant to be kept current.
- A later currency converter ([#9](https://github.com/jakubbohm/RevolutReader/issues/9)) can reuse the kept rate.
