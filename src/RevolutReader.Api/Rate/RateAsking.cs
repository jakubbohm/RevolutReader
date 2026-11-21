namespace RevolutReader.Api.Rate;

/// <summary>When the CNB is asked (c017 design.md D3): a pure rule, in UTC, Monday to Friday, no holiday list.</summary>
public static class RateAsking {
  /// <summary>08:00 UTC on the first day from Monday to Friday after <paramref name="keptDay"/>. A compile-only stub until tasks.md 13.1.</summary>
  public static DateTimeOffset NextAskFrom(DateOnly keptDay) => throw new NotImplementedException("RateAsking.NextAskFrom is implemented in tasks.md 13.1.");

  /// <summary>Nothing kept, or <paramref name="now"/> at or after NextAskFrom(kept.Date). A compile-only stub until tasks.md 6.1.</summary>
  public static bool IsDue(KorunaRate? kept, DateTimeOffset now) => throw new NotImplementedException("RateAsking.IsDue is implemented in tasks.md 6.1.");
}