using FastEndpoints;
using Microsoft.Extensions.Options;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Push;

/// <summary>
/// <c>GET /api/push/key</c> (spec push-devices, c011 design.md D9): the VAPID public key the app subscribes with, from the
/// validated settings (D5); the first runtime value the API serves (configuration.md § Frontend). No
/// <c>AllowAnonymous</c>, so the default policy <c>AllowedUser</c> applies: nobody signed in gets 401, and an account not on
/// the allowlist 403, before the endpoint runs. The API description lists 200, 401 and 403; the 403 is
/// <see cref="RefusedProblem"/>, as for <see cref="MeEndpoint"/>, since the refusal names the account here too.
/// </summary>
public sealed class PushKeyEndpoint(IOptions<PushOptions> options) : EndpointWithoutRequest<PushKeyResponse> {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  public override void Configure() {
    Get("/api/push/key");
    Description(
      static endpoint => endpoint
        .Produces<PushKeyResponse>(StatusCodes.Status200OK, JSON)
        .ProducesProblem(StatusCodes.Status401Unauthorized)
        .Produces<RefusedProblem>(StatusCodes.Status403Forbidden, PROBLEM_JSON),
      clearDefaults: true);
    Summary(static summary => summary.Summary = "The public push key the app subscribes with");
  }

  public override Task HandleAsync(CancellationToken ct) => Send.OkAsync(new PushKeyResponse(options.Value.VapidPublicKey), ct);
}