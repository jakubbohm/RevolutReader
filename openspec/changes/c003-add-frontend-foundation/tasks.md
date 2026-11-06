# Tasks: c003-add-frontend-foundation

Before this list: the setup commit from design.md § Bootstrap: the frontend project, its tools and the process docs the run depends on. Its baseline holds two known exceptions, accepted once:
- the frontend test run finds no test files;
- the repository traceability check reports this change's ten scenarios as not claimed. Group 1 claims them.

Run with `/tdd-apply c003-add-frontend-foundation review=all`, the first change where the test-writer writes frontend tests. Ten scenarios, so the work is sliced per scenario (slices 1–10). Then come the local-development and CI wiring, and the final close. Docs tasks are the orchestrator's. "Green" below means the full suite: `dotnet test` and the frontend tests, except this change's scenario tests still waiting for their slice.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation: frontend claims in the traceability check (design.md D7). Claims are `scenario(` calls with two string literals in `src/RevolutReader.Web/src/**/*.test.{ts,tsx}`; any other `scenario(` call is reported as unreadable, with its file and line. Verify: the new self-tests pass, and the repository check counts the frontend claims below
- [x] 1.2 Foundation: `scenario()` and `renderApp()` in `src/RevolutReader.Web/src/test/` (design.md D7, D8). Verify: `npm --prefix src/RevolutReader.Web test` runs the scenario files below
- [x] 1.3 Foundation: the stand-in page folder `Drivers/StandInPages/` (an `index.html` and `StandInPages`), copied to the test output and set as every test app's web root (design.md D6). Verify: every acceptance test that was green stays green
- [x] 1.4 Foundation: the page fallback's two entries on the anonymous-endpoint allowlist, exactly as design.md D5 gives them. Verify: "only allowlisted endpoints answer without sign-in" passes; "every allowlisted endpoint exists" fails at runtime until 11.1
- [x] 1.5 Acceptance: app-shell / The top bar shows the app name (frontend)
- [x] 1.6 Acceptance: app-installation / iPhone Safari shows only the install hint (frontend)
- [x] 1.7 Acceptance: app-installation / The Home Screen app shows the app, not the install hint (frontend)
- [x] 1.8 Acceptance: app-installation / Other browsers show the app, not the install hint (frontend)
- [x] 1.9 Acceptance: app-installation / The Home Screen shows the app's icon and name (manual)
- [x] 1.10 Acceptance: app-installation / The Home Screen app opens with its launch screen (manual)
- [x] 1.11 Acceptance: app-delivery / The start page opens at the root address
- [x] 1.12 Acceptance: app-delivery / An unknown page address opens the app
- [x] 1.13 Acceptance: app-delivery / The app opens without network after the first visit (manual)
- [x] 1.14 Acceptance: app-delivery / A new version shows on the first open after a deploy (manual)
- [x] 1.15 Docs:
  - testing.md § Every scenario has exactly one test: frontend claims, the file pattern, unreadable calls reported;
  - testing.md § Acceptance-test harness: the stand-in page folder, the fourth swap;
  - `.claude/rules/testing.md`;
  - divergences.md R-12: the acceptance tests never see the built pages;
  - an inventory line for the traceability check's frontend reading and the `scenario()` helper.

  Verify: no statement contradicts design.md D6, D7

## 2. [wiring] Slice 1 — The frame

- [x] 2.1 `AppShell` as design.md D4: the sticky top bar below the safe-area inset, "Tarjeta Papá" in `text-headline` with `lang="es"`, and a `main` with the design's gaps and bottom inset. `App` shows it. The design files are those of design system AppShell and theme. Verify: `typecheck` and lint pass; green

## 3. [close] Slice 1 — The top bar shows the app name

- [x] 3.1 The scenario's test passes. Verify: green, including app-shell / The top bar shows the app name

## 4. [unit] Slice 2 — The install-hint rule

- [x] 4.1 An iPhone Safari tab needs the install hint
- [x] 4.2 Another browser tab on an iPhone needs the install hint too
- [x] 4.3 The app opened from the Home Screen needs no install hint
- [x] 4.4 An iPad, an Android phone or a computer needs no install hint

## 5. [wiring] Slice 2 — The install-hint screen

- [x] 5.1 `public/app-icon.svg` copied as it is from the design system's asset `App icon/app-icon.svg` (design.md D10). `InstallHint` as design.md D4, laid out as artboard "Shell / Safari / Install hint" (design system InstallHint), showing that icon. `App` shows it alone when `needsInstallHint` says so. Verify: `typecheck` and lint pass; green

## 6. [close] Slice 2 — iPhone Safari shows only the install hint

