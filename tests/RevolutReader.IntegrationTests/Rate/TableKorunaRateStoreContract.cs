using Azure.Data.Tables;
using Azure.Data.Tables.Models;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Rate;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Rate;

/// <summary>
/// The store's contract (<see cref="KorunaRateStoreContract"/>) on the Table adapter, against the test session's Azurite
/// (<see cref="AzuriteTables"/>): each test's store writes to a table no other test uses, which nothing creates before the
/// store does (D2, D9: the adapter creates its table if it is missing, as the other stores' <c>TableCreation</c>). One case
/// is the adapter's alone: the table is created when missing, before the store's first read.
/// </summary>
[InheritsTests]
public sealed class TableKorunaRateStoreContract : KorunaRateStoreContract {
  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  /// <summary>
  /// The service's first call reads the kept rate (D2), so a table that is missing, as on a first start, is created by that
  /// read, which finds nothing kept; the rate saved next reads back.
  /// </summary>
  [Test]
  public async Task The_table_is_created_when_missing() {
    string tableName = AzuriteTables.UniqueTableName();
    bool existedBefore = await TableExists(tableName);
    TableKorunaRateStore store = StoreOn(tableName);

    KorunaRate? readFirst = await store.Read(CancellationToken.None);
    bool existsAfterTheRead = await TableExists(tableName);
    await store.Save(new KorunaRate(24.41m, new DateOnly(2026, 11, 20)), CancellationToken.None);

    KorunaRate? readNext = await store.Read(CancellationToken.None);
    store.ShouldSatisfyAllConditions(
      () => existedBefore.ShouldBeFalse("no table before the store"),
      () => readFirst.ShouldBeNull("the first read finds nothing kept"),
      () => existsAfterTheRead.ShouldBeTrue("the table, created by the store's first read"),
      () => readNext.ShouldBe(new KorunaRate(24.41m, new DateOnly(2026, 11, 20)), "the rate saved into the table it created"));
  }

  protected override IKorunaRateStore NewStore() => StoreOn(AzuriteTables.UniqueTableName());

  /// <summary>The Table adapter on the table <paramref name="tableName"/> of the test session's Azurite.</summary>
  private TableKorunaRateStore StoreOn(string tableName) =>
    new(Azurite.Tables, Options.Create(new KorunaRateStoreOptions { TableName = tableName }));

  /// <summary>Whether the test session's Azurite has a table named <paramref name="tableName"/>.</summary>
  private async Task<bool> TableExists(string tableName) {
    await foreach (TableItem table in Azurite.Tables.QueryAsync(table => table.Name == tableName))
      return true;

    return false;
  }
}