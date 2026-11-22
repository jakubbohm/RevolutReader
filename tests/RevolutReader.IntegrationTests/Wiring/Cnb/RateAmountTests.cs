using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Cnb;

/// <summary>
/// The rate is the euro entry's <c>rate / amount</c> (c017 design.md D1, D6): the CNB quotes some currencies per 100, so the
/// client divides by the amount whatever it is. The answer has the shape of the CNB's daily rates (the euro's entry as the
/// CNB wrote it on 2026-11-21, design.md § Context), but the euro's amount is 100, with its rate 100 times as large, which
/// the CNB has never written for the euro: the case cannot be captured, so the answer is written here, with another
/// currency quoted per 100 before it. The values are made up.
/// </summary>
public sealed class RateAmountTests {
  private const string DAILY_RATES = """
    {"rates":[
      {"validFor":"2026-11-20","order":223,"country":"Maďarsko","currency":"forint","amount":100,"currencyCode":"HUF","rate":6.315},
      {"validFor":"2026-11-20","order":223,"country":"EMU","currency":"euro","amount":100,"currencyCode":"EUR","rate":2447.5}
    ]}
    """;

  [Test]
  public async Task A_rate_quoted_for_100_euros_is_divided_by_its_amount() {
    using CnbOnWireMock cnb = new();
    cnb.AnswersTheDailyRates(DAILY_RATES);

    CnbAnswer answer = await cnb.Cnb.ReadEuroRate(CancellationToken.None);

    answer.Value.ShouldBeOfType<KorunaRate>().ShouldBe(new KorunaRate(24.475m, new DateOnly(2026, 11, 20)), "the euro's rate for one euro, and its day");
  }
}