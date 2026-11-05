namespace RevolutReader.AcceptanceTests.Traceability;

/// <summary>A claim on a scenario, with where it comes from (a test method or a row of the manual list) for the problem report.</summary>
public sealed record ScenarioClaim(string Capability, string Name, string Source);