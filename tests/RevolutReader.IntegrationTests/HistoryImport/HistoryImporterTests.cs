using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.HistoryImport;

/// <summary>
/// The history import (c010 design.md D9): a made-up file of the M1 file's shape (<see cref="MadeUpHistory"/>, exported on
/// 2026-11-04), read by <see cref="HistoryFile"/> and imported by <see cref="HistoryImporter"/> through the real Table
/// adapter into a table of its own on the test session's Azurite (<see cref="AzuriteTables"/>); what was kept is read back
/// through the same adapter. Each test builds its own file and, where it needs one, keeps its own transaction first, as a
/// live read would have. Everything is made up: references, names, amounts.
/// </summary>
public sealed class HistoryImporterTests {
  /// <summary>Distinctive, so it cannot turn up in an error's text by coincidence.</summary>
  private const string MARKER = "7f3a9c";

  private static readonly DateOnly _august8 = new(2026, 8, 8);
  private static readonly DateOnly _august9 = new(2026, 8, 9);
  private static readonly DateOnly _september13 = new(2026, 9, 13);
  private static readonly DateOnly _september14 = new(2026, 9, 14);
  private static readonly DateOnly _september15 = new(2026, 9, 15);
  private static readonly DateOnly _october1 = new(2026, 10, 1);
  private static readonly DateOnly _october2 = new(2026, 10, 2);
  private static readonly DateOnly _october19 = new(2026, 10, 19);
  private static readonly DateOnly _october20 = new(2026, 10, 20);
  private static readonly DateOnly _october25 = new(2026, 10, 25);
  private static readonly DateOnly _november3 = new(2026, 11, 3);

  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  /// <summary>
  /// The file holds, over two pages, settled transactions from 2026-08-09 on (a payment with details, money received, a
  /// payment without details), pending ones with and without a reference, and a settled one on 2026-08-08, the day the
  /// download started from. The table is empty.
  /// </summary>
  [Test]
  public async Task The_import_keeps_the_settled_transactions_dated_from_2026_08_09_and_leaves_out_the_pending_ones_and_the_earlier_days() {
    TableTransactionStore store = NewStore();
    JsonObject file = MadeUpHistory.File(
      [
        MadeUpHistory.Pending(null, _october2),
        MadeUpHistory.SettledPayment("h-301", _october2, "12.30", "Pekárna U Lípy", "CARD_PAYMENT", "Praha 2"),
        MadeUpHistory.Pending("h-302", _october2),
        MadeUpHistory.SettledReceipt("h-201", _september14, "50.00", "Jan Novák", "TRANSFER", "Kapesné září"),
      ],
      [
        MadeUpHistory.SettledPayment("h-101", _august9, "8.90", "Kavárna Na Rohu", "CARD_PAYMENT"),
        MadeUpHistory.SettledPayment("h-001", _august8, "4.50", "Trafika U Mostu", "CARD_PAYMENT", "Praha 1"),
      ]);

    await Import(file, store);

    (await store.ReadAll(CancellationToken.None)).Select(KeptValues.Of).ShouldBe([
      new KeptValues("h-301", _october2, -12.30m, "EUR", "Pekárna U Lípy", "Praha 2", "CARD_PAYMENT"),
      new KeptValues("h-201", _september14, 50.00m, "EUR", "Jan Novák", "Kapesné září", "TRANSFER"),
      new KeptValues("h-101", _august9, -8.90m, "EUR", "Kavárna Na Rohu", "", "CARD_PAYMENT"),
    ], ignoreOrder: true);
  }

  /// <summary>
  /// The file has no <c>history_start</c>, as the first run of the export script wrote the M1 file on 2026-11-04; its
  /// <c>date_from</c> is 2026-08-08, so its history starts the day after, as the script derives one from the other. It holds
  /// a settled transaction on 2026-08-09 and one on 2026-08-08. The table is empty.
  /// </summary>
  [Test]
  public async Task A_file_without_a_history_start_is_imported_from_the_day_after_its_date_from() {
    TableTransactionStore store = NewStore();
    JsonObject file = MadeUpHistory.WithoutHistoryStart(MadeUpHistory.File([
      MadeUpHistory.Settled("h-101", _august9),
      MadeUpHistory.Settled("h-001", _august8),
    ]));

    await Import(file, store);

    (await store.ReadAll(CancellationToken.None)).Select(static transaction => transaction.Reference).ShouldBe(["h-101"]);
  }

