using FastEndpoints;

namespace RevolutReader.Api.Health;

/// <summary>
/// The health probe (spec service-health, c001 design.md D3): <c>GET /health</c> answers any caller, signed in or not,
/// with 200 and the plain text <c>Healthy</c>. It has no dependencies on purpose, so a probe can never reach the bank or
/// the storage (bank requests are limited, ADR-0001-bank-data-access).
/// </summary>
public sealed class HealthEndpoint : EndpointWithoutRequest {
  private const string HEALTHY = "Healthy";
  private const string PLAIN_TEXT = "text/plain";

  public override void Configure() {
    Get("/health");
    AllowAnonymous();
    Description(static endpoint => endpoint.Produces<string>(StatusCodes.Status200OK, PLAIN_TEXT), clearDefaults: true);
    Summary(static summary => summary.Summary = "The app is running");
  }

  public override Task HandleAsync(CancellationToken ct) => Send.StringAsync(HEALTHY, StatusCodes.Status200OK, $"{PLAIN_TEXT}; charset=utf-8", ct);
}