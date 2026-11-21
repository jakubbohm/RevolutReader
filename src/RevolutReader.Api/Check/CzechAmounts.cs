namespace RevolutReader.Api.Check;

/// <summary>Czech amounts as the app writes them (c014 design.md D2), by hand: no-break spaces, a decimal comma, U+2212 for minus.</summary>
public static class CzechAmounts {
  /// <summary>Euros with two decimals: "45,20 €", "1 234,56 €", "−5,00 €" (each space a no-break space).</summary>
  public static string Euros(decimal amount) => throw new NotImplementedException();

  /// <summary>The size of <paramref name="euros"/> at <paramref name="czkPerEur"/>, rounded half up to whole koruna and grouped: "1 098 Kč" (each space a no-break space).</summary>
  public static string WholeKoruna(decimal euros, decimal czkPerEur) => throw new NotImplementedException();
}