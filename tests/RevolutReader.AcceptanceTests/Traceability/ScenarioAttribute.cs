namespace RevolutReader.AcceptanceTests.Traceability;

/// <summary>
/// Claims an OpenSpec scenario for the test it is on: the test is that scenario's one executable specification
/// (docs/conventions/testing.md § Every scenario has exactly one test). Names are exact, as in the spec.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class ScenarioAttribute(string capability, string name) : Attribute {
  public string Capability { get; } = capability;

  public string Name { get; } = name;
}