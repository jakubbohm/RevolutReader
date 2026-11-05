using System.Net;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Asks the app's health check over HTTP (spec service-health, c001 design.md D3). <see cref="HealthAnswer.Healthy"/>
/// only when all three hold: status 200, content type <c>text/plain</c> (the media type is compared; a parameter such
/// as <c>charset</c> is allowed), and a body that is exactly <c>Healthy</c>. <see cref="HealthAnswer.NotHealthy"/> for
/// any other answer.
/// </summary>
public sealed class HealthDriver {
  private const string PATH = "/health";
  private const string PLAIN_TEXT = "text/plain";
  private const string HEALTHY_BODY = "Healthy";

  private readonly HttpClient _http;

  public HealthDriver(HttpClient http) => _http = http;

  public async Task<HealthAnswer> GetHealth() {
    using HttpResponseMessage response = await _http.GetAsync(new Uri(PATH, UriKind.Relative));

    if (response.StatusCode != HttpStatusCode.OK)
      return HealthAnswer.NotHealthy;

    if (!string.Equals(response.Content.Headers.ContentType?.MediaType, PLAIN_TEXT, StringComparison.OrdinalIgnoreCase))
      return HealthAnswer.NotHealthy;

    string body = await response.Content.ReadAsStringAsync();

    return string.Equals(body, HEALTHY_BODY, StringComparison.Ordinal) ? HealthAnswer.Healthy : HealthAnswer.NotHealthy;
  }
}