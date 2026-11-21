namespace RevolutReader.Api.Storage;

/// <summary>The <c>CheckedBalances</c> section (c014 design.md D4), validated on start as <see cref="TransactionStoreOptions"/> is.</summary>
public sealed class CheckedBalanceStoreOptions {
  public const string SECTION = "CheckedBalances";

  /// <summary>The table the account check keeps its two balances in; each acceptance test's app copy has its own.</summary>
  public required string TableName { get; init; }
}