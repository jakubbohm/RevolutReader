# Proposal: c003-add-frontend-foundation

## TL;DR

- **What:** the frontend's first code. A React + Vite PWA in `src/RevolutReader.Web/` (TypeScript 7, oxlint, Prettier, Tailwind with the design system's tokens, Vitest), served by the backend from the API's own address, run locally by Aspire, checked in CI by its own `frontend` job. It shows the app's frame, shows only the install hint in a browser on an iPhone, installs to the Home Screen with its icon and launch screen, opens without network, and picks up a new version on the next open.
- **Why now:** C4 deploys it, C6 builds sign-in on it, C7 and C8 build their screens in it. It also decides Q10: the phone keeps only the app's files now, and from C7 also the last balance (ADR-0007).
- **Out of scope:** sign-in and the account menu (C6), the generated API client (moved to C6), account data and its offline screens (C7), notifications (C8, C9), the Docker image (C4).
- **Riskiest assumption:** iOS 26 honours the launch images and lets the service worker switch to a new version on the next open of the Home Screen app. Only the iPhone can show it, after C4 deploys. Fallbacks: a white flash at launch; removing and re-adding the app.
- **Scenarios added:**
  - `app-shell`: The top bar shows the app name
  - `app-installation`: iPhone Safari shows only the install hint · The Home Screen app shows the app, not the install hint · Other browsers show the app, not the install hint · The Home Screen shows the app's icon and name *(manual)* · The Home Screen app opens with its launch screen *(manual)*
  - `app-delivery`: The start page opens at the root address · An unknown page address opens the app · The app opens without network after the first visit *(manual)* · A new version shows on the first open after a deploy *(manual)*

## Why

Roadmap step **C3** (`pm/roadmap.md`). No use case directly: UC1 (sign-in, C6), UC2 (account detail, C7) and UC3 (notifications, C8–C9) are all screens of this app. The main user opens it from her iPhone's Home Screen, because only there do sign-in and push work (ADR-0003-sign-in § The main user's phone). So the app has to install and start like an app before any feature is built on it. Everything here was decided with the user in explore (2026-11-05/06).

## What Changes

- A React 19 + Vite 8 app in `src/RevolutReader.Web/`, scaffolded once outside the test loop (design.md § Bootstrap):
  - TypeScript 7 with oxlint and Prettier, instead of ESLint;
  - Tailwind 4 themed from the design system "Tarjeta Papá";
  - Vitest, with frontend tests next to the code (`*.test.tsx`).
- **The app's first screens.**
  - The frame: a top bar with "Tarjeta Papá", marked as Spanish.
  - In a browser tab on an iPhone, only the install hint ("Shell / Safari / Install hint").
- **Installable:**
  - the manifest, the app icon (copied from the design system, with its PNG sizes made by a committed script) and the iPhone tags;
  - launch images for every iPhone, light and dark.
- **Our own service worker.**
  - It keeps the app's own files on the phone, never API answers.
  - It checks for a new version on every open and on every return to the screen, then switches and reloads once.
- **The backend serves the pages from the API's address** (ADR-0002-frontend-hosting):
  - the start page at `/`, and the page for every unknown page address;
  - never for `/api/...`;
  - the start page and the service worker are always checked with the server, hashed files are kept for a year.
- **Locally:** the AppHost runs the Vite dev server, which forwards `/api` to the API.
- **Test foundation for the frontend.**
  - The traceability check also reads the frontend tests' `scenario(...)` claims.
  - The acceptance tests give the app a stand-in page folder.
- **CI:** a separate `frontend` job (format, lint, type check, tests, build), added to the ruleset on `main` with the user's go.
- **Conventions recorded:**
  - oxlint instead of ESLint;
  - which design files are copied into the repository (assets), translated (tokens, components, formats) or never copied;
  - how the frontend gets runtime settings (an ordinary endpoint, added when first needed);
  - `[setup]` once per stack.

## Capabilities

### New Capabilities