- [x] 6.1 The scenario's test passes. Verify: green, including app-installation / iPhone Safari shows only the install hint

## 7. [close] Slice 3 — The Home Screen app shows the app, not the install hint

- [x] 7.1 The scenario's test passes with what slices 1 and 2 built; if it fails, route it as tdd-apply § 4 says. Verify: green, including this scenario

## 8. [close] Slice 4 — Other browsers show the app, not the install hint

- [ ] 8.1 The scenario's test passes with what slices 1 and 2 built; if it fails, route it as tdd-apply § 4 says. Verify: green, including this scenario

## 9. [wiring] Slice 5 — Static pages

- [ ] 9.1 `UseAppPages()` in `src/RevolutReader.Api/Pages/`: default and static files from the web root, called in `Program.cs` after `UseStatusCodePages` and before `UseFastEndpoints` (design.md D5). Verify: build passes; green
- [ ] 9.2 `PagesDriver.GetPage` replaces its stub: status 200, a `text/html` content type and a body equal to `StandInPages.StartPage` give `PageAnswer.TheApp`, anything else `SomethingElse` (design.md D6). Verify: the scenario runs against the app

## 10. [close] Slice 5 — The start page opens at the root address

- [ ] 10.1 The scenario's test passes, which also proves that the stand-in web root takes effect (design.md D6; if it does not, the fallback named there). Verify: green, including this scenario

## 11. [wiring] Slice 6 — The page fallback

- [ ] 11.1 The page fallback in `UseAppPages()` with the route pattern of design.md D5. Verify: both anonymous-endpoint tests pass; api-errors / Unknown API address answers with a problem description and the health scenario still pass

## 12. [close] Slice 6 — An unknown page address opens the app

- [ ] 12.1 The scenario's test passes. Verify: green, including this scenario and api-errors

## 13. [wiring] Slice 7 — The service worker

- [ ] 13.1 vite-plugin-pwa with `strategies: "injectManifest"` and `src/sw.ts`, as design.md D9:
  - the build's files precached, old caches cleaned;
  - a navigation route to `index.html` that never covers `/api` or `/health`;
  - no runtime caching.

  Verify: `npm run build` writes `dist/sw.js` with the precache list, which holds no launch images; `typecheck` and lint pass; green
- [ ] 13.2 `main.tsx` registers the service worker through `virtual:pwa-register` (design.md D9). Verify: `typecheck` passes; green

## 14. [close] Slice 7 — The app opens without network after the first visit

- [ ] 14.1 Local check in Chrome against the API serving the real build (design.md D9):
  - the service worker is active;
  - with the network switched off in DevTools, a reload still shows the top bar.

  Record the result and the date in `.tdd-state.md`; the iPhone check stays the manual row (M5). Verify: the result is recorded; green

## 15. [unit] Slice 8 — Page caching

- [ ] 15.1 Files under /assets/ are kept for a year without asking again
- [ ] 15.2 The start page is always checked with the server first
- [ ] 15.3 The service worker is always checked with the server first
- [ ] 15.4 Every other file is checked with the server first

## 16. [unit] Slice 8 — The update watch

- [ ] 16.1 An update check runs when the app comes back to the screen
- [ ] 16.2 No update check runs while the phone is offline
- [ ] 16.3 No update check runs when the app goes to the background
- [ ] 16.4 A failed update check is ignored until the next return

## 17. [wiring] Slice 8 — Switching to a new version

- [ ] 17.1 `PageCaching` applied to the static files and the page fallback through their shared options (design.md D5). Verify: green; against the API serving the real build (design.md D9), `curl -I` shows `no-cache` for `/`, `/no-such-page` and `/sw.js`, and the one-year rule for a file under `/assets/`
- [ ] 17.2 `sw.ts` calls `skipWaiting()` on install and `clientsClaim()`; the plugin runs with `registerType: "autoUpdate"`; `main.tsx` starts `watchForUpdates` with the registration (design.md D9). Verify: `typecheck` and lint pass; green

## 18. [close] Slice 8 — A new version shows on the first open after a deploy

- [ ] 18.1 Local check in Chrome against the API serving the real build:
  - open the app;
  - rebuild with a visible change;
  - switch the tab away and back: the page reloads once by itself and shows the change.

  Record it in `.tdd-state.md`; the iPhone check stays the manual row (M5). Verify: the result is recorded
- [ ] 18.2 Docs: lesson R-41 (how the installed PWA picks up a new version); an inventory line for the service worker with the update watch. Verify: both link to design.md D9

## 19. [wiring] Slice 9 — Icon, name and manifest

- [ ] 19.1 `pwa-assets.config.ts` and an `icons` script make, from `public/app-icon.svg` (slice 2), `apple-touch-icon.png` (180, opaque), `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`; the PNGs are committed (design.md D10). Verify: running `npm run icons` again changes no file
- [ ] 19.2 The manifest and the `index.html` tags of design.md D10: `lang="cs"`, title, viewport with `viewport-fit=cover`, `apple-mobile-web-app-title`, `apple-touch-icon`, two `theme-color` metas. Verify: the built `manifest.webmanifest` holds name, short name, `lang`, `display`, `start_url`, colours and the three icons; `typecheck` and lint pass; green

## 20. [close] Slice 9 — The Home Screen shows the app's icon and name

- [ ] 20.1 Local check in Chrome against the API serving the real build: DevTools → Application → Manifest shows the name and the icons with no errors, and Chrome offers to install the app. Record it in `.tdd-state.md`; the iPhone check stays the manual row (M5). Verify: the result is recorded
- [ ] 20.2 Docs:
  - workflow.md § 8 and `.claude/rules/design.md`: the three-part rule for design files (design.md D10);
  - a line added to lesson R-7;
  - an inventory line for the icon and launch-image script config.

  Verify: § 8 no longer says nothing is downloaded into the repository

## 21. [wiring] Slice 10 — Launch images

- [ ] 21.1 The same script makes the launch images of design.md D10 into `public/launch/` (every iPhone the tool knows, portrait, light and dark), and their `<link rel="apple-touch-startup-image">` tags go into `index.html`. Verify: every launch-image `href` in the built `index.html` exists in `dist/`; running `npm run icons` again changes no file

## 22. [close] Slice 10 — The Home Screen app opens with its launch screen

- [ ] 22.1 The images exist for the iPhone 13 Pro (1170 × 2532) in light and dark, and their tags carry the matching `media` conditions, dark ones included. The iPhone check stays the manual row (M5). Verify: both files and both tags are present
- [ ] 22.2 Docs: lesson R-42 (iOS's launch screen needs one image per device). Verify: it links to design.md D10

## 23. [wiring] Local development

- [ ] 23.1 AppHost: `Aspire.Hosting.JavaScript` 13.6.4 (central version) and `AddViteApp("web", "../RevolutReader.Web").WithReference(api).WaitFor(api)`. `vite.config.ts` forwards `/api` to `API_HTTPS` or `API_HTTP` (design.md D11). Verify, with `aspire start`, then `aspire stop`:
  - `web` runs and `api` is healthy;
  - the `web` address shows the top bar;
  - `<web address>/api/no-such-address` answers the 404 problem description.
- [ ] 23.2 Bicep: none until C4 creates `infra/`. C4's Dockerfile builds this folder in a Node stage (ADR-0002). Verify: roadmap C4 still names the frontend in its one image
- [ ] 23.3 Docs: CLAUDE.md § Commands, "Run the app": locally the app opens at the `web` resource's address. Verify: the row says so

## 24. [wiring] CI

- [ ] 24.1 `.github/workflows/ci.yml`: the `frontend` job of design.md D12 (same trigger, no path filters, read-only token, checkout without credentials, Node from `.node-version`, npm cache; `npm ci`, format check, lint, type check, tests, build). Verify: the same commands pass locally in `src/RevolutReader.Web`
- [ ] 24.2 Docs:
  - `docs/operations/main-ruleset.json` requires `frontend` as well;
  - `docs/operations/main-ruleset.md` and workflow.md § 4's checks table list it.

  Not applied yet (§ Workflow follow-up). Verify: the JSON parses and names the three checks

## 25. [close] Acceptance green

- [ ] 25.1 All of this change's tests pass (the two page scenarios, the four frontend scenarios, the unit tests of slices 2 and 8), then the full suite and the traceability check. Verify: `dotnet test` and `npm --prefix src/RevolutReader.Web test` both exit 0
- [ ] 25.2 `pm/progress.md`: C3 row (status as the user decides, date, notes: the local checks, deviations). Verify: the row matches what was done

## Workflow follow-up

- Open the PR when the user asks (title `feat: add frontend foundation (C3)`), and wait for `build-and-test`, `pr-title` and `frontend` to be green.
- With the user's explicit go: re-apply the ruleset from `docs/operations/main-ruleset.json` as `main-ruleset.md` describes, read it back, and see `frontend` required on the PR (design.md D12).
- Squash merge, then `/opsx:archive c003-add-frontend-foundation`.
- After C4's first deploy: the manual rows for icon and name, launch screen and offline, on the owner's iPhone. After C4's second deploy: the update row. At the latest at M5.
