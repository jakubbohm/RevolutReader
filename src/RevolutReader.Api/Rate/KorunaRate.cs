namespace RevolutReader.Api.Rate;

/// <summary>The euro's rate in koruna and the day it is for (c017 design.md D1): the CNB's rate / amount and its validFor.</summary>
public sealed record KorunaRate(decimal CzkPerEur, DateOnly Date) {
  /// <summary>
  /// The app's own rate (D5): the CNB's for 2026-11-20. Answered only while nothing is kept and an ask fails; never kept.
  /// A compile-only stub until tasks.md 6.1, <see langword="null"/> so its test fails at runtime: a property may not throw
  /// <see cref="NotImplementedException"/> (CA1065).
  /// </summary>
  public static KorunaRate AppsOwn { get; } = null!;
}