- `app-shell`: the frame every screen sits in. For now, the top bar with the app's name; C6 adds the account menu.
- `app-installation`: how the app gets onto the iPhone and starts there. The install hint in a browser tab, the app itself from the Home Screen and elsewhere, the icon, the name and the launch screen.
- `app-delivery`: how the app reaches the phone and stays current. The backend serves its pages, the app opens without network, and a new version shows on the next open.

### Modified Capabilities

None. `api-errors` keeps its scenario unchanged. Its test becomes the guard that the new page fallback never covers `/api`.

## Non-goals

- **Sign-in, the sign-in screens and the account menu in the top bar** (C6). C3 has no sign-in library at all (ADR-0003-sign-in).
- **The generated API client** (FastEndpoints OpenAPI export, openapi-typescript, openapi-fetch, the CI drift check): moved to C6, the first change with an `/api` endpoint and a screen that calls it (roadmap change log). C3 calls no API.
- **The stored balance and the offline and waking-up screens that show it** (C7): C3 decides Q10 and records it (ADR-0007), and builds only the shell caching.
- **Push** (C8, C9): the service worker gets no push handler yet.
- **A runtime-settings endpoint:** none is needed yet. The first change that needs a value adds one (configuration.md § Frontend).
- **The Docker image and deployment** (C4). Until then the phone checks (manual scenarios) cannot run.
- **iPads:** no iPad launch images; an iPad gets the app, not the install hint.
- **An i18n library:** the UI has one language, so the Czech texts sit in the components.
- **Radix:** nothing C3 shows needs it. The oxlint rule that keeps it inside the component layer is set up now; Radix arrives with C6's account menu.

## Open questions

- **Decides Q10** (PWA scope): no offline mode beyond the shell now. From C7 the phone also keeps the last balance and the time the server read it, never transactions; it is replaced on every refresh and every push, and deleted on sign-out. Record: ADR-0007-offline-balance.
- **Applies Q2** (ADR-0003-sign-in): no sign-in library; nothing in C3 calls the API.
- **Applies Q3** (ADR-0002-frontend-hosting): the backend serves the built pages; locally the Vite dev server forwards `/api`. The runtime-settings mechanism ADR-0002 left to C3 is decided: an ordinary API endpoint, added by the first change that needs a value.
- **Applies Q9** (ADR-0003-sign-in § The main user's phone): the app installs to the iPhone's Home Screen, and a browser tab on the iPhone shows only the install hint.

## Impact

- **New code:**
  - `src/RevolutReader.Web/` (the app, its tests, `public/` with the icon and the launch images);
  - the API's page serving (`Program.cs`, a small `Pages/` folder);
  - the AppHost's `web` resource (`Aspire.Hosting.JavaScript` 13.6.4);
  - tests: frontend tests, two page scenarios with their DSL and driver, the stand-in page folder, the traceability check's frontend reading, unit tests for the caching rule.
- **CI and GitHub:**
  - `.github/workflows/ci.yml` gets the `frontend` job;
  - `docs/operations/main-ruleset.json` gets the `frontend` check, re-applied with the user's explicit go once the C3 PR's `frontend` run is green (CLAUDE.md).
- **Docs:**
  - `docs/conventions/` (README.md § Formatting and § Frontend, configuration.md § Frontend, testing.md, workflow.md §§ 3, 4, 8) and their `.claude/rules/` mirrors;
  - the test-writer agent and the `tdd-apply` skill (frontend groups; the known red traceability check before group 1);
  - ADR-0007 (new) and ADR-0002 (amendment);
  - `docs/software-factory/` (lessons, divergences, inventory);
  - `CLAUDE.md` § Commands, `pm/roadmap.md` (C3 and C6), `pm/progress.md`.
- **Tools on the owner's machine:** Node 24.14 and npm 11.19, already installed. No global installs: every tool is a project dependency.
- **No change to:** Azure, Entra, Enable Banking, the API contract (no `/api` endpoint).
