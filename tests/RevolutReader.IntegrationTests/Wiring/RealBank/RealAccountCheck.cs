using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.RealBank;

/// <summary>
/// Check 2 (c004 design.md D7): the bank port on its production wiring against the real account, run once by the owner
/// before C5 ends. The settings are the production values kept apart in the AppHost's user-secrets
/// (<c>RealAccountCheck:*</c>, which the AppHost never hands to the API), so <c>aspire start</c> cannot reach the account.
/// <list type="bullet">
/// <item>One present-user read, with the owner's public IP (from <c>api.ipify.org</c>, as the M1 smoke test fetches it;
/// never printed or saved) and a user agent like the spike's: the balance, then the transactions of the last 89 days,
/// inside Revolut's 90-day limit. At Revolut's 50 a page that is more than one page: the live test of paging.</item>
/// <item>One unattended balance read: 1 of the 4 a day (ADR-0001); nothing else unattended.</item>
/// <item>The same 89 days again through the raw page reader, for the field counts the port does not show (which dates a
/// pending transaction carries, whether it has a reference). Present-user reads are not limited (ADR-0001).</item>
/// </list>
/// It writes a counts-only summary to <c>spikes/enable-banking/evidence/&lt;date&gt;-real-account-check.json</c>: outcomes,
/// counts, ages in days and durations, never amounts, names, texts, references, ids or the IP. It prints only the
/// outcomes and the file's path. A read that fails is recorded as its outcome, and the check then fails.
/// </summary>
[Explicit]
[Category("RealBank")]
public sealed class RealAccountCheck {
  /// <summary>Inside Revolut's 90-day limit for reading transactions (D7).</summary>
  private const int DAYS = 89;

  private const string READ = "read";

  /// <summary>More pages than 89 days can hold at Revolut's 50 a page: a stop for a bank that keeps answering.</summary>
  private const int MOST_PAGES = 100;

  /// <summary>Each setting of the section and the AppHost user-secret it comes from (docs/operations/local-secrets.md § 2).</summary>
  private static readonly (string Setting, string UserSecret)[] _secrets = [
    ("ApplicationId", "RealAccountCheck:ApplicationId"),
    ("PrivateKey", "RealAccountCheck:PrivateKey"),
    ("SessionId", "RealAccountCheck:SessionId"),
    ("AccountId", "RealAccountCheck:AccountId"),
  ];

