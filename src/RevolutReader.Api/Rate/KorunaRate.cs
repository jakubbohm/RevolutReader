namespace RevolutReader.Api.Rate;

/// <summary>The euro's rate in koruna and the day it is for (c017 design.md D1): the CNB's rate / amount and its validFor.</summary>
public sealed record KorunaRate(decimal CzkPerEur, DateOnly Date) {
  /// <summary>
  /// The app's own rate (D5): the CNB's for 2026-11-20, its latest when the change was proposed. Answered only while nothing
  /// is kept and an ask fails; never kept.
  /// </summary>
  public static KorunaRate AppsOwn { get; } = new(24.47m, new DateOnly(2026, 11, 20));
}