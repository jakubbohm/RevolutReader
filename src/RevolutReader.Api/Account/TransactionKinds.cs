namespace RevolutReader.Api.Account;

/// <summary>The kind of a type code (c010 design.md D4): the five known codes; any code containing REFUND, ignoring case; else Other.</summary>
public static class TransactionKinds {
  /// <summary>The kind the bank's type code names.</summary>
  public static TransactionKind Of(string? typeCode) => throw new NotImplementedException();

  /// <summary>Whether the app knows the code; when it does not, the handler logs it (D4c).</summary>
  public static bool IsKnown(string? typeCode) => throw new NotImplementedException();

  /// <summary>Whether the code looks like one (<c>^[A-Z0-9_]{1,40}$</c>), and so may be quoted in the log (D4c).</summary>
  public static bool LooksLikeACode(string? typeCode) => throw new NotImplementedException();
}