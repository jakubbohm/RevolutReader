using Microsoft.AspNetCore.Http.HttpResults;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>
/// The bank's expected failures as the API's answers (the user, 2026-11-08, roadmap C13; the case → status table in
/// docs/conventions/README.md § Backend code): each a problem description with a status, a <c>type</c> of its own and a
/// fixed <c>title</c>, and no <c>detail</c>.
/// </summary>
public static class BankAnswers {
  /// <summary>
  /// The read's value as a 200 answer carrying <paramref name="toResponse"/>'s response for it; each failure as its problem.
  /// A read's value is never null (<c>notnull</c>), so a switch over the result needs no null arm, and an empty result, a
  /// bug, throws <see cref="System.Runtime.CompilerServices.SwitchExpressionException"/>.
  /// </summary>
  public static Results<Ok<TResponse>, ProblemHttpResult> From<T, TResponse>(BankResult<T> result, Func<T, TResponse> toResponse) where T : notnull =>
    throw new NotImplementedException();

  /// <summary>503, <c>/problems/bank-access-expired</c>, <c>Bank access expired</c>.</summary>
  public static ProblemHttpResult Problem(BankAccessExpired failure) => throw new NotImplementedException();

  /// <summary>429, <c>/problems/bank-rate-limited</c>, <c>Bank rate limit reached</c>.</summary>
  public static ProblemHttpResult Problem(BankRateLimited failure) => throw new NotImplementedException();

  /// <summary>503, <c>/problems/bank-unavailable</c>, <c>Bank unavailable</c>.</summary>
  public static ProblemHttpResult Problem(BankUnavailable failure) => throw new NotImplementedException();

  /// <summary>Declares the bank problems, a 429 and a 503 problem description, in the endpoint's API description.</summary>
  public static RouteHandlerBuilder ProducesBankProblems(this RouteHandlerBuilder builder) => throw new NotImplementedException();
}