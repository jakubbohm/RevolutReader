# RevolutReader

Personal project. Currently empty — no source code, tech stack, or build tooling chosen yet. Update this file once those exist (build/test/run commands, architecture overview).

## Workflow

- **Spec-driven development via OpenSpec** (`openspec/`, schema `spec-driven`). Start new work with `/opsx:propose "<idea>"` (or `/opsx:explore` to think it through first), implement with `/opsx:apply`, close with `/opsx:archive`. Current specs live in `openspec/specs/`, in-flight changes in `openspec/changes/`.
- Project-level constraints for OpenSpec artifacts go in `openspec/config.yaml` (`context:` / `rules:`).

## Code navigation

- The repo is indexed in codebase-memory-mcp as project `D-source-jakubbohm-RevolutReader`. Prefer its graph tools (`search_graph`, `trace_path`, `get_code_snippet`) for code exploration; re-run `index_repository` after significant changes.
