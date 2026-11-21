using System.Globalization;

namespace RevolutReader.Api.Check;

/// <summary>
/// Czech amounts as the app writes them (c014 design.md D2), by hand: a decimal comma, no-break spaces (U+00A0) as the
/// thousands separator and before the currency, U+2212 for minus. Never through .NET's Czech culture: the runtime image
/// runs with invariant globalization, so it has no culture data, and even with it, .NET's and the browser's Czech formats
/// could differ in a space. The digits come from the invariant culture, which needs no culture data.
/// </summary>
public static class CzechAmounts {
  /// <summary>A no-break space: the thousands separator, and the space before "€" and "Kč" (D2).</summary>
  private const char NO_BREAK_SPACE = ' ';

  /// <summary>The minus sign the app's header writes (U+2212), never the hyphen-minus.</summary>
  private const char MINUS = '−';

  private const char DECIMAL_COMMA = ',';

  private const string EURO = "€";
  private const string KORUNA = "Kč";

  /// <summary>
  /// Euros with two decimals: "45,20 €", "1 234,56 €", "−5,00 €" (each space a no-break space). An amount finer than cents
  /// is rounded half away from zero, as the browser's number format rounds it.
  /// </summary>
  public static string Euros(decimal amount) {
    decimal size = Math.Round(Math.Abs(amount), 2, MidpointRounding.AwayFromZero);
    decimal whole = decimal.Truncate(size);
    int cents = (int)((size - whole) * 100);

    return string.Concat(
      amount < 0 ? MINUS.ToString() : string.Empty,
      Grouped(whole),
      DECIMAL_COMMA.ToString(),
      cents.ToString("00", CultureInfo.InvariantCulture),
      NO_BREAK_SPACE.ToString(),
      EURO);
  }

  /// <summary>
  /// The size of <paramref name="euros"/> at <paramref name="czkPerEur"/>, rounded half up to whole koruna and grouped:
  /// "1 098 Kč" (each space a no-break space). Rounded as the frontend's <c>wholeCrowns</c> rounds it (c010 design.md D6,
  /// <c>src/RevolutReader.Web/src/app/format.ts</c>), so the notification and the app show the same koruna: the size in whole
  /// cents and the rate in ten-thousandths of a koruna, each rounded half up, multiplied, then the millionths of a koruna
  /// rounded half up to whole koruna.
  /// </summary>
  public static string WholeKoruna(decimal euros, decimal czkPerEur) {
    decimal cents = Math.Round(Math.Abs(euros) * 100m, MidpointRounding.AwayFromZero);
    decimal rateInTenThousandths = Math.Round(czkPerEur * 10_000m, MidpointRounding.AwayFromZero);
    decimal crowns = Math.Floor(((cents * rateInTenThousandths) + 500_000m) / 1_000_000m);

    return string.Concat(Grouped(crowns), NO_BREAK_SPACE.ToString(), KORUNA);
  }

  /// <summary>
  /// The whole number <paramref name="whole"/>'s digits, grouped by threes with no-break spaces: the invariant culture's
  /// fixed grouping (always by threes, with a comma), its comma replaced.
  /// </summary>
  private static string Grouped(decimal whole) =>
    whole.ToString("#,0", CultureInfo.InvariantCulture).Replace(',', NO_BREAK_SPACE);
}