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
/// Filled in by the wiring groups; until then every method throws.
/// </summary>
public sealed class ScenarioCalendar(DateOnly scenarioToday, FakeTimeProvider clock) {
  /// <summary>The scenario's today, mapped onto the clock's today.</summary>
  private DateOnly ScenarioToday => scenarioToday;

  /// <summary>The app copy's clock.</summary>
  private FakeTimeProvider Clock => clock;

  /// <summary>The scenario's today is <paramref name="today"/>, mapped onto the clock's today as it is now.</summary>
  public void TodayIs(DateOnly today) => throw new NotImplementedException();

  /// <summary>The clock's date for <paramref name="scenarioDate"/>: as many days from the clock's today as it is from the scenario's.</summary>
  public DateOnly ToClock(DateOnly scenarioDate) => throw new NotImplementedException();

  /// <summary>The scenario's date for <paramref name="clockDate"/>, the inverse of <see cref="ToClock"/>.</summary>
  public DateOnly FromClock(DateOnly clockDate) => throw new NotImplementedException();

  /// <summary>Moves the clock forward by <paramref name="days"/> whole days; the scenario's today moves with it.</summary>
  public void PassDays(int days) => throw new NotImplementedException();
}