using Microsoft.Extensions.Time.Testing;
using RevolutReader.AcceptanceTests.Drivers;
using Shouldly;

namespace RevolutReader.AcceptanceTests.HarnessSelfTests;

/// <summary>
/// Checks of the test harness itself, not of the app (c017 design.md D10; tasks.md 13.1): the scenario calendar's weekday
/// step, <see cref="ScenarioCalendar.TodayIsAt"/>, moves the clock forward to the coming day with the same weekday as the
/// scenario's day, at the given UTC time, and maps the scenario's dates onto it, so a scenario's Monday lands on a Monday
/// and every date keeps its weekday. The clock only moves forward: on the same weekday, the coming day is today while the
/// clock is still before the time, and a week later once it is past it. Each clock starts at a literal time with ticks, as
/// the harness clock starts at the real time; the calendar is made as <see cref="AcceptanceTest"/> makes it, with the
/// scenarios' default today, 2026-11-20.
/// </summary>
public sealed class ScenarioCalendarSelfTests {
  /// <summary>The scenarios' default today (<c>TransactionsDsl.DefaultToday</c>), which the calendar is made with.</summary>
  private static readonly DateOnly _defaultToday = new(2026, 11, 20);

  /// <summary>The spec's Friday and Monday.</summary>
  private static readonly DateOnly _friday = new(2026, 11, 20);
  private static readonly DateOnly _saturday = new(2026, 11, 21);
  private static readonly DateOnly _monday = new(2026, 11, 23);

  /// <summary>
  /// On a Wednesday morning, the scenario's Monday at 15:00 UTC: the clock moves to the coming Monday at exactly 15:00 UTC,
  /// which is the scenario's today on the clock; the scenario's Friday before it lands on the Friday before that Monday,
  /// and back.
  /// </summary>
  [Test]
  public void The_calendars_Monday_lands_on_the_coming_Monday_at_the_given_UTC_time() {
    FakeTimeProvider clock = new(new DateTimeOffset(2026, 12, 2, 10, 17, 42, TimeSpan.Zero).AddTicks(1_234_567)); // a Wednesday
    ScenarioCalendar calendar = new(_defaultToday, clock);

    calendar.TodayIsAt(_monday, new TimeOnly(15, 0));

    calendar.ShouldSatisfyAllConditions(
      () => clock.GetUtcNow().ShouldBe(new DateTimeOffset(2026, 12, 7, 15, 0, 0, TimeSpan.Zero), "the coming Monday at 15:00 UTC exactly"),
      () => clock.GetUtcNow().DayOfWeek.ShouldBe(DayOfWeek.Monday),
      () => calendar.ClockToday.ShouldBe(new DateOnly(2026, 12, 7), "the scenario's today on the clock"),
      () => calendar.ToClock(_monday).ShouldBe(new DateOnly(2026, 12, 7), "the scenario's Monday on the clock"),
      () => calendar.ToClock(_friday).ShouldBe(new DateOnly(2026, 12, 4), "the scenario's Friday, the Friday before"),
      () => calendar.ToClock(_friday).DayOfWeek.ShouldBe(DayOfWeek.Friday),
      () => calendar.FromClock(new DateOnly(2026, 12, 7)).ShouldBe(_monday, "back to the scenario's Monday"));
  }

  /// <summary>On a Monday, the scenario's Saturday at 10:00 UTC: the clock moves to the coming Saturday, five days on.</summary>
  [Test]
  public void A_weekend_day_lands_on_the_coming_day_of_its_weekday() {
    FakeTimeProvider clock = new(new DateTimeOffset(2026, 12, 7, 9, 3, 11, TimeSpan.Zero).AddTicks(7_654_321)); // a Monday
    ScenarioCalendar calendar = new(_defaultToday, clock);

    calendar.TodayIsAt(_saturday, new TimeOnly(10, 0));

    calendar.ShouldSatisfyAllConditions(
      () => clock.GetUtcNow().ShouldBe(new DateTimeOffset(2026, 12, 12, 10, 0, 0, TimeSpan.Zero), "the coming Saturday at 10:00 UTC exactly"),
      () => clock.GetUtcNow().DayOfWeek.ShouldBe(DayOfWeek.Saturday),
      () => calendar.ToClock(_friday).ShouldBe(new DateOnly(2026, 12, 11), "the scenario's Friday, the day before"));
  }

  /// <summary>On a Monday at 06:00 UTC, the scenario's Monday at 09:00 UTC: the coming Monday is today, three hours on.</summary>
  [Test]
  public void On_the_same_weekday_before_the_given_time_the_coming_day_is_today() {
    FakeTimeProvider clock = new(new DateTimeOffset(2026, 12, 7, 6, 0, 0, TimeSpan.Zero).AddTicks(42)); // a Monday
    ScenarioCalendar calendar = new(_defaultToday, clock);

    calendar.TodayIsAt(_monday, new TimeOnly(9, 0));

    calendar.ShouldSatisfyAllConditions(
      () => clock.GetUtcNow().ShouldBe(new DateTimeOffset(2026, 12, 7, 9, 0, 0, TimeSpan.Zero), "today at 09:00 UTC exactly"),
      () => calendar.ToClock(_monday).ShouldBe(new DateOnly(2026, 12, 7), "the scenario's Monday is today"));
  }

  /// <summary>
  /// On a Monday at 16:00 UTC, the scenario's Monday at 15:00 UTC: the clock cannot go back an hour, so the coming Monday
  /// is a week later.
  /// </summary>
  [Test]
  public void On_the_same_weekday_after_the_given_time_the_coming_day_is_a_week_later() {
    FakeTimeProvider clock = new(new DateTimeOffset(2026, 12, 7, 16, 0, 0, TimeSpan.Zero)); // a Monday
    ScenarioCalendar calendar = new(_defaultToday, clock);

    calendar.TodayIsAt(_monday, new TimeOnly(15, 0));

    calendar.ShouldSatisfyAllConditions(
      () => clock.GetUtcNow().ShouldBe(new DateTimeOffset(2026, 12, 14, 15, 0, 0, TimeSpan.Zero), "the next Monday at 15:00 UTC exactly"),
      () => calendar.ToClock(_monday).ShouldBe(new DateOnly(2026, 12, 14), "the scenario's Monday is next week's"));
  }
}