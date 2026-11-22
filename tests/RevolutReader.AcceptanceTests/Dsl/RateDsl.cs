using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// The koruna rate, as the scenarios state it (spec koruna-rate; c017 design.md D10): today's weekday and time, the rate
/// the app keeps, the CNB's latest rate or its failure, and the requests the CNB received. The rate an answer carries
/// comes from <see cref="BalanceDsl"/> and <see cref="TransactionsDsl"/> as they are.
/// <para>
/// Every date is the scenario's, on the same calendar as <see cref="TransactionsDsl"/>'s (<see cref="ScenarioCalendar"/>);
/// the driver shifts what goes to the app's store and to the fake CNB.
/// </para>
/// <para>
/// Defaults: the scenario's today is <see cref="TransactionsDsl.DefaultToday"/>, at the clock's time of day, unless it names
/// a weekday and a time (<see cref="TodayIs"/>); a CNB the scenario sets nothing up for answers a rate no scenario names for
/// the clock's today (lessons.md R-15; <see cref="FakeCnb"/>); the app keeps no rate until the scenario keeps one.
/// </para>
/// </summary>
public sealed class RateDsl(RateDriver driver) {
  // The calendar (GIVEN)

  /// <summary>
  /// Today is <paramref name="day"/> at <paramref name="utcTime"/> UTC (D10): the app's clock moves forward to the coming
  /// day of the same weekday, at that time. Only after signing in (Microsoft's ID token is checked against the real clock),
  /// and before any step that names a date.
  /// </summary>
  public void TodayIs(DateOnly day, TimeOnly utcTime) => driver.TodayIs(day, utcTime);

  // The kept rate (GIVEN)

  /// <summary>
  /// The app keeps <paramref name="czkPerEur"/> koruna per euro for <paramref name="day"/>, written into its own store
  /// before the scenario's first request that needs a rate (the app reads it once, on first need, D2).
  /// </summary>
  public Task TheKeptRateIs(decimal czkPerEur, DateOnly day) => driver.KeepRate(czkPerEur, day);

  /// <summary>Checks that the app keeps no rate; throws when its store holds one, so a scenario never rests on a state it only assumes.</summary>
  public async Task NoRateIsKept() {
    if (await driver.KeepsARate())
      throw new InvalidOperationException("The scenario needs no rate kept, but the app's store holds one.");
  }

  // The CNB (GIVEN)

  /// <summary>The CNB's latest rate is <paramref name="czkPerEur"/> koruna per euro, for <paramref name="day"/>.</summary>
  public void TheCnbsLatestRateIs(decimal czkPerEur, DateOnly day) => driver.CnbAnswersRate(czkPerEur, day);

  /// <summary>The CNB's latest rate is <paramref name="czkPerEur"/> koruna per euro, for the scenario's today.</summary>
  public void TheCnbsLatestRateIs(decimal czkPerEur) => driver.CnbAnswersRateForToday(czkPerEur);

  /// <summary>The CNB answers with a server error.</summary>
  public void TheCnbAnswersAServerError() => driver.CnbAnswersAServerError();

  /// <summary>The CNB does not answer within the app's 2 s limit.</summary>
  public void TheCnbDoesNotAnswerInTime() => driver.CnbDoesNotAnswerInTime();

  // What the CNB received (THEN)

  /// <summary>How many requests the CNB received.</summary>
  public int RequestsTheCnbReceived() => driver.RequestsTheCnbReceived();
}