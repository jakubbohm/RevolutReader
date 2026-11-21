using System.Diagnostics.CodeAnalysis;

namespace RevolutReader.Api.Rate;

/// <summary>When the CNB is asked (c017 design.md D3): a pure rule, in UTC, Monday to Friday, no holiday list.</summary>
public static class RateAsking {
  /// <summary>08:00 UTC on the first day from Monday to Friday after <paramref name="keptDay"/>. A compile-only stub until tasks.md 13.1.</summary>
  public static DateTimeOffset NextAskFrom(DateOnly keptDay) => throw new NotImplementedException("RateAsking.NextAskFrom is implemented in tasks.md 13.1.");

  /// <summary>
  /// Nothing kept, or <paramref name="now"/> at or after NextAskFrom(kept.Date); so a rate that is not due is always a kept
  /// one. Until tasks.md 13.1 brings <see cref="NextAskFrom"/>, only nothing kept is due: a kept rate never is.
  /// </summary>
  public static bool IsDue([NotNullWhen(false)] KorunaRate? kept, DateTimeOffset now) => kept is null;
}