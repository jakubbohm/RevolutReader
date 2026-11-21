using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.UnitTests.Rate;

/// <summary>
/// When the CNB is asked (c017 design.md D3): never before 08:00 UTC on the first weekday after the kept rate's day; with
/// nothing kept, always. A plain function of the kept rate and the time, so any dates do.
/// </summary>
public sealed class RateAskingTests {
  /// <summary>
  /// With nothing kept, a rate is due at any time, also at the times a kept rate would not be: on a weekend, and on a
  /// weekday one tick before 08:00 UTC.
  /// </summary>
  [Test]
  public void With_nothing_kept_a_rate_is_due() {
    DateTimeOffset[] times = [
      new(2026, 11, 21, 10, 0, 0, TimeSpan.Zero), // a Saturday
      new DateTimeOffset(2026, 11, 23, 8, 0, 0, TimeSpan.Zero).AddTicks(-1), // a Monday, one tick before 08:00 UTC
      new(2026, 11, 25, 15, 0, 0, TimeSpan.Zero), // a Wednesday afternoon
    ];

    times.ShouldAllBe(now => RateAsking.IsDue(null, now));
  }
}