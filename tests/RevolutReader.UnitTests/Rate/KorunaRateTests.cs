using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.UnitTests.Rate;

/// <summary>
/// The app's own koruna rate (c017 design.md D5; spec koruna-rate, "With no rate kept, the app's own rate stands in"): the
/// CNB's rate for 2026-11-20, which an answer carries only while nothing is kept and an ask fails. The values are written
/// out here, as the spec names them.
/// </summary>
public sealed class KorunaRateTests {
  [Test]
  public void The_apps_own_rate_is_24_point_47_koruna_per_euro_for_20_November_2026() =>
    KorunaRate.AppsOwn.ShouldBe(new KorunaRate(24.47m, new DateOnly(2026, 11, 20)));
}