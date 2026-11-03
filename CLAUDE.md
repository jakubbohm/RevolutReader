# RevolutReader

Personal project. Currently empty — no source code, tech stack, or build tooling chosen yet. Update this file once those exist (build/test/run commands, architecture overview).

## Language

- The user may write prompts in Czech or English.
- All output is always in English: chat replies, project documents (`pm/`, knowledge base), OpenSpec artifacts, code, comments, commit messages, PR descriptions.
- Exception: user-facing text in the app UI is Czech (see `pm/kickoff.md`, ch. 8).

## Project management

- `pm/roadmap.md` and `pm/progress.md` are the source of truth for driving development. Every session reads both at the start, before doing anything else.
- `pm/kickoff.md` is the original project brief; the roadmap refers to its chapters and open questions.
- Update `pm/progress.md` when a step starts and when it ends, and record decisions on open questions there.

## Workflow

- **Spec-driven development via OpenSpec** (`openspec/`, schema `spec-driven`). Start new work with `/opsx:propose "<idea>"` (or `/opsx:explore` to think it through first), implement with `/opsx:apply`, close with `/opsx:archive`. Current specs live in `openspec/specs/`, in-flight changes in `openspec/changes/`.
- Project-level constraints for OpenSpec artifacts go in `openspec/config.yaml` (`context:` / `rules:`).

## Claude memory

Auto-memory lives **in-repo** at `.claude/memory/` (committed). Per machine, `.claude/settings.local.json` (gitignored) must contain:

```json
{ "autoMemoryDirectory": "<absolute-repo-path>/.claude/memory" }
```

A canary MEMORY.md sits at the default global location — if its line ever appears in loaded memories, the redirect is not applied; fix the local setting before writing memories.

## Code navigation

- The repo is indexed in codebase-memory-mcp as project `D-source-jakubbohm-RevolutReader`. Prefer its graph tools (`search_graph`, `trace_path`, `get_code_snippet`) for code exploration; re-run `index_repository` after significant changes.