  /// <summary>
  /// 2026-09-14 runs over the page break, with a pending one between its settled ones; the days before and after it have
  /// one each. The table is empty.
  /// </summary>
  [Test]
  public async Task The_import_keeps_each_days_transactions_with_their_positions_in_the_files_order() {
    TableTransactionStore store = NewStore();
    JsonObject file = MadeUpHistory.File(
      [
        MadeUpHistory.Settled("h-a1", _september15),
        MadeUpHistory.Settled("h-b1", _september14),
        MadeUpHistory.Settled("h-b2", _september14),
      ],
      [
        MadeUpHistory.Pending("h-bp", _september14),
        MadeUpHistory.Settled("h-b3", _september14),
        MadeUpHistory.Settled("h-c1", _september13),
      ]);

    await Import(file, store);

    (await store.ReadAll(CancellationToken.None)).Select(Placed.Of).ShouldBe([
      new Placed("h-a1", _september15, 0),
      new Placed("h-b1", _september14, 0),
      new Placed("h-b2", _september14, 1),
      new Placed("h-b3", _september14, 2),
      new Placed("h-c1", _september13, 0),
    ], ignoreOrder: true);
  }

  /// <summary>
  /// A live read has kept one transaction on 2026-10-20, so the live reads fill that day and every later one (D9: only
  /// days before the oldest kept day). The file holds other transactions on that day, on a later day the table does not
  /// hold, and on two earlier days.
  /// </summary>
  [Test]
  public async Task The_import_never_writes_a_day_the_table_already_holds() {
    TableTransactionStore store = NewStore();
    await store.Keep([LiveRead("e-live-1", _october20)], CancellationToken.None);
    JsonObject file = MadeUpHistory.File(
      [
        MadeUpHistory.Settled("h-501", _october25),
        MadeUpHistory.Settled("h-401", _october20),
      ],
      [
        MadeUpHistory.Settled("h-301", _october19),
        MadeUpHistory.Settled("h-201", _october1),
      ]);

    await Import(file, store);

    (await store.ReadAll(CancellationToken.None)).Select(static transaction => transaction.Reference)
      .ShouldBe(["e-live-1", "h-301", "h-201"], ignoreOrder: true);
  }

  /// <summary>The file was exported on 2026-11-04 and holds two settled transactions of that day and one of the day before. The table is empty.</summary>
  [Test]
  public async Task The_import_never_writes_the_exports_own_day() {
    TableTransactionStore store = NewStore();
    JsonObject file = MadeUpHistory.File([
      MadeUpHistory.Settled("h-601", MadeUpHistory.ExportDay),
      MadeUpHistory.Settled("h-602", MadeUpHistory.ExportDay),
      MadeUpHistory.Settled("h-501", _november3),
    ]);

    await Import(file, store);

    (await store.ReadAll(CancellationToken.None)).Select(static transaction => transaction.Reference).ShouldBe(["h-501"]);
  }

  /// <summary>The same file imported twice into a table that was empty: the second run leaves the table as the first left it.</summary>
  [Test]
  public async Task Running_the_import_twice_keeps_each_transaction_once() {
    TableTransactionStore store = NewStore();
    JsonObject file = MadeUpHistory.File(
      [
        MadeUpHistory.Settled("h-202", _september14),
        MadeUpHistory.SettledReceipt("h-201", _september14, "50.00", "Jan Novák", "TRANSFER", "Kapesné září"),
      ],
      [
        MadeUpHistory.Settled("h-101", _august9),
      ]);

    await Import(file, store);
    List<Row> afterOnce = [.. (await store.ReadAll(CancellationToken.None)).Select(Row.Of)];

    await Import(file, store);
    List<Row> afterTwice = [.. (await store.ReadAll(CancellationToken.None)).Select(Row.Of)];

    afterTwice.ShouldSatisfyAllConditions(
      () => afterTwice.Select(static row => row.Reference).ShouldBe(["h-202", "h-201", "h-101"], ignoreOrder: true),
      () => afterTwice.ShouldBe(afterOnce, "the second run leaves every row as the first wrote it"));
  }

  /// <summary>
  /// A live read has kept one transaction on 2026-10-20. Over two pages the file holds 9 transactions: 2 pending and 7
  /// settled, of which 3 are kept (2026-10-19, 2026-09-14, 2026-08-09) and 4 fall on 3 days the import leaves to the live
  /// reads (2026-10-20, the table's; 2026-10-25, a later one; 2026-11-04, the export's own).
  /// </summary>
  [Test]
  public async Task The_import_reports_counts_only_read_settled_kept_and_days_skipped() {
    TableTransactionStore store = NewStore();
    await store.Keep([LiveRead("e-live-1", _october20)], CancellationToken.None);
    JsonObject file = MadeUpHistory.File(
      [
        MadeUpHistory.Pending(null, MadeUpHistory.ExportDay),
        MadeUpHistory.Settled("h-601", MadeUpHistory.ExportDay),
        MadeUpHistory.Settled("h-501", _october25),
        MadeUpHistory.Settled("h-401", _october20),
        MadeUpHistory.Settled("h-402", _october20),
      ],
      [
        MadeUpHistory.Pending("h-302", _october19),
        MadeUpHistory.Settled("h-301", _october19),
        MadeUpHistory.SettledReceipt("h-201", _september14, "50.00", "Jan Novák", "TRANSFER", "Kapesné září"),
        MadeUpHistory.Settled("h-101", _august9),
      ]);

    HistoryImportCounts counts = await Import(file, store);

    counts.ShouldBe(new HistoryImportCounts(Read: 9, Settled: 7, Kept: 3, DaysSkipped: 3));
  }

