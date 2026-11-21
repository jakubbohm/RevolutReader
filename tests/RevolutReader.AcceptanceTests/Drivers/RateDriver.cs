namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// The koruna rate (spec koruna-rate; c017 design.md D10): the scenario's weekday and time, the rate the app keeps, and the
/// fake CNB's answers and the requests it received. The fake CNB's wire stays in <see cref="FakeCnb"/> and the kept rate in
/// the app copy's own store; the DSL gets dates of the scenario's calendar and counts.
/// <list type="bullet">
/// <item><see cref="TodayIs"/>: the scenario's calendar moves the app copy's clock to the coming day of the scenario's
/// weekday, at the given UTC time (<see cref="ScenarioCalendar.TodayIsAt"/>), only after signing in.</item>
/// <item><see cref="KeepRate"/> and <see cref="KeepsARate"/> write and read through the app copy's own
/// <c>IKorunaRateStore</c> (from its services, so the real Table adapter on the test's own table in Azurite,
/// <see cref="AzuriteStorage"/>), the day shifted onto the clock. A rate is kept before the scenario's first request that
/// needs one: the app reads the kept rate once, on first need (D2).</item>
/// <item>The CNB's answers go to <see cref="FakeCnb"/>, their day shifted onto the clock; the scenario's today is the
/// clock's today.</item>
/// </list>
/// Filled in by the wiring groups (tasks.md 6.6, 13.1, 21.1, 23.1, 26.1); until then every method throws, here or in
/// <see cref="ScenarioCalendar"/> and <see cref="FakeCnb"/>, where its step lives.
/// </summary>
public sealed class RateDriver(FakeCnb cnb, ScenarioCalendar calendar, IServiceProvider app) {
  /// <summary>The app copy's services, for its store of the kept rate (tasks.md 13.1, 26.1).</summary>
  internal IServiceProvider App => app;

  /// <summary>
  /// Today is <paramref name="scenarioDay"/> at <paramref name="utcTime"/> UTC: the calendar moves the clock to the coming
  /// day of that weekday at that time (<see cref="ScenarioCalendar.TodayIsAt"/>, tasks.md 13.1).
  /// </summary>
  public void TodayIs(DateOnly scenarioDay, TimeOnly utcTime) => calendar.TodayIsAt(scenarioDay, utcTime);

  /// <summary>
  /// The app keeps <paramref name="czkPerEur"/> koruna per euro for <paramref name="scenarioDay"/>, written through its own
  /// <c>IKorunaRateStore</c>, the day shifted onto the clock. Wired in tasks.md 13.1.
  /// </summary>
  public Task KeepRate(decimal czkPerEur, DateOnly scenarioDay) => throw new NotImplementedException("Keeping a rate through the app copy's store is wired in tasks.md 13.1.");

  /// <summary>Whether the app's own <c>IKorunaRateStore</c> holds a rate. Wired in tasks.md 26.1.</summary>
  public Task<bool> KeepsARate() => throw new NotImplementedException("Reading the app copy's kept rate is wired in tasks.md 26.1.");

  /// <summary>
  /// The CNB's latest rate is <paramref name="czkPerEur"/> koruna per euro for <paramref name="scenarioDay"/>, the day
  /// shifted onto the clock (<see cref="FakeCnb.AnswerRate"/>). Wired in tasks.md 6.6.
  /// </summary>
  public void CnbAnswersRate(decimal czkPerEur, DateOnly scenarioDay) => throw new NotImplementedException("The CNB's latest rate for a day is wired in tasks.md 6.6.");

  /// <summary>
  /// The CNB's latest rate is <paramref name="czkPerEur"/> koruna per euro for the scenario's today, the clock's today
  /// (<see cref="FakeCnb.AnswerRate"/>). Wired in tasks.md 6.6.
  /// </summary>
  public void CnbAnswersRateForToday(decimal czkPerEur) => throw new NotImplementedException("The CNB's latest rate for today is wired in tasks.md 6.6.");

  /// <summary>The CNB answers with a server error (<see cref="FakeCnb.AnswerServerError"/>, tasks.md 21.1).</summary>
  public void CnbAnswersAServerError() => cnb.AnswerServerError();

  /// <summary>The CNB does not answer within the 2 s limit (<see cref="FakeCnb.AnswerNeverInTime"/>, tasks.md 23.1).</summary>
  public void CnbDoesNotAnswerInTime() => cnb.AnswerNeverInTime();

  /// <summary>How many requests the CNB received (<see cref="FakeCnb.RequestsReceived"/>). Wired in tasks.md 6.6.</summary>
  public int RequestsTheCnbReceived() => throw new NotImplementedException("The CNB's count of requests is wired in tasks.md 6.6.");
}