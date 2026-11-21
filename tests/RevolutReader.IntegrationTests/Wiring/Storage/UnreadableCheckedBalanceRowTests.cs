using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// The row of the checked balances table the store cannot read (c014 design.md § Error model, D4): a column it needs is
/// missing, or holds something the store never writes. Each is an <see cref="InvalidOperationException"/> naming the
/// column, never a parser's or the client's own exception, and its text quotes nothing from the row: the row is bank data
/// (two balances and their read times). Each test writes the one row straight into a table of its own on the test
/// session's Azurite (<see cref="AzuriteTables"/>), as the store would but for the one column the case is about, and then
/// reads it through the store. The values are made up: the amounts distinctive, and each text in the column's place holding
/// a marker; neither may turn up in the error.
/// </summary>
public sealed class UnreadableCheckedBalanceRowTests {
  /// <summary>Distinctive, so it cannot turn up in an error's text by coincidence.</summary>
  private const string MARKER = "5d1f8e";

  /// <summary>The row's amounts and rates as the store writes them, invariant decimal text, each distinctive.</summary>
  private const string LAST_SEEN_AMOUNT = "7531.86";
  private const string LAST_NOTIFIED_AMOUNT = "6420.97";
  private const string LAST_SEEN_RATE = "24.3175";
  private const string LAST_NOTIFIED_RATE = "24.2864";

  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  /// <param name="column">The column the case is about, as the store names it.</param>
  /// <param name="content">What the column holds instead of what the store writes, or <c>missing</c> when the row has no such column.</param>
  [Test]
  [Arguments("LastSeenAmount", "missing")]
  [Arguments("LastSeenAmount", "a decimal comma")]
  [Arguments("LastSeenAmount", "a number")]
  [Arguments("LastSeenReadAt", "missing")]
  [Arguments("LastSeenReadAt", "text")]
  [Arguments("LastSeenCzkPerEur", "missing")]
  [Arguments("LastSeenCzkPerEur", "a decimal comma")]
  [Arguments("LastNotifiedAmount", "missing")]
  [Arguments("LastNotifiedAmount", "a decimal comma")]
  [Arguments("LastNotifiedAmount", "a number")]
  [Arguments("LastNotifiedReadAt", "missing")]
  [Arguments("LastNotifiedReadAt", "text")]
  [Arguments("LastNotifiedCzkPerEur", "missing")]
  [Arguments("LastNotifiedCzkPerEur", "a decimal comma")]
  public async Task A_row_the_store_cannot_read_is_an_error_naming_the_column_and_quoting_nothing_from_the_row(string column, string content) {
    TableEntity row = WrittenRow();

    if (content == "missing")
      row.Remove(column);
    else
      row[column] = content switch {
        "a decimal comma" => $"45,20 {MARKER}",
        "a number" => 7,
        "text" => $"2026-11-21T09:14:03Z {MARKER}",
        _ => throw new ArgumentOutOfRangeException(nameof(content), content, "Not a known case."),
      };

    TableCheckedBalanceStore store = await StoreHolding(row);

    InvalidOperationException error = await Should.ThrowAsync<InvalidOperationException>(() => store.Read(CancellationToken.None));

    string[] fromTheRow = [MARKER, LAST_SEEN_AMOUNT, LAST_NOTIFIED_AMOUNT, LAST_SEEN_RATE, LAST_NOTIFIED_RATE, "2026-11-21", "2026-11-20"];
    error.ShouldSatisfyAllConditions(
      () => error.Message.ShouldContain(column, Case.Sensitive),
      () => fromTheRow.Where(value => error.ToString().Contains(value, StringComparison.Ordinal)).ShouldBeEmpty("the error quotes nothing from the row"));
  }

  /// <summary>A store whose table, of its own, holds this one row, written straight into it.</summary>
  private async Task<TableCheckedBalanceStore> StoreHolding(TableEntity row) {
    string tableName = AzuriteTables.UniqueTableName();
    TableClient table = Azurite.Tables.GetTableClient(tableName);
    await table.CreateIfNotExistsAsync();
    await table.UpsertEntityAsync(row, TableUpdateMode.Replace);

    return new TableCheckedBalanceStore(Azurite.Tables, Options.Create(new CheckedBalanceStoreOptions { TableName = tableName }));
  }

  /// <summary>
  /// The two balances as the store writes them (D4): partition <c>check</c>, row key <c>balances</c>, the amounts and
  /// rates as invariant decimal text, the read times as the table's date type; each test changes the column it is about.
  /// </summary>
  private static TableEntity WrittenRow() =>
    new("check", "balances") {
      ["LastSeenAmount"] = LAST_SEEN_AMOUNT,
      ["LastSeenReadAt"] = new DateTimeOffset(2026, 11, 21, 9, 14, 3, TimeSpan.Zero),
      ["LastSeenCzkPerEur"] = LAST_SEEN_RATE,
      ["LastNotifiedAmount"] = LAST_NOTIFIED_AMOUNT,
      ["LastNotifiedReadAt"] = new DateTimeOffset(2026, 11, 20, 18, 2, 44, TimeSpan.Zero),
      ["LastNotifiedCzkPerEur"] = LAST_NOTIFIED_RATE,
    };
}