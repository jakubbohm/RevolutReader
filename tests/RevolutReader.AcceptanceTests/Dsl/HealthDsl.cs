using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>The health check, asked by a caller who has not signed in (spec service-health).</summary>
public sealed class HealthDsl(HealthDriver driver) {
  public Task<HealthAnswer> Check() => driver.GetHealth();
}