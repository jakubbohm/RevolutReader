# RevolutReader — Testing conventions

**Status:** placeholder — filled in the TDD/BDD part of F0-1, a separate session. Sources for that session: the user's Claude session on TDD and BDD (the user gives the link) and DoseUp's `docs/conventions/testing.md` + `docs/adr/0003-testing-stack.md`.

Until then nothing here is decided. Already fixed elsewhere:

- kickoff ch. 7 and 8: TDD + BDD; Testcontainers where needed, likely for the database (an assumption);
- [README.md § Backend code](README.md#backend-code): read endpoints have an exact-shape test; the anonymous-endpoint allowlist is checked by a test;
- [workflow.md § 4](workflow.md#4-cicd): every CI check blocks or is deleted.

Candidates from DoseUp for that session to decide (none adopted yet): TUnit + Shouldly · the Aspire testing harness · @playwright/test (a smoke subset on PRs, the full suite nightly) · ArchUnitNET · mutation testing (spike first) · where each kind of test goes and isolation by construction · fake only what you don't own · zero automatic retries for flaky tests · whether any test needs a real secret (the Enable Banking sandbox).
