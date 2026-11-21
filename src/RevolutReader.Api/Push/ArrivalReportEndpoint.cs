using FastEndpoints;
using FluentValidation.Results;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Push;

/// <summary>
/// <c>POST /api/push/arrivals</c> (spec push-arrivals, c016 design.md D3): a phone's service worker reports a push's
/// arrival, named by the read time the push's balance carried; the arrival is recorded through
/// <see cref="RecordArrivalHandler"/>, and the answer is 204. A report naming no read time (left out, or <c>null</c>) is
/// refused with 400, FastEndpoints' validation problem, whose <c>errors</c> name <c>readAt</c> with a fixed reason, and
/// nothing is recorded. No <c>AllowAnonymous</c>, so the default policy
/// <c>AllowedUser</c> applies: nobody signed in gets 401, and an account not on the allowlist 403, before the endpoint
/// runs; a write from another site is refused before it too (<c>UseCrossSiteWriteProtection</c>). The body is declared
/// with <c>Accepts</c>, which keeps it in the API description; a request without a JSON body never reaches the endpoint
/// and gets the catch-all's 404, and a read time FastEndpoints cannot bind gets its 400 problem before the endpoint runs.
/// The API description lists 204, 400, 401 and 403; the 403 is <see cref="RefusedProblem"/>, as for
/// <see cref="SubscriptionEndpoint"/>.
/// </summary>
public sealed class ArrivalReportEndpoint(RecordArrivalHandler handler) : Endpoint<ArrivalReportRequest> {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>The member a refusal names, as the report names it (D2), and its fixed reason.</summary>
  private const string READ_AT = "readAt";
  private const string MISSING = "Missing.";

  public override void Configure() {
    Post("/api/push/arrivals");
    Description(
      static endpoint => endpoint
        .Accepts<ArrivalReportRequest>(JSON)
        .Produces(StatusCodes.Status204NoContent)
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status401Unauthorized)
        .Produces<RefusedProblem>(StatusCodes.Status403Forbidden, PROBLEM_JSON),
      clearDefaults: true);
    Summary(static summary => summary.Summary = "Reports that a push reached this device, so the server records how long it took");
  }

  public override async Task HandleAsync(ArrivalReportRequest req, CancellationToken ct) {
    ArgumentNullException.ThrowIfNull(req);

    if (req.ReadAt is not DateTimeOffset readAt) {
      await RefuseWithoutReadTime(ct);

      return;
    }

    handler.Record(readAt);
    await Send.NoContentAsync(ct);
  }

  /// <summary>FastEndpoints' validation problem, 400, naming <c>readAt</c> with its fixed reason; nothing is recorded.</summary>
  private Task<FastEndpoints.Void> RefuseWithoutReadTime(CancellationToken cancellationToken) {
    AddError(new ValidationFailure(READ_AT, MISSING));

    return Send.ErrorsAsync(cancellation: cancellationToken);
  }
}