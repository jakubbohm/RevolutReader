using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// The row a saved device is written as (c011 design.md D11, "The layout"): partition <c>devices</c>, keyed by the SHA-256
/// of its push address's UTF-8 bytes in lowercase hex, so the key holds only <c>0-9a-f</c> whatever the address holds:
/// none of the characters Table Storage forbids in a key, and no <c>%</c>; the address, the keys and the account each in
/// its own column, unchanged. The contract (<c>PushDeviceStoreContract</c>) sees only what the store reads back; this
/// reads the table's raw rows with a <see cref="TableClient"/>, since every stored device is found by that key. The test
/// saves one device through <see cref="TablePushDeviceStore"/> into a table of its own on the test session's Azurite
/// (<see cref="AzuriteTables"/>). The address, keys and account are made up; the key is written out.
/// </summary>
public sealed class PushDeviceRowKeyTests {
  /// <summary>A push address shaped as Microsoft's are, holding a slash, a question mark, escapes and a hash.</summary>
  private const string PUSH_ADDRESS = "https://wns2-par02p.notify.windows.com/w/?token=made-up%2bHk%2fM%3d#x";

  /// <summary>The SHA-256 of <see cref="PUSH_ADDRESS"/>'s UTF-8 bytes, in lowercase hex.</summary>
  private const string ROW_KEY = "1c64b364a2359eb817288d5d859c6358a70f81bf2a3aded2041e9a79d143b751";

  private const string P256DH = "made-up-public-key";
  private const string AUTH = "made-up-secret";
  private const string ACCOUNT = "Lucie@Example.com";

  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  [Test]
  public async Task A_saved_device_is_written_under_the_SHA_256_of_its_push_address_in_lowercase_hex_with_every_field_in_its_own_column() {
    string tableName = AzuriteTables.UniqueTableName();
    TablePushDeviceStore store = new(Azurite.Tables, Options.Create(new PushDeviceStoreOptions { TableName = tableName }));

    await store.Save(new PushDevice(PUSH_ADDRESS, P256DH, AUTH, ACCOUNT), CancellationToken.None);

    List<TableEntity> rows = [];

    await foreach (TableEntity row in Azurite.Tables.GetTableClient(tableName).QueryAsync<TableEntity>())
      rows.Add(row);

    TableEntity saved = rows.ShouldHaveSingleItem("the table's rows: the one device saved");
    saved.ShouldSatisfyAllConditions(
      () => saved.PartitionKey.ShouldBe("devices"),
      () => saved.RowKey.ShouldBe(ROW_KEY),
      () => saved.GetString("Endpoint").ShouldBe(PUSH_ADDRESS, "the push address, unchanged in its own column"),
      () => saved.GetString("P256dh").ShouldBe(P256DH),
      () => saved.GetString("Auth").ShouldBe(AUTH),
      () => saved.GetString("Account").ShouldBe(ACCOUNT, "the account as the sign-in gave it"));
  }
}