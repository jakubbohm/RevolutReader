namespace RevolutReader.Api.Account;

/// <summary>
/// The euro's rate in Czech koruna, which the screen converts euro amounts with (the user, 2026-11-08, roadmap C13): a
/// constant until GitHub issue #39 sources a daily rate from an outside service. The screen converts and rounds once; the
/// backend never rounds.
/// </summary>
public static class KorunaRate {
  // The red step's stub only: a property may not throw NotImplementedException (CA1065), and the tests must fail at run
  // time, not at compile time. The implementation replaces both bodies and removes this suppression.
#pragma warning disable CA1065
  /// <summary>Koruna per euro.</summary>
  public static decimal CzkPerEur => throw new NotImplementedException();

  /// <summary>The day the rate is for.</summary>
  public static DateOnly Date => throw new NotImplementedException();
#pragma warning restore CA1065
}