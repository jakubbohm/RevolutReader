using RevolutReader.Api.Account;

namespace RevolutReader.IntegrationTests.HistoryImport;

/// <summary>
/// The history import (c010 design.md D9): every page of the file through the adapter's own reading and
/// <c>TransactionMapping</c>; the settled transactions dated from 2026-08-09, each with its position within its day in the
/// file's order, kept through the store; only days before the earlier of the export's day and the oldest kept day, since
/// positions within a day must come from one complete read. Returns counts only.
/// </summary>
#pragma warning disable CS9113 // A stub until c010 group 83 writes Import, which reads it; then this goes.
public sealed class HistoryImporter(ITransactionStore store) {
#pragma warning restore CS9113
  public Task<HistoryImportCounts> Import(HistoryFile file, CancellationToken cancellationToken) => throw new NotImplementedException();
}

/// <summary>What an import did, in counts only (c010 design.md D9).</summary>
/// <param name="Read">The transactions on the file's pages, whatever their status.</param>
/// <param name="Settled">The settled (booked) ones among them.</param>
/// <param name="Kept">The ones the import kept.</param>
/// <param name="DaysSkipped">The days of settled ones the import left to the live reads: the export's own day, and any day from the oldest kept day on.</param>
public sealed record HistoryImportCounts(int Read, int Settled, int Kept, int DaysSkipped);