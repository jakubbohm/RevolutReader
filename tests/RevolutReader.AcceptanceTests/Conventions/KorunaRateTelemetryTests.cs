using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// The koruna rate's log lines (c017 design.md D7, D12): an ask that keeps a new rate writes one <c>KorunaRateKept</c> line
/// and no line of the HTTP client factory's own. The factory's loggers are removed from the CNB's named client
/// (<see cref="CnbClient.NAME"/>): otherwise every ask, also one that keeps nothing, would add the factory's Information
/// lines under the app's <c>appsettings.json</c> levels (<c>Default</c> Information): "Start processing HTTP request" and
/// "End processing HTTP request" (category <c>System.Net.Http.HttpClient.cnb.LogicalHandler</c>), "Sending HTTP request"
/// and "Received HTTP response headers" (<c>….ClientHandler</c>), the first of each pair naming the request's address.
/// <para>
/// A rule, not a scenario. Lucie, signed in, asks for the balance with nothing kept and the CNB answering a rate of its
/// own, so the balance's ask keeps that rate. The lines are the app copy's own, as every app copy captures them
/// (<see cref="CapturedLogEvents"/>, through its levels): one <c>KorunaRateKept</c> line holding the rate, no line in a
/// category of the CNB's client, and no line naming the CNB's address in any value. The test first checks that the CNB was
/// asked once and the balance carries its rate, so it cannot pass without an ask.
/// </para>
/// </summary>
public sealed class KorunaRateTelemetryTests : AcceptanceTest {
  /// <summary>The line of a newly kept rate (design.md D7).</summary>
  private const string KORUNA_RATE_KEPT = "KorunaRateKept";

  /// <summary>How the categories of the HTTP client factory's own lines of the CNB's client start: <c>LogicalHandler</c> and <c>ClientHandler</c> follow.</summary>
  private const string CNB_CLIENT_CATEGORY = $"System.Net.Http.HttpClient.{CnbClient.NAME}.";

  /// <summary>The CNB's daily rates, which the factory's request lines would name (design.md D1).</summary>
  private const string CNB_DAILY_RATES = "/cnbapi/exrates/daily";

  [Test]
  public async Task An_ask_that_keeps_a_new_rate_writes_one_KorunaRateKept_line_and_no_line_of_the_HTTP_client_factorys_own() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Rate.TheCnbsLatestRateIs(24.52m);

    BalanceReading balance = await Balance.AsksForTheBalance();

    balance.CzkPerEur.ShouldBe(24.52m, "the balance at the CNB's rate, which the ask kept");
    Rate.RequestsTheCnbReceived().ShouldBe(1, "one ask");
    LogEvents.ShouldSatisfyAllConditions(
      () => LogEvents.ValuesOf(KORUNA_RATE_KEPT).ShouldHaveSingleItem("one KorunaRateKept line").Values.ShouldContain(24.52m, "the line holds the rate"),
      () => LogEvents.LinesOfCategoriesStartingWith(CNB_CLIENT_CATEGORY).ShouldBeEmpty("no line of the HTTP client factory's own for the CNB's client"),
      () => LogEvents.LinesHolding(CNB_DAILY_RATES).ShouldBeEmpty("no line naming the CNB's address"));
  }
}