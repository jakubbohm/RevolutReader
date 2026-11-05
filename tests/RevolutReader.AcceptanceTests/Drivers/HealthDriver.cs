using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Asks the app's health check over HTTP (spec service-health, c001 design.md D3). <see cref="HealthAnswer.Healthy"/>
/// only when all three hold: status 200, content type <c>text/plain</c> (the media type is compared; a parameter such
/// as <c>charset</c> is allowed), and a body that is exactly <c>Healthy</c>. <see cref="HealthAnswer.NotHealthy"/> for
/// any other answer. Stub until wiring (tasks.md 2.2).
/// </summary>
public sealed class HealthDriver {
  private readonly HttpClient _http;

  public HealthDriver(HttpClient http) => _http = http;

  public Task<HealthAnswer> GetHealth() => throw new NotImplementedException();
}