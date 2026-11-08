namespace RevolutReader.Api.Account;

/// <summary>
/// The euro's rate in Czech koruna, which the screen converts euro amounts with (the user, 2026-11-08, roadmap C13): a
/// constant until GitHub issue #39 sources a daily rate from an outside service. The Czech National Bank's rate valid on
/// 2026-11-08 was 24.345 (declared 2026-11-06), so 24.3 is about 0.2% below it, harmless on a line marked "≈". C7a's
/// answer carries the rate, and C7b's carries the rate with its date. The screen converts and rounds once, as the design
/// does (whole koruna, the size only, half up), so the backend never rounds: rounding to halers first and then to whole
/// koruna on the screen would be 1 Kč off for 0.5% of amounts, and .NET's default rounding is to even, unlike the
/// screen's half up. An amount not in euros gets no koruna line, a rule on the screen.
/// </summary>
public static class KorunaRate {
  /// <summary>Koruna per euro.</summary>
  public static decimal CzkPerEur => 24.3m;

  /// <summary>
  /// The day the rate is for. Only C7b's transaction sheet shows it ("orientační kurz z 8. 11. 2026"), so only C7b's
  /// answer carries it.
  /// </summary>
  public static DateOnly Date => new(2026, 11, 8);
}