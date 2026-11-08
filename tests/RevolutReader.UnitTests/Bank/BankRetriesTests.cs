using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Polly;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// Which failed attempt of a bank request is tried again (spec bank-reads § Retrying a failed request; c008 design.md D2,
/// D5, D8): only a request of a present user's read, and only when the attempt failed in a way that reads as bank
/// unavailable, the error answer read as the client reads it (c006 design.md D3, D7). A <c>Retry-After</c> wait is
/// followed only when it ends before the request's deadline. The requests are marked as the client marks them: the
/// present-user mark, and the deadline, production's 15 s request timeout from <see cref="_now"/> unless a test says
/// otherwise.
/// <para>
/// The error answers have the shape of Enable Banking's captured error answers
/// (<c>spikes/enable-banking-mock/evidence/2026-11-04-error-responses.json</c>: <c>{ code, message, error, detail }</c>);
/// the codes the Mock ASPSP cannot produce (the bank's own error, its rate limit, an expired session) and the statuses
/// that come with them are written from the API reference, as the reference does not pair codes with statuses. Messages,
/// pages and texts are made up.
/// </para>
/// </summary>
public sealed class BankRetriesTests {
  // Descriptions of the cases, as the data sources name them

  private const string NO_BODY = "no body";
  private const string GATEWAY_PAGE = "a gateway's maintenance page";
  private const string NO_ERROR_VALUE = "an error answer whose error value is null";
  private const string ERROR_VALUE_OF_ANOTHER_SHAPE = "an error answer whose error value is not of the code shape";
  private const string PLAIN_TEXT = "plain text";

  private const string CANNOT_BE_REACHED = "the bank cannot be reached";
  private const string BROKE_WHILE_THE_ANSWER_CAME_IN = "the connection broke while the answer came in";

  private const string BALANCES = "a balances answer";
  private const string UNREADABLE_SUCCESS = "a success answer the client cannot read";
  private const string NO_CONTENT = "a success answer without content";

  private const string CALLER_CANCELLED = "the caller cancelled";
  private const string REQUEST_TIMEOUT_RAN_OUT = "the request timeout ran out";

  private const string NO_REQUEST = "no request";
  private const string NO_MARK = "a request without the present-user mark";
  private const string MARKED_FALSE = "a request marked as not a present user's";

  private const string OWN_ERROR = "the bank's own error";
  private const string GATEWAY_503 = "a gateway's 503 page";
  private const string NETWORK_FAILURE = "a network failure";
  private const string TIMEOUT_408 = "a 408 without a code";

  private const string RATE_LIMIT_CODE = "ASPSP_RATE_LIMIT_EXCEEDED";

  /// <summary>When the rule is asked: a whole second, so an HTTP date (whole seconds) can name it and the deadline exactly.</summary>
  private static readonly DateTimeOffset _now = new(2026, 11, 8, 13, 0, 0, TimeSpan.Zero);

  /// <summary>Production's request timeout (<c>EnableBanking:RequestTimeout</c>), so a request's deadline by default.</summary>
  private static readonly TimeSpan _requestTimeout = TimeSpan.FromSeconds(15);

  // 2.1 – 2.3: retried

  /// <param name="errorCode">The bank's own error, or its own timeout.</param>
  /// <param name="status"><c>502</c> and <c>503</c>, as the bank plausibly sends these codes; <c>500</c>; <c>422</c>, which without the code would not be retried.</param>
  [Test, MatrixDataSource]
  public async Task A_present_users_request_answered_with_the_banks_own_error_is_retried(
    [Matrix("ASPSP_ERROR", "ASPSP_TIMEOUT")] string errorCode,
    [Matrix(HttpStatusCode.BadGateway, HttpStatusCode.ServiceUnavailable, HttpStatusCode.InternalServerError, HttpStatusCode.UnprocessableEntity)] HttpStatusCode status) {
    using HttpRequestMessage request = PresentUsersRequest();
    using HttpResponseMessage answer = ErrorAnswer(status, errorCode);

    (await ShouldRetry(request, Outcome.FromResult(answer))).ShouldBeTrue();
  }

