namespace RevolutReader.AcceptanceTests.Traceability;

/// <summary>
/// What one frontend test file claims (c003 design.md D7): the <c>scenario(...)</c> calls whose capability and name are
/// string literals, and the <c>scenario(...)</c> calls that cannot be read, each as <c>"&lt;file&gt; line &lt;n&gt;"</c>.
/// </summary>
public sealed record FrontendClaims(IReadOnlyList<ScenarioClaim> Claims, IReadOnlyList<string> Unreadable);