using System.Net;
using RevolutReader.Api.Rate;
using RevolutReader.IntegrationTests.Wiring.EnableBanking;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Cnb;

/// <summary>
/// The CNB's answers the client cannot use (c017 design.md D6, § Error model): each is a <see cref="CnbFailed"/> with its
/// kind, never an exception. Any status but 200 is <see cref="CnbFailure.Status"/> with its code; a 200 that is not JSON,
/// or JSON without a usable euro entry, is <see cref="CnbFailure.Unreadable"/>; a refused connection is
/// <see cref="CnbFailure.Unreachable"/>. The CNB cannot be made to fail on demand, so these answers are written here, in the
/// shape of its daily rates (the euro's entry as the CNB wrote it on 2026-11-21, design.md § Context), each changed in the
/// one way the case is about; the values are made up.
/// </summary>
public sealed class UnusableAnswerTests {
  /// <summary>Another currency's entry, before the euro's, quoted per 100.</summary>
  private const string FORINT = """{"validFor":"2026-11-20","order":223,"country":"Maďarsko","currency":"forint","amount":100,"currencyCode":"HUF","rate":6.315}""";

  /// <param name="status">An error of the CNB's, and an address it does not know (as after a change of its API).</param>
  [Test]
  [Arguments(HttpStatusCode.InternalServerError)]
  [Arguments(HttpStatusCode.NotFound)]
  public async Task Any_status_but_200_is_Status_with_its_code(HttpStatusCode status) {
    using CnbOnWireMock cnb = new();
    cnb.AnswersTheDailyRatesWith(status, "<html><body>Chyba</body></html>", "text/html");

    CnbAnswer answer = await cnb.Cnb.ReadEuroRate(CancellationToken.None);

    answer.Value.ShouldBe(new CnbFailed(CnbFailure.Status, (int)status));
  }

  /// <param name="shape">How the 200's body differs from a usable answer.</param>
  [Test]
  [Arguments("not JSON")]
  [Arguments("a JSON null")]
  [Arguments("no rates")]
  [Arguments("rates that are not an array")]
  [Arguments("no EUR entry")]
  [Arguments("a rate of zero")]
  [Arguments("a rate below zero")]
  [Arguments("a rate as text")]
  [Arguments("an amount of zero")]
  [Arguments("an amount below zero")]
  [Arguments("no validFor")]
  [Arguments("a malformed validFor")]
  public async Task An_answer_without_a_usable_euro_entry_is_Unreadable(string shape) {
    string body = shape switch {
      "not JSON" => "<html><body>Kurzy</body></html>",
      "a JSON null" => "null",
      "no rates" => """{"currencies":[]}""",
      "rates that are not an array" => """{"rates":{}}""",
      "no EUR entry" => $$"""{"rates":[{{FORINT}}]}""",
      "a rate of zero" => WithEuro("""{"validFor":"2026-11-20","amount":1,"currencyCode":"EUR","rate":0}"""),
      "a rate below zero" => WithEuro("""{"validFor":"2026-11-20","amount":1,"currencyCode":"EUR","rate":-24.47}"""),
      "a rate as text" => WithEuro("""{"validFor":"2026-11-20","amount":1,"currencyCode":"EUR","rate":"24.47"}"""),
      "an amount of zero" => WithEuro("""{"validFor":"2026-11-20","amount":0,"currencyCode":"EUR","rate":24.47}"""),
      "an amount below zero" => WithEuro("""{"validFor":"2026-11-20","amount":-1,"currencyCode":"EUR","rate":24.47}"""),
      "no validFor" => WithEuro("""{"amount":1,"currencyCode":"EUR","rate":24.47}"""),
      "a malformed validFor" => WithEuro("""{"validFor":"20.11.2026","amount":1,"currencyCode":"EUR","rate":24.47}"""),
      _ => throw new ArgumentOutOfRangeException(nameof(shape), shape, "Not a known case."),
    };
    using CnbOnWireMock cnb = new();
    cnb.AnswersTheDailyRates(body);

    CnbAnswer answer = await cnb.Cnb.ReadEuroRate(CancellationToken.None);

    answer.Value.ShouldBe(new CnbFailed(CnbFailure.Unreadable));
  }

  /// <summary>
  /// Nothing listens at the CNB's address (<see cref="UnlistenedPort"/>), so the connection is refused. The time limit is
  /// the most the setting allows, 10 s: Windows tries a refused connection again for about 2 s before it gives up (Linux
  /// gives up at once), which the production limit of 2 s would cut off as no answer in time.
  /// </summary>
  [Test]
  public async Task A_refused_connection_is_Unreachable() {
    using UnlistenedPort nowhere = new();
    using CnbOnWireMock cnb = new(new Dictionary<string, string?> { ["Cnb:Address"] = nowhere.Address.ToString(), ["Cnb:TimeLimit"] = "00:00:10" });

    CnbAnswer answer = await cnb.Cnb.ReadEuroRate(CancellationToken.None);

    answer.Value.ShouldBe(new CnbFailed(CnbFailure.Unreachable));
  }

  /// <summary>The daily rates with the forint's entry and then this euro entry.</summary>
  private static string WithEuro(string euro) => $$"""{"rates":[{{FORINT}},{{euro}}]}""";
}