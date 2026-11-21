namespace RevolutReader.Api.Push;

/// <summary>
/// The delay a report of a push's arrival records (spec push-arrivals, c016 design.md D4), pure: the server's time when the
/// report arrives minus the read time the push's balance carried, in whole seconds, rounded down.
/// </summary>
public static class ArrivalDelay {
  /// <summary>
  /// The whole seconds from <paramref name="readAt"/> to <paramref name="now"/>, between instants (their offsets play no
  /// part), the fraction of a second dropped, so a delay (<paramref name="now"/> after <paramref name="readAt"/>) is rounded
  /// down. Counted in ticks, never through a <see cref="double"/>, so it is exact for any two <see cref="DateTimeOffset"/>s.
  /// </summary>
  public static long Seconds(DateTimeOffset readAt, DateTimeOffset now) => (now - readAt).Ticks / TimeSpan.TicksPerSecond;
}