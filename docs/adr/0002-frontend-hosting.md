# ADR-0002: Frontend hosting — one container, one origin

**Status:** Accepted (the user's decision, 2026-11-05) · **Date:** 2026-11-05 · **Roadmap:** F0-2; applied in C3, C4 · **Questions:** Q3

## Context

- Kickoff ch. 6 deploys the app as a single Docker container on Azure App Service. Q3 asked whether the backend also serves the frontend build from it.
- The main user has an iPhone (the user, 2026-11-04). Safari blocks cookies on cross-site requests by default ([WebKit: Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), 2020-03-24). A sign-in cookie therefore works only if the frontend and the API share one origin, which keeps both answers to Q2 open.
- Azure Static Web Apps serves a frontend on its own origin. To put an existing API under that origin (its "bring your own API" feature), you need the paid Standard plan ([Microsoft Learn: API support in Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/apis-overview), read 2026-11-05).
- The budget is free tiers only (the user, 2026-11-04).
- The frontend's deploy-time values must not be built into the bundle ([configuration.md § Frontend](../conventions/configuration.md#frontend)). How it gets them depended on Q3.

## Decision

Decided by the user, 2026-11-05: **the backend's container serves the built frontend, so the frontend and the API share one origin.**

- The pages are served at `/` and the API under `/api`. The frontend calls the API by relative paths.
- The frontend gets its runtime settings from the backend on the same origin. The mechanism is chosen in C3.
- Locally, the AppHost runs the Vite dev server, which forwards `/api` to the backend, so development also uses one origin.
- The PWA's service worker serves the cached app shell. The screen therefore appears without waiting for the backend, and only the data waits for it.

## Alternatives considered

- **Static Web Apps Free for the frontend, with the API in its own container.** Free, and the frontend gets a global CDN, which brings nothing for three users. It would mean two origins:
  - CORS for every API call.
  - No sign-in cookie on the iPhone, so Q2 would be forced to keep the token in the browser.
  - A settings file written by the pipeline next to the bundle.

  This is DoseUp's choice. There the shell must stay up while its scale-to-zero API sleeps.
- **Static Web Apps Standard with the API linked under its origin.** One origin, but paid, which breaks the free-tier budget.

## Consequences

- **One image, one deployment.** C4's Dockerfile builds the frontend in a Node stage and copies the output into the backend's static files. The frontend and the backend always ship together.
- **C3:**
  - The backend serves the static files, plus `index.html` as the fallback for client-side routes. The fallback never covers `/api/*`: an unknown API path returns a ProblemDetails 404, not the page.
  - The AppHost runs the Vite dev server with `/api` forwarding.
  - The service worker caches the shell.
- **Security:** the static files are public by nature and carry no data and no secrets. Every `/api` endpoint still requires a signed-in, allowed user ([README.md § Backend code](../conventions/README.md#backend-code)).
- **Software factory:** this diverges from DoseUp ([lessons.md R-23](../software-factory/lessons.md)).
