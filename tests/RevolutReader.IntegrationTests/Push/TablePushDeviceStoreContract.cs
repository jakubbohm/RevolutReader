using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;

namespace RevolutReader.IntegrationTests.Push;

/// <summary>
/// The store's contract (<see cref="PushDeviceStoreContract"/>) on the Table adapter, against the test session's Azurite
/// (<see cref="AzuriteTables"/>): each test's store writes to a table no other test uses, which nothing creates before the
/// store does (D11: the adapter creates its table if it is missing).
/// </summary>
[InheritsTests]
public sealed class TablePushDeviceStoreContract : PushDeviceStoreContract {
  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  protected override IPushDeviceStore NewStore() =>
    new TablePushDeviceStore(Azurite.Tables, Options.Create(new PushDeviceStoreOptions { TableName = AzuriteTables.UniqueTableName() }));
}