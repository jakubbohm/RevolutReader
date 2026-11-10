using FastEndpoints;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Push;

/// <summary>
/// <c>DELETE /api/push/subscription</c> (spec push-devices, c011 design.md D9): forgets the device with the push address
/// the body names, through <see cref="ForgetDeviceHandler"/>, and answers 204 whether or not it was stored. No
/// <c>AllowAnonymous</c>, so the default policy <c>AllowedUser</c> applies: nobody signed in gets 401, and an account not
/// on the allowlist 403, before the endpoint runs; a write from another site is refused before it too
/// (<c>UseCrossSiteWriteProtection</c>). The body is declared with <c>Accepts</c>, which keeps it in the API description;
/// a request without a JSON body never reaches the endpoint and gets the catch-all's 404 (D9). The API description lists
/// 204, 401 and 403; the 403 is <see cref="RefusedProblem"/>, as for <see cref="SubscriptionEndpoint"/>.
/// </summary>
public sealed class ForgetSubscriptionEndpoint(ForgetDeviceHandler handler) : Endpoint<ForgetSubscriptionRequest> {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  public override void Configure() {
    Delete("/api/push/subscription");
    Description(
      static endpoint => endpoint
        .Accepts<ForgetSubscriptionRequest>(JSON)
        .Produces(StatusCodes.Status204NoContent)
        .ProducesProblem(StatusCodes.Status401Unauthorized)
        .Produces<RefusedProblem>(StatusCodes.Status403Forbidden, PROBLEM_JSON),
      clearDefaults: true);
    Summary(static summary => summary.Summary = "Forgets this device, so it gets no more push notifications");
  }

  public override async Task HandleAsync(ForgetSubscriptionRequest req, CancellationToken ct) {
    ArgumentNullException.ThrowIfNull(req);

    await handler.Handle(req.Endpoint, ct);
    await Send.NoContentAsync(ct);
  }
}