  /// <summary>
  /// The file's second page is one the adapter cannot read, each case in its own way; both pages hold made-up bank data
  /// marked with <see cref="MARKER"/> and the amount 73.19, neither of which may turn up in the error (c010 design.md
  /// § Error model: naming what, quoting nothing). The table is empty.
  /// </summary>
  /// <param name="unreadable">What is wrong with the page.</param>
  [Test]
  [Arguments("a status the bank's API reference does not define")]
  [Arguments("a negative amount")]
  [Arguments("transactions that are text")]
  [Arguments("no transactions")]
  [Arguments("a transaction that is null")]
  public async Task A_page_the_adapter_cannot_read_fails_the_import_quoting_nothing_from_it(string unreadable) {
    TableTransactionStore store = NewStore();
    JsonObject file = MadeUpHistory.File(
      [MadeUpHistory.SettledPayment($"h-1{MARKER}", _september14, "73.19", $"Pekárna {MARKER}", "CARD_PAYMENT", $"Praha {MARKER}")],
      [MadeUpHistory.SettledPayment($"h-2{MARKER}", _september13, "73.19", $"Lékárna {MARKER}", "CARD_PAYMENT", $"Brno {MARKER}")]);
    JsonObject page = MadeUpHistory.Page(file, 1);
    JsonObject transaction = page["transactions"]![0]!.AsObject();

    switch (unreadable) {
      case "a status the bank's API reference does not define":
        transaction["status"] = $"BOOK{MARKER}";

        break;
      case "a negative amount":
        transaction["transaction_amount"]!["amount"] = "-73.19";

        break;
      case "transactions that are text":
        page["transactions"] = $"Lékárna {MARKER} 73.19";

        break;
      case "no transactions":
        page.Remove("transactions");

        break;
      case "a transaction that is null":
        page["transactions"]!.AsArray().Add(null);

        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(unreadable), unreadable, "Not a known case.");
    }

    Exception error = await Should.ThrowAsync<Exception>(() => Import(file, store));

    error.ShouldSatisfyAllConditions(
      () => (error is BankReadException or JsonException).ShouldBeTrue($"the import fails with a BankReadException or a JsonException (the error model), not a {error.GetType().Name}"),
      () => error.ToString().ShouldNotContain(MARKER),
      () => error.ToString().ShouldNotContain("73.19"));
  }

  /// <summary>A new store on a table no other test uses, which nothing creates before the store does.</summary>
  private TableTransactionStore NewStore() =>
    new(Azurite.Tables, Options.Create(new TransactionStoreOptions { TableName = AzuriteTables.UniqueTableName() }));

  /// <summary>The file read by <see cref="HistoryFile"/>, then imported into <paramref name="store"/>.</summary>
  private static async Task<HistoryImportCounts> Import(JsonObject file, ITransactionStore store) {
    await using MemoryStream json = MadeUpHistory.AsStream(file);
    HistoryFile history = await HistoryFile.Read(json, CancellationToken.None);

    return await new HistoryImporter(store).Import(history, CancellationToken.None);
  }

  /// <summary>A card payment a live read kept, first on its day.</summary>
  private static KeptTransaction LiveRead(string reference, DateOnly day) =>
    new(reference, day, Position: 0, Amount: -4.50m, Currency: "EUR", Counterparty: "Trafika U Mostu", PaymentDetails: [], TypeCode: "CARD_PAYMENT");

  /// <summary>A kept transaction's values but its position; the lines joined with <c>|</c>.</summary>
  private sealed record KeptValues(string Reference, DateOnly Date, decimal Amount, string Currency, string? Counterparty, string Details, string? TypeCode) {
    public static KeptValues Of(KeptTransaction kept) =>
      new(kept.Reference, kept.Date, kept.Amount, kept.Currency, kept.Counterparty, string.Join('|', kept.PaymentDetails), kept.TypeCode);
  }

  /// <summary>A kept transaction's day and position within it.</summary>
  private sealed record Placed(string Reference, DateOnly Date, int Position) {
    public static Placed Of(KeptTransaction kept) => new(kept.Reference, kept.Date, kept.Position);
  }

  /// <summary>Every value of a kept transaction; the lines joined with <c>|</c>.</summary>
  private sealed record Row(string Reference, DateOnly Date, int Position, decimal Amount, string Currency, string? Counterparty, string Details, string? TypeCode) {
    public static Row Of(KeptTransaction kept) =>
      new(kept.Reference, kept.Date, kept.Position, kept.Amount, kept.Currency, kept.Counterparty, string.Join('|', kept.PaymentDetails), kept.TypeCode);
  }
}