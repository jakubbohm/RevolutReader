namespace RevolutReader.Api.Account;

/// <summary>The kind of a type code (c010 design.md D4): the five known codes; any code containing REFUND, ignoring case; else Other.</summary>
public static class TransactionKinds {
  /// <summary>The longest text that still looks like a code (D4c).</summary>
  private const int LONGEST_CODE = 40;

  /// <summary>The word that makes a code a refund, in any letter case (D4c).</summary>
  private const string REFUND = "REFUND";

  /// <summary>
  /// The kind the bank's type code names: the five codes Revolut uses in the history, each exactly as the bank writes it;
  /// a refund for any code containing <c>REFUND</c>, ordinal, ignoring case (D4c); other for anything else, a missing code too.
  /// </summary>
  public static TransactionKind Of(string? typeCode) => typeCode switch {
    null => TransactionKind.Other,
    _ when KnownKind(typeCode) is TransactionKind known => known,
    _ when typeCode.Contains(REFUND, StringComparison.OrdinalIgnoreCase) => TransactionKind.Refund,
    _ => TransactionKind.Other,
  };

  /// <summary>
  /// Whether the app knows the code: the five codes only, so a refund code is not known either; when it is not, the handler
  /// logs it (D4c).
  /// </summary>
  public static bool IsKnown(string? typeCode) => typeCode is not null && KnownKind(typeCode) is not null;

  /// <summary>
  /// Whether the code looks like one, and so may be quoted in the log (D4c): 1 to 40 characters, each a capital A to Z, a
  /// digit 0 to 9 or an underscore, the whole text (<c>^[A-Z0-9_]{1,40}$</c>, with nothing let through after a line break
  /// at its end, as a pattern anchored with <c>$</c> alone would).
  /// </summary>
  public static bool LooksLikeACode(string? typeCode) =>
    typeCode is { Length: > 0 and <= LONGEST_CODE } && typeCode.All(static character => char.IsAsciiLetterUpper(character) || char.IsAsciiDigit(character) || character == '_');

  /// <summary>The kind of one of the five known codes, compared exactly; none for any other code.</summary>
  private static TransactionKind? KnownKind(string typeCode) => typeCode switch {
    "CARD_PAYMENT" => TransactionKind.CardPayment,
    "TOPUP" => TransactionKind.TopUp,
    "TRANSFER" => TransactionKind.Transfer,
    "ATM" => TransactionKind.CashWithdrawal,
    "EXCHANGE" => TransactionKind.Exchange,
    _ => null,
  };
}