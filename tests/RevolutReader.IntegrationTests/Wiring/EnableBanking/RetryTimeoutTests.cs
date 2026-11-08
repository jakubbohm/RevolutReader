using System.Diagnostics;
using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// Our request timeout covers a request with all its retries and the waits between them, and a request that ran into it is
/// never sent again (c008 design.md D1): <c>HttpClient.Timeout</c> wraps the retry handler, and a cancelled attempt is
/// never retried. The worst case for a present user's request stays one timeout. No wait between attempts
/// (<see cref="BankOnWireMock.DefaultRetryDelay"/>). The balances and the gateway page are made up.
/// </summary>
public sealed class RetryTimeoutTests {
  /// <summary>A balances answer the read would accept, had it come in time.</summary>
  private const string READABLE_BALANCES = """{ "balances": [{ "balance_amount": { "currency": "EUR", "amount": "1234.56" }, "balance_type": "ITAV" }] }""";

  private const string GATEWAY_PAGE = "<html><body><h1>Service Temporarily Unavailable</h1></body></html>";

  /// <summary>Short, so the tests stay fast, yet long enough that a first answer on a busy machine comes well within it.</summary>
  private static readonly TimeSpan _requestTimeout = TimeSpan.FromSeconds(3);

  /// <summary>
  /// How much longer than the timeout a read may take to end: generous for a busy machine, yet well under a second timeout,
  /// which a limit per attempt would have allowed the read.
  /// </summary>
  private static readonly TimeSpan _margin = TimeSpan.FromSeconds(2);

  /// <summary>Made up: a user at a documentation address (RFC 5737) with a made-up browser.</summary>
  private static readonly PresentUser _presentUser = new(IPAddress.Parse("203.0.113.24"), "Mozilla/5.0 (RevolutReader c008 timeout test; made up)");

  /// <summary>The first answer is a gateway's 503, so the request is retried; the retry is answered only long after the timeout.</summary>
  [Test]
  public async Task A_present_users_read_whose_retry_is_never_answered_is_bank_unavailable_within_the_request_timeout_after_2_requests() {
    using BankOnWireMock bank = new(requestTimeout: _requestTimeout);
    bank.AnswersAfter(_requestTimeout * 3, READABLE_BALANCES);
    bank.AnswersTheFirstRequest(HttpStatusCode.ServiceUnavailable, GATEWAY_PAGE, "text/html");
    Stopwatch reading = Stopwatch.StartNew();

    BankResult<Balance> result = await bank.Account.ReadBalance(_presentUser, CancellationToken.None);

    reading.Elapsed.ShouldBeLessThan(_requestTimeout + _margin);
    result.Value.ShouldBeOfType<BankUnavailable>();
    bank.RequestsReceived.ShouldBe(2);
  }

  /// <summary>Every answer comes only long after the timeout: the first attempt runs into it, and nothing is sent after it.</summary>
  [Test]
  public async Task A_present_users_first_attempt_that_runs_into_the_request_timeout_is_the_only_request() {
    using BankOnWireMock bank = new(requestTimeout: _requestTimeout);
    bank.AnswersAfter(_requestTimeout * 3, READABLE_BALANCES);
    Stopwatch reading = Stopwatch.StartNew();

    BankResult<Balance> result = await bank.Account.ReadBalance(_presentUser, CancellationToken.None);

    reading.Elapsed.ShouldBeLessThan(_requestTimeout + _margin);
    result.Value.ShouldBeOfType<BankUnavailable>();
    bank.RequestsReceived.ShouldBe(1);
  }

  /// <summary>
  /// The answer starts (a success status, a promised body), then its body stops coming. The timeout runs out while each
  /// attempt reads the whole answer (<see cref="WholeAnswerHandler"/>, D6), as a cancellation, which is never retried; the
  /// read's line says it timed out.
  /// </summary>
  [Test]
  public async Task A_present_users_read_whose_body_comes_in_slower_than_the_request_timeout_is_bank_unavailable_after_1_request() {
    await using ConnectionBreakingServer server = new(holdsTheConnection: true);
    using BankOnWireMock bank = new(apiBaseUrl: server.Address, requestTimeout: _requestTimeout);
    Stopwatch reading = Stopwatch.StartNew();

    BankResult<Balance> result = await bank.Account.ReadBalance(_presentUser, CancellationToken.None);

    reading.Elapsed.ShouldBeLessThan(_requestTimeout + _margin);
    result.Value.ShouldBeOfType<BankUnavailable>();
    server.RequestsReceived.ShouldBe(1);
    bank.LogLines.ShouldHaveSingleItem().Values["Status"].ShouldBe("none (timed out)");
  }
}