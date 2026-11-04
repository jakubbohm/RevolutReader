---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Frontend

- **Feature code never imports Radix directly** — only the app's own component layer does (ESLint `no-restricted-imports`).
- **Wire payloads use the generated contract types only** (openapi-typescript + openapi-fetch); never hand-write wire types and never edit the generated file — regenerate it.
- **UI text is Czech;** code, comments and identifiers are English.
- **Nothing secret or environment-specific in `VITE_` variables.**
- Formatting is Prettier's, as is; ESLint and `tsc` must pass.

Source of truth: [docs/conventions/README.md § Frontend](../../docs/conventions/README.md#frontend), [§ API contract](../../docs/conventions/README.md#api-contract).
