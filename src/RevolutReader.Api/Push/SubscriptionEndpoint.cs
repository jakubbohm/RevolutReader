using System.Diagnostics;
using System.Security.Claims;
using FastEndpoints;
using FluentValidation.Results;
using Microsoft.IdentityModel.JsonWebTokens;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Push;

/// <summary>
/// <c>PUT /api/push/subscription</c> (spec push-devices, c011 design.md D9): stores this device under the signed-in
/// account, read from the login's <c>email</c> claim as <see cref="MeEndpoint"/> reads it, through
/// <see cref="RegisterDeviceHandler"/>. No <c>AllowAnonymous</c>, so the default policy <c>AllowedUser</c> applies: nobody
/// signed in gets 401, and an account not on the allowlist 403, before the endpoint runs; a write from another site is
/// refused before it too (<c>UseCrossSiteWriteProtection</c>).
/// <list type="bullet">
/// <item><see cref="Registered"/>: 204.</item>
/// <item><see cref="SubscriptionRefused"/>: 400, FastEndpoints' validation problem, whose <c>errors</c> name each refused
/// member with its fixed reason, never its value; nothing is stored.</item>
/// <item>The body is declared with <c>Accepts</c>, which keeps it in the API description; a request without a JSON body
/// never reaches the endpoint and gets the catch-all's 404 (D9).</item>
/// </list>
/// The API description lists 204, 400, 401 and 403; the 403 is <see cref="RefusedProblem"/>, as for <see cref="MeEndpoint"/>.
/// </summary>
public sealed class SubscriptionEndpoint(RegisterDeviceHandler handler) : Endpoint<SubscriptionRequest> {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  public override void Configure() {
    Put("/api/push/subscription");
    Description(
      static endpoint => endpoint
        .Accepts<SubscriptionRequest>(JSON)
        .Produces(StatusCodes.Status204NoContent)
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status401Unauthorized)
        .Produces<RefusedProblem>(StatusCodes.Status403Forbidden, PROBLEM_JSON),
      clearDefaults: true);
    Summary(static summary => summary.Summary = "Registers this device for push notifications under the signed-in account");
  }

  public override async Task HandleAsync(SubscriptionRequest req, CancellationToken ct) {
    ArgumentNullException.ThrowIfNull(req);

    string email = User.FindFirstValue(JwtRegisteredClaimNames.Email)
      ?? throw new UnreachableException("The AllowedUser policy lets no login without an email address through.");

    RegistrationResult result = await handler.Handle(new DeviceSubscription(req.Endpoint, req.Keys?.P256dh, req.Keys?.Auth), email, ct);

#pragma warning disable CA1508 // Its interprocedural analysis follows the handler's returns and calls the last arm always true; each case is named, so a case added to the union later is a compile error rather than a silent default.
    await (result switch {
      Registered => Send.NoContentAsync(ct),
      SubscriptionRefused refused => Refuse(refused, ct),
    });
#pragma warning restore CA1508
  }

  /// <summary>FastEndpoints' validation problem, 400, naming each refused member with its fixed reason.</summary>
  private Task<FastEndpoints.Void> Refuse(SubscriptionRefused refused, CancellationToken cancellationToken) {
    foreach (RefusedMember member in refused.Members)
      AddError(new ValidationFailure(member.Member, member.Reason));

    return Send.ErrorsAsync(cancellation: cancellationToken);
  }
}