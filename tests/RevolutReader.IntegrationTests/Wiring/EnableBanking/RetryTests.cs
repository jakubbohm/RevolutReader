using System.Net;
using Microsoft.Extensions.Logging;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// The bank client's retries on its production wiring (c008 design.md D2, D3, D5, D6): a present user's request whose
/// answer reads as the bank unavailable, or breaks while it comes in, is sent again, up to three times, and the read gets
/// the next answer; a transactions read retries only the failed page, with the same key and user headers; one answered as
/// rate limited or as access expired, and any unattended one, is sent once. No wait between the attempts
/// (<see cref="BankOnWireMock.DefaultRetryDelay"/>).
/// <para>
/// The error answers are written from the API reference (<c>ErrorResponse</c>, <c>{ code, message, error, detail }</c>), not
/// captured: the Mock ASPSP cannot fail, time out, reach its limit or expire a session on demand. The reference does not
/// pair codes with statuses; as the acceptance driver chose them: 429 for the rate limit, 422 for an expired session, and
/// 502 for the bank's own error, here also its own timeout. Messages, the gateway page, the balance, the pages' keys and
/// the user's address and browser are made up.
/// </para>
/// </summary>
public sealed class RetryTests {
  private const string GATEWAY_503 = "a gateway's 503 page";
  private const string BANKS_OWN_ERROR = "the bank's own error (ASPSP_ERROR)";
  private const string BANKS_OWN_TIMEOUT = "the bank's own timeout (ASPSP_TIMEOUT)";
  private const string RATE_LIMITED = "rate limited (ASPSP_RATE_LIMIT_EXCEEDED)";
  private const string EXPIRED_SESSION = "an expired session (EXPIRED_SESSION)";

  /// <summary>A balances answer the read accepts, with a made-up balance.</summary>
  private const string READABLE_BALANCES = """{ "balances": [{ "balance_amount": { "currency": "EUR", "amount": "1234.56" }, "balance_type": "ITAV" }] }""";

  private const string USER_IP_ADDRESS = "203.0.113.24";
  private const string USER_AGENT = "Mozilla/5.0 (RevolutReader c008 retry test; made up)";

  private static readonly DateOnly _november1 = new(2026, 11, 1);

  /// <summary>Made up: a user at a documentation address (RFC 5737) with a made-up browser.</summary>
  private static readonly PresentUser _presentUser = new(IPAddress.Parse(USER_IP_ADDRESS), USER_AGENT);

  /// <summary>The user headers every request of <see cref="_presentUser"/>'s read carries, as <see cref="ReceivedRequest.UserHeaders"/> lists them.</summary>
  private static readonly string[] _presentUsersHeaders = [$"Psu-Ip-Address: {USER_IP_ADDRESS}", $"Psu-User-Agent: {USER_AGENT}"];

  /// <param name="firstAnswer">Answers that read as the bank unavailable: a 503 without a code, and the bank's own timeout.</param>
  [Test]
  [Arguments(GATEWAY_503)]
  [Arguments(BANKS_OWN_TIMEOUT)]
  public async Task A_present_users_balance_read_whose_first_answer_reads_as_bank_unavailable_is_read_with_2_requests(string firstAnswer) {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.OK, READABLE_BALANCES);
    (HttpStatusCode status, string body, string contentType) = Answer(firstAnswer);
    bank.AnswersTheFirstRequest(status, body, contentType);

    BankResult<Balance> result = await bank.Account.ReadBalance(_presentUser, CancellationToken.None);

