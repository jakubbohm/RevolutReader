using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// Push arrivals, as the scenarios state them (spec push-arrivals, c016 design.md D7): the signed-in visitor's phone reports
/// the arrival of a push, naming the read time the push's balance carried, in the browser <see cref="SignInDsl"/> signed in
/// with; and what the server recorded, each arrival's delay in whole seconds.
/// <para>
/// Defaults: a read time is given relative to the app's clock, which does not move by itself, so it is that far from the
/// server's own time when the report arrives; a report is sent at once.
/// </para>
/// </summary>
public sealed class ArrivalDsl(ArrivalDriver driver) {
  // The phone's reports (WHEN)

  /// <summary>The signed-in visitor's phone reports the arrival of a push whose balance the server read <paramref name="age"/> before its own time.</summary>
  public Task<ReportAnswer> PhoneReportsAPushReadEarlier(TimeSpan age) {
    ArgumentOutOfRangeException.ThrowIfLessThan(age, TimeSpan.Zero);

    return driver.ReportReadAt(driver.Now - age);
  }

  /// <summary>The signed-in visitor's phone reports the arrival of a push whose read time lies <paramref name="ahead"/> after the server's own time.</summary>
  public Task<ReportAnswer> PhoneReportsAPushReadAhead(TimeSpan ahead) {
    ArgumentOutOfRangeException.ThrowIfLessThan(ahead, TimeSpan.Zero);

    return driver.ReportReadAt(driver.Now + ahead);
  }

  /// <summary>The signed-in visitor's phone reports an arrival naming no read time.</summary>
  public Task<ReportAnswer> PhoneReportsAnArrivalWithNoReadTime() => driver.ReportWithNoReadTime();

  // What the server recorded (THEN)

  /// <summary>Every arrival the server recorded, as its delay in whole seconds after the read, in the order recorded.</summary>
  public IReadOnlyList<long> RecordedDelays() => driver.RecordedDelays();
}