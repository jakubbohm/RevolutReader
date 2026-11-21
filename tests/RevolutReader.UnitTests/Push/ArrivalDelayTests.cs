using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// The delay a report of a push's arrival records (c016 design.md D4): the server's time when the report arrives minus the
/// read time the push's balance carried, in whole seconds, rounded down. The read times are as the API writes them into a
/// push (UTC), the times made up.
/// </summary>
public sealed class ArrivalDelayTests {
  /// <summary>When the server read the balance a push carried (made up).</summary>
  private static readonly DateTimeOffset _readAt = new(2026, 11, 21, 9, 14, 3, TimeSpan.Zero);

  /// <summary>
  /// 75 seconds, and the same two instants with the read time written in Prague's offset (+01:00), so the delay is between
  /// instants, not between the clocks' readings.
  /// </summary>
  [Test]
  public void The_delay_is_the_servers_time_minus_the_read_time_in_whole_seconds() {
    DateTimeOffset now = _readAt.AddSeconds(75);
    DateTimeOffset readAtInPrague = _readAt.ToOffset(TimeSpan.FromHours(1));

    now.ShouldSatisfyAllConditions(
      () => ArrivalDelay.Seconds(_readAt, now).ShouldBe(75L, "read in UTC"),
      () => ArrivalDelay.Seconds(readAtInPrague, now).ShouldBe(75L, "read in Prague's offset"));
  }

  /// <summary>
  /// A read time with a fraction of a second, as the API writes one (74.4876544 s before the server's time), and a delay
  /// one tick short of 75 seconds: neither is rounded to the nearest second.
  /// </summary>
  [Test]
  public void A_delay_with_a_fraction_of_a_second_is_rounded_down() {
    DateTimeOffset readAtWithAFraction = new DateTimeOffset(2026, 11, 21, 9, 14, 3, TimeSpan.Zero).AddTicks(5_123_456);
    DateTimeOffset now = new(2026, 11, 21, 9, 15, 18, TimeSpan.Zero);
    DateTimeOffset oneTickShortOf75Seconds = _readAt.AddSeconds(75).AddTicks(-1);

    now.ShouldSatisfyAllConditions(
      () => ArrivalDelay.Seconds(readAtWithAFraction, now).ShouldBe(74L, "74.4876544 seconds"),
      () => ArrivalDelay.Seconds(_readAt, oneTickShortOf75Seconds).ShouldBe(74L, "one tick short of 75 seconds"));
  }

  [Test]
  public void A_delay_of_an_hour_is_3600_seconds() =>
    ArrivalDelay.Seconds(_readAt, _readAt.AddHours(1)).ShouldBe(3600L);

  /// <summary>
  /// The widest span two <see cref="DateTimeOffset"/>s hold: 3 155 378 975 999 999 999 ticks, so 315 537 897 599 whole
  /// seconds and a fraction just short of the next; a count that passes through a <see cref="double"/> rounds it up.
  /// </summary>
  [Test]
  public void The_earliest_read_time_and_the_latest_server_time_still_give_a_delay() =>
    ArrivalDelay.Seconds(DateTimeOffset.MinValue, DateTimeOffset.MaxValue).ShouldBe(315_537_897_599L);
}