  /// <param name="status">Server errors across the 5xx range, including one with no name, and 408.</param>
  /// <param name="body">
  /// Every way an answer carries no Enable Banking code (c006 design.md D3, D7): no body, a gateway's HTML page, plain text,
  /// an error answer whose <c>error</c> is <c>null</c>, or whose <c>error</c> is a text not of the code shape (never a code).
  /// </param>
  [Test, MatrixDataSource]
  public async Task A_present_users_request_answered_with_a_5xx_or_408_without_an_Enable_Banking_code_is_retried(
    [Matrix(HttpStatusCode.InternalServerError, HttpStatusCode.BadGateway, HttpStatusCode.ServiceUnavailable, HttpStatusCode.GatewayTimeout, (HttpStatusCode)599, HttpStatusCode.RequestTimeout)] HttpStatusCode status,
    [Matrix(NO_BODY, GATEWAY_PAGE, PLAIN_TEXT, NO_ERROR_VALUE, ERROR_VALUE_OF_ANOTHER_SHAPE)] string body) {
    using HttpRequestMessage request = PresentUsersRequest();
    using HttpResponseMessage answer = AnswerWithoutCode(status, body);

    (await ShouldRetry(request, Outcome.FromResult(answer))).ShouldBeTrue();
  }

  /// <param name="failure">
  /// Nothing answered, or the answer started and the connection broke while its body came in, as <c>HttpClient</c> reports
  /// it when it reads the body (c008 design.md D6).
  /// </param>
  [Test]
  [Arguments(CANNOT_BE_REACHED)]
  [Arguments(BROKE_WHILE_THE_ANSWER_CAME_IN)]
  public async Task A_present_users_request_that_failed_with_a_network_failure_is_retried(string failure) {
    using HttpRequestMessage request = PresentUsersRequest();

    (await ShouldRetry(request, Outcome.FromException<HttpResponseMessage>(NetworkFailure(failure)))).ShouldBeTrue();
  }

  // 2.4 – 2.8: not retried

  /// <param name="status">429, as the bank sends its rate limit; with the rate-limit code also statuses that without it would be retried (<c>503</c>, <c>500</c>) or not (<c>422</c>).</param>
  /// <param name="errorCode">None, or the rate-limit code.</param>
  /// <param name="retryAfterSeconds">A wait the answer asks for, well before the deadline: it never makes a rate limit retried.</param>
  [Test]
  [Arguments(HttpStatusCode.TooManyRequests, null, null)]
  [Arguments(HttpStatusCode.TooManyRequests, null, 1)]
  [Arguments(HttpStatusCode.TooManyRequests, RATE_LIMIT_CODE, null)]
  [Arguments(HttpStatusCode.TooManyRequests, RATE_LIMIT_CODE, 1)]
  [Arguments(HttpStatusCode.ServiceUnavailable, RATE_LIMIT_CODE, null)]
  [Arguments(HttpStatusCode.InternalServerError, RATE_LIMIT_CODE, null)]
  [Arguments(HttpStatusCode.UnprocessableEntity, RATE_LIMIT_CODE, null)]
  public async Task A_present_users_request_answered_as_rate_limited_is_not_retried(HttpStatusCode status, string? errorCode, int? retryAfterSeconds) {
    using HttpRequestMessage request = PresentUsersRequest();
    using HttpResponseMessage answer = ErrorAnswer(status, errorCode);

    if (retryAfterSeconds is { } seconds)
      answer.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(seconds));