    result.Value.ShouldBe(new Balance(1234.56m, "EUR"));
    bank.RequestsReceived.ShouldBe(2);
  }

  /// <param name="answer">Answers a request is never sent again after, whatever the status: rate limited and access expired.</param>
  [Test]
  [Arguments(RATE_LIMITED)]
  [Arguments(EXPIRED_SESSION)]
  public async Task A_present_users_balance_read_answered_as_rate_limited_or_access_expired_is_sent_once(string answer) {
    using BankOnWireMock bank = new();
    (HttpStatusCode status, string body, string contentType) = Answer(answer);
    bank.Answers(status, body, contentType);

    BankResult<Balance> result = await bank.Account.ReadBalance(_presentUser, CancellationToken.None);

    result.Value.ShouldBeOfType(answer == RATE_LIMITED ? typeof(BankRateLimited) : typeof(BankAccessExpired));
    bank.RequestsReceived.ShouldBe(1);
  }

  /// <summary>
  /// The first answer starts (a success status, a promised body) and the connection breaks while its body comes in; the
  /// next is whole. Each attempt reads the whole answer (c008 design.md D6), so the break fails the attempt and is retried.
  /// </summary>
  [Test]
  public async Task A_present_users_balance_read_whose_first_answer_breaks_while_it_comes_in_is_read_with_2_requests() {
    await using ConnectionBreakingServer server = new(laterAnswerBody: READABLE_BALANCES);
    using BankOnWireMock bank = new(apiBaseUrl: server.Address);

    BankResult<Balance> result = await bank.Account.ReadBalance(_presentUser, CancellationToken.None);

    result.Value.ShouldBe(new Balance(1234.56m, "EUR"));
    server.RequestsReceived.ShouldBe(2);
  }

  /// <summary>As above, but nobody is waiting for the read: an unattended request is never sent again (D2).</summary>
  [Test]
  public async Task An_unattended_balance_read_whose_first_answer_breaks_while_it_comes_in_is_bank_unavailable_after_1_request() {
    await using ConnectionBreakingServer server = new(laterAnswerBody: READABLE_BALANCES);
    using BankOnWireMock bank = new(apiBaseUrl: server.Address);

    BankResult<Balance> result = await bank.Account.ReadBalance(new Unattended(), CancellationToken.None);

    result.Value.ShouldBeOfType<BankUnavailable>();
    server.RequestsReceived.ShouldBe(1);
  }

  /// <summary>
  /// The bank reports its own error on every request: the request is tried four times, the first attempt and three retries
  /// (D4), then the read is bank unavailable. The read's one line counts the pages it requested, not the attempts (D3, D9).
  /// </summary>
  [Test]
  public async Task A_present_users_transactions_read_against_a_bank_that_keeps_reporting_its_own_error_is_bank_unavailable_after_4_requests_and_its_line_says_1_page() {
    using BankOnWireMock bank = new();
    (HttpStatusCode status, string body, string contentType) = Answer(BANKS_OWN_ERROR);
    bank.Answers(status, body, contentType);

    BankResult<Transactions> result = await bank.Account.ReadTransactions(_november1, _presentUser, CancellationToken.None);

    result.Value.ShouldBeOfType<BankUnavailable>();
    bank.RequestsReceived.ShouldBe(4);

    LogLine line = bank.LogLines.ShouldHaveSingleItem();

    line.Level.ShouldBe(LogLevel.Warning);
    line.Values["Outcome"].ShouldBe("bank unavailable");
    line.Values["Pages"].ShouldBe("1");
  }

  /// <summary>
  /// Three pages; the first request for page 2 gets the bank's own error. The retry is the same request: page 2's
  /// continuation key and the present user's headers, as its first attempt carried them (D3, D11); then page 3.
  /// </summary>
  [Test]
  public async Task A_retried_transactions_page_carries_the_same_continuation_key_and_user_headers_as_its_first_attempt() {
    using BankOnWireMock bank = new();
    bank.AnswersPagesInARow(3);
    (HttpStatusCode status, string body, string contentType) = Answer(BANKS_OWN_ERROR);
    bank.AnswersTheFirstRequestForPage(2, status, body, contentType);

    BankResult<Transactions> result = await bank.Account.ReadTransactions(_november1, _presentUser, CancellationToken.None);

    result.Value.ShouldBeOfType<Transactions>();

    IReadOnlyList<ReceivedRequest> requests = bank.Requests();
    string?[] keys = [null, BankOnWireMock.KeyOfPage(2), BankOnWireMock.KeyOfPage(2), BankOnWireMock.KeyOfPage(3)];

    requests.Select(static request => request.ContinuationKey).ShouldBe(keys);
    requests[1].UserHeaders.ShouldBe(_presentUsersHeaders, "page 2's first attempt");
    requests[2].UserHeaders.ShouldBe(_presentUsersHeaders, "page 2's retry");
  }

  /// <summary>
  /// Three pages; the first request for page 2 gets the bank's own error. Nobody is waiting for the read, so page 2 is not
  /// requested again (D2): the read is bank unavailable, and page 3 is never requested.
  /// </summary>
  [Test]
  public async Task An_unattended_transactions_read_whose_second_page_fails_once_is_bank_unavailable_with_that_page_requested_once() {
    using BankOnWireMock bank = new();
    bank.AnswersPagesInARow(3);
    (HttpStatusCode status, string body, string contentType) = Answer(BANKS_OWN_ERROR);
    bank.AnswersTheFirstRequestForPage(2, status, body, contentType);

    BankResult<Transactions> result = await bank.Account.ReadTransactions(_november1, new Unattended(), CancellationToken.None);

    result.Value.ShouldBeOfType<BankUnavailable>();

    string?[] keys = [null, BankOnWireMock.KeyOfPage(2)];

    bank.Requests().Select(static request => request.ContinuationKey).ShouldBe(keys);
  }

  /// <summary>The answer <paramref name="answer"/> names: its status, its body and its content type.</summary>
  private static (HttpStatusCode Status, string Body, string ContentType) Answer(string answer) => answer switch {
    GATEWAY_503 => (HttpStatusCode.ServiceUnavailable, "<html><body><h1>Service Temporarily Unavailable</h1></body></html>", "text/html"),
    BANKS_OWN_ERROR => (HttpStatusCode.BadGateway, ErrorBody(HttpStatusCode.BadGateway, "ASPSP_ERROR"), "application/json"),
    BANKS_OWN_TIMEOUT => (HttpStatusCode.BadGateway, ErrorBody(HttpStatusCode.BadGateway, "ASPSP_TIMEOUT"), "application/json"),
    RATE_LIMITED => (HttpStatusCode.TooManyRequests, ErrorBody(HttpStatusCode.TooManyRequests, "ASPSP_RATE_LIMIT_EXCEEDED"), "application/json"),
    EXPIRED_SESSION => (HttpStatusCode.UnprocessableEntity, ErrorBody(HttpStatusCode.UnprocessableEntity, "EXPIRED_SESSION"), "application/json"),
    _ => throw new ArgumentOutOfRangeException(nameof(answer), answer, "Not a known case."),
  };

  /// <summary>An Enable Banking error answer's body with this status as <c>code</c> and this <c>error</c>; the message is made up.</summary>
  private static string ErrorBody(HttpStatusCode status, string errorCode) =>
    $$"""{ "code": {{(int)status}}, "message": "A made-up message", "error": "{{errorCode}}", "detail": null }""";
}