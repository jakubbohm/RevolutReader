namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>What the health check said. <see cref="NotHealthy"/> is the default value, so an unset answer never reads as healthy.</summary>
public enum HealthAnswer {
  NotHealthy,
  Healthy,
}