    (await ShouldRetry(request, Outcome.FromResult(answer))).ShouldBeFalse();
  }

  /// <param name="errorCode">Every code the client reads as access expired (c004 design.md D4).</param>
  /// <param name="status"><c>422</c>, as the bank plausibly sends these codes; <c>401</c>; <c>503</c>, which without the code would be retried.</param>
  [Test, MatrixDataSource]
  public async Task A_present_users_request_answered_with_an_access_expired_code_is_not_retried(
    [Matrix("EXPIRED_SESSION", "REVOKED_SESSION", "CLOSED_SESSION", "SESSION_DOES_NOT_EXIST", "ASPSP_PSU_ACTION_REQUIRED", "NO_ACCOUNTS_ADDED", "ASPSP_ACCOUNT_NOT_ACCESSIBLE")] string errorCode,
    [Matrix(HttpStatusCode.UnprocessableEntity, HttpStatusCode.Unauthorized, HttpStatusCode.ServiceUnavailable)] HttpStatusCode status) {
    using HttpRequestMessage request = PresentUsersRequest();
    using HttpResponseMessage answer = ErrorAnswer(status, errorCode);

    (await ShouldRetry(request, Outcome.FromResult(answer))).ShouldBeFalse();
  }

  /// <param name="status">A client error (4xx other than 408 and 429), or a server error with a code the client does not know.</param>
  /// <param name="errorCode">See <see cref="OtherErrors"/>.</param>
  [Test]
  [MethodDataSource(nameof(OtherErrors))]
  public async Task A_present_users_request_answered_with_any_other_error_is_not_retried(HttpStatusCode status, string? errorCode) {
    using HttpRequestMessage request = PresentUsersRequest();
    using HttpResponseMessage answer = ErrorAnswer(status, errorCode);

    (await ShouldRetry(request, Outcome.FromResult(answer))).ShouldBeFalse();
  }

  /// <param name="success">An answer the client reads, one it cannot read (an error later, never a reason to ask again), and one without content.</param>
  [Test]
  [Arguments(BALANCES)]
  [Arguments(UNREADABLE_SUCCESS)]
  [Arguments(NO_CONTENT)]
  public async Task A_success_answer_is_not_retried(string success) {
    using HttpRequestMessage request = PresentUsersRequest();
    using HttpResponseMessage answer = SuccessAnswer(success);

    (await ShouldRetry(request, Outcome.FromResult(answer))).ShouldBeFalse();
  }

  /// <param name="cancellation">The caller's own cancellation, or <c>HttpClient</c>'s timeout running out, as it reports it.</param>
  [Test]
  [Arguments(CALLER_CANCELLED)]
  [Arguments(REQUEST_TIMEOUT_RAN_OUT)]
  public async Task A_cancelled_attempt_is_not_retried(string cancellation) {
    using HttpRequestMessage request = PresentUsersRequest();

    (await ShouldRetry(request, Outcome.FromException<HttpResponseMessage>(Cancellation(cancellation)))).ShouldBeFalse();
  }

  // 2.9: only a present user's requests

  /// <param name="mark">No request at all, a request without the mark, or one marked false: each carries a deadline, as the client marks every request.</param>
  /// <param name="failure">Failures that a present user's request is retried after.</param>
  [Test, MatrixDataSource]
  public async Task A_request_without_the_present_user_mark_or_marked_false_is_never_retried(
    [Matrix(NO_REQUEST, NO_MARK, MARKED_FALSE)] string mark,
    [Matrix(OWN_ERROR, GATEWAY_503, NETWORK_FAILURE, TIMEOUT_408)] string failure) {
    using HttpRequestMessage? request = mark switch {
      NO_REQUEST => null,
      NO_MARK => Request(presentUser: null, Deadline()),
      MARKED_FALSE => Request(presentUser: false, Deadline()),
      _ => throw new ArgumentOutOfRangeException(nameof(mark), mark, "Not a known case."),
    };
    using HttpResponseMessage? answer = failure switch {
      OWN_ERROR => ErrorAnswer(HttpStatusCode.BadGateway, "ASPSP_ERROR"),
      GATEWAY_503 => AnswerWithoutCode(HttpStatusCode.ServiceUnavailable, GATEWAY_PAGE),
      TIMEOUT_408 => AnswerWithoutCode(HttpStatusCode.RequestTimeout, NO_BODY),
      NETWORK_FAILURE => null,
      _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known case."),
    };
    Outcome<HttpResponseMessage> outcome = answer is null ? Outcome.FromException<HttpResponseMessage>(NetworkFailure(CANNOT_BE_REACHED)) : Outcome.FromResult(answer);

    (await ShouldRetry(request, outcome)).ShouldBeFalse();
  }

  // 2.10: a Retry-After wait is followed only while it ends before the deadline (D8)

  /// <param name="retryAfter">The <c>Retry-After</c> header as sent: seconds, or an HTTP date (<see cref="_now"/> is 13:00:00).</param>
  /// <param name="secondsLeft">The time from <see cref="_now"/> to the request's deadline: the whole 15 s, or 10 s after earlier attempts took 5 s.</param>
  /// <remarks>
  /// A wait that ends exactly at the deadline is not retried: the retry would be sent as the request timeout runs out, so it
  /// could never be answered, and the wait would be for nothing (D8: "never a wait for nothing").
  /// </remarks>
  [Test]
  [Arguments("60", 15)]
  [Arguments("16", 15)]
  [Arguments("15", 15)]
  [Arguments("12", 10)]
  [Arguments("Sun, 08 Nov 2026 13:01:00 GMT", 15)]
  [Arguments("Sun, 08 Nov 2026 13:00:15 GMT", 15)]
  public async Task A_retryable_answer_whose_Retry_After_wait_would_end_after_the_requests_deadline_is_not_retried(string retryAfter, int secondsLeft) {
    using HttpRequestMessage request = Request(presentUser: true, _now.AddSeconds(secondsLeft));
    using HttpResponseMessage answer = AnswerWithoutCode(HttpStatusCode.ServiceUnavailable, GATEWAY_PAGE);
    answer.Headers.RetryAfter = RetryConditionHeaderValue.Parse(retryAfter);

    (await ShouldRetry(request, Outcome.FromResult(answer))).ShouldBeFalse();
  }

  /// <param name="retryAfter">The <c>Retry-After</c> header as sent: seconds, or an HTTP date (<see cref="_now"/> is 13:00:00).</param>
  /// <param name="secondsLeft">The time from <see cref="_now"/> to the request's deadline: the whole 15 s, or 10 s after earlier attempts took 5 s.</param>
  [Test]
  [Arguments("1", 15)]
  [Arguments("14", 15)]
  [Arguments("9", 10)]
  [Arguments("Sun, 08 Nov 2026 13:00:05 GMT", 15)]
  public async Task A_retryable_answer_whose_Retry_After_wait_ends_before_the_requests_deadline_is_retried(string retryAfter, int secondsLeft) {
    using HttpRequestMessage request = Request(presentUser: true, _now.AddSeconds(secondsLeft));
    using HttpResponseMessage answer = AnswerWithoutCode(HttpStatusCode.ServiceUnavailable, GATEWAY_PAGE);
    answer.Headers.RetryAfter = RetryConditionHeaderValue.Parse(retryAfter);

    (await ShouldRetry(request, Outcome.FromResult(answer))).ShouldBeTrue();
  }

  /// <param name="retryAfter">A short wait, as seconds or as an HTTP date (<see cref="_now"/> is 13:00:00): with no deadline, no wait can be checked against it.</param>
  [Test]
  [Arguments("1")]
  [Arguments("Sun, 08 Nov 2026 13:00:01 GMT")]
  public async Task A_Retry_After_on_a_request_without_a_deadline_is_not_retried(string retryAfter) {
    using HttpRequestMessage request = Request(presentUser: true, deadline: null);
    using HttpResponseMessage answer = AnswerWithoutCode(HttpStatusCode.ServiceUnavailable, GATEWAY_PAGE);
    answer.Headers.RetryAfter = RetryConditionHeaderValue.Parse(retryAfter);

    (await ShouldRetry(request, Outcome.FromResult(answer))).ShouldBeFalse();
  }

  /// <summary>
  /// For <see cref="A_present_users_request_answered_with_any_other_error_is_not_retried"/>: client errors other than 408
  /// and 429 without a code and with codes the client reads as unexpected (two of them captured from the Mock ASPSP with
  /// these statuses), and server errors with a code of the code shape that the client does not know.
  /// </summary>
  public static IEnumerable<(HttpStatusCode Status, string? ErrorCode)> OtherErrors() {
    HttpStatusCode[] clientErrors = [HttpStatusCode.BadRequest, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound, HttpStatusCode.UnprocessableEntity];

    foreach (HttpStatusCode status in clientErrors) {
      yield return (status, null);
      yield return (status, "UNAUTHORIZED_ACCESS");
      yield return (status, "NOT_A_CODE_ENABLE_BANKING_DEFINES");
    }

    yield return (HttpStatusCode.UnprocessableEntity, "WRONG_REQUEST_PARAMETERS");
    yield return (HttpStatusCode.NotFound, "ACCOUNT_DOES_NOT_EXIST");

    HttpStatusCode[] serverErrors = [HttpStatusCode.InternalServerError, HttpStatusCode.BadGateway, HttpStatusCode.ServiceUnavailable];

    foreach (HttpStatusCode status in serverErrors) {
      yield return (status, "NOT_A_CODE_ENABLE_BANKING_DEFINES");
      yield return (status, "WRONG_REQUEST_PARAMETERS");
      yield return (status, "ACCESS_DENIED");
    }
  }

  private static ValueTask<bool> ShouldRetry(HttpRequestMessage? request, Outcome<HttpResponseMessage> outcome) =>
    BankRetries.ShouldRetry(request, outcome, _now, CancellationToken.None);

  /// <summary>The request's deadline as the client sets it when the request starts at <see cref="_now"/>.</summary>
  private static DateTimeOffset Deadline() => _now + _requestTimeout;

  /// <summary>A request of a present user's read, marked as the client marks it, with its deadline.</summary>
  private static HttpRequestMessage PresentUsersRequest() => Request(presentUser: true, Deadline());

  /// <summary>
  /// A balance read's request, made up. <paramref name="presentUser"/>: the present-user mark's value, none when
  /// <see langword="null"/>; <paramref name="deadline"/>: the deadline mark, none when <see langword="null"/>.
  /// </summary>
  private static HttpRequestMessage Request(bool? presentUser, DateTimeOffset? deadline) {
    HttpRequestMessage request = new(HttpMethod.Get, new Uri("accounts/c008-made-up-account/balances", UriKind.Relative));

    if (presentUser is { } isPresentUser)
      request.Options.Set(BankRetries.PresentUser, isPresentUser);

    if (deadline is { } at)
      request.Options.Set(BankRetries.Deadline, at);

    return request;
  }

  /// <summary>An Enable Banking error answer with this status and this <c>error</c> value (<see langword="null"/>: a JSON <c>null</c>).</summary>
  private static HttpResponseMessage ErrorAnswer(HttpStatusCode status, string? errorCode) =>
    Answer(status, ErrorBody(status, JsonSerializer.Serialize(errorCode)), "application/json");

  /// <summary>An answer with this status that carries no Enable Banking code, in the way <paramref name="body"/> names.</summary>
  private static HttpResponseMessage AnswerWithoutCode(HttpStatusCode status, string body) => body switch {
    NO_BODY => new HttpResponseMessage(status),
    GATEWAY_PAGE => Answer(status, """
      <!DOCTYPE html>
      <html>
      <head><title>Service Temporarily Unavailable</title></head>
      <body><h1>Service Temporarily Unavailable</h1><p>The service is down for maintenance. Please try again later.</p></body>
      </html>
      """, "text/html"),
    PLAIN_TEXT => Answer(status, "Service Unavailable", "text/plain"),
    NO_ERROR_VALUE => Answer(status, ErrorBody(status, errorValueJson: "null"), "application/json"),
    ERROR_VALUE_OF_ANOTHER_SHAPE => Answer(status, ErrorBody(status, JsonSerializer.Serialize("Service temporarily unavailable, try again")), "application/json"),
    _ => throw new ArgumentOutOfRangeException(nameof(body), body, "Not a known case."),
  };

  /// <summary>A 2xx answer, in the way <paramref name="success"/> names.</summary>
  private static HttpResponseMessage SuccessAnswer(string success) => success switch {
    BALANCES => Answer(HttpStatusCode.OK, """
      {
        "balances": [
          {
            "name": "Available balance calculated in the course of the business day",
            "balance_amount": { "currency": "EUR", "amount": "1234.56" },
            "balance_type": "ITAV",
            "last_change_date_time": null,
            "reference_date": "2026-11-06",
            "last_committed_transaction": null
          }
        ]
      }
      """, "application/json"),
    UNREADABLE_SUCCESS => Answer(HttpStatusCode.OK, "{ \"balances\": [", "application/json"),
    NO_CONTENT => new HttpResponseMessage(HttpStatusCode.NoContent),
    _ => throw new ArgumentOutOfRangeException(nameof(success), success, "Not a known case."),
  };

  /// <summary>A network failure as <c>HttpClient</c> reports it, in the way <paramref name="failure"/> names (messages as .NET writes them).</summary>
  private static HttpRequestException NetworkFailure(string failure) => failure switch {
    CANNOT_BE_REACHED => new HttpRequestException(HttpRequestError.ConnectionError, "No connection could be made because the target machine actively refused it."),
    BROKE_WHILE_THE_ANSWER_CAME_IN => new HttpRequestException(
      "Error while copying content to a stream.",
      new HttpIOException(HttpRequestError.ResponseEnded, "The response ended prematurely.")),
    _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known case."),
  };

  /// <summary>A cancellation as the attempt reports it, in the way <paramref name="cancellation"/> names.</summary>
  private static OperationCanceledException Cancellation(string cancellation) => cancellation switch {
    CALLER_CANCELLED => new OperationCanceledException(new CancellationToken(canceled: true)),
    REQUEST_TIMEOUT_RAN_OUT => new TaskCanceledException(
      "The request was canceled due to the configured HttpClient.Timeout of 15 seconds elapsing.",
      new TimeoutException("The operation was canceled.")),
    _ => throw new ArgumentOutOfRangeException(nameof(cancellation), cancellation, "Not a known case."),
  };

  /// <summary>The captured error answers' shape, with this status as <c>code</c> and this JSON as <c>error</c>; the message is made up.</summary>
  private static string ErrorBody(HttpStatusCode status, string errorValueJson) => $$"""
    {
      "code": {{(int)status}},
      "message": "A made-up message",
      "error": {{errorValueJson}},
      "detail": null
    }
    """;

  private static HttpResponseMessage Answer(HttpStatusCode status, string body, string mediaType) =>
    new(status) { Content = new StringContent(body, Encoding.UTF8, mediaType) };
}