  private static readonly JsonSerializerOptions _evidenceJson = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, WriteIndented = true };

  [Test]
  public async Task The_real_account_reads_and_its_pages_are_counted() {
    // First, so a missing setting stops the check before any request leaves the machine.
    Dictionary<string, string?> settings = RealBankWiring.SettingsFromUserSecrets(_secrets);
    PresentUser owner = new(await OwnersPublicAddress(), $"RevolutReader-check/1.0 .NET/{Environment.Version}");

    await using ServiceProvider services = RealBankWiring.Wiring(settings);
    IBankAccount account = services.GetRequiredService<IBankAccount>();
    EnableBankingClient client = (EnableBankingClient)account;
    DateOnly today = DateOnly.FromDateTime(TimeProvider.System.GetUtcNow().UtcDateTime);
    DateOnly from = today.AddDays(-DAYS);

    List<ReadSummary> reads = [];

    Timed<BankResult<Balance>> balance = await Time(() => account.ReadBalance(owner, CancellationToken.None));
    reads.Add(new ReadSummary("balance", "present user", OutcomeOf(balance), balance.Milliseconds));

    Timed<BankResult<Transactions>> transactions = await Time(() => account.ReadTransactions(from, owner, CancellationToken.None));
    reads.Add(new ReadSummary("transactions", "present user", OutcomeOf(transactions), transactions.Milliseconds, CountsOf(transactions.Value.Value as Transactions)));

    Timed<BankResult<Balance>> unattended = await Time(() => account.ReadBalance(new Unattended(), CancellationToken.None));
    reads.Add(new ReadSummary("balance", "unattended", OutcomeOf(unattended), unattended.Milliseconds));

    Timed<RawPages> pages = await Time(() => ReadRawPages(client, from, owner, today));
    reads.Add(new ReadSummary("raw transaction pages", "present user", pages.Value?.Outcome ?? pages.Error ?? READ, pages.Milliseconds));

    string evidence = await WriteEvidence(new Evidence(
      Note: "Redacted: outcomes, counts, ages in days and durations only. No amounts, names, texts, references, ids or PSU header values.",
      RunUtc: TimeProvider.System.GetUtcNow().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
      TransactionsDays: DAYS,
      PsuHeadersSent: ["Psu-Ip-Address", "Psu-User-Agent"],
      Reads: reads,
      RawPages: pages.Value?.Counts), today, "real-account-check");

    foreach (ReadSummary read in reads)
      Console.WriteLine($"{read.Read}, {read.Trigger}: {read.Outcome}");

    Console.WriteLine($"Evidence: {evidence}");

    reads.Where(static read => read.Outcome != READ).Select(static read => $"{read.Read}, {read.Trigger}: {read.Outcome}")
      .ShouldBeEmpty($"every read succeeds; the evidence file records each outcome ({evidence})");
  }

  /// <summary>
  /// c008 design.md D11: whether Enable Banking accepts a continuation key a second time, as a retried transactions page
  /// sends it. With the owner present (the owner's headers, as above; Revolut does not limit such reads): the first page of
  /// the last 89 days, then the second page twice with the same key, the second time right after the first answered.
  /// Writes <c>spikes/enable-banking/evidence/&lt;date&gt;-continuation-key-reuse.json</c>: each request's outcome and
  /// duration, the transactions on each answer of the second page, whether both answers hold the same transactions in the
  /// same order (compared in memory by entry reference, never saved) and whether each announces a next page. Nothing else.
  /// </summary>
  [Test]
  public async Task A_continuation_key_works_a_second_time() {
    Dictionary<string, string?> settings = RealBankWiring.SettingsFromUserSecrets(_secrets);
    PresentUser owner = new(await OwnersPublicAddress(), $"RevolutReader-check/1.0 .NET/{Environment.Version}");

    await using ServiceProvider services = RealBankWiring.Wiring(settings);
    EnableBankingClient client = (EnableBankingClient)services.GetRequiredService<IBankAccount>();
    DateOnly today = DateOnly.FromDateTime(TimeProvider.System.GetUtcNow().UtcDateTime);
    DateOnly from = today.AddDays(-DAYS);

    Timed<BankResult<EbTransactionPage>> first = await Time(() => client.ReadTransactionPage(from, null, owner, CancellationToken.None));
    string? key = (first.Value.Value as EbTransactionPage)?.ContinuationKey;
    List<PageAnswer> answers = [PageAnswer.Of("page 1", first)];

    EbTransactionPage? secondOnce = null;
    EbTransactionPage? secondAgain = null;

    if (!string.IsNullOrEmpty(key)) {
      Timed<BankResult<EbTransactionPage>> once = await Time(() => client.ReadTransactionPage(from, key, owner, CancellationToken.None));
      Timed<BankResult<EbTransactionPage>> again = await Time(() => client.ReadTransactionPage(from, key, owner, CancellationToken.None));

      answers.Add(PageAnswer.Of("page 2, first time", once));
      answers.Add(PageAnswer.Of("page 2, same key again", again));
      secondOnce = once.Value.Value as EbTransactionPage;
      secondAgain = again.Value.Value as EbTransactionPage;
    }

    bool? sameTransactions = secondOnce is null || secondAgain is null
      ? null
      : secondOnce.Transactions.Select(static transaction => transaction.EntryReference).SequenceEqual(secondAgain.Transactions.Select(static transaction => transaction.EntryReference), StringComparer.Ordinal);

    string evidence = await WriteEvidence(new KeyReuseEvidence(
      Note: "Redacted: outcomes, counts and durations only. No amounts, names, texts, references, keys, ids or PSU header values. c008 design.md D11.",
      RunUtc: TimeProvider.System.GetUtcNow().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
      TransactionsDays: DAYS,
      PsuHeadersSent: ["Psu-Ip-Address", "Psu-User-Agent"],
      FirstPageAnnouncesAnother: !string.IsNullOrEmpty(key),
      Requests: answers,
      SecondPageAnswersHoldTheSameTransactions: sameTransactions), today, "continuation-key-reuse");

    foreach (PageAnswer answer in answers)
      Console.WriteLine($"{answer.Request}: {answer.Outcome}");

    Console.WriteLine($"Evidence: {evidence}");

    key.ShouldNotBeNullOrEmpty($"the first page announces a second one, or nothing was tried ({evidence})");
    answers.Where(static answer => answer.Outcome != READ).Select(static answer => $"{answer.Request}: {answer.Outcome}")
      .ShouldBeEmpty($"every request succeeds; the evidence file records each outcome ({evidence})");
    sameTransactions.ShouldBe(true, $"both answers of the second page hold the same transactions ({evidence})");
  }

  /// <summary>
  /// The owner's public IPv4 address, as the M1 smoke test fetches it. Sent only to Enable Banking as the user's
  /// address; an answer that is not an IPv4 address fails without being quoted.
  /// </summary>
  private static async Task<IPAddress> OwnersPublicAddress() {
    using HttpClient ipify = new() { Timeout = TimeSpan.FromSeconds(15) };
    string answer = (await ipify.GetStringAsync(new Uri("https://api.ipify.org"))).Trim();

    return IPAddress.TryParse(answer, out IPAddress? address) && address.AddressFamily == AddressFamily.InterNetwork && answer.Count(static character => character == '.') == 3
      ? address
      : throw new InvalidOperationException("Unexpected answer from api.ipify.org (expected an IPv4 address).");
  }

  /// <summary>
  /// The days from <paramref name="from"/> through the raw page reader, following each continuation key until none, or an
  /// empty one, comes back (D7, 16.6), and the counts over every page. A failed page, a repeated key or too many pages
  /// end it with that outcome.
  /// </summary>
  private static async Task<RawPages> ReadRawPages(EnableBankingClient client, DateOnly from, PresentUser owner, DateOnly today) {
    List<EbTransaction> transactions = [];
    HashSet<string> keysReturned = new(StringComparer.Ordinal);
    string? continuationKey = null;
    int pageCount = 0;

    while (true) {
      BankResult<EbTransactionPage> result = await client.ReadTransactionPage(from, continuationKey, owner, CancellationToken.None);

      if (result.Value is not EbTransactionPage page)
        return new RawPages($"page {pageCount + 1}: {RealBankWiring.OutcomeOf(result.Value)}", RawPageCounts.Of(pageCount, transactions, today));

      pageCount++;
      transactions.AddRange(page.Transactions);

      if (string.IsNullOrEmpty(page.ContinuationKey))
        return new RawPages(READ, RawPageCounts.Of(pageCount, transactions, today));

      if (!keysReturned.Add(page.ContinuationKey))
        return new RawPages($"a continuation key came back again after {pageCount} pages", RawPageCounts.Of(pageCount, transactions, today));

      if (pageCount == MOST_PAGES)
        return new RawPages($"stopped after {MOST_PAGES} pages", RawPageCounts.Of(pageCount, transactions, today));

      continuationKey = page.ContinuationKey;
    }
  }

  /// <summary>The read's result and how long it took; an exception becomes its outcome (its type, and for the adapter's own error its message, which names only a status and a code, D5).</summary>
  private static async Task<Timed<T>> Time<T>(Func<Task<T>> read) {
    Stopwatch watch = Stopwatch.StartNew();

    try {
      T value = await read();

      return new(value, Error: null, watch.ElapsedMilliseconds);
    }
    catch (BankReadException exception) {
      return new(default, $"{nameof(BankReadException)}: {exception.Message}", watch.ElapsedMilliseconds);
    }
    catch (Exception exception) when (exception is not OperationCanceledException) {
      return new(default, exception.GetType().Name, watch.ElapsedMilliseconds);
    }
  }

  private static string OutcomeOf<T>(Timed<BankResult<T>> timed) => timed.Error ?? RealBankWiring.OutcomeOf(timed.Value.Value);

  /// <summary>How many transactions the port returned, by status.</summary>
  private static TransactionCounts? CountsOf(Transactions? transactions) => transactions is null
    ? null
    : new TransactionCounts(
      transactions.Items.Count,
      transactions.Items.Count(static item => item.Status == TransactionStatus.Booked),
      transactions.Items.Count(static item => item.Status == TransactionStatus.Pending));

  /// <summary>Writes the summary to <c>spikes/enable-banking/evidence/&lt;yyyy-MM-dd&gt;-&lt;name&gt;.json</c> in the repository; its path.</summary>
  private static async Task<string> WriteEvidence<T>(T evidence, DateOnly today, string name) {
    string path = Path.Combine(RepositoryRoot(), "spikes", "enable-banking", "evidence", $"{today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}-{name}.json");

    await File.WriteAllTextAsync(path, JsonSerializer.Serialize(evidence, _evidenceJson) + "\n");

    return path;
  }

  /// <summary>The repository's root: the nearest folder above the test's own that holds <c>RevolutReader.slnx</c>.</summary>
  private static string RepositoryRoot() {
    for (DirectoryInfo? folder = new(AppContext.BaseDirectory); folder is not null; folder = folder.Parent) {
      if (File.Exists(Path.Combine(folder.FullName, "RevolutReader.slnx")))
        return folder.FullName;
    }

    throw new InvalidOperationException("No RevolutReader.slnx above the test's folder.");
  }

  private sealed record Timed<T>(T? Value, string? Error, long Milliseconds);

  private sealed record RawPages(string Outcome, RawPageCounts Counts);

  private sealed record Evidence(
    string Note,
    string RunUtc,
    int TransactionsDays,
    IReadOnlyList<string> PsuHeadersSent,
    IReadOnlyList<ReadSummary> Reads,
    RawPageCounts? RawPages);

  private sealed record KeyReuseEvidence(
    string Note,
    string RunUtc,
    int TransactionsDays,
    IReadOnlyList<string> PsuHeadersSent,
    bool FirstPageAnnouncesAnother,
    IReadOnlyList<PageAnswer> Requests,
    bool? SecondPageAnswersHoldTheSameTransactions);

  /// <summary>One page request of the key-reuse probe: how it ended, how long it took, how many transactions, whether it announces a next page.</summary>
  private sealed record PageAnswer(string Request, string Outcome, long DurationMs, int? Transactions, bool? AnnouncesAnother) {
    public static PageAnswer Of(string request, Timed<BankResult<EbTransactionPage>> timed) {
      EbTransactionPage? page = timed.Value.Value as EbTransactionPage;

      return new(request, OutcomeOf(timed), timed.Milliseconds, page?.Transactions.Count, page is null ? null : !string.IsNullOrEmpty(page.ContinuationKey));
    }
  }

  /// <summary>One read: which, for whom, how it ended, how long it took; for the transactions, how many came back.</summary>
  private sealed record ReadSummary(string Read, string Trigger, string Outcome, long DurationMs, TransactionCounts? Transactions = null);

  private sealed record TransactionCounts(int Count, int Booked, int Pending);

  /// <summary>Counts over the raw pages: the pages, the statuses as the bank writes them, and the fields pending and booked transactions carry.</summary>
  private sealed record RawPageCounts(int Pages, int Transactions, IReadOnlyDictionary<string, int> ByStatus, FieldCounts Pending, FieldCounts Booked) {
    public static RawPageCounts Of(int pages, List<EbTransaction> transactions, DateOnly today) => new(
      pages,
      transactions.Count,
      transactions.GroupBy(static transaction => transaction.Status ?? "(none)", StringComparer.Ordinal).OrderBy(static group => group.Key, StringComparer.Ordinal).ToDictionary(static group => group.Key, static group => group.Count(), StringComparer.Ordinal),
      FieldCounts.Of([.. transactions.Where(static transaction => transaction.Status == "PDNG")], today),
      FieldCounts.Of([.. transactions.Where(static transaction => transaction.Status == "BOOK")], today));
  }

  /// <summary>
  /// How many of these transactions carry each field; the oldest one's age in days, from the date it is dated by (the
  /// transaction date, else the booking date, else the value date, D3) against today.
  /// </summary>
  private sealed record FieldCounts(int Count, int WithEntryReference, int WithTransactionDate, int WithBookingDate, int WithValueDate, int? OldestAgeDays) {
    public static FieldCounts Of(EbTransaction[] transactions, DateOnly today) {
      DateOnly[] dates = [.. transactions.Select(static transaction => transaction.TransactionDate ?? transaction.BookingDate ?? transaction.ValueDate).OfType<DateOnly>()];

      return new(
        transactions.Length,
        transactions.Count(static transaction => !string.IsNullOrEmpty(transaction.EntryReference)),
        transactions.Count(static transaction => transaction.TransactionDate is not null),
        transactions.Count(static transaction => transaction.BookingDate is not null),
        transactions.Count(static transaction => transaction.ValueDate is not null),
        dates.Length == 0 ? null : today.DayNumber - dates.Min().DayNumber);
    }
  }
}