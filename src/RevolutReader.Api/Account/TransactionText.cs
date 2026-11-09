using System.Globalization;
using System.Text;

namespace RevolutReader.Api.Account;

/// <summary>
/// The bank's lines without blank lines and without any line repeating the counterparty, compared ignoring letter case,
/// accents and spacing; runs of spaces in a kept line collapsed (c010 design.md D4b, the design system's descriptionLines).
/// A blank counterparty counts as none.
/// </summary>
public static class TransactionText {
  /// <summary>
  /// The counterparty as the app shows it: the bank's name as it is, or <see langword="null"/> when the bank gives none, an
  /// empty one or one of white space only.
  /// </summary>
  public static string? Counterparty(string? counterparty) => string.IsNullOrWhiteSpace(counterparty) ? null : counterparty;

  /// <summary>
  /// The bank's lines in their order, each with its runs of white space collapsed to one space and none at its ends;
  /// blank lines left out, and every line that is nothing but the counterparty's name: the same letters once accents are
  /// taken off, in any letter case (culture-independent), with any spacing. Without a counterparty, or with a blank one
  /// (<see cref="Counterparty"/>), there is no name to compare with, and only blank lines go.
  /// </summary>
  public static IReadOnlyList<string> Details(string? counterparty, IReadOnlyList<string> paymentDetails) {
    ArgumentNullException.ThrowIfNull(paymentDetails);

    string? name = Counterparty(counterparty) is { } shown ? Comparable(shown) : null;

    return [
      .. paymentDetails
        .Select(Collapsed)
        .Where(line => line.Length > 0 && (name is null || !string.Equals(Comparable(line), name, StringComparison.OrdinalIgnoreCase))),
    ];
  }

  /// <summary>The text with each run of white space as one space, and none at its ends.</summary>
  private static string Collapsed(string text) => string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

  /// <summary>The text as two lines are compared: without accents, its spacing collapsed; letter case is ignored where it is compared.</summary>
  private static string Comparable(string text) => Collapsed(WithoutAccents(text));

  /// <summary>The text with its accents taken off: decomposed, so "á" becomes "a" and a combining mark, and the marks dropped.</summary>
  private static string WithoutAccents(string text) {
    StringBuilder letters = new(text.Length);

    foreach (char character in text.Normalize(NormalizationForm.FormD)) {
      if (CharUnicodeInfo.GetUnicodeCategory(character) is not (UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark))
        letters.Append(character);
    }

    return letters.ToString();
  }
}