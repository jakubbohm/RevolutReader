using System.Diagnostics;
using System.Globalization;
using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// A <c>Retry-After</c> header on an answer that is retried is followed, but only while its wait still ends within the
/// request's timeout, counted from when the answer came; otherwise the read ends at once, never waiting for nothing (c008
/// design.md D8). Only a gateway sends it here: a 503 without an Enable Banking code, so a present user's request would
/// be retried. The waits run on the real clock. The gateway page and the balances are made up.
/// </summary>
public sealed class RetryAfterTests {
  /// <summary>A balances answer the read accepts, with a made-up balance.</summary>
  private const string READABLE_BALANCES = """{ "balances": [{ "balance_amount": { "currency": "EUR", "amount": "1234.56" }, "balance_type": "ITAV" }] }""";

  private const string GATEWAY_PAGE = "<html><body><h1>Service Temporarily Unavailable</h1></body></html>";
  private const string HTML = "text/html";

  /// <summary>Long, so a wait that was wrongly made, and then cut off by the timeout, is far from "at once".</summary>
  private static readonly TimeSpan _requestTimeout = TimeSpan.FromSeconds(10);

  /// <summary>How long after the last answer a read that ends "at once" may still take: generous for a busy machine, far under the timeout.</summary>
  private static readonly TimeSpan _atOnce = TimeSpan.FromSeconds(2);

  /// <summary>Made up: a user at a documentation address (RFC 5737) with a made-up browser.</summary>
  private static readonly PresentUser _presentUser = new(IPAddress.Parse("203.0.113.24"), "Mozilla/5.0 (RevolutReader c008 Retry-After test; made up)");

  [Test]
  public async Task A_503_asking_to_retry_after_60_seconds_ends_a_present_users_read_as_bank_unavailable_at_once_after_1_request() {
    using BankOnWireMock bank = new(requestTimeout: _requestTimeout);
    bank.Answers(HttpStatusCode.ServiceUnavailable, GATEWAY_PAGE, HTML, retryAfter: "60");
    Stopwatch reading = Stopwatch.StartNew();

    BankResult<Balance> result = await bank.Account.ReadBalance(_presentUser, CancellationToken.None);

    reading.Elapsed.ShouldBeLessThan(_atOnce);
    result.Value.ShouldBeOfType<BankUnavailable>();
    bank.RequestsReceived.ShouldBe(1);
  }

  /// <summary>The first answer asks for a 1 s wait, well within the timeout: the retry is sent after it and read.</summary>
  [Test]
  public async Task A_503_asking_to_retry_after_1_second_is_retried_about_1_second_later_and_read() {
    using BankOnWireMock bank = new(requestTimeout: _requestTimeout);
    bank.Answers(HttpStatusCode.OK, READABLE_BALANCES);
    bank.AnswersTheFirstRequest(HttpStatusCode.ServiceUnavailable, GATEWAY_PAGE, HTML, retryAfter: "1");
    Stopwatch reading = Stopwatch.StartNew();

    BankResult<Balance> result = await bank.Account.ReadBalance(_presentUser, CancellationToken.None);

    reading.Elapsed.ShouldBeGreaterThanOrEqualTo(TimeSpan.FromSeconds(0.9), "the retry waits for the Retry-After");
    reading.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(1) + _atOnce);
    result.Value.ShouldBe(new Balance(1234.56m, "EUR"));
    bank.RequestsReceived.ShouldBe(2);
  }

  /// <param name="answeredAfterSeconds">How long the attempt took before its answer came.</param>
  /// <param name="retryAfterSeconds">
  /// The wait the answer asks for: the whole timeout, asked at once; or 9 s, shorter than the timeout, after an attempt
  /// that took 2 s, so it would end 1 s after the deadline. Either would be cut off by the timeout, after waiting.
  /// </param>
  [Test]
  [Arguments(0, 10)]
  [Arguments(2, 9)]
  public async Task A_503_whose_Retry_After_wait_overruns_the_time_left_ends_a_present_users_read_at_once_after_1_request(int answeredAfterSeconds, int retryAfterSeconds) {
    TimeSpan answeredAfter = TimeSpan.FromSeconds(answeredAfterSeconds);
    using BankOnWireMock bank = new(requestTimeout: _requestTimeout);
    bank.Answers(HttpStatusCode.ServiceUnavailable, GATEWAY_PAGE, HTML, retryAfter: retryAfterSeconds.ToString(CultureInfo.InvariantCulture), after: answeredAfter);
    Stopwatch reading = Stopwatch.StartNew();

    BankResult<Balance> result = await bank.Account.ReadBalance(_presentUser, CancellationToken.None);

    reading.Elapsed.ShouldBeLessThan(answeredAfter + _atOnce);
    result.Value.ShouldBeOfType<BankUnavailable>();
    bank.RequestsReceived.ShouldBe(1);
  }
}