using FastEndpoints;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Account;

/// <summary>
/// <c>GET /api/transactions/older?before=yyyy-MM-dd</c> (spec account-transactions, c010 design.md D1, D10): an older page
/// of the kept transactions, from storage only, so no present user and no bank problem. No <c>AllowAnonymous</c>, so the
/// default policy <c>AllowedUser</c> applies: nobody signed in gets 401, and an account not on the allowlist 403, before
/// the endpoint runs.
/// <list type="bullet">
/// <item><c>before</c> is required and a calendar date: a request without it, or with anything else, is one FastEndpoints
/// cannot bind, so it answers 400 with a problem description (spec api-errors), and the handler is never called.</item>
/// <item>Otherwise <see cref="ReadOlderTransactionsHandler"/>'s page as 200 <see cref="TransactionPageResponse"/>, the
/// same answer as the newest page's.</item>
/// <item>An exception (the store failing, a row it cannot read) is not caught here: it is the 500.</item>
/// </list>
/// The API description lists 200, 400, 401, 403 and 500; the 403 is <see cref="RefusedProblem"/>, as for
/// <see cref="MeEndpoint"/>.
/// </summary>
public sealed class OlderTransactionsEndpoint(ReadOlderTransactionsHandler handler) : Endpoint<OlderTransactionsRequest, TransactionPageResponse> {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  public override void Configure() {
    Get("/api/transactions/older");
    Description(
      static endpoint => endpoint
        .Produces<TransactionPageResponse>(StatusCodes.Status200OK, JSON)
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status401Unauthorized)
        .Produces<RefusedProblem>(StatusCodes.Status403Forbidden, PROBLEM_JSON)
        .ProducesProblem(StatusCodes.Status500InternalServerError),
      clearDefaults: true);
    Summary(static summary => {
      summary.Summary = "Older transactions, from storage, in pages of whole days";
      summary.Params[nameof(OlderTransactionsRequest.Before)] = "The day before which the page's transactions are dated, as yyyy-MM-dd: the olderBefore of the page before it";
    });
  }

  public override async Task HandleAsync(OlderTransactionsRequest req, CancellationToken ct) {
    ArgumentNullException.ThrowIfNull(req);

    await Send.ResultAsync(TypedResults.Ok(TransactionPageResponse.Of(await handler.Handle(req.Before, ct))));
  }
}