using System.Diagnostics;
using System.Security.Claims;
using FastEndpoints;
using Microsoft.IdentityModel.JsonWebTokens;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// <c>GET /api/me</c> (spec sign-in, c007 design.md D3): who is signed in, read from the login's <c>name</c> and
/// <c>email</c> claims, which keep the ID token's short names. Without a <c>name</c> claim, the email stands in. No
/// <c>AllowAnonymous</c>, so the default policy <c>AllowedUser</c> applies: nobody signed in gets 401 before the endpoint
/// runs.
/// </summary>
public sealed class MeEndpoint : EndpointWithoutRequest<MeResponse> {
  private const string JSON = "application/json";

  public override void Configure() {
    Get("/api/me");
    Description(
      static endpoint => endpoint
        .Produces<MeResponse>(StatusCodes.Status200OK, JSON)
        .ProducesProblem(StatusCodes.Status401Unauthorized)
        .ProducesProblem(StatusCodes.Status403Forbidden),
      clearDefaults: true);
    Summary(static summary => summary.Summary = "Who is signed in");
  }

  public override Task HandleAsync(CancellationToken ct) {
    string email = User.FindFirstValue(JwtRegisteredClaimNames.Email)
      ?? throw new UnreachableException("The AllowedUser policy lets no login without an email address through.");
    string name = User.FindFirstValue(JwtRegisteredClaimNames.Name) ?? email;

    return Send.OkAsync(new MeResponse(name, email), ct);
  }
}