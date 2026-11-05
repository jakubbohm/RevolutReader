namespace RevolutReader.AcceptanceTests.Traceability;

/// <summary>One <c>spec.md</c>: a main spec (<paramref name="ChangeId"/> empty) or an active change's delta for one capability.</summary>
public sealed record SpecFile(string Capability, string ChangeId, string Markdown);