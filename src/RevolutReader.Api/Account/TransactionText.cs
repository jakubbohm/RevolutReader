namespace RevolutReader.Api.Account;

/// <summary>
/// The bank's lines without blank lines and without any line repeating the counterparty, compared ignoring letter case,
/// accents and spacing; runs of spaces in a kept line collapsed (c010 design.md D4b, the design system's descriptionLines).
/// </summary>
public static class TransactionText {
  public static IReadOnlyList<string> Details(string? counterparty, IReadOnlyList<string> paymentDetails) => throw new NotImplementedException();
}