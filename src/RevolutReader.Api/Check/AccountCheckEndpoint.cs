using FastEndpoints;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Push;

namespace RevolutReader.Api.Check;

/// <summary>
/// <c>POST /api/account/check</c> (spec account-check, c014 design.md D6–D8, D11): the account check the owner's iPhone
/// Shortcut calls, for anyone holding the check key, a key of its own, never the message key. Anonymous, on the checked
/// list of anonymous endpoints, and kept out of the API description; it binds nothing (a body is ignored), so nothing is
/// read before the key is checked.
/// <list type="bullet">
/// <item>The key first (<see cref="MessageKeyCheck"/> on <see cref="KEY_HEADER"/> against
/// <see cref="AccountCheckOptions.Key"/>): a missing, repeated or wrong key answers a 404 with no body, which
/// <c>UseStatusCodePages</c> fills in exactly as for an unknown <c>/api</c> address, so nothing is read at the bank.</item>
/// <item>Then the present user (D7): the bank read is the phone's, with the request's address and browser name, as
/// <c>GET /api/balance</c> reads them (<see cref="PresentUserFromRequest.Read"/>). A request missing either answers
/// <see cref="BankAnswers.NoPresentUser"/>'s 400, and nothing is read at the bank.</item>
/// <item>Then the check, through <see cref="AccountCheckQueue"/>, which runs it on the app's lifetime, never this request's
/// (D8): the request only waits for it, on its own token. Its result as <see cref="BankAnswers.From"/> answers it (D11):
/// 200 <see cref="AccountCheckResponse"/>, or the bank's 503 and 429 problems, as <c>GET /api/balance</c> answers them.</item>
/// <item>A check that threw answers C7a's 500 problem description, with nothing about the failure (spec api-errors), also
/// when its caller is leaving at that moment; the queue has logged it already (<see cref="CheckLog.CheckFailed"/>, D15),
/// so it is never left to the exception handler, which would log it again. A caller that left gets nothing: its wait ends
/// with its token, and only that cancellation of its own passes on.</item>
/// </list>
/// The Shortcut's request carries neither <c>Sec-Fetch-Site</c> nor <c>Origin</c>, so the cross-site rule lets it through.
/// </summary>
public sealed class AccountCheckEndpoint(AccountCheckQueue queue, IOptions<AccountCheckOptions> options) : EndpointWithoutRequest {
  /// <summary>The request header the check key travels in (D6).</summary>
  public const string KEY_HEADER = "X-Check-Key";

  public override void Configure() {
    Post("/api/account/check");
    AllowAnonymous();
    Description(static endpoint => endpoint.ExcludeFromDescription());
  }

  public override async Task HandleAsync(CancellationToken ct) {
    if (!MessageKeyCheck.Matches(HttpContext.Request.Headers[KEY_HEADER], options.Value.Key)) {
      await Send.ResultAsync(TypedResults.NotFound());

      return;
    }

    PresentUser? user = PresentUserFromRequest.Read(HttpContext);

    if (user is null) {
      await Send.ResultAsync(BankAnswers.NoPresentUser());

      return;
    }

    BankResult<CheckOutcome> result;

    try {
      result = await queue.Check(user).WaitAsync(ct);
    }
#pragma warning disable CA1031 // Every failure of a check, of whatever type, answers the same 500 (D11): the queue has logged it, and the exception handler would log it again. Only the caller's own cancellation passes.
    catch (Exception exception) when (exception is not OperationCanceledException || !ct.IsCancellationRequested) {
      await Send.ResultAsync(TypedResults.Problem(statusCode: StatusCodes.Status500InternalServerError));

      return;
    }
#pragma warning restore CA1031

    await Send.ResultAsync(BankAnswers.From(result, static outcome => new AccountCheckResponse(outcome.Changed)));
  }
}