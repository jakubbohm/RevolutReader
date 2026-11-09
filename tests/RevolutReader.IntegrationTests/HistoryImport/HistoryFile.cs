using System.Globalization;
using System.Text;
using System.Text.Json;
using RevolutReader.Api.Bank;

namespace RevolutReader.IntegrationTests.HistoryImport;

/// <summary>
/// The M1 history file (c010 design.md D9), as <c>spikes/enable-banking/export-history.ps1</c> writes it:
/// <c>{exported_utc, history_start, date_from, accounts:[{account, pages:[{transactions, continuation_key}]}]}</c>, each
/// page the bank's raw answer, unchanged, read as the adapter reads a page (<see cref="EbTransactionPage"/>, the API
/// reference's snake_case names). <c>history_start</c> may be missing: the script's first run, which wrote the M1 file on
/// 2026-11-04, did not write it.
/// </summary>
/// <param name="ExportedUtc">When the file was written (<c>exported_utc</c>, <c>yyyy-MM-ddTHH:mm:ssZ</c>).</param>
/// <param name="HistoryStart">
/// The history's first day (<c>history_start</c>, <c>yyyy-MM-dd</c>); in a file without one, the day after
/// <paramref name="DateFrom"/>, as the script derives one from the other.
/// </param>
/// <param name="DateFrom">The day the download asked from (<c>date_from</c>): the day before <paramref name="HistoryStart"/>.</param>
/// <param name="Accounts">Each account's pages, in the file's order.</param>
public sealed record HistoryFile(DateTimeOffset ExportedUtc, DateOnly HistoryStart, DateOnly DateFrom, IReadOnlyList<HistoryAccount> Accounts) {
  private const string EXPORTED_UTC = "exported_utc";
  private const string HISTORY_START = "history_start";
  private const string DATE_FROM = "date_from";
  private const string ACCOUNTS = "accounts";
  private const string ACCOUNT = "account";
  private const string PAGES = "pages";

  /// <summary>The export's time, as the script writes it: always UTC, always with its <c>Z</c>.</summary>
  private const string TIME_FORMAT = "yyyy-MM-dd'T'HH:mm:ss'Z'";
  private const string DATE_FORMAT = "yyyy-MM-dd";

  private const string THE_FILE = "The history file";
  private const string AN_ACCOUNT = "An account of the history file";

  /// <summary>
  /// The file's JSON, read whole. A file or page it cannot read is a <see cref="JsonException"/> or a
  /// <see cref="BankReadException"/>, naming what and quoting nothing (c010 design.md § Error model): each page is read by
  /// the adapter itself (<see cref="EnableBankingClient.TransactionPageOf"/>), its checks included.
  /// </summary>
  public static async Task<HistoryFile> Read(Stream json, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(json);

    using JsonDocument document = await Parsed(json, cancellationToken);
    JsonElement file = document.RootElement;

    if (file.ValueKind != JsonValueKind.Object)
      throw new JsonException($"{THE_FILE} is not a JSON object.");

    DateTimeOffset exportedUtc = Time(file, EXPORTED_UTC);
    DateOnly dateFrom = Day(file, DATE_FROM);
    // The first run of export-history.ps1, which wrote the M1 file on 2026-11-04, wrote no history_start. The script
    // derives date_from as history_start minus one day (Enable Banking reads dates as UTC), so the day after is the start.
    DateOnly historyStart = file.TryGetProperty(HISTORY_START, out _) ? Day(file, HISTORY_START) : dateFrom.AddDays(1);
    List<HistoryAccount> accounts = [];

    foreach (JsonElement account in Member(file, ACCOUNTS, JsonValueKind.Array, THE_FILE).EnumerateArray())
      accounts.Add(await AccountOf(account, cancellationToken));

    return new HistoryFile(exportedUtc, historyStart, dateFrom, accounts);
  }

  /// <summary>The file as a JSON document; not JSON is a <see cref="JsonException"/> of its own.</summary>
  private static async Task<JsonDocument> Parsed(Stream json, CancellationToken cancellationToken) {
    try {
      return await JsonDocument.ParseAsync(json, cancellationToken: cancellationToken);
    }
    catch (JsonException) {
      // Not passed on: its message may quote the file where the reading stopped.
      throw new JsonException($"{THE_FILE} is not JSON.");
    }
  }

  /// <summary>An account's number and its pages, each page's raw JSON read by the adapter, unchanged.</summary>
  private static async Task<HistoryAccount> AccountOf(JsonElement account, CancellationToken cancellationToken) {
    if (account.ValueKind != JsonValueKind.Object)
      throw new JsonException($"{AN_ACCOUNT} is not a JSON object.");

    if (!Member(account, ACCOUNT, JsonValueKind.Number, AN_ACCOUNT).TryGetInt32(out int number))
      throw new JsonException($"{AN_ACCOUNT} has an {ACCOUNT} that is not a whole number.");

    List<EbTransactionPage> pages = [];

    foreach (JsonElement page in Member(account, PAGES, JsonValueKind.Array, AN_ACCOUNT).EnumerateArray()) {
      await using MemoryStream raw = new(Encoding.UTF8.GetBytes(page.GetRawText()));

      pages.Add(await EnableBankingClient.TransactionPageOf(raw, cancellationToken));
    }

    return new HistoryAccount(number, pages);
  }

  /// <summary>The UTC time in the file's member <paramref name="name"/>, <see cref="TIME_FORMAT"/>.</summary>
  private static DateTimeOffset Time(JsonElement file, string name) =>
    DateTimeOffset.TryParseExact(Member(file, name, JsonValueKind.String, THE_FILE).GetString(), TIME_FORMAT, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out DateTimeOffset time)
      ? time
      : throw new JsonException($"{THE_FILE} has an {name} that is not a UTC time in the form {TIME_FORMAT}.");

  /// <summary>The calendar day in the file's member <paramref name="name"/>, <see cref="DATE_FORMAT"/>.</summary>
  private static DateOnly Day(JsonElement file, string name) =>
    DateOnly.TryParseExact(Member(file, name, JsonValueKind.String, THE_FILE).GetString(), DATE_FORMAT, CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly day)
      ? day
      : throw new JsonException($"{THE_FILE} has a {name} that is not a date in the form {DATE_FORMAT}.");

  /// <summary>
  /// The member <paramref name="name"/> of <paramref name="holder"/>, which must be of <paramref name="kind"/>; the error
  /// names the member, never its value.
  /// </summary>
  private static JsonElement Member(JsonElement holder, string name, JsonValueKind kind, string holderName) =>
    holder.TryGetProperty(name, out JsonElement member) && member.ValueKind == kind
      ? member
      : throw new JsonException($"{holderName} has no {name}, or one that is not a JSON {kind}.");
}

/// <summary>One account of the file: its number in the file (<c>account</c>, 1 first; never an identifier) and its raw pages, in the bank's order.</summary>
public sealed record HistoryAccount(int Account, IReadOnlyList<EbTransactionPage> Pages);