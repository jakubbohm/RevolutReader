using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The bank's three expected failures as the API's answers (the user, 2026-11-08, roadmap C13; the case → status table in
/// docs/conventions/README.md § Backend code): access expired is a 503, rate limited a 429 and bank unavailable a 503, each
/// a problem description (RFC 9457, <c>application/problem+json</c>) with a <c>type</c> of its own, a fixed <c>title</c>
/// and no <c>detail</c> (never the bank's error text). The <c>type</c> is what names the case for the client: RFC 9457
/// makes it the problem's identifier and the title a fixed label for it, while a status alone never names one of these
/// cases (the proxies in front of the app answer with the same statuses, as that section says, and ASP.NET's default
/// <c>type</c> would be the same for both 503 cases). A read's value becomes a 200 answer carrying the endpoint's own response for it,
/// and an endpoint declares the two problem statuses in its API description. The statuses and strings are written out
/// here, never read from <see cref="BankAnswers"/>: they are the contract the client switches on. The balance is made up.
/// </summary>
public sealed class BankAnswersTests {
  private const string PROBLEM_JSON = "application/problem+json";

  private const string ACCESS_EXPIRED_TYPE = "/problems/bank-access-expired";
  private const string ACCESS_EXPIRED_TITLE = "Bank access expired";
  private const string RATE_LIMITED_TYPE = "/problems/bank-rate-limited";
  private const string RATE_LIMITED_TITLE = "Bank rate limit reached";
  private const string BANK_UNAVAILABLE_TYPE = "/problems/bank-unavailable";
  private const string BANK_UNAVAILABLE_TITLE = "Bank unavailable";

  // The reads, as the data sources name them

  private const string A_BALANCE = "a balance";
  private const string ACCESS_EXPIRED = "access expired";
  private const string RATE_LIMITED = "rate limited";
  private const string BANK_UNAVAILABLE = "bank unavailable";

  /// <summary>A made-up balance, never the account's.</summary>
  private static readonly Balance _balance = new(1234.56m, "EUR");

  // Each failure's problem, for an endpoint that answers a failure itself

  /// <summary>Only the owner can renew the access. No status fits exactly; 503 is the closest, and the client offers no retry for this type.</summary>
  [Test]
  public void Access_expired_is_a_503_problem_of_its_own_type() =>
    ShouldBeTheProblem(BankAnswers.Problem(new BankAccessExpired()), StatusCodes.Status503ServiceUnavailable, ACCESS_EXPIRED_TYPE, ACCESS_EXPIRED_TITLE);

  /// <summary>The bank's request limit is reached. The problem asks for no wait (no <c>Retry-After</c>): the failure carries no wait time.</summary>
  [Test]
  public void Rate_limited_is_a_429_problem_of_its_own_type() =>
    ShouldBeTheProblem(BankAnswers.Problem(new BankRateLimited()), StatusCodes.Status429TooManyRequests, RATE_LIMITED_TYPE, RATE_LIMITED_TITLE);

  /// <summary>The bank's own trouble: its own error or timeout, no answer in time, or no connection.</summary>
  [Test]
  public void Bank_unavailable_is_a_503_problem_of_its_own_type() =>
    ShouldBeTheProblem(BankAnswers.Problem(new BankUnavailable()), StatusCodes.Status503ServiceUnavailable, BANK_UNAVAILABLE_TYPE, BANK_UNAVAILABLE_TITLE);

  // A read's result as the answer, for an endpoint that answers the read as it came

  [Test]
  public void A_read_value_is_a_200_answer_carrying_the_endpoints_response_for_it() {
    BankResult<Balance> read = _balance;

    Results<Ok<BalanceShown>, ProblemHttpResult> answer = BankAnswers.From(read, Shown);

    Ok<BalanceShown> ok = answer.Result.ShouldBeOfType<Ok<BalanceShown>>();
    ok.StatusCode.ShouldBe(StatusCodes.Status200OK);
    ok.Value.ShouldBe(new BalanceShown(1234.56m, "EUR"));
  }

  /// <param name="failure">Each of the bank's expected failures.</param>
  /// <param name="status">The failure's status.</param>
  /// <param name="type">The failure's <c>type</c>.</param>
  /// <param name="title">The failure's <c>title</c>.</param>
  [Test]
  [Arguments(ACCESS_EXPIRED, StatusCodes.Status503ServiceUnavailable, ACCESS_EXPIRED_TYPE, ACCESS_EXPIRED_TITLE)]
  [Arguments(RATE_LIMITED, StatusCodes.Status429TooManyRequests, RATE_LIMITED_TYPE, RATE_LIMITED_TITLE)]
  [Arguments(BANK_UNAVAILABLE, StatusCodes.Status503ServiceUnavailable, BANK_UNAVAILABLE_TYPE, BANK_UNAVAILABLE_TITLE)]
  public void A_failed_read_is_that_failures_problem(string failure, int status, string type, string title) {
    Results<Ok<BalanceShown>, ProblemHttpResult> answer = BankAnswers.From(Read(failure), Shown);

    ShouldBeTheProblem(answer.Result.ShouldBeOfType<ProblemHttpResult>(), status, type, title);
  }

  /// <summary>
  /// A read whose value could be anything (<see cref="object"/>, which a failure record also is) still answers the
  /// failure's problem, never a 200 carrying the failure: a type pattern over the union tests the value it holds, so the
  /// failures must be told apart before the value.
  /// </summary>
  [Test]
  public void A_failed_read_whose_value_could_be_anything_is_still_that_failures_problem() {
    BankResult<object> read = new BankRateLimited();

    Results<Ok<string>, ProblemHttpResult> answer = BankAnswers.From(read, static _ => "a value");

    ShouldBeTheProblem(answer.Result.ShouldBeOfType<ProblemHttpResult>(), StatusCodes.Status429TooManyRequests, RATE_LIMITED_TYPE, RATE_LIMITED_TITLE);
  }

  /// <summary>
  /// A default <see cref="BankResult{T}"/> holds no case at all, which no read returns: a bug, so it throws as a switch over
  /// it does (docs/conventions/README.md § Backend code), and never becomes an answer. The exception is the one a switch
  /// expression over the union throws (checked on .NET 11 RC3, 2026-11-08, with the value's type <c>notnull</c>).
  /// </summary>
  [Test]
  public void An_empty_read_result_is_a_bug_and_throws() =>
    Should.Throw<SwitchExpressionException>(static () => BankAnswers.From(default(BankResult<Balance>), Shown));

  // Bugs in the caller

  /// <param name="read">A value and each failure: the response's builder is checked whatever the read.</param>
  [Test]
  [Arguments(A_BALANCE)]
  [Arguments(ACCESS_EXPIRED)]
  [Arguments(RATE_LIMITED)]
  [Arguments(BANK_UNAVAILABLE)]
  public void A_null_response_builder_is_rejected(string read) {
    ArgumentNullException error = Should.Throw<ArgumentNullException>(() => BankAnswers.From<Balance, BalanceShown>(Read(read), null!));

    error.ParamName.ShouldBe("toResponse");
  }

  /// <param name="failure">Each failure's own overload, given <see langword="null"/>.</param>
  [Test]
  [Arguments(ACCESS_EXPIRED)]
  [Arguments(RATE_LIMITED)]
  [Arguments(BANK_UNAVAILABLE)]
  public void A_null_failure_is_rejected(string failure) {
    Func<ProblemHttpResult> problemOfNull = failure switch {
      ACCESS_EXPIRED => static () => BankAnswers.Problem((BankAccessExpired)null!),
      RATE_LIMITED => static () => BankAnswers.Problem((BankRateLimited)null!),
      BANK_UNAVAILABLE => static () => BankAnswers.Problem((BankUnavailable)null!),
      _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known failure."),
    };

    ArgumentNullException error = Should.Throw<ArgumentNullException>(problemOfNull);

    error.ParamName.ShouldBe("failure");
  }

  [Test]
  public void A_null_endpoint_builder_is_rejected() {
    ArgumentNullException error = Should.Throw<ArgumentNullException>(static () => BankAnswers.ProducesBankProblems(null!));

    error.ParamName.ShouldBe("builder");
  }

  // The API description

  /// <summary>
  /// What the endpoint's API description declares (<see cref="IProducesResponseTypeMetadata"/>): a 429 and a 503 problem
  /// description, one 503 for both 503 cases, and nothing else. A problem result puts no status into the API description by
  /// itself, so C7a's and C7b's endpoints declare them with this, inside FastEndpoints' <c>Description(…, clearDefaults:
  /// true)</c>.
  /// </summary>
  [Test]
  public void The_bank_problems_are_declared_as_a_429_and_a_503_problem_description_and_nothing_else() {
    IList<object> metadata = MetadataDeclaredBy(static builder => builder.ProducesBankProblems());

    metadata.ShouldAllBe(item => item is IProducesResponseTypeMetadata, "nothing but response descriptions");
    metadata.OfType<IProducesResponseTypeMetadata>()
      .Select(static declared => (declared.StatusCode, declared.Type, ContentTypes: string.Join(' ', declared.ContentTypes)))
      .ShouldBe([(429, typeof(ProblemDetails), PROBLEM_JSON), (503, typeof(ProblemDetails), PROBLEM_JSON)], ignoreOrder: true);
  }

  /// <summary>A read's result: <see cref="_balance"/>, or the failure named.</summary>
  private static BankResult<Balance> Read(string outcome) => outcome switch {
    A_BALANCE => _balance,
    ACCESS_EXPIRED => new BankAccessExpired(),
    RATE_LIMITED => new BankRateLimited(),
    BANK_UNAVAILABLE => new BankUnavailable(),
    _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, "Not a known read."),
  };

  /// <summary>The made-up endpoint's response for a balance.</summary>
  private static BalanceShown Shown(Balance balance) => new(balance.Amount, balance.Currency);

  /// <summary>A problem description with this status, <c>type</c> and <c>title</c> and no <c>detail</c>, written as <c>application/problem+json</c>.</summary>
  private static void ShouldBeTheProblem(ProblemHttpResult problem, int status, string type, string title) {
    problem.StatusCode.ShouldBe(status);
    problem.ProblemDetails.Status.ShouldBe(status);
    problem.ProblemDetails.Type.ShouldBe(type);
    problem.ProblemDetails.Title.ShouldBe(title);
    problem.ProblemDetails.Detail.ShouldBeNull("never the bank's error text");
    problem.ContentType.ShouldBe(PROBLEM_JSON);
  }

  /// <summary>
  /// The metadata <paramref name="describe"/> gives an endpoint, without an app or a server: a route handler's builder over
  /// a collector of its conventions, which are then applied to an endpoint of its own, as the app applies them when it
  /// builds its endpoints.
  /// </summary>
  private static IList<object> MetadataDeclaredBy(Action<RouteHandlerBuilder> describe) {
    ConventionsCollected conventions = new();
    describe(new RouteHandlerBuilder([conventions]));

    RouteEndpointBuilder endpoint = new(requestDelegate: null, RoutePatternFactory.Parse("/api/balance"), order: 0);
    conventions.ApplyTo(endpoint);

    return endpoint.Metadata;
  }

  /// <summary>A made-up endpoint's response.</summary>
  private sealed record BalanceShown(decimal Amount, string Currency);

  /// <summary>An endpoint's conventions, collected to be applied later: first the ordinary ones, then the final ones, each in the order given.</summary>
  private sealed class ConventionsCollected : IEndpointConventionBuilder {
    private readonly List<Action<EndpointBuilder>> _conventions = [];
    private readonly List<Action<EndpointBuilder>> _finalConventions = [];

    public void Add(Action<EndpointBuilder> convention) => _conventions.Add(convention);

    public void Finally(Action<EndpointBuilder> finallyConvention) => _finalConventions.Add(finallyConvention);

    public void ApplyTo(EndpointBuilder endpoint) {
      foreach (Action<EndpointBuilder> convention in _conventions.Concat(_finalConventions))
        convention(endpoint);
    }
  }
}