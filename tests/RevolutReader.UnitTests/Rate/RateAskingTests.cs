using System.Globalization;
using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.UnitTests.Rate;

/// <summary>
/// When the CNB is asked (c017 design.md D3): never before 08:00 UTC on the first day from Monday to Friday after the kept
/// rate's day, from then on every time; with nothing kept, always. UTC only, and no holiday list: a Czech holiday counts as
/// a working day. A plain function of the kept rate and the time, so any dates do; days are given as invariant text
/// (<c>yyyy-MM-dd</c>), since an attribute cannot hold a date.
/// </summary>
public sealed class RateAskingTests {
  /// <summary>08:00 UTC, the time of day from which a newer rate may be out (D3).</summary>
  private static readonly TimeOnly _eightUtc = new(8, 0);

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

  /// <param name="keptDay">The kept rate's day, a Monday to Thursday.</param>
  /// <param name="nextDay">The next day, whose 08:00 UTC the next ask is from.</param>
  [Test]
  [Arguments("2026-11-23", "2026-11-24")] // a Monday
  [Arguments("2026-11-24", "2026-11-25")] // a Tuesday
  [Arguments("2026-11-25", "2026-11-26")] // a Wednesday
  [Arguments("2026-11-26", "2026-11-27")] // a Thursday
  [Arguments("2026-12-31", "2027-01-01")] // a Thursday before New Year's Day, a Czech holiday that counts as a working day
  public void After_a_Monday_to_Thursday_the_next_ask_is_from_08_00_UTC_the_next_day(string keptDay, string nextDay) =>
    RateAsking.NextAskFrom(Day(keptDay)).ShouldBe(AtEightUtc(nextDay));

  /// <param name="keptDay">The kept rate's day, a Friday, a Saturday or a Sunday.</param>
  [Test]
  [Arguments("2026-11-20")] // a Friday
  [Arguments("2026-11-21")] // a Saturday
  [Arguments("2026-11-22")] // a Sunday
  public void After_a_Friday_a_Saturday_or_a_Sunday_the_next_ask_is_from_08_00_UTC_on_Monday(string keptDay) =>
    RateAsking.NextAskFrom(Day(keptDay)).ShouldBe(AtEightUtc("2026-11-23"));

  /// <summary>
  /// The kept rate's next ask day at 08:00 UTC is the boundary: one tick before it the rate is not due; at it, it is, also
  /// when the time is given at another offset (09:00 at +01:00, the same instant).
  /// </summary>
  /// <param name="keptDay">The kept rate's day.</param>
  /// <param name="askDay">The first weekday after it.</param>
  [Test]
  [Arguments("2026-11-20", "2026-11-23")] // kept on a Friday, asked from Monday
  [Arguments("2026-11-23", "2026-11-24")] // kept on a Monday, asked from Tuesday
  public void A_kept_rate_is_not_due_one_tick_before_08_00_UTC_and_is_due_at_08_00_UTC(string keptDay, string askDay) {
    KorunaRate kept = new(24.41m, Day(keptDay));
    DateTimeOffset eight = AtEightUtc(askDay);

    kept.ShouldSatisfyAllConditions(
      () => RateAsking.IsDue(kept, eight.AddTicks(-1)).ShouldBeFalse("one tick before 08:00 UTC"),
      () => RateAsking.IsDue(kept, eight).ShouldBeTrue("at 08:00 UTC"),
      () => RateAsking.IsDue(kept, eight.ToOffset(TimeSpan.FromHours(1))).ShouldBeTrue("at 09:00 at +01:00, the same instant"));
  }

  private static DateOnly Day(string day) => DateOnly.ParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture);

  private static DateTimeOffset AtEightUtc(string day) => new(Day(day).ToDateTime(_eightUtc), TimeSpan.Zero);
}