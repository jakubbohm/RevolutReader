using System.Globalization;

namespace RevolutReader.Api.Bank;

/// <summary>
/// An amount as Enable Banking writes it (API reference <c>AmountType</c>): a string such as <c>"1234.56"</c>, a point
/// whatever the machine's culture, a minus sign when negative, no thousands separators.
/// </summary>
public static class WireAmount {
  private const NumberStyles STYLES = NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint;

  /// <summary>
  /// Whether <paramref name="text"/> is such an amount. A try, not a parse: <c>decimal.Parse</c>'s
  /// <see cref="FormatException"/> quotes its input, so it would carry the amount into the error (c004 design.md D5).
  /// </summary>
  public static bool TryParse(string? text, out decimal amount) => decimal.TryParse(text, STYLES, CultureInfo.InvariantCulture, out amount);
}