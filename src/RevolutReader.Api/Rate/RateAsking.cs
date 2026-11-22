using System.Diagnostics.CodeAnalysis;

namespace RevolutReader.Api.Rate;

/// <summary>
/// When the CNB is asked (c017 design.md D3): a pure rule, in UTC, Monday to Friday, no holiday list. The CNB publishes on
/// working days, a rate valid for that day and any weekend after it, so nothing newer than a kept rate can come before the
/// next weekday; 08:00 UTC is the owner's choice of that day's first ask, earlier than the publication, with no time zone.
/// </summary>
public static class RateAsking {
  /// <summary>The time of day, in UTC, from which the next weekday's ask may be made.</summary>
  private static readonly TimeOnly _askFrom = new(8, 0);

  /// <summary>08:00 UTC on the first day from Monday to Friday after <paramref name="keptDay"/>.</summary>
  public static DateTimeOffset NextAskFrom(DateOnly keptDay) {
    DateOnly askDay = keptDay.AddDays(keptDay.DayOfWeek switch {
      DayOfWeek.Friday => 3,
      DayOfWeek.Saturday => 2,
      _ => 1,
    });

    return new DateTimeOffset(askDay.ToDateTime(_askFrom), TimeSpan.Zero);
  }

  /// <summary>
  /// Nothing kept, or <paramref name="now"/> at or after <see cref="NextAskFrom"/> of the kept rate's day, compared as
  /// instants whatever offset <paramref name="now"/> is given at; so a rate that is not due is always a kept one.
  /// </summary>
  public static bool IsDue([NotNullWhen(false)] KorunaRate? kept, DateTimeOffset now) => kept is null || now >= NextAskFrom(kept.Date);
}