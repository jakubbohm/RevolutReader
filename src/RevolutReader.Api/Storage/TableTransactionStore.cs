using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="ITransactionStore"/> on Azure Table Storage (c010 design.md D5, § Ports and contracts): the table
/// <see cref="TransactionStoreOptions.TableName"/>, one partition (<c>account</c>), one row per transaction, keyed by the
/// SHA-256 of its reference's UTF-8 bytes in lowercase hex: 64 characters, only <c>0-9a-f</c>, so whatever the reference
/// holds, the key has neither a character Table Storage forbids in a key (<c>/</c>, <c>\</c>, <c>#</c>, <c>?</c>) nor the
/// <c>%</c> escaping would bring; the reference itself kept unchanged in a column, which every read uses.
/// <list type="bullet">
/// <item>The columns: <c>Reference</c>; <c>Date</c> as <c>yyyy-MM-dd</c>; <c>Position</c>; <c>Amount</c> as an invariant
/// decimal string (tables have no decimal type, and a double would lose cents); <c>Currency</c>; <c>Counterparty</c> and
/// <c>TypeCode</c>, left out when missing; <c>Details</c>, the lines as a JSON array, unchanged.</item>
/// <item>The table is created when missing, once per instance, before its first read or write; a creation that failed is
/// tried again by the next call.</item>
/// <item>A row it cannot read is an <see cref="InvalidOperationException"/> naming the column, never its value; the
/// storage's own failures pass on as the client's exceptions (§ Error model). Logs nothing.</item>
/// </list>
/// </summary>
public sealed class TableTransactionStore(TableServiceClient tables, IOptions<TransactionStoreOptions> options) : ITransactionStore {
  /// <summary>The one partition: the app reads one account.</summary>
  private const string PARTITION = "account";

  /// <summary>Table Storage's most actions in one transaction (one partition).</summary>
  private const int MOST_PER_BATCH = 100;

  private const string DATE_FORMAT = "yyyy-MM-dd";
  private const NumberStyles AMOUNT_STYLES = NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint;

  private const string REFERENCE = "Reference";
  private const string DATE = "Date";
  private const string POSITION = "Position";
  private const string AMOUNT = "Amount";
  private const string CURRENCY = "Currency";
  private const string COUNTERPARTY = "Counterparty";
  private const string DETAILS = "Details";
  private const string TYPE_CODE = "TypeCode";

  private readonly TableClient _table = tables.GetTableClient(options.Value.TableName);
  private readonly Lock _lock = new();

  /// <summary>The table's creation, shared by every caller; <see langword="null"/> before the first call.</summary>
  private Task? _created;

  /// <summary>Every row of the partition, newest day first, then by position within the day, then by reference (ordinal), so a read is always in the same order.</summary>
  public async Task<IReadOnlyList<KeptTransaction>> ReadAll(CancellationToken cancellationToken) {
    await TableCreated(cancellationToken);

    List<KeptTransaction> kept = [];

    await foreach (TableEntity row in _table.QueryAsync<TableEntity>(TableClient.CreateQueryFilter($"PartitionKey eq {PARTITION}"), cancellationToken: cancellationToken))
      kept.Add(Read(row));

    return [
      .. kept
        .OrderByDescending(static transaction => transaction.Date)
        .ThenBy(static transaction => transaction.Position)
        .ThenBy(static transaction => transaction.Reference, StringComparer.Ordinal),
    ];
  }

  /// <summary>
  /// Upserts each row whole, replacing a row with the same key rather than merging into it, in transactions of at most
  /// <see cref="MOST_PER_BATCH"/>, in the order given; not atomic across them. A reference named twice is kept once, with
  /// the later values, as keeping them one after the other would leave it: a transaction naming a key twice is refused
  /// whole. Nothing to keep: no request at all.
  /// </summary>
  public async Task Keep(IReadOnlyList<KeptTransaction> transactions, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(transactions);

    if (transactions.Count == 0)
      return;

    await TableCreated(cancellationToken);

    // Grouped by the reference, not the key: distinct references have distinct keys (SHA-256 has no known collision).
    IEnumerable<KeptTransaction> latest = transactions
      .GroupBy(static transaction => transaction.Reference, StringComparer.Ordinal)
      .Select(static named => named.Last());

    foreach (KeptTransaction[] batch in latest.Chunk(MOST_PER_BATCH))
      await _table.SubmitTransactionAsync([.. batch.Select(static transaction => new TableTransactionAction(TableTransactionActionType.UpsertReplace, Row(transaction)))], cancellationToken);
  }

  /// <summary>
  /// The table created if missing: every caller awaits the same creation, and only one that failed or was cancelled is
  /// started again. It runs without the caller's token, so one caller giving up does not fail the others; each caller
  /// stops waiting on its own token.
  /// </summary>
  private Task TableCreated(CancellationToken cancellationToken) {
    lock (_lock) {
      if (_created is null || _created.IsFaulted || _created.IsCanceled)
        _created = _table.CreateIfNotExistsAsync(CancellationToken.None);

      return _created.WaitAsync(cancellationToken);
    }
  }

  private static TableEntity Row(KeptTransaction transaction) {
    TableEntity row = new(PARTITION, RowKey(transaction.Reference)) {
      [REFERENCE] = transaction.Reference,
      [DATE] = transaction.Date.ToString(DATE_FORMAT, CultureInfo.InvariantCulture),
      [POSITION] = transaction.Position,
      [AMOUNT] = transaction.Amount.ToString(CultureInfo.InvariantCulture),
      [CURRENCY] = transaction.Currency,
      [DETAILS] = JsonSerializer.Serialize(transaction.PaymentDetails),
    };

    // A table has no null value: a missing one is a column left out.
    if (transaction.Counterparty is not null)
      row[COUNTERPARTY] = transaction.Counterparty;

    if (transaction.TypeCode is not null)
      row[TYPE_CODE] = transaction.TypeCode;

    return row;
  }

  /// <summary>The row key of a reference: the SHA-256 of its UTF-8 bytes, in lowercase hex (D5).</summary>
  private static string RowKey(string reference) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(reference)));

  /// <summary>
  /// A row as kept. Tries, never parses: a parse's exception quotes its input, which would carry the row's bank data into
  /// the error.
  /// </summary>
  private static KeptTransaction Read(TableEntity row) => new(
    Text(row, REFERENCE),
    DateOnly.TryParseExact(Text(row, DATE), DATE_FORMAT, CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly date) ? date : throw Unreadable(DATE),
    row.TryGetValue(POSITION, out object? value) && value is int position ? position : throw Unreadable(POSITION),
    decimal.TryParse(Text(row, AMOUNT), AMOUNT_STYLES, CultureInfo.InvariantCulture, out decimal amount) ? amount : throw Unreadable(AMOUNT),
    Text(row, CURRENCY),
    OptionalText(row, COUNTERPARTY),
    Lines(row),
    OptionalText(row, TYPE_CODE));

  private static string Text(TableEntity row, string column) =>
    row.TryGetValue(column, out object? value) && value is string text ? text : throw Unreadable(column);

  private static string? OptionalText(TableEntity row, string column) => row.TryGetValue(column, out object? value) && value is not null
    ? value as string ?? throw Unreadable(column)
    : null;

  /// <summary>The details' JSON array of lines; a line that is not a string, or no array at all, makes the row unreadable.</summary>
  private static string[] Lines(TableEntity row) {
    string[]? lines;

    try {
      lines = JsonSerializer.Deserialize<string[]>(Text(row, DETAILS));
    }
    catch (JsonException) {
      // Not passed on as the inner exception: its message may quote the column's text.
      throw Unreadable(DETAILS);
    }

    return lines is null || lines.Any(static line => line is null) ? throw Unreadable(DETAILS) : lines;
  }

  private static InvalidOperationException Unreadable(string column) =>
    new($"A row of the transactions table cannot be read: its {column} column is missing or not in the form the store writes.");
}