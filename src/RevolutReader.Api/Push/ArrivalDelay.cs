namespace RevolutReader.Api.Push;

/// <summary>
/// The delay a report of a push's arrival records (spec push-arrivals, c016 design.md D4), pure: the server's time when the
/// report arrives minus the read time the push's balance carried, in whole seconds, rounded down, never below 0.
/// </summary>
public static class ArrivalDelay {
  /// <summary>The whole seconds from <paramref name="readAt"/> to <paramref name="now"/>, rounded down, never below 0.</summary>
  public static long Seconds(DateTimeOffset readAt, DateTimeOffset now) => throw new NotImplementedException();
}