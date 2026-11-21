using Microsoft.Extensions.Time.Testing;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Maps a scenario's dates onto the app copy's clock (c010 design.md D12). The harness clock
/// (<see cref="FakeMicrosoft.Clock"/>) starts at the real time and can only move forward (Microsoft's ID token is checked
/// against the real clock, testing.md), so a scenario's "today is 2026-11-20" cannot be set. Instead the scenario's today
/// is the clock's today, the UTC date of its time (as the app takes today, D3), and every other date keeps its distance
/// in days from it. The rules count days only, so a scenario's claims hold unchanged.
/// <list type="bullet">
/// <item><see cref="ToClock"/> shifts a scenario's date onto the clock (what the driver writes to the fake bank, the
/// store and the API's query); <see cref="FromClock"/> shifts a date the app or the fake bank gave back;
/// <see cref="ClockToday"/> is the scenario's today on the clock, as it is when asked.</item>
/// <item><see cref="PassDays"/> moves the clock by whole days, and the scenario's today with it: the mapping keeps its
/// distance, so a date shifts the same before and after.</item>
/// <item><see cref="TodayIs"/> names the scenario's today, before any date is shifted; until then it is the one the
/// calendar was made with.</item>
/// <item><see cref="TodayIsAt"/> names it on a weekday at a time of day, for a rule that depends on the weekday (c017
/// design.md D10, the koruna rate's asking): the clock moves to the coming day of that weekday first.</item>
/// </list>
/// The mapping is a fixed number of days, set when the scenario's today is named: whatever moves the clock (this
/// calendar, or <c>SignInDsl.DaysPass</c>), the scenario's today moves with it, and a date already written stays the
/// scenario's same date.
/// </summary>
public sealed class ScenarioCalendar(DateOnly scenarioToday, FakeTimeProvider clock) {
  private const int DAYS_IN_A_WEEK = 7;

  /// <summary>The app copy's clock.</summary>
  private readonly FakeTimeProvider _clock = clock;

  /// <summary>How many days the clock's dates are ahead of the scenario's.</summary>
  private int _daysAhead = DaysAhead(scenarioToday, clock);

  /// <summary>The scenario's today on the clock: the clock's today, the UTC date of its time, as the app takes today.</summary>
  public DateOnly ClockToday => ClockTodayOf(_clock);

  /// <summary>The scenario's today is <paramref name="today"/>, mapped onto the clock's today as it is now.</summary>
  public void TodayIs(DateOnly today) => _daysAhead = DaysAhead(today, _clock);

  /// <summary>
  /// The scenario's today is <paramref name="scenarioDay"/> at <paramref name="utcTime"/> UTC (c017 design.md D10): the
  /// clock moves forward to the coming day with the same weekday as <paramref name="scenarioDay"/>, at
  /// <paramref name="utcTime"/> UTC, and the scenario's dates are mapped onto it, so their distances are multiples of 7
  /// days and weekdays agree. Only after signing in, as <see cref="PassDays"/>: Microsoft's ID token is checked against the
  /// real clock. The clock only moves forward: on the same weekday the coming day is today while the clock is not yet past
  /// <paramref name="utcTime"/> (exactly at it, the clock stays), and a week later once it is.
  /// </summary>
  public void TodayIsAt(DateOnly scenarioDay, TimeOnly utcTime) {
    DateTimeOffset now = _clock.GetUtcNow();
    DateOnly today = ClockTodayOf(_clock);
    int daysToTheWeekday = ((int)scenarioDay.DayOfWeek - (int)today.DayOfWeek + DAYS_IN_A_WEEK) % DAYS_IN_A_WEEK;
    DateTimeOffset coming = new(today.AddDays(daysToTheWeekday).ToDateTime(utcTime), TimeSpan.Zero);

    if (coming < now)
      coming = coming.AddDays(DAYS_IN_A_WEEK);

    _clock.Advance(coming - now);
    _daysAhead = DaysAhead(scenarioDay, _clock);
  }

  /// <summary>The clock's date for <paramref name="scenarioDate"/>: as many days from the clock's today as it is from the scenario's.</summary>
  public DateOnly ToClock(DateOnly scenarioDate) => scenarioDate.AddDays(_daysAhead);

  /// <summary>The scenario's date for <paramref name="clockDate"/>, the inverse of <see cref="ToClock"/>.</summary>
  public DateOnly FromClock(DateOnly clockDate) => clockDate.AddDays(-_daysAhead);

  /// <summary>Moves the clock forward by <paramref name="days"/> whole days; the scenario's today moves with it.</summary>
  public void PassDays(int days) {
    ArgumentOutOfRangeException.ThrowIfNegative(days);

    _clock.Advance(TimeSpan.FromDays(days));
  }

  /// <summary>The days from <paramref name="scenarioDay"/> to the clock's today: the UTC date of its time, as the app takes today.</summary>
  private static int DaysAhead(DateOnly scenarioDay, FakeTimeProvider clock) => ClockTodayOf(clock).DayNumber - scenarioDay.DayNumber;

  /// <summary>The UTC date of <paramref name="clock"/>'s time, as the app takes today.</summary>
  private static DateOnly ClockTodayOf(FakeTimeProvider clock) => DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
}