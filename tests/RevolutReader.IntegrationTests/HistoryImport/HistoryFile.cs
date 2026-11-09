using RevolutReader.Api.Bank;

namespace RevolutReader.IntegrationTests.HistoryImport;

/// <summary>
/// The M1 history file (c010 design.md D9), as <c>spikes/enable-banking/export-history.ps1</c> writes it:
/// <c>{exported_utc, history_start, date_from, accounts:[{account, pages:[{transactions, continuation_key}]}]}</c>, each
/// page the bank's raw answer, unchanged, read as the adapter reads a page (<see cref="EbTransactionPage"/>, the API
/// reference's snake_case names).
/// </summary>
/// <param name="ExportedUtc">When the file was written (<c>exported_utc</c>, <c>yyyy-MM-ddTHH:mm:ssZ</c>).</param>
/// <param name="HistoryStart">The history's first day (<c>history_start</c>, <c>yyyy-MM-dd</c>).</param>
/// <param name="DateFrom">The day the download asked from (<c>date_from</c>): the day before <paramref name="HistoryStart"/>.</param>
/// <param name="Accounts">Each account's pages, in the file's order.</param>
public sealed record HistoryFile(DateTimeOffset ExportedUtc, DateOnly HistoryStart, DateOnly DateFrom, IReadOnlyList<HistoryAccount> Accounts) {
  /// <summary>
  /// The file's JSON, read whole. A file or page it cannot read is a <see cref="System.Text.Json.JsonException"/> or a
  /// <see cref="BankReadException"/>, naming what and quoting nothing (c010 design.md § Error model).
  /// </summary>
  public static Task<HistoryFile> Read(Stream json, CancellationToken cancellationToken) => throw new NotImplementedException();
}

/// <summary>One account of the file: its number in the file (<c>account</c>, 1 first; never an identifier) and its raw pages, in the bank's order.</summary>
public sealed record HistoryAccount(int Account, IReadOnlyList<EbTransactionPage> Pages);