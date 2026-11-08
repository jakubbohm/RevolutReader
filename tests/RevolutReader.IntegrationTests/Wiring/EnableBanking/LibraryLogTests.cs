using System.Net;
using Microsoft.Extensions.Logging;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// The resilience library's own log lines (category <c>Polly</c>) under the app's log levels from its
/// <c>appsettings.json</c>, <c>Logging:LogLevel:Polly</c> = <c>Warning</c> (c008 design.md D9): a read answered at once
/// writes none, so a bank request adds no line of its own to Application Insights; a retry writes the library's warning,
/// and the read still writes exactly its one line (c006 design.md D6). The balances and the gateway page are made up.
/// </summary>
public sealed class LibraryLogTests {
  /// <summary>A balances answer the read accepts, with a made-up balance.</summary>
  private const string READABLE_BALANCES = """{ "balances": [{ "balance_amount": { "currency": "EUR", "amount": "1234.56" }, "balance_type": "ITAV" }] }""";

  private const string GATEWAY_PAGE = "<html><body><h1>Service Temporarily Unavailable</h1></body></html>";

  /// <summary>The library's event for a retry it is about to make.</summary>
  private const string ON_RETRY = "OnRetry";

  /// <summary>Made up: a user at a documentation address (RFC 5737) with a made-up browser.</summary>
  private static readonly PresentUser _presentUser = new(IPAddress.Parse("203.0.113.24"), "Mozilla/5.0 (RevolutReader c008 log test; made up)");

  /// <summary>The library would write an Information line for the successful attempt; the app's level for it drops that line.</summary>
  [Test]
  public async Task A_present_users_read_answered_at_once_writes_no_line_of_the_library() {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.OK, READABLE_BALANCES);

    (await bank.Account.ReadBalance(_presentUser, CancellationToken.None)).Value.ShouldBeOfType<Balance>();

    bank.LibraryLogLines.ShouldBeEmpty();
    bank.LogLines.ShouldHaveSingleItem();
  }

  /// <summary>The first answer is a gateway's 503, the retry is read: one retry warning, no line for the successful attempt.</summary>
  [Test]
  public async Task A_present_users_read_retried_once_writes_the_librarys_retry_warning_and_still_exactly_one_read_line() {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.OK, READABLE_BALANCES);
    bank.AnswersTheFirstRequest(HttpStatusCode.ServiceUnavailable, GATEWAY_PAGE, "text/html");

    (await bank.Account.ReadBalance(_presentUser, CancellationToken.None)).Value.ShouldBeOfType<Balance>();

    IReadOnlyList<LogLine> library = bank.LibraryLogLines;

    library.ShouldAllBe(line => line.Level == LogLevel.Warning, "the successful attempt's Information line is dropped");
    library.Count(line => line.Values.GetValueOrDefault("EventName") == ON_RETRY).ShouldBe(1, "one retry warning");
    bank.LogLines.ShouldHaveSingleItem().Values["Outcome"].ShouldBe("read");
  }
}