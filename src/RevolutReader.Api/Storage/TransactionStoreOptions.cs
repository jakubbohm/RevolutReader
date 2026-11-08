namespace RevolutReader.Api.Storage;

/// <summary>The <c>Transactions</c> section (c010 design.md D11), validated on start.</summary>
public sealed class TransactionStoreOptions {
  public const string SECTION = "Transactions";

  /// <summary>The table the transactions are kept in.</summary>
  public required string TableName { get; init; }
}