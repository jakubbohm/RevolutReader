---
paths:
  - "**/*.cs"
---

# C# member layout

- A type leads with its payload — properties, constructors, operations.
- The mechanical object plumbing — `operator ==`/`!=`, `Equals` overloads, `GetHashCode`, a `ToString` that adds no domain meaning — is always the **last** block in the type, wrapped in `#region Object overrides` … `#endregion`.
- Never open a type with equality plumbing.
- A region folds mechanical plumbing only, never meaningful code — never wrap domain logic in a region.
- The dispose pattern is tail plumbing too: fold it as `#region IDisposable` / `#region IAsyncDisposable` (named for the implemented interface), placed before `Object overrides` when both appear.

Source of truth: [docs/conventions/README.md § C# style beyond tooling](../../docs/conventions/README.md#c-style-beyond-tooling).
