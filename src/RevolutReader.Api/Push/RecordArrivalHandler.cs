namespace RevolutReader.Api.Push;

/// <summary>
/// Records a push's arrival on a device (spec push-arrivals, c016 design.md D4): the delay from the read time the push's
/// balance carried to the server's own time now (<see cref="ArrivalDelay"/>), logged as one
/// <see cref="PushLog.PushArrived"/> line holding the delay alone: never the read time, an amount or the account.
/// </summary>
public sealed class RecordArrivalHandler(TimeProvider clock, ILogger<RecordArrivalHandler> logger) {
  /// <summary>Records the arrival of a push whose balance was read at <paramref name="readAt"/>, as the class describes.</summary>
  public void Record(DateTimeOffset readAt) {
    long delaySeconds = ArrivalDelay.Seconds(readAt, clock.GetUtcNow());

    PushLog.PushArrived(logger, delaySeconds);
  }
}