using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;

namespace RevolutReader.IntegrationTests.HistoryImport;

/// <summary>
/// The history import (c010 design.md D9): every page of the file through the adapter's own reading and
/// <c>TransactionMapping</c>; the settled transactions dated from 2026-08-09, each with its position within its day in the
/// file's order, kept through the store; only days before the earlier of the export's day and the oldest kept day, since
/// positions within a day must come from one complete read. Returns counts only.
/// </summary>
public sealed class HistoryImporter(ITransactionStore store) {
  /// <summary>
  /// The file's one account: its pages joined, as a live read joins them, and mapped (<see cref="TransactionMapping"/>);
  /// positions counted by <see cref="TransactionPaging.ToKeep"/> over the whole file, so each day's are those of one
  /// complete read; then the settled ones from the file's <see cref="HistoryFile.HistoryStart"/> to the day before the
  /// first day left to the live reads (<see cref="FirstDayLeftToLiveReads"/>) kept by upserts, so a second run changes
  /// nothing.
  /// <list type="bullet">
  /// <item>Everything is mapped before the store is read or written: a page the adapter cannot read fails the import with
  /// nothing written (its exception names what, quoting nothing).</item>
  /// <item>Each day is kept in a call of its own, newest first: in the Table adapter, a day of up to 100 transactions is one
  /// transaction of its own, so a run that fails part way leaves only whole days, the newest ones, and running it again
  /// imports the days before them.</item>
  /// <item>A file of more than one account is refused: the app reads one account, and the file's account number does not
  /// say which.</item>
  /// </list>
  /// Logs nothing.
  /// </summary>
  public async Task<HistoryImportCounts> Import(HistoryFile file, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(file);

    if (file.Accounts is not [HistoryAccount account])
      throw new InvalidOperationException($"The history file holds {file.Accounts.Count} accounts; the import reads the history of the app's one account.");

    List<EbTransaction> listed = [.. account.Pages.SelectMany(static page => page.Transactions)];
    IReadOnlyList<BankTransaction> mapped = TransactionMapping.Map(listed).Kept;
    List<DateOnly> settledDays = [.. mapped.Where(static transaction => transaction.Status == TransactionStatus.Booked).Select(static transaction => transaction.Date)];

    DateOnly leftToLiveReads = await FirstDayLeftToLiveReads(file, cancellationToken);
    List<KeptTransaction> kept = [.. TransactionPaging.ToKeep(mapped).Transactions.Where(transaction => transaction.Date >= file.HistoryStart && transaction.Date < leftToLiveReads)];
    int daysSkipped = settledDays.Where(day => day >= file.HistoryStart && day >= leftToLiveReads).Distinct().Count();

    foreach (IGrouping<DateOnly, KeptTransaction> day in kept.GroupBy(static transaction => transaction.Date).OrderByDescending(static onDay => onDay.Key))
      await store.Keep([.. day], cancellationToken);

    return new HistoryImportCounts(listed.Count, settledDays.Count, kept.Count, daysSkipped);
  }

  /// <summary>
  /// The export's own day, or the oldest day the table holds when that is earlier: the file may hold the export's day only
  /// in part, and the live reads fill the table's days and every later one (D9). The export's day is its UTC day, never
  /// later than the bank's own day at that moment in Europe, so a day the file holds only in part is never imported.
  /// </summary>
  private async Task<DateOnly> FirstDayLeftToLiveReads(HistoryFile file, CancellationToken cancellationToken) {
    DateOnly exportDay = DateOnly.FromDateTime(file.ExportedUtc.UtcDateTime);
    IReadOnlyList<KeptTransaction> alreadyKept = await store.ReadAll(cancellationToken);

    return alreadyKept.Select(static transaction => transaction.Date).Append(exportDay).Min();
  }
}

/// <summary>What an import did, in counts only (c010 design.md D9).</summary>
/// <param name="Read">The transactions on the file's pages, whatever their status.</param>
/// <param name="Settled">The settled (booked) ones among them.</param>
/// <param name="Kept">The ones the import kept.</param>
/// <param name="DaysSkipped">The days of settled ones the import left to the live reads: the export's own day, and any day from the oldest kept day on.</param>
public sealed record HistoryImportCounts(int Read, int Settled, int Kept, int DaysSkipped);