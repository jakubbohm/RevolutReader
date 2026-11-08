namespace RevolutReader.Api.Bank;

/// <summary>The shape of an Enable Banking error code (c006 design.md D7).</summary>
public static class EnableBankingErrorCode {
  /// <summary>A capital letter, then capital letters and underscores, 64 characters at most (^[A-Z][A-Z_]{0,63}$, ordinal).</summary>
  public static bool HasCodeShape(string? value) => throw new NotImplementedException();
}