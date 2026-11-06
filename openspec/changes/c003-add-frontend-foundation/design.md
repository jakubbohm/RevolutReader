# Design: c003-add-frontend-foundation

## TL;DR

- **Setup first, outside the TDD loop:** create-vite 9.3.4 (React + TypeScript 7 + oxlint), adapted. Prettier, Tailwind with the design system's theme and Vitest are added, together with the process docs the run depends on, in one green `[setup]` commit (§ Bootstrap).
- **TypeScript 7 + oxlint + Prettier instead of ESLint** (the user, for knowledge building). oxlint enforces the Radix wall (D3).
- **The backend serves the pages:** default and static files, plus one fallback endpoint whose route never matches `/api` (proven in a scratch app on .NET 11 RC3). Its caching rule: hashed `/assets/` files are kept for a year, everything else is "always ask first" (D5).
- **Our own service worker** (vite-plugin-pwa, injectManifest): it keeps only the build's files and never caches an API answer. On a new version it takes over at once and reloads once. The app asks for a check whenever it comes back to the screen while online (D9).
- **Tests:** the acceptance tests give the app a stand-in page folder, the fourth swap (D6). The traceability check reads `scenario("…", "…")` literals in `*.test.ts(x)` (D7). Frontend scenario tests render `<App device>` through the real install-hint rule (D8).
- **New public interfaces:** `UseAppPages()`, `PageCaching.CacheControlFor`; `App`, `AppShell`, `InstallHint`, `needsInstallHint`, `watchForUpdates`, `sw.ts`; DSL `Pages`; driver `PagesDriver`; `ClaimDiscovery.FromFrontendTest`; test helpers `scenario`, `renderApp`.
- **Integration points:** Aspire's `web` resource with the `/api` forwarding (D11); a new required CI check `frontend` (D12). No API contract, no Bicep, no bank.
- **Hard to reverse:** the update policy (D9; the plugin warns that switching from automatic to prompting after release is painful). Also the icon and launch images that iOS caches on the phone (D10).

## Context

- See proposal.md § Why. Everything decided in explore with the user (2026-11-05/06) is marked "decision N" below, in the order it was decided.
- **Backend today:**
  - `Program.cs` holds ServiceDefaults, ProblemDetails + `UseStatusCodePages`, and FastEndpoints with one endpoint, `GET /health`.
  - The acceptance harness runs one app copy per test in `Production` (testing.md § Acceptance-test harness).
  - The traceability check reads `[Scenario]` attributes and `tests/manual-scenarios.md`.
  - The anonymous-endpoint check lists every route endpoint and its methods.
- **The owner's machine:**
  - Node 24.14.0 and npm 11.19.1 installed, no pnpm;
  - `core.autocrlf=true` with `* text=auto` in `.gitattributes`, so text files are checked out with CRLF;
  - Aspire CLI 13.6.4.
- **The design** ([workflow.md § 8](../../../docs/conventions/workflow.md#8-design)), read 2026-11-05/06:
  - **Design system "Tarjeta Papá":** `project/README.md`, `project/tokens.json`, `project/tailwind/theme.css`, the components AppShell and InstallHint, and the app icon (`assets/App icon/app-icon.svg` with its README: sizes, manifest and head tags).
  - **Screens design:** the artboards "Shell / Safari / Install hint", "Shell / Home Screen / Icon" and "Shell / Launch / Default".
  - **Not used by C3:** the "Shell / Offline" boards and "Account / Detail / Waking up, balance stored" belong to C7 (ADR-0007).

## Goals / Non-Goals

**Goals:**

- A frontend project whose build, lint, format check, type check and tests run the same way locally, in CI and in the TDD loop.
- The ten scenarios, at the levels in § How each scenario is verified. The four device-only ones get a local check in Chrome now and the iPhone check after C4.
- The test foundation every later UI change relies on: frontend claims in the traceability check, the `scenario()` and `renderApp()` helpers, and page files in the acceptance tests.

**Non-Goals** (design level; scope is in proposal.md § Non-goals):

- No routing library: C3 has two screens and picks one by a rule. The first change with a second real screen (C6) decides routing.
- No state or data-fetching library, no IndexedDB (C7), no push handler in the service worker (C8).
- The Vite dev server runs without a service worker. It is checked only on the built app.

## Bootstrap (done before `/tdd-apply`, not in tasks.md)

The test-writer may add only signatures to production code, and the implementer needs failing tests. So, as in C1 (lesson R-29), Claude creates the empty, green starting point once, directly on the change branch, after the user approves the artifacts. None of it is behaviour.

1. **Generate:** `npm create vite@9.3.4 RevolutReader.Web -- --template react-ts` in `src/` (template checked 2026-11-05: React 19.3, TypeScript ~7.0.2, Vite 8.3, oxlint).
2. **Adapt:**
   - The template's demo content goes:
     - the counter `App`, its CSS and assets, the README;
     - `src/App.tsx` becomes `export function App({ device }: { device: Device }) { return null; }`;
     - `src/main.tsx` renders `<App device={readDevice(window)} />`.
   - `src/app/device.ts` holds `Device` and `readDevice` (plumbing, no rule: the user agent, and whether the page runs as the Home Screen app: `navigator.standalone === true` or `display-mode: standalone`).
   - `package.json`:
     - name `revolutreader-web`, `private`, `"type": "module"`, `"engines": { "node": ">=24" }`;
     - exact versions from D2; `.npmrc` with `save-exact=true`; `.node-version` with `24` (CI reads it, D12);
     - scripts: `dev`, `build` (`tsc -b && vite build`), `preview`, `test` (`vitest run`), `lint` (`oxlint`), `typecheck` (`tsc -b`), `format` (`prettier --write .`), `format:check` (`prettier --check .`).
   - Tailwind 4:
     - the `@tailwindcss/vite` plugin;
     - `src/styles/theme.css` translated from the design system's `tailwind/theme.css` (decision 11), with a header naming the design-system version it was taken from;
     - `src/index.css` imports Tailwind and the theme.
   - oxlint: `.oxlintrc.json` from the template, plus the Radix rule (D3).
   - Prettier: `.prettierrc.json` holding `{}` (Prettier's style as is), and `.prettierignore` for `dist/`, `coverage/` and the generated images.
   - Vitest:
     - `test: { environment: "jsdom", setupFiles: ["src/test/setup.ts"] }` in `vite.config.ts`;
     - `src/test/setup.ts` imports `@testing-library/jest-dom/vitest`;
     - no `passWithNoTests`: an empty run must stay visible.
   - Line endings: `.gitattributes` gets `src/RevolutReader.Web/** text eol=lf`. Without it, Windows checkouts get CRLF and Prettier's check fails locally but passes in CI.
   - VS Code:
     - `.vscode/settings.json` sets Prettier as the formatter for TypeScript, TSX, JSON, CSS and HTML (format on save is already on, and would otherwise use the built-in TypeScript formatter);
     - `.vscode/extensions.json` recommends `esbenp.prettier-vscode` and `oxc.oxc-vscode`.
3. **Docs the run depends on** (they land in the same commit, because the agents are spawned with them):
   - **docs/conventions/README.md:**
     - § Formatting: TypeScript 7, oxlint + Prettier, LF for the frontend;
     - § Frontend: the Radix wall through oxlint, the component layer in `src/components/`, Czech texts in the components (no i18n library).
   - **Mirrors:** `.claude/rules/frontend.md`.
   - **testing.md** § Where tests live: frontend tests sit next to their code as `*.test.ts(x)`; scenario tests go one file per capability in `src/scenarios/`; the helpers live in `src/test/`.
   - **The test-writer agent:** frontend unit tests sit next to their target; frontend scenario tests use `renderApp()`.
   - **The `tdd-apply` skill:**
     - for a frontend group, "builds" means `typecheck` passes, and the tests are the frontend tests;
     - § 0 step 5's baseline may hold one known red: the repository traceability check, reporting "Not claimed" for exactly this change's own scenarios (see step 4). C3 is the first change that adds scenarios after the check exists.
   - **workflow.md § 3:** `[setup]` becomes "once per stack: C1 the backend, C3 the frontend".
   - **CLAUDE.md § Commands:** the frontend rows of D1.
   - **Software factory:** lesson R-40, a line added to R-29, and the inventory line for the oxlint config.
4. **Check:**
   - `dotnet build` passes;
   - `dotnet test` is green except one test: the repository traceability check fails with "Not claimed" for exactly the ten scenarios of this change's delta specs, and nothing else. The specs already exist; group 1 claims them;
   - in `src/RevolutReader.Web`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run format:check` and `npm run build` pass;
   - `npm test` reports "No test files found". This is the accepted frontend baseline for `/tdd-apply` § 0 step 5, once, as C1 accepted exit code 8. From group 1 on, there are tests.
5. **Commit:** `build(c003): [setup] frontend project, tools and conventions`.
6. ***Found during setup (2026-11-06):***
   - create-vite needs `--no-immediate --no-interactive` to scaffold without prompts or installing.
   - **Every D2 package was installed in setup,** not slice by slice. So the toolchain's compatibility is proven once (no peer conflicts on TypeScript 7, Vite 8, Vitest 5), and the implementer adds no package.
   - oxlint runs with `--deny-warnings`; otherwise the template's warning rules would pass CI as advisories (workflow.md § 4). The Radix rule was probed in the project itself: a feature-folder import failed, `src/components/` passed.
   - Testing Library's automatic cleanup needs Vitest globals, which the project doesn't use. So `src/test/setup.ts` registers `afterEach(cleanup)`.
   - The Vitest settings sit in `vite.config.ts` through `defineConfig` from `vitest/config`.
   - **npm audit reports 6 advisories (2 low, 4 moderate):** `glob`, `minimatch` and `deepmerge` in workbox-build's build-time chain under vite-plugin-pwa. Its suggested fix downgrades vite-plugin-pwa to 1.1.0. They run at build time on our own files only and never ship to the browser, so they're accepted; there is no security scanning in CI by design (divergences.md R-35).
   - Prettier reads `.editorconfig`, whose sections cover `*.cs` only, so nothing there changes the frontend's style.

**Shape of group 1** (as in C1). Besides one task per scenario, group 1 holds the foundation the test-writer owns:
- the frontend claims in the traceability check (D7);
- the `scenario()` and `renderApp()` helpers;
- the stand-in page folder (D6);
- the page fallback's allowlist entries (D5).

**Expected state after group 1:**
- **Green:** the traceability self-tests, the repository check (all ten scenarios claimed), "only allowlisted endpoints answer without sign-in", and every test that was green before.
- **Red at runtime:**
  - the two page scenarios (driver stub);
  - the four frontend scenarios (assertions against `App` returning nothing);
  - "every allowlisted endpoint exists", until slice 6 maps the fallback.

## Decisions

### D1 — The frontend project (decisions 5, 6, 14)

```
src/RevolutReader.Web/
  index.html               lang="cs"; viewport-fit=cover; iPhone tags and launch-image links (D10)
  package.json · package-lock.json · .npmrc · .node-version
  vite.config.ts           React, Tailwind, VitePWA (D9, D10), /api forwarding (D11), Vitest
  tsconfig.json · tsconfig.app.json · tsconfig.node.json
  .oxlintrc.json · .prettierrc.json · .prettierignore
  pwa-assets.config.ts     icon sizes and launch images from public/app-icon.svg (D10)
  public/
    app-icon.svg           copied from the design system
    apple-touch-icon.png · icon-192.png · icon-512.png · icon-maskable-512.png    generated, committed
    launch/                launch images, light and dark, generated, committed
  src/
    main.tsx               renders <App device={readDevice(window)} />, registers the service worker (D9)
    App.tsx                install hint in an iPhone browser tab, otherwise the frame (D8)
    sw.ts                  our service worker (D9)
    index.css · styles/theme.css
    app/device.ts          Device, readDevice, needsInstallHint (D8)
    app/updates.ts         watchForUpdates (D9)
    components/AppShell.tsx · components/InstallHint.tsx
    scenarios/app-shell.test.tsx · scenarios/app-installation.test.tsx
    test/setup.ts · test/scenario.ts · test/renderApp.tsx
    **/*.test.ts(x)        unit tests next to their code (decision 14)
```

- **The folder is `src/RevolutReader.Web/`** (decision 6), next to the .NET projects. It's not in the `.slnx`: `dotnet` ignores it, and npm runs it.
- **npm** is installed, and it's Aspire's default (`AddViteApp` installs packages on start, D11). No workspaces: one package.
- **Commands for CLAUDE.md § Commands** (run once each in setup, from the repository root):

  | Purpose | Command |
  |---|---|
  | Frontend install | `npm --prefix src/RevolutReader.Web ci` |
  | Frontend tests | `npm --prefix src/RevolutReader.Web test` |
  | One frontend test file | `npm --prefix src/RevolutReader.Web test -- src/scenarios/app-installation.test.tsx` |
  | Frontend checks | `npm --prefix src/RevolutReader.Web run lint` · `run typecheck` · `run format:check` (fix: `run format`) |
  | Frontend build | `npm --prefix src/RevolutReader.Web run build` |
  | Full suite | `dotnet test` and the frontend tests |

  The `/tdd-apply` commands for "one change's acceptance tests" gain the frontend form: the two scenario files.

### D2 — Versions (verified on npm and NuGet, 2026-11-06)

| Package | Version | Note |
|---|---|---|
| create-vite | 9.3.4 | the scaffold only |
| react, react-dom | 19.3.1 | `@types/react`, `@types/react-dom` 19.3.0 |
| vite | 8.3.6 | `@vitejs/plugin-react` 6.2.1 |
| typescript | 7.0.2 | the native compiler: no classic compiler API (its package exports only a version file and "unstable" APIs) |
| `@types/node` | 24.x, the latest | matches Node 24 (the template's choice) |
| tailwindcss, `@tailwindcss/vite` | 4.3.4 | |
| oxlint | 1.91.0 | enforces the Radix rule (probe, 2026-11-05) |
| prettier | 3.9.10 | |
| vitest | 5.1.0 | jsdom 31.0.0 |
| `@testing-library/react`, `/dom`, `/user-event`, `/jest-dom` | 16.3.3, 10.4.2, 14.6.8, 7.0.1 | |
| vite-plugin-pwa | 2.0.0 | peers: Vite ≤ 8, workbox 7.4.1 |
| workbox-window, workbox-precaching, workbox-routing, workbox-core | 7.4.1 | |
| `@vite-pwa/assets-generator` | 2.0.0 | dev dependency; run by hand, not in the build (D10) |
| lucide-react | 1.69.0 | the design system's only icon set |
| Aspire.Hosting.JavaScript | 13.6.4 | AppHost, central package versions |
| actions/setup-node | v7 (7.1.0, 2026-10-08) | CI |

Not added: Radix (no component needs it yet), an i18n library, a router, `idb` (C7).

### D3 — Lint and format (decision 5)

- **TypeScript 7 + oxlint + Prettier,** not ESLint. The user chose this for knowledge building (2026-11-06).
  - typescript-eslint 8.72.1 supports TypeScript below 6.1 only, and the template now ships TypeScript 7 with oxlint.
  - TypeScript 7 has no classic compiler API. So **C6's openapi-typescript** (which declares TypeScript 5.x) runs with its own TypeScript 5 copy, kept to the generation script. That note goes into roadmap C6 with the client's move (D15).
- **The Radix wall** (README.md § Frontend), in `.oxlintrc.json`:
  - `no-restricted-imports` with the pattern group `radix-ui`, `@radix-ui/*` and the message "Import Radix only in src/components/; feature code uses the app's own components";
  - an override that switches it off for `src/components/**`.
  - Probed with oxlint 1.91.0 on 2026-11-05: two imports in a feature folder flagged, the one in the component folder passed, exit code 1.
- **Prettier's style as is** (`{}`), checked in CI, applied on save. Prettier writes LF, hence the `.gitattributes` line (§ Bootstrap).
- **Alternatives:**
  - TypeScript 5.9.3 with ESLint + typescript-eslint, the old convention. Every tool supports it, but the template's defaults would have to be swapped back.
  - TypeScript 6.0.3. ESLint works, but openapi-typescript's peer range refuses it, with no gain.
- **Software factory:** lesson R-40 *(Divergence from DoseUp, which names ESLint + Prettier; New: the TypeScript 7 finding)*.

### D4 — The look: the design system translated (decision 11)

- **Tokens:** `src/styles/theme.css` starts from the design system's `tailwind/theme.css` (`@theme static` with the light values and a `prefers-color-scheme: dark` block). It's the repository's own theme file:
  - a header comment names the design-system version it was taken from;
  - a token change arrives through § 8's loop as a small direct PR.
  - **The three shadows sit outside `@theme`,** in a plain `:root` block, each with an `@utility` rule that reads its variable. Tailwind v4 copies `@theme` shadow values into the `shadow-*` utilities at build time, so the dark values would never reach them. Found while building C3; the owner fixed it in the design system through § 8's loop (version 1793973462-31c9, 2026-11-06). These three utilities don't combine with `ring-*` or `shadow-<colour>` on the same element.
  - Utilities follow the design: `bg-background`, `text-ink`, `text-headline`, `px-gutter`, `h-topbar` and so on.
- **Components are rebuilt,** never copied. The design system's reference components (`bundle.js`, `src/index.tsx`) are a model.
  - **`AppShell`:** the top bar `spacing-topbar` high below `env(safe-area-inset-top)`, opaque `color-background`, sticky; "Tarjeta Papá" in `text-headline` with `lang="es"`; a `main` with `spacing-section` gaps and the bottom inset. **Without the account menu:** it needs a signed-in account (C6). That isn't a design change, only a staged build.
  - **`InstallHint`:** as the design system's guideline, laid out as artboard "Shell / Safari / Install hint":
    - the icon at 64 px, the name in `text-title` with `lang="es"`, the sentence "Uvidíš tu zůstatek a pohyby na tátově eurovém účtu.";
    - the card "Nejdřív si appku přidej na plochu", "Upozornění na iPhonu fungují jen v appce otevřené z plochy." and the three steps, a real `<ol>` with the Lucide icons `ellipsis` (`aria-label="tři tečky"`), `share` and `square-plus` in `color-accent`;
    - the step words "Sdílet", "Přidat na plochu" and "Přidat" as `<b>` at weight 600 (`font-semibold`), not the browser's 700 (the same loop).
- **Czech texts sit in the components;** there's one language, so no i18n library.
- **No new token or component.** The install screen's header block (icon, name, sentence) is screen composition from the artboard.

### D5 — The backend serves the pages (decision 9 for the caching rule)

- **`UseAppPages()`** (`src/RevolutReader.Api/Pages/PagesExtensions.cs`) in `Program.cs`, after `UseStatusCodePages` and before `UseFastEndpoints`:
  - `UseDefaultFiles()` + `UseStaticFiles(options)`: `/` and every existing file from the web root;
  - `MapFallbackToFile("{*path:regex(^(?!api(/|$)).*$):nonfile}", "index.html", options)`: every other page address gets the page; addresses with a file extension and everything under `/api` don't.
- **Proven in a scratch app** (.NET 11 RC3, 2026-11-06) with that exact code:
  - `/` and `/index.html` come from the default and static files (the fallback alone does not match `/`);
  - `/no-such-page` and `/deep/link` → the page;
  - `/api`, `/api/no-such-address`, `/API/x` → 404 problem description (the regex is case-insensitive);
  - `/missing.js` → 404 problem description;
  - `/health` → `Healthy`.
- **The fallback is a route endpoint with methods `GET` and `HEAD`.** The anonymous-endpoint allowlist gets exactly:
  `GET /{*path:regex(^(?!api(/|$)).*$):nonfile}` and `HEAD /{*path:regex(^(?!api(/|$)).*$):nonfile}`.
  - Static files are middleware, not endpoints.
  - **For C6:** with an authorization fallback policy, the page fallback must stay `AllowAnonymous`, and the static files must run before authorization, because the sign-in screen is one of these pages.
- **Caching rule, `PageCaching.CacheControlFor(path)`** (`src/RevolutReader.Api/Pages/PageCaching.cs`, a pure function with unit tests):
  - under `/assets/` (Vite's hashed files) → `public, max-age=31536000, immutable`;
  - everything else (the start page, `sw.js`, the manifest, icons, launch images) → `no-cache`.
  - It's applied through the shared `StaticFileOptions.OnPrepareResponse`, so the fallback's `index.html` gets it too.
  - Proven in the same scratch app: `/`, `/index.html` and `/no-such-page` sent `no-cache`, and a hashed file sent the one-year rule.
- **Locally the API's web root is empty:** Aspire's `web` resource serves the pages during development (D11). In production, C4's Dockerfile copies the build into the API's `wwwroot` (ADR-0002).
- **Alternatives:**
  - The default fallback pattern `{*path:nonfile}`: it would answer `/api/no-such-address` with the page and break api-errors.
  - A second fallback that answers 404 under `/api`: two endpoints and two more allowlist entries for the same effect.
  - `MapStaticAssets()`: it needs the files at .NET build time, but here they arrive in the Docker stage.

### D6 — A stand-in page folder in the acceptance tests (decision 7)

- **`tests/RevolutReader.AcceptanceTests/Drivers/StandInPages/index.html`:** a tiny page, copied to the test output. `AcceptanceTest.ConfigureWebHostBuilder` sets it as every test app's web root (`builder.UseWebRoot(StandInPages.Folder)`).
  - The tests check the backend's serving rules, not the frontend build.
  - The real build is covered by the frontend tests, the CI build, the local checks of slices 7–10 (the API serving the real build, D9) and C4's first deployment.
- **The fourth swap,** after the bank address, the sign-in key and the clock. testing.md § Acceptance-test harness says so. Nothing in the deployed app can switch it on, because it's set in test code, not in a setting.
- **"The app's page"** in the DSL means: status 200, a `text/html` content type and a body equal to the stand-in page. The driver knows that; the test case sees `PageAnswer.TheApp`.
- **Risk:** the web root set from the test host might not take effect with minimal hosting. Group 1 proves it with the page scenarios once slice 5 wires the static files. The fallback is `builder.UseSetting(WebHostDefaults.WebRootKey, …)`; if neither works, stop and ask.
- **Software factory:** a line added to divergences.md R-12 (the acceptance tests never see the built pages).
- **Alternatives:** build the frontend before every `dotnet build`; commit a placeholder page in `wwwroot` (both rejected in explore).

### D7 — Frontend claims in the traceability check (decision 14)

- **`ClaimDiscovery.FromFrontendTest(text, source)`** returns:
  - the claims of one file: every `scenario(` call whose first two arguments are string literals (single or double quotes, whitespace and line breaks allowed between them);
  - the calls it cannot read (a template literal, a variable, a missing name), each named with its file and line.
- **Which files:** `src/RevolutReader.Web/src/**/*.test.ts` and `*.test.tsx`; `node_modules` is never reached, because it sits outside `src/`. The repository test adds these claims to the attribute and manual-list claims. Unreadable calls are problems too, so a claim can never vanish silently.
- **`scenario(capability, name, body)`** (`src/test/scenario.ts`) registers a Vitest test named `<capability> / <name>`. The helper's own file is not a `*.test` file, so its definition is never read as a claim.
- **Self-tests** (the test-writer's, in `Traceability/`):
  - a literal claim is found, in single and in double quotes, and across lines;
  - a call with a template literal or a variable is reported, with its line;
  - a claim in a frontend file and the same scenario claimed by an attribute count as claimed twice.
- **testing.md** § Every scenario has exactly one test gets the file pattern and the unreadable-call rule. C1 left this to C3.

### D8 — Install hint or app (decisions 2, 3)

- **`needsInstallHint(device)`** (`src/app/device.ts`, unit-tested): the device is an iPhone (`iPhone` in the user agent) and the page is not the Home Screen app.
  - iPadOS reports a Mac user agent, so an iPad gets the app, as do Android phones and computers.
- **Confirmed by the user (2026-11-06, at the group 1 review):** every browser tab on an iPhone gets the hint, not only Safari's. That includes Chrome and in-app browsers, because none of them gets push or the Home Screen app's sign-in. The hint's steps describe Safari, which is where Apple's "Add to Home Screen" lives. The spec's requirement says "a browser tab on an iPhone"; the scenario uses Safari.
- **`App({ device })`** renders `InstallHint` alone (no top bar) when the rule says so, and `AppShell` otherwise.
  - `main.tsx` passes `readDevice(window)` (§ Bootstrap).
  - The scenario tests use `renderApp(opened)`, where `opened` is `"iPhone Safari" | "iPhone Home Screen" | "computer browser"`. It builds a realistic `Device` and renders `<App device>`, so the scenarios run through the real rule.
- **Alternative:** read `navigator` inside `App`. The tests would then have to patch globals, and `App` would not be testable through its props.

### D9 — The service worker: the app's files only, a new version on the next open (decisions 1, 9)

- **vite-plugin-pwa 2.0.0, `strategies: "injectManifest"`, `srcDir: "src"`, `filename: "sw.ts"`.** It's our own file from the start, so C8 and C9 add push handling to it. It's compiled by Vite, not by `tsc`.
- **`sw.ts`:**
  - `precacheAndRoute(self.__WB_MANIFEST)` + `cleanupOutdatedCaches()`;
  - a `NavigationRoute` to the precached `index.html` with `denylist: [/^\/api(\/|$)/, /^\/health$/]`;
  - no runtime caching. That's the "shell only" half of Q10 (ADR-0007): no API answer is ever kept by the service worker.
  - The precache list (`globPatterns`) is the build's JavaScript, CSS, HTML, the manifest, the SVG and the four icons, not the launch images, which iOS reads itself.
- **Updates (decision 9, automatic with one reload):**
  - `sw.ts` calls `self.skipWaiting()` on install and `clientsClaim()`, so a new version takes over as soon as it is installed.
  - `registerType: "autoUpdate"`, `injectRegister: false`; `main.tsx` calls `registerSW({ immediate: true, onRegisteredSW })` from `virtual:pwa-register`. When the new worker takes over, the page reloads once.
  - The browser checks for a new `sw.js` on every fresh open. A Home Screen app that iOS kept in memory doesn't reopen, so **`watchForUpdates(registration, page, network)`** (`src/app/updates.ts`, unit-tested) calls `registration.update()` whenever the page becomes visible while the phone is online, and ignores a failed check (the next return tries again).
  - **Not `prompt`:** a banner would need a design component, and she might ignore it. Not network-first for the page either: every open after the server slept would wait about 20 s (ADR-0002).
- **Checked locally on the real build, served by the API** (the production shape, one origin):
  - `npm run build`, then `dotnet run --project src/RevolutReader.Api --no-launch-profile -- --webroot <absolute path to src/RevolutReader.Web/dist> --urls http://localhost:5310`, then Chrome at that address (localhost counts as a secure origin).
  - The web root from the command line took effect only with `--no-launch-profile` (scratch app, 2026-11-06).
  - **Slice 7:** with the network switched off in DevTools, a reload still shows the top bar.
  - **Slice 8:** rebuild with a visible change, switch the tab away and back, and the page reloads once with the change. The response headers also follow D5.
- **The service worker is off in the Vite dev server** (the plugin's default).
- **Software factory:** lesson R-41 *(New: how a scale-to-zero PWA picks up a new version)*.

### D10 — Manifest, icon and launch images (decisions 10, 11, 12)

- **The icon:**
  - `public/app-icon.svg` is copied as it is from the design system's asset `App icon/app-icon.svg` (decision 11: files the app ships are copied and committed).
  - `pwa-assets.config.ts`, run with `npm run icons` (`pwa-assets-generator`), makes `apple-touch-icon.png` (180, opaque), `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`. The art already keeps the maskable safe zone (the design's App icon README).
  - The PNGs are committed. The build never runs the tool, which depends on sharp's native binaries (decision 10).
- **The launch images** (decision 12):
  - the same script makes them for every iPhone the tool knows (iPhone 11 to 17, iPhone 13 Pro included), portrait, light and dark, into `public/launch/`;
  - each is `color-pwa-background` (`#f6f4ef` light, `#111416` dark) with the icon in the middle, as artboard "Shell / Launch / Default";
  - the tool prints the matching `<link rel="apple-touch-startup-image" media="…">` tags (its HTML output), and they go into `index.html` once;
  - no iPad images.
- **The manifest** (the plugin's `manifest` option), values from the design system's App icon README:
  - `name` and `short_name` "Tarjeta Papá", `lang: "cs"`, `display: "standalone"`, `start_url: "/"`, `scope: "/"`;
  - `theme_color` and `background_color` `#f6f4ef`;
  - the three icons with their purposes.
- **`index.html`:**
  - `<html lang="cs">`, `<title>Tarjeta Papá</title>`;
  - the viewport `width=device-width, initial-scale=1, viewport-fit=cover`;
  - `apple-mobile-web-app-title`, `apple-touch-icon`, two `theme-color` metas (light, dark);
  - the launch-image links.
- **No `apple-mobile-web-app-status-bar-style` tag** (iOS's default). How the status bar strip looks over the opaque top bar is checked with the launch screen on the iPhone. If it's wrong, a small direct PR changes it (§ Risks).
- **workflow.md § 8 and `.claude/rules/design.md`** get the three-part rule for design files (decision 11):
  - copied and committed: the files the app ships (icon, images, logos);
  - translated, not copied: the tokens, the components, the formats;
  - never copied: the reference components' code, the screens, the sample data, the guidelines.
- **Software factory:** a line added to lesson R-7 (the asset rule); lesson R-42 *(New: iOS ignores the manifest for its launch screen and needs one image per device)*.

### D11 — Local development: Aspire runs Vite

- **AppHost:** `Aspire.Hosting.JavaScript` 13.6.4 and `builder.AddViteApp("web", "../RevolutReader.Web").WithReference(api).WaitFor(api);`
  - npm is Aspire's default and installs packages before start (aspire.dev, "Set up JavaScript apps in the AppHost", read 2026-11-06).
- **`/api` forwarding:** `vite.config.ts` sets `server.proxy["/api"]` to `process.env.API_HTTPS ?? process.env.API_HTTP`, the variables `WithReference(api)` provides (same page), with `changeOrigin: true` and `secure: false` for the local development certificate. Outside Aspire, the dev server runs without forwarding.
- **Locally, the app opens at the `web` resource's address;** the API's own address serves no pages, because its web root is empty (D5).
- **For C6:** the sign-in callback must sit under `/api` (or get its own forwarding), because the browser's origin is the Vite server.
- **Bicep:** none. The `web` resource is local only, and production serves the built files from the API's container (ADR-0002). `infra/` arrives with C4, whose Dockerfile builds this folder in a Node stage.

### D12 — CI: a separate `frontend` job (decision 13)

- **In `.github/workflows/ci.yml`, same trigger, no path filters** (workflow.md § 4):

  ```yaml
  frontend:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults: { run: { working-directory: src/RevolutReader.Web } }
    steps:
      - actions/checkout@v7 with persist-credentials: false
      - actions/setup-node@v7 with node-version-file src/RevolutReader.Web/.node-version, cache npm, cache-dependency-path src/RevolutReader.Web/package-lock.json
      - npm ci → npm run format:check → npm run lint → npm run typecheck → npm test → npm run build
  ```
- **The ruleset:**
  - `docs/operations/main-ruleset.json` requires `frontend` too (`integration_id` 15368, as the others), and `main-ruleset.md` and workflow.md § 4's table list it.
  - **Applied only with the user's explicit go** (CLAUDE.md), once the C3 PR's `frontend` run is green and before the merge (§ Workflow follow-up in tasks.md).
  - From then until C3 merges, a PR branched from `main` without C3 would wait for a `frontend` check that never comes. None is expected, and such a PR rebases after C3 merges.
- **Alternative:** steps inside `build-and-test`. The ruleset stays untouched, but CI runs serially and a frontend failure reads as a backend one.

### D13 — Runtime settings (decision 8)

- The frontend gets a value that differs between environments from **an ordinary API endpoint, added by the first change that needs one** (C8's public push key, for example), behind sign-in like everything else. It's typed by the generated client from C6.
- **Recorded in the `[plan]` commit,** because C3 builds nothing for it:
  - configuration.md § Frontend (the rule);
  - an amendment line in ADR-0002-frontend-hosting § Decision pointing to it.
- **Alternatives:**
  - The backend writing values into `index.html`: the service worker's cached page would go stale, and the page couldn't stay a plain file.
  - A `settings.json` loaded before start: it delays every start and can go stale the same way.

### D14 — Q10 decided: ADR-0007-offline-balance (decision 1)

- **Recorded in the `[plan]` commit:**
  - ADR-0007 (the full decision);
  - the Q10 entry in progress.md;
  - lesson R-39 *(New)*.
- **What C3 builds of it:** only the service worker's "app files only" rule (D9).
- **What C7 builds:** the stored balance in IndexedDB, the waking-up and offline screens with it, and its deletion on sign-out.
- **What C9 builds:** the push payload carrying the balance and its read time, and the service worker writing them.

### D15 — Moved to C6: the generated API client (decision 4)

- C3 has no `/api` endpoint and no screen that calls one. The FastEndpoints OpenAPI export, openapi-typescript, openapi-fetch and the CI drift check move to C6, which has both. The roadmap's C3 and C6 texts and its change log are updated in the `[plan]` commit.
- **Two packages to choose from in C6:** FastEndpoints.Swagger and FastEndpoints.OpenApi, both 9.0.0-beta.7 on NuGet (checked 2026-11-05).

## Public API sketch

Backend (`src/RevolutReader.Api`):

```csharp
// Program.cs, after wiring
app.UseStatusCodePages();
app.UseAppPages();
app.UseFastEndpoints();

// Pages/PagesExtensions.cs
public static class PagesExtensions {
  /// <summary>Default and static files from the web root, and index.html for every other page address outside /api (D5).</summary>
  public static WebApplication UseAppPages(this WebApplication app);
}

// Pages/PageCaching.cs
public static class PageCaching {
  /// <summary>"public, max-age=31536000, immutable" under /assets/; "no-cache" for everything else (D5).</summary>
  public static string CacheControlFor(PathString path);
}
```

AppHost: `builder.AddViteApp("web", "../RevolutReader.Web").WithReference(api).WaitFor(api);`

Acceptance tests (`tests/RevolutReader.AcceptanceTests`):

```csharp
// Drivers/StandInPages/index.html (copied to the output) and Drivers/StandInPages.cs
public static class StandInPages {
  public static string Folder { get; }        // the output copy of Drivers/StandInPages/
  public static string StartPage { get; }     // its index.html, as text
}
// Drivers/AcceptanceTest.cs: ConfigureWebHostBuilder also sets builder.UseWebRoot(StandInPages.Folder)
public abstract class AcceptanceTest {
  protected PagesDsl Pages { get; }           // next to Health and Api
}

// Dsl/
public enum PageAnswer { TheApp, SomethingElse }
public sealed class PagesDsl(PagesDriver driver) {
  public Task<PageAnswer> OpenTheStartPage();            // "/"
  public Task<PageAnswer> OpenAnUnknownPageAddress();    // "/no-such-page"
}

// Drivers/PagesDriver.cs (stub throws NotImplementedException until slice 5)
public sealed class PagesDriver(HttpClient http) {
  public Task<PageAnswer> GetPage(string path);          // TheApp: 200, text/html, body equals StandInPages.StartPage
}

// Scenarios/AppDelivery/AppDeliveryScenarios.cs
[Test, Scenario("app-delivery", "The start page opens at the root address")]
public async Task The_start_page_opens_at_the_root_address();      // (await Pages.OpenTheStartPage()).ShouldBe(PageAnswer.TheApp)
[Test, Scenario("app-delivery", "An unknown page address opens the app")]
public async Task An_unknown_page_address_opens_the_app();

// Traceability/ClaimDiscovery.cs
public sealed record FrontendClaims(IReadOnlyList<ScenarioClaim> Claims, IReadOnlyList<string> Unreadable);
public static FrontendClaims FromFrontendTest(string text, string source);   // source: repository-relative path, for messages
public static IReadOnlyList<string> FrontendTestFiles(string repositoryRoot); // src/RevolutReader.Web/src/**/*.test.{ts,tsx}

// Conventions/AnonymousEndpointsTests.cs: two allowlist entries (D5)
```

Unit tests: `tests/RevolutReader.UnitTests/Pages/PageCachingTests.cs`.

Frontend (`src/RevolutReader.Web/src`):

```ts
// app/device.ts
export interface Device { userAgent: string; standalone: boolean }   // facts the browser gives
export function readDevice(window: Window): Device;                  // setup: user agent; navigator.standalone or display-mode standalone
export function needsInstallHint(device: Device): boolean;           // an iPhone, not the Home Screen app (D8)

// App.tsx
export function App({ device }: { device: Device }): JSX.Element;    // InstallHint alone, or AppShell

// components/AppShell.tsx
export function AppShell({ children }: { children?: ReactNode }): JSX.Element;   // top bar with <span lang="es">Tarjeta Papá</span>, then <main>

// components/InstallHint.tsx
export function InstallHint(): JSX.Element;                          // artboard "Shell / Safari / Install hint"

// app/updates.ts
export interface UpdatableRegistration { update(): Promise<unknown> }
export interface Page { visibilityState: DocumentVisibilityState; addEventListener(type: "visibilitychange", listener: () => void): void }
export interface Network { onLine: boolean }
export function watchForUpdates(registration: UpdatableRegistration, page: Page, network: Network): void;  // runs as long as the page; nothing stops it

// sw.ts: no exports (D9)

// test/scenario.ts
export function scenario(capability: string, name: string, body: () => void | Promise<void>): void;

// test/renderApp.tsx
export type Opened = "iPhone Safari" | "iPhone Home Screen" | "computer browser";
export function renderApp(opened: Opened): RenderResult;
```

Frontend unit tests: `app/device.test.ts`, `app/updates.test.ts`. Scenario tests: `scenarios/app-shell.test.tsx`, `scenarios/app-installation.test.tsx`.

## Rule ownership

| Rule (spec or convention) | Enforced by |
|---|---|
| The top bar shows "Tarjeta Papá", marked as Spanish | `AppShell` |
| A browser tab on an iPhone shows only the install hint | `needsInstallHint` + `App` |
| The Home Screen app and other devices show the app | `needsInstallHint` + `App` |
| The start page at `/` | `UseAppPages` (default and static files) |
| Unknown page addresses get the page; `/api` never | the fallback's route pattern in `UseAppPages`; the api-errors scenario guards `/api` |
| The pages need no sign-in | static files are middleware; the fallback is on the anonymous-endpoint allowlist; C6 keeps both open |
| The start page and the service worker are always checked with the server; hashed files are kept a year | `PageCaching`, applied to static files and the fallback |
| The app opens without network | `sw.ts` (precache + navigation route) |
| The service worker keeps no API answer (Q10, ADR-0007) | `sw.ts`: precache list only, no runtime caching, `/api` denied for navigations |
| A new version shows on the next open | `watchForUpdates` + `sw.ts` (`skipWaiting`, `clientsClaim`) + `registerSW({ immediate: true })` |
| Icon, name, full-screen, launch screen | the manifest (`vite.config.ts`), `index.html` tags, the generated images |
| Every scenario is claimed exactly once, frontend included | `TraceabilityTests` with `FromFrontendTest` |
| Radix only in `src/components/` | oxlint `no-restricted-imports` |
| Frontend formatting, lint, types | Prettier check, oxlint, `tsc -b` (CI `frontend`) |

## Error model

- No new operation has an expected failure, so there are no Result values.
- A missing file or an unknown `/api` address → 404 problem description through the existing `UseStatusCodePages` (spec api-errors).
- A failed update check → ignored, retried on the next return to the screen (`watchForUpdates`).
- A new service worker that fails to install → the browser keeps the old one (web.dev, "The service worker lifecycle").

## Ports and contracts

None. C3 adds no repository, external client or push sender, so there's no `[integration]` group.

## How each scenario is verified

| Scenario | Level | Why |
|---|---|---|
| app-delivery / The start page opens at the root address | API acceptance | backend behaviour, through HTTP |
| app-delivery / An unknown page address opens the app | API acceptance | backend behaviour, through HTTP |
| app-shell / The top bar shows the app name | frontend | what the screen shows exists only in the browser |
| app-installation / iPhone Safari shows only the install hint | frontend | same |
| app-installation / The Home Screen app shows the app, not the install hint | frontend | same |
| app-installation / Other browsers show the app, not the install hint | frontend | same |
| app-installation / The Home Screen shows the app's icon and name | manual (M5) | iOS draws the Home Screen; first chance after C4's deploy |
| app-installation / The Home Screen app opens with its launch screen | manual (M5) | iOS draws the launch screen from its own cache |
| app-delivery / The app opens without network after the first visit | manual (M5) | service worker behaviour on the phone; jsdom runs no service worker, and there are no browser tests (divergences.md R-19) |
| app-delivery / A new version shows on the first open after a deploy | manual (M5) | needs two deploys and the iPhone's Home Screen app; first chance after C4's second deploy |

- Each manual scenario's slice ends with a local check in Chrome against the API serving the real build (D9). The orchestrator records the result in `.tdd-state.md`.
- The manual rows in `tests/manual-scenarios.md` name M5, with the earliest chance in the "why manual" text.

## Cross-cutting effects

- **API contract / TS client:** none. There's no `/api` endpoint, and the generator moved to C6 (D15).
- **Bicep:** none (D11).
- **Settings:** none added to `appsettings.json`.
- **Bank calls:** none.
- **ADRs:** ADR-0007-offline-balance, new (D14); ADR-0002-frontend-hosting, amended (D13).
- **Design:**
  - **Parts implemented:** the tokens (`tailwind/theme.css`, `tokens.json`), AppShell (the top bar, without its account menu), InstallHint, the app icon.
  - **Artboards:** "Shell / Safari / Install hint", "Shell / Home Screen / Icon", "Shell / Launch / Default".
  - No new token or component.
- **Software factory:**
  - lesson R-39 *(New)*: what a scale-to-zero PWA keeps on the phone: only the last balance, never transactions, replaced by refresh and push (ADR-0007);
  - lesson R-40 *(Divergence from DoseUp, and New)*: TypeScript 7 + oxlint + Prettier; why ESLint and openapi-typescript don't fit TypeScript 7 yet;
  - lesson R-41 *(New)*: how the installed PWA picks up a new version (automatic, one reload, a check on every return);
  - lesson R-42 *(New)*: iOS's launch screen needs one image per device, with no manifest fallback;
  - lines added to R-7 (the asset rule) and R-29 (`[setup]` once per stack), and to divergences.md R-12 (the stand-in page folder);
  - inventory lines: the oxlint config (Radix wall), the traceability check's frontend reading with the `scenario()` helper, the service worker with the update watch, the icon and launch-image script config.

## Risks / Trade-offs

- [TypeScript 7 is new, and tools built on the classic compiler API break] → C3's tools (Vite, Vitest, oxlint, vite-plugin-pwa) don't use `tsc`'s API; the setup build proves it. C6's openapi-typescript gets its own TypeScript 5 (D3). If a C3 tool fails on TypeScript 7, stop and ask.
- [iOS ignores the launch images, or shows a wrong status-bar strip] → the manual rows; fallback a white launch flash, or a small direct PR for the status-bar tag. iOS caches icons and launch images hard: remove and re-add the app after a change (developer report, 2026-11-05).
- [iOS keeps the old service worker past the next open] → the update watch asks on every return; worst case, remove and re-add the app.
- [The reload after an update flashes while she's looking] → accepted (decision 9); it happens once per deploy, and the app has no forms.
- [For a few seconds after a deploy, the old frontend calls the new API] → C3 calls no API. Later changes that modify a contract update every consumer in the same change (README.md § API contract), and the reload follows within seconds.
- [The web root set from the test host doesn't take effect] → D6's fallback, or stop.
- [Windows checkouts turn LF into CRLF] → the `.gitattributes` line (§ Bootstrap).
- [Every browser tab on an iPhone gets the hint, including ones whose steps differ from Safari's] → confirmed by the user (D8): the hint's steps send her to Safari.
- [Packages published days before this change (jsdom 31.0.0, Vite 8.3.6)] → exact pins. If a test tool misbehaves, the previous version is the first thing to try.
- [The ruleset requiring `frontend` before C3 merges] → D12's timing.

## Migration plan

None: nothing exists to migrate. Rollback is reverting the merge commit. The ruleset change is undone by re-applying the file's previous version.
