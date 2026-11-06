---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Frontend

- **The app lives in `src/RevolutReader.Web/`** (React + Vite + TypeScript 7, npm).
- **Feature code never imports Radix directly** — only the app's own component layer in `src/components/` does (oxlint `no-restricted-imports`).
- **Wire payloads use the generated contract types only** (openapi-typescript + openapi-fetch, from C6); never hand-write wire types and never edit the generated file — regenerate it.
- **UI text is Czech,** written in the components (no i18n library); code, comments and identifiers are English.
- **Nothing secret or environment-specific in `VITE_` variables.**
- **Formatting is Prettier's, as is; oxlint (`--deny-warnings`) and `tsc -b` must pass.** Not ESLint. Line endings are LF.
- **Tests sit next to their code** as `*.test.ts(x)`; scenario tests use `scenario(...)` in `src/scenarios/<capability>.test.tsx`.

Source of truth: [docs/conventions/README.md § Frontend](../../docs/conventions/README.md#frontend), [§ Formatting](../../docs/conventions/README.md#formatting), [§ API contract](../../docs/conventions/README.md#api-contract).
