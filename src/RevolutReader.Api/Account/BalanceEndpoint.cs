using FastEndpoints;
using RevolutReader.Api.Bank;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Account;

/// <summary>
/// <c>GET /api/balance</c> (spec account-balance, c009 design.md D1): the balance, read at the bank for the present user.
/// No <c>AllowAnonymous</c>, so the default policy <c>AllowedUser</c> applies: nobody signed in gets 401, and an account
/// not on the allowlist 403, before the endpoint runs.
/// <list type="bullet">
/// <item>No present user (<see cref="PresentUserFromRequest.Read"/> gives <see langword="null"/>): C13's 400,
/// <see cref="BankAnswers.NoPresentUser"/>, and the handler is never called, so nothing is read at the bank, and never
/// unattended in its place (ADR-0001).</item>
/// <item>Otherwise <see cref="ReadBalanceHandler"/>'s result through <see cref="BankAnswers.From"/>: the balance as
/// 200 <see cref="BalanceResponse"/>, a bank failure as C13's problem description.</item>
/// <item>An exception (a balance not in euros, an answer the bank adapter cannot read) is not caught here: it is the
/// 500.</item>
/// </list>
/// The API description lists 200, 401, 403 and 500, and C13's <see cref="BankAnswers.ProducesBankProblems"/> the 400,
/// 429 and 503; the 403 is <see cref="RefusedProblem"/>, as for <see cref="MeEndpoint"/>, since the refusal names the
/// account here too.
/// </summary>
public sealed class BalanceEndpoint(ReadBalanceHandler handler) : EndpointWithoutRequest<BalanceResponse> {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  public override void Configure() {
    Get("/api/balance");
    Description(
      static endpoint => endpoint
        .Produces<BalanceResponse>(StatusCodes.Status200OK, JSON)
        .ProducesProblem(StatusCodes.Status401Unauthorized)
        .Produces<RefusedProblem>(StatusCodes.Status403Forbidden, PROBLEM_JSON)
        .ProducesProblem(StatusCodes.Status500InternalServerError)
        .ProducesBankProblems(),
      clearDefaults: true);
    Summary(static summary => summary.Summary = "The account's balance, read at the bank");
  }

  public override async Task HandleAsync(CancellationToken ct) => await Send.ResultAsync(await Answer(ct));

  /// <summary>The answer, as the class describes it.</summary>
  private async Task<IResult> Answer(CancellationToken cancellationToken) {
    PresentUser? user = PresentUserFromRequest.Read(HttpContext);

    if (user is null)
      return BankAnswers.NoPresentUser();

    return BankAnswers.From(await handler.Handle(user, cancellationToken), ToResponse);
  }

  private static BalanceResponse ToResponse(AccountBalance balance) => new(balance.Amount, balance.ReadAt, balance.CzkPerEur);
}