using RevolutReader.Api.Account;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The koruna rate the screen converts euro amounts with (the user, 2026-11-08, roadmap C13): 24.3 CZK per euro, dated
/// 2026-11-08, a constant until GitHub issue #39 sources a daily rate from an outside service. The values are written out
/// here, as C7a's and C7b's answers carry them.
/// </summary>
public sealed class KorunaRateTests {
  [Test]
  public void One_euro_is_24_point_3_koruna() => KorunaRate.CzkPerEur.ShouldBe(24.3m);

  [Test]
  public void The_rate_is_dated_8_November_2026() => KorunaRate.Date.ShouldBe(new DateOnly(2026, 11, 8));
}