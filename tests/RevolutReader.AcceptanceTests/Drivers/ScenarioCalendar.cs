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
/// store and the API's query); <see cref="FromClock"/> shifts a date the app or the fake bank gave back.</item>
/// <item><see cref="PassDays"/> moves the clock by whole days, and the scenario's today with it: the mapping keeps its
/// distance, so a date shifts the same before and after.</item>
/// <item><see cref="TodayIs"/> names the scenario's today, before any date is shifted; until then it is the one the
/// calendar was made with.</item>
/// </list>
/// The mapping is a fixed number of days, set when the scenario's today is named: whatever moves the clock (this
/// calendar, or <c>SignInDsl.DaysPass</c>), the scenario's today moves with it, and a date already written stays the
/// scenario's same date.
/// </summary>
public sealed class ScenarioCalendar(DateOnly scenarioToday, FakeTimeProvider clock) {
  /// <summary>The app copy's clock.</summary>
  private readonly FakeTimeProvider _clock = clock;

  /// <summary>How many days the clock's dates are ahead of the scenario's.</summary>
  private int _daysAhead = DaysAhead(scenarioToday, clock);

  /// <summary>The scenario's today is <paramref name="today"/>, mapped onto the clock's today as it is now.</summary>
  public void TodayIs(DateOnly today) => _daysAhead = DaysAhead(today, _clock);

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
  private static int DaysAhead(DateOnly scenarioDay, FakeTimeProvider clock) =>
    DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime).DayNumber - scenarioDay.DayNumber;
}