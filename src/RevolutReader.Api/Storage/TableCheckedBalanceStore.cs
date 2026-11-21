using System.Globalization;
using Azure;
using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;
using RevolutReader.Api.Check;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="ICheckedBalanceStore"/> on Azure Table Storage (c014 design.md D4, § Ports and contracts): the table
/// <see cref="CheckedBalanceStoreOptions.TableName"/>, one row, partition <c>check</c>, row key <c>balances</c>. As
/// <see cref="TableTransactionStore"/>:
/// <list type="bullet">
/// <item>The columns: <c>LastSeenAmount</c>, <c>LastSeenReadAt</c>, <c>LastSeenCzkPerEur</c>, <c>LastNotifiedAmount</c>,
/// <c>LastNotifiedReadAt</c> and <c>LastNotifiedCzkPerEur</c>; the amounts and rates as invariant decimal strings (tables
/// have no decimal type, and a double would lose cents or a rate's decimals), the read times as the table's date type,
/// which keeps the instant in UTC to the tick.</item>
/// <item>A save replaces the whole row; no row reads as nothing stored.</item>
/// <item>The table is created when missing, once per instance, before its first read or write; a creation that failed is
/// tried again by the next call (<see cref="TableCreation"/>).</item>
/// <item>A row it cannot read is an <see cref="InvalidOperationException"/> naming the column, never its value; the
/// storage's own failures pass on as the client's exceptions (§ Error model). Logs nothing.</item>
/// </list>
/// Last write wins: one app copy runs one check at a time (D10), and two copies during a deploy are not guarded (D13).
/// </summary>
public sealed class TableCheckedBalanceStore : ICheckedBalanceStore {
  /// <summary>The one row's keys (D4).</summary>
  private const string PARTITION = "check";
  private const string ROW = "balances";

  private const string LAST_SEEN_AMOUNT = "LastSeenAmount";
  private const string LAST_SEEN_READ_AT = "LastSeenReadAt";
  private const string LAST_SEEN_CZK_PER_EUR = "LastSeenCzkPerEur";
  private const string LAST_NOTIFIED_AMOUNT = "LastNotifiedAmount";
  private const string LAST_NOTIFIED_READ_AT = "LastNotifiedReadAt";
  private const string LAST_NOTIFIED_CZK_PER_EUR = "LastNotifiedCzkPerEur";

  /// <summary>What an amount or a rate the store wrote holds: an optional minus and a decimal point, nothing else.</summary>
  private const NumberStyles DECIMAL_STYLES = NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint;

  private readonly TableClient _table;
  private readonly TableCreation _creation;

  public TableCheckedBalanceStore(TableServiceClient tables, IOptions<CheckedBalanceStoreOptions> options) {
    ArgumentNullException.ThrowIfNull(tables);
    ArgumentNullException.ThrowIfNull(options);

    _table = tables.GetTableClient(options.Value.TableName);
    _creation = new TableCreation(_table);
  }

  public async Task<CheckedBalances?> Read(CancellationToken cancellationToken) {
    await _creation.Ensure(cancellationToken);

    NullableResponse<TableEntity> row = await _table.GetEntityIfExistsAsync<TableEntity>(PARTITION, ROW, cancellationToken: cancellationToken);

    return row.HasValue && row.Value is { } entity
      ? new CheckedBalances(
        LastSeen: Balance(entity, LAST_SEEN_AMOUNT, LAST_SEEN_READ_AT, LAST_SEEN_CZK_PER_EUR),
        LastNotified: Balance(entity, LAST_NOTIFIED_AMOUNT, LAST_NOTIFIED_READ_AT, LAST_NOTIFIED_CZK_PER_EUR))
      : null;
  }

  /// <summary>Upserts the one row whole, replacing it rather than merging into it.</summary>
  public async Task Save(CheckedBalances balances, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(balances);

    await _creation.Ensure(cancellationToken);

    TableEntity row = new(PARTITION, ROW) {
      [LAST_SEEN_AMOUNT] = Text(balances.LastSeen.Amount),
      [LAST_SEEN_READ_AT] = balances.LastSeen.ReadAt,
      [LAST_SEEN_CZK_PER_EUR] = Text(balances.LastSeen.CzkPerEur),
      [LAST_NOTIFIED_AMOUNT] = Text(balances.LastNotified.Amount),
      [LAST_NOTIFIED_READ_AT] = balances.LastNotified.ReadAt,
      [LAST_NOTIFIED_CZK_PER_EUR] = Text(balances.LastNotified.CzkPerEur),
    };

    _ = await _table.UpsertEntityAsync(row, TableUpdateMode.Replace, cancellationToken);
  }

  private static string Text(decimal value) => value.ToString(CultureInfo.InvariantCulture);

  private static AccountBalance Balance(TableEntity row, string amount, string readAt, string czkPerEur) =>
    new(Decimal(row, amount), Instant(row, readAt), Decimal(row, czkPerEur));

  private static decimal Decimal(TableEntity row, string column) =>
    row.TryGetValue(column, out object? value) && value is string text && decimal.TryParse(text, DECIMAL_STYLES, CultureInfo.InvariantCulture, out decimal number)
      ? number
      : throw Unreadable(column);

  private static DateTimeOffset Instant(TableEntity row, string column) =>
    row.TryGetValue(column, out object? value) && value is DateTimeOffset instant ? instant : throw Unreadable(column);

  private static InvalidOperationException Unreadable(string column) =>
    new($"A row of the checked balances table cannot be read: its {column} column is missing or not in the form the store writes.");
}