using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;

namespace RevolutReader.IntegrationTests.Account;

/// <summary>
/// The store's contract (<see cref="TransactionStoreContract"/>) on the Table adapter, against the test session's Azurite
/// (<see cref="AzuriteTables"/>): each test's store writes to a table no other test uses, which nothing creates before the
/// store does (D5: the adapter creates its table if it is missing).
/// </summary>
[InheritsTests]
public sealed class TableTransactionStoreContract : TransactionStoreContract {
  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  protected override ITransactionStore NewStore() =>
    new TableTransactionStore(Azurite.Tables, Options.Create(new TransactionStoreOptions { TableName = AzuriteTables.UniqueTableName() }));
}