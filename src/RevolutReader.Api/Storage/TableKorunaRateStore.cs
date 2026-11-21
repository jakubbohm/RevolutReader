using System.Globalization;
using Azure;
using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Rate;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="IKorunaRateStore"/> on Azure Table Storage (c017 design.md D2, D9, § Ports and contracts): the table
/// <see cref="KorunaRateStoreOptions.TableName"/>, one row, partition <c>rate</c>, row key <c>eur</c>. As
/// <see cref="TableCheckedBalanceStore"/>:
/// <list type="bullet">
/// <item>The columns: <c>CzkPerEur</c> as an invariant decimal string (tables have no decimal type, and a double would lose
/// the rate's digits and its scale) and <c>Date</c> as <c>yyyy-MM-dd</c>.</item>
/// <item>A save replaces the whole row; no row reads as nothing kept.</item>
/// <item>The table is created when missing, once per instance, before its first read or write; a creation that failed is
/// tried again by the next call (<see cref="TableCreation"/>).</item>
/// <item>A row it cannot read is an <see cref="InvalidOperationException"/> naming the column, never its value; the
/// storage's own failures pass on as the client's exceptions (§ Error model). Logs nothing.</item>
/// </list>
/// Last write wins: only this app writes the row, and two copies during a deploy write the same rate (D2).
/// </summary>
public sealed class TableKorunaRateStore : IKorunaRateStore {
  /// <summary>The one row's keys (D2).</summary>
  private const string PARTITION = "rate";
  private const string ROW = "eur";

  private const string CZK_PER_EUR = "CzkPerEur";
  private const string DATE = "Date";

  private const string DATE_FORMAT = "yyyy-MM-dd";

  /// <summary>What a rate the store wrote holds: an optional minus and a decimal point, nothing else.</summary>
  private const NumberStyles DECIMAL_STYLES = NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint;

  private readonly TableClient _table;
  private readonly TableCreation _creation;

  public TableKorunaRateStore(TableServiceClient tables, IOptions<KorunaRateStoreOptions> options) {
    ArgumentNullException.ThrowIfNull(tables);
    ArgumentNullException.ThrowIfNull(options);

    _table = tables.GetTableClient(options.Value.TableName);
    _creation = new TableCreation(_table);
  }

  public async Task<KorunaRate?> Read(CancellationToken cancellationToken) {
    await _creation.Ensure(cancellationToken);

    NullableResponse<TableEntity> row = await _table.GetEntityIfExistsAsync<TableEntity>(PARTITION, ROW, cancellationToken: cancellationToken);

    return row.HasValue && row.Value is { } entity
      ? new KorunaRate(CzkPerEur(entity), Day(entity))
      : null;
  }

  /// <summary>Upserts the one row whole, replacing it rather than merging into it.</summary>
  public async Task Save(KorunaRate rate, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(rate);

    await _creation.Ensure(cancellationToken);

    TableEntity row = new(PARTITION, ROW) {
      [CZK_PER_EUR] = rate.CzkPerEur.ToString(CultureInfo.InvariantCulture),
      [DATE] = rate.Date.ToString(DATE_FORMAT, CultureInfo.InvariantCulture),
    };

    _ = await _table.UpsertEntityAsync(row, TableUpdateMode.Replace, cancellationToken);
  }

  private static decimal CzkPerEur(TableEntity row) =>
    decimal.TryParse(Text(row, CZK_PER_EUR), DECIMAL_STYLES, CultureInfo.InvariantCulture, out decimal rate) ? rate : throw Unreadable(CZK_PER_EUR);

  private static DateOnly Day(TableEntity row) =>
    DateOnly.TryParseExact(Text(row, DATE), DATE_FORMAT, CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly day) ? day : throw Unreadable(DATE);

  private static string Text(TableEntity row, string column) =>
    row.TryGetValue(column, out object? value) && value is string text ? text : throw Unreadable(column);

  private static InvalidOperationException Unreadable(string column) =>
    new($"A row of the koruna rates table cannot be read: its {column} column is missing or not in the form the store writes.");
}