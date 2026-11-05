using FastEndpoints;

namespace RevolutReader.Api.Health;

/// <summary>
/// The health probe (spec service-health, c001 design.md D3): <c>GET /health</c> answers any caller, signed in or not,
/// with 200 and the plain text <c>Healthy</c>. It has no dependencies on purpose, so a probe can never reach the bank or
/// the storage (bank requests are limited, ADR-0001-bank-data-access).
/// </summary>
public sealed class HealthEndpoint : EndpointWithoutRequest {
  private const string HEALTHY = "Healthy";

  public override void Configure() {
    Get("/health");
    AllowAnonymous();
  }

  public override Task HandleAsync(CancellationToken ct) => Send.StringAsync(HEALTHY, StatusCodes.Status200OK, "text/plain; charset=utf-8", ct);
}