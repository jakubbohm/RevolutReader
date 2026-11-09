using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// The row key a kept transaction is written under (c010 design.md D5, "Row key"): the SHA-256 of its reference's UTF-8
/// bytes, in lowercase hex, so the key holds only <c>0-9a-f</c> whatever the reference holds: none of the characters Table
/// Storage forbids in a key, and no <c>%</c>, which escaping would bring. The reference itself stays unchanged in its own
/// column. The test keeps one transaction through <see cref="TableTransactionStore"/> into a table of its own on the test
/// session's Azurite (<see cref="AzuriteTables"/>), then reads the table's raw rows with a <see cref="TableClient"/>. The
/// reference and the transaction are made up; the key is written out, since it is what every stored row is found by.
/// </summary>
public sealed class RowKeyTests {
  /// <summary>A reference holding a slash, an accented letter, a space and a percent sign.</summary>
  private const string REFERENCE = "e/kavárna 50%";

  /// <summary>The SHA-256 of <see cref="REFERENCE"/>'s UTF-8 bytes, in lowercase hex.</summary>
  private const string ROW_KEY = "4b0cf44f70551ba9343d205836259679616f6fdf224ce0fd7091c66eba30e21a";

  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  [Test]
  public async Task A_kept_transaction_is_written_under_the_SHA_256_of_its_reference_in_lowercase_hex() {
    string tableName = AzuriteTables.UniqueTableName();
    TableTransactionStore store = new(Azurite.Tables, Options.Create(new TransactionStoreOptions { TableName = tableName }));

    await store.Keep([
      new KeptTransaction(REFERENCE, new DateOnly(2026, 11, 18), Position: 0, Amount: -12.30m, Currency: "EUR", Counterparty: "Pekárna U Lípy", PaymentDetails: ["Praha 2"], TypeCode: "CARD_PAYMENT"),
    ], CancellationToken.None);

    List<TableEntity> rows = [];

    await foreach (TableEntity row in Azurite.Tables.GetTableClient(tableName).QueryAsync<TableEntity>())
      rows.Add(row);

    TableEntity kept = rows.ShouldHaveSingleItem("the table's rows: the one transaction kept");
    kept.ShouldSatisfyAllConditions(
      () => kept.PartitionKey.ShouldBe("account"),
      () => kept.RowKey.ShouldBe(ROW_KEY),
      () => kept.GetString("Reference").ShouldBe(REFERENCE, "the reference, unchanged in its own column"));
  }
}