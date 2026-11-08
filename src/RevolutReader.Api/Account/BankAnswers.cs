using Microsoft.AspNetCore.Http.HttpResults;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>
/// The bank's expected failures as the API's answers (the user, 2026-11-08, roadmap C13; the case → status table in
/// docs/conventions/README.md § Backend code): each a problem description (RFC 9457, <c>application/problem+json</c>) with
/// its status, a <c>type</c> of its own and a fixed <c>title</c>. The <c>type</c> is what names the case for the client,
/// which compares it as an exact string: RFC 9457 makes it the problem's identifier and the title a fixed label for it,
/// while a status alone never names one of these cases (the proxies in front of the app answer with the same statuses when
/// it cannot be reached, as that section says, and ASP.NET Core's default <c>type</c> would be the same for both 503
/// cases). No <c>detail</c>, never the bank's error text, and no <c>Retry-After</c>: the failure records carry no wait
/// time. Each problem is built with <c>TypedResults.Problem</c>, so for a caller that accepts JSON it is written through
/// <see cref="IProblemDetailsService"/> with the trace id and the app's problem customization, as the problems ASP.NET
/// Core writes are; a caller that rules JSON out gets the same problem, still as <c>application/problem+json</c>, but
/// without either. Never with FastEndpoints' own problem details, which bypass that service. The types are
/// <see cref="BankProblem"/>'s, the shape the API description lists them in.
/// </summary>
public static class BankAnswers {
  private const string ACCESS_EXPIRED_TITLE = "Bank access expired";
  private const string RATE_LIMITED_TITLE = "Bank rate limit reached";
  private const string BANK_UNAVAILABLE_TITLE = "Bank unavailable";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>
  /// The read's value as a 200 answer carrying <paramref name="toResponse"/>'s response for it, each failure as its
  /// problem: for an endpoint that answers the read as it came, its <c>ExecuteAsync</c> returning this union of results.
  /// A read's value is never null (<c>notnull</c>), so the switch needs no null arm. The failures come first: a type pattern
  /// over the union tests the value it holds, so when a failure record is also a <typeparamref name="T"/> (as every record
  /// is an <see cref="object"/>), a value arm first would answer 200 carrying the failure. An empty result holds no case,
  /// which no read returns: a bug, so it throws <see cref="System.Runtime.CompilerServices.SwitchExpressionException"/>, as
  /// a switch over the union does (docs/conventions/README.md § Backend code), and never becomes an answer.
  /// </summary>
  public static Results<Ok<TResponse>, ProblemHttpResult> From<T, TResponse>(BankResult<T> result, Func<T, TResponse> toResponse) where T : notnull {
    ArgumentNullException.ThrowIfNull(toResponse);

    return result switch {
      BankAccessExpired failure => Problem(failure),
      BankRateLimited failure => Problem(failure),
      BankUnavailable failure => Problem(failure),
      T value => TypedResults.Ok(toResponse(value)),
    };
  }

  /// <summary>
  /// 503, <c>/problems/bank-access-expired</c>, <c>Bank access expired</c>, for an endpoint that answers a failure itself
  /// (e.g. from <c>HandleAsync</c> with <c>Send.ResultAsync</c>). Only the owner can renew the access, so no status fits
  /// exactly: 503 is the closest, though RFC 9110 makes it a temporary condition, so the client tells this case by its
  /// <c>type</c> and offers no retry for it (the user, 2026-11-08, roadmap C13).
  /// </summary>
  public static ProblemHttpResult Problem(BankAccessExpired failure) {
    ArgumentNullException.ThrowIfNull(failure);

    return TypedResults.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: ACCESS_EXPIRED_TITLE, type: BankProblem.ACCESS_EXPIRED_TYPE);
  }

  /// <summary>
  /// 429, <c>/problems/bank-rate-limited</c>, <c>Bank rate limit reached</c>, for an endpoint that answers a failure itself.
  /// No <c>Retry-After</c>: the failure carries no wait time.
  /// </summary>
  public static ProblemHttpResult Problem(BankRateLimited failure) {
    ArgumentNullException.ThrowIfNull(failure);

    return TypedResults.Problem(statusCode: StatusCodes.Status429TooManyRequests, title: RATE_LIMITED_TITLE, type: BankProblem.RATE_LIMITED_TYPE);
  }

  /// <summary>
  /// 503, <c>/problems/bank-unavailable</c>, <c>Bank unavailable</c>, for an endpoint that answers a failure itself: the
  /// bank's own error or timeout, no answer in time, or no connection. Its own <c>type</c> tells it from access expired,
  /// the other 503, and from a 503 a proxy in front of the app answers when the app cannot be reached.
  /// </summary>
  public static ProblemHttpResult Problem(BankUnavailable failure) {
    ArgumentNullException.ThrowIfNull(failure);

    return TypedResults.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: BANK_UNAVAILABLE_TITLE, type: BankProblem.BANK_UNAVAILABLE_TYPE);
  }

  /// <summary>
  /// 400 with ASP.NET Core's default <c>type</c> and <c>title</c> (<c>Bad Request</c>), for a bank read with no present
  /// user (<see cref="PresentUserFromRequest.Read"/> gave <see langword="null"/>): a request the API cannot read, answered
  /// before the bank and never with an unattended read in its place (the user, 2026-11-08, roadmap C13; ADR-0001). One
  /// answer for C7a's and C7b's endpoints, declared with the bank problems by <see cref="ProducesBankProblems"/>.
  /// </summary>
  public static ProblemHttpResult NoPresentUser() => TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest);

  /// <summary>
  /// Declares the bank problems in the endpoint's API description (<c>application/problem+json</c>): a 400 problem
  /// description (<see cref="NoPresentUser"/>), and a 429 and a 503 <see cref="BankProblem"/>, whose <c>type</c> lists the
  /// bank types, one 503 for both 503 cases. A problem result puts no status into the API description by itself, while an
  /// <see cref="Ok{TValue}"/> does, so C7a's and C7b's endpoints declare the same statuses with this, inside FastEndpoints'
  /// <c>Description(…, clearDefaults: true)</c>, as <see cref="SignIn.MeEndpoint"/> declares its own.
  /// </summary>
  public static RouteHandlerBuilder ProducesBankProblems(this RouteHandlerBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    return builder
      .ProducesProblem(StatusCodes.Status400BadRequest)
      .Produces<BankProblem>(StatusCodes.Status429TooManyRequests, PROBLEM_JSON)
      .Produces<BankProblem>(StatusCodes.Status503ServiceUnavailable, PROBLEM_JSON);
  }
}