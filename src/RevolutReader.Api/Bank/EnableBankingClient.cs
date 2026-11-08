using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using RevolutReader.ServiceDefaults;

namespace RevolutReader.Api.Bank;

/// <summary>
/// The bank port over Enable Banking's API (spec bank-reads, c004 design.md § Ports and contracts): read-only, for the one
/// configured account; every request a <c>GET</c> signed with the application's token, carrying the user headers of who
/// triggers the read (D2). An error answer becomes the read's failure case, or a <see cref="BankReadException"/> when no
/// case fits (D4), decided by its <c>error</c> value only when that has the shape of a code, otherwise by its status
/// (c006 design.md D3, D7); a network failure is the bank unavailable; a success answer it cannot read is a
/// <see cref="BankReadException"/>. No exception quotes a URL, a body or an error value of another shape, and each read
/// logs one line without identifiers or bank data (D5).
/// </summary>
public sealed partial class EnableBankingClient(HttpClient http, IOptions<EnableBankingOptions> options, ApplicationToken token, TimeProvider time, ILogger<EnableBankingClient> logger)
  : IBankAccount {
  private const string BEARER = "Bearer";

  /// <summary>A calendar date as the API reference writes it in a query.</summary>
  private const string DATE = "yyyy-MM-dd";

  /// <summary>No status or no error code, in the log line.</summary>
  private const string NONE = "none";

  /// <summary>An error value that does not have the shape of a code, in the log line: never quoted (c006 design.md D7).</summary>
  private const string UNRECOGNISED = "unrecognised";

  /// <summary>
  /// The API reference's names: snake_case. Lenient about missing or null members: each reader checks what it reads, so
  /// a malformed transaction a read leaves out does not fail it (D3).
  /// </summary>
  private static readonly JsonSerializerOptions _json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

  /// <summary>The configured account's path, relative to the API address.</summary>
  private string AccountPath => $"accounts/{Uri.EscapeDataString(options.Value.AccountId)}";

  /// <summary>
  /// <c>GET /accounts/{account}/balances</c>, then the available balance (D3); one log line, whatever ends the read (c006
  /// design.md D6): an exception passes on unchanged after it.
  /// </summary>
  public async Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken) {
    ReadRecord record = new(time);
    BankResult<Balance> result;

    try {
      result = (await Get<EbBalances>($"{AccountPath}/balances", trigger, HoldsBalances, record, cancellationToken)) switch {
        EbBalances balances => BalanceSelection.Available(balances),
        BankAccessExpired expired => expired,
        BankRateLimited rateLimited => rateLimited,
        BankUnavailable unavailable => unavailable,
      };
    }
    catch (BankReadException exception) {
      BalanceReadEnded(LogLevel.Error, trigger, Outcome.UNEXPECTED, exception.Message, record);

      throw;
    }
    catch (OperationCanceledException) {
      BalanceReadEnded(LogLevel.Information, trigger, Outcome.CANCELLED, NONE, record);

      throw;
    }
    catch (Exception exception) {
      BalanceReadEnded(LogLevel.Error, trigger, Outcome.UNEXPECTED, ReasonOf(exception), record);

      throw;
    }

    BalanceReadEnded(LevelOf(result), trigger, OutcomeOf(result), NONE, record);

    return result;
  }

  /// <summary>
  /// Every page from <paramref name="from"/> (D7), joined, then the mapping (D3); a failed page fails the read; one log
  /// line, whatever ends the read (c006 design.md D6): an exception passes on unchanged after it.
  /// </summary>
  public async Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken) {
    ReadRecord record = new(time);
    int leftOut = 0;
    BankResult<Transactions> result;

    try {
      result = (await TransactionPages.ReadAll(continuationKey => ReadPage(from, continuationKey, trigger, record, cancellationToken))) switch {
        JoinedPages joined => KeptOf(joined, out leftOut),
        BankAccessExpired expired => expired,
        BankRateLimited rateLimited => rateLimited,
        BankUnavailable unavailable => unavailable,
      };
    }
    catch (BankReadException exception) {
      TransactionsReadEnded(LogLevel.Error, trigger, Outcome.UNEXPECTED, exception.Message, record, leftOut);

      throw;
    }
    catch (OperationCanceledException) {
      TransactionsReadEnded(LogLevel.Information, trigger, Outcome.CANCELLED, NONE, record, leftOut);

      throw;
    }
    catch (Exception exception) {
      TransactionsReadEnded(LogLevel.Error, trigger, Outcome.UNEXPECTED, ReasonOf(exception), record, leftOut);

      throw;
    }

    TransactionsReadEnded(LevelOf(result), trigger, OutcomeOf(result), NONE, record, leftOut);

    return result;
  }

  /// <summary>
  /// One raw page, <c>GET /accounts/{account}/transactions?date_from=…</c>, with <c>&amp;continuation_key=…</c> (escaped)
  /// for a later page; used by Check 2's field counts (D7). Logs nothing: it is not a read of its own.
  /// </summary>
  public Task<BankResult<EbTransactionPage>> ReadTransactionPage(DateOnly from, string? continuationKey, ReadTrigger trigger, CancellationToken cancellationToken) =>
    ReadPage(from, continuationKey, trigger, new ReadRecord(time), cancellationToken);

  private Task<BankResult<EbTransactionPage>> ReadPage(DateOnly from, string? continuationKey, ReadTrigger trigger, ReadRecord record, CancellationToken cancellationToken) {
    string query = $"date_from={from.ToString(DATE, CultureInfo.InvariantCulture)}";

    if (continuationKey is not null)
      query += $"&continuation_key={Uri.EscapeDataString(continuationKey)}";

    return Get<EbTransactionPage>($"{AccountPath}/transactions?{query}", trigger, HoldsTransactions, record, cancellationToken);
  }

  /// <summary>
  /// A signed <c>GET</c> of <paramref name="pathAndQuery"/> with the user headers of <paramref name="trigger"/>
  /// (<see cref="PsuHeaders"/>), left out of the exported traces (<see cref="HttpRequestTracing.Exclude"/>, D5). A success
  /// answer is its JSON body read as <typeparamref name="T"/>, which must be <paramref name="whole"/>; an error answer is
  /// its failure case (<see cref="FailureOf{T}"/>). What it sees goes into <paramref name="record"/>.
  /// </summary>
  private async Task<BankResult<T>> Get<T>(string pathAndQuery, ReadTrigger trigger, Func<T, bool> whole, ReadRecord record, CancellationToken cancellationToken)
    where T : class {
    using HttpRequestMessage request = SignedGet(pathAndQuery);

    foreach ((string name, string value) in PsuHeaders.For(trigger))
      request.Headers.Add(name, value);

    request.Options.Set(HttpRequestTracing.Exclude, true);

    record.Sent();

    using HttpResponseMessage? response = await Send(request, record, cancellationToken);

    if (response is null)
      return new BankUnavailable();

    record.Answered(response.StatusCode);

    if (!response.IsSuccessStatusCode) {
      ErrorValue error = await ErrorValueOf(response, cancellationToken);

      record.ErrorCodeIs(error.Logged);

      return FailureOf<T>(response.StatusCode, error);
    }

    T? body = await ReadJson<T>(response.Content, cancellationToken);

    return body is not null && whole(body) ? body : throw new BankReadException($"The bank's answer lacks what a {typeof(T).Name} must hold.");
  }

  /// <summary>
  /// The answer, its body read whole; <see langword="null"/> when the bank cannot be reached, the connection breaks before
  /// the answer is read, or the answer takes longer than our request timeout (all the bank unavailable, § Error model). The
  /// caller's own cancellation is none of these: its <see cref="OperationCanceledException"/> passes on.
  /// </summary>
  private async Task<HttpResponseMessage?> Send(HttpRequestMessage request, ReadRecord record, CancellationToken cancellationToken) {
    try {
      return await http.SendAsync(request, cancellationToken);
    }
    catch (HttpRequestException) {
      record.NotAnswered("network failure");

      return null;
    }
    catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested) {
      // The client's Timeout (EnableBankingOptions.RequestTimeout) ran out, not the caller's patience.
      record.NotAnswered("timed out");

      return null;
    }
  }

  /// <summary>
  /// The JSON body as <typeparamref name="T"/>; <see langword="null"/> for a JSON <c>null</c>. Not JSON, or not of that
  /// shape, is a <see cref="BankReadException"/> without the <see cref="JsonException"/>, whose message would quote the
  /// body where the reading stopped.
  /// </summary>
  private static async Task<T?> ReadJson<T>(HttpContent content, CancellationToken cancellationToken) where T : class {
    await using Stream body = await content.ReadAsStreamAsync(cancellationToken);

    try {
      return await JsonSerializer.DeserializeAsync<T>(body, _json, cancellationToken);
    }
    catch (JsonException) {
      throw new BankReadException($"The bank's answer is not JSON in the shape of a {typeof(T).Name}.");
    }
  }

  /// <summary>
  /// The <c>error</c> value of an error answer (c006 design.md D3, D7). No value: a body that is not JSON of the error
  /// answer's shape (none at all, a JSON <c>null</c>, a gateway's HTML page, plain text, an array), or a missing,
  /// <c>null</c> or blank <c>error</c>. A text of the code shape is a code; any other value, a text or not, is of another
  /// shape. What the body holds never makes it throw.
  /// </summary>
  private static async Task<ErrorValue> ErrorValueOf(HttpResponseMessage response, CancellationToken cancellationToken) {
    byte[] body = await response.Content.ReadAsByteArrayAsync(cancellationToken);
    JsonElement error;

    try {
      error = JsonSerializer.Deserialize<EbError>(body, _json)?.Error ?? default;
    }
    catch (JsonException) {
      return ErrorValue.None;
    }

    return error.ValueKind switch {
      JsonValueKind.Undefined or JsonValueKind.Null => ErrorValue.None,
      JsonValueKind.String => ErrorValue.Of(error.GetString()),
      _ => ErrorValue.OfAnotherShape,
    };
  }

  /// <summary>
  /// D4's case for an error answer, by its code, or by its status when it carried none (c006 design.md D3); one a read has
  /// no case for is a <see cref="BankReadException"/> naming its status and code, or that its value was unrecognised (D7).
  /// </summary>
  private static BankResult<T> FailureOf<T>(HttpStatusCode status, ErrorValue error) => BankErrorClassification.Classify(status, error.Code) switch {
    BankErrorKind.AccessExpired => new BankAccessExpired(),
    BankErrorKind.RateLimited => new BankRateLimited(),
    BankErrorKind.Unavailable => new BankUnavailable(),
    BankErrorKind.Unexpected => throw (error.IsUnrecognised ? BankReadException.ForUnrecognisedErrorValue(status) : new BankReadException(status, error.Code)),
    _ => throw new UnreachableException("Not a kind of error answer."),
  };

  /// <summary>The kept transactions of every page; <paramref name="leftOut"/> counts the others (D3), for the log line.</summary>
  private static Transactions KeptOf(JoinedPages joined, out int leftOut) {
    MappedTransactions mapped = TransactionMapping.Map(joined.Transactions);

    leftOut = mapped.LeftOut;

    return new Transactions(mapped.Kept);
  }

  /// <summary>A balances answer holds its list of balances, with no gaps in it.</summary>
  private static bool HoldsBalances(EbBalances balances) => balances.Balances is not null && balances.Balances.All(static balance => balance is not null);

  /// <summary>A page holds its list of transactions, with no gaps in it.</summary>
  private static bool HoldsTransactions(EbTransactionPage page) => page.Transactions is not null && page.Transactions.All(static transaction => transaction is not null);

  /// <summary>A <c>GET</c> of <paramref name="pathAndQuery"/>, relative to the API address, carrying a new application token.</summary>
  private HttpRequestMessage SignedGet(string pathAndQuery) => new(HttpMethod.Get, new Uri(pathAndQuery, UriKind.Relative)) {
    Headers = { Authorization = new AuthenticationHeaderValue(BEARER, token.Create(time.GetUtcNow())) },
  };

  /// <summary>The balance read's one log line (<see cref="LogBalanceRead"/>), its values worked out only when the level is on.</summary>
  private void BalanceReadEnded(LogLevel level, ReadTrigger trigger, string outcome, string reason, ReadRecord record) {
    if (!logger.IsEnabled(level))
      return;

    string who = WhoOf(trigger);

    LogBalanceRead(logger, level, who, outcome, record.Status, record.ErrorCode, reason, record.Milliseconds);
  }

  /// <summary>The transactions read's one log line (<see cref="LogTransactionsRead"/>), its values worked out only when the level is on.</summary>
  private void TransactionsReadEnded(LogLevel level, ReadTrigger trigger, string outcome, string reason, ReadRecord record, int leftOut) {
    if (!logger.IsEnabled(level))
      return;

    string who = WhoOf(trigger);

    LogTransactionsRead(logger, level, who, outcome, record.Status, record.ErrorCode, reason, record.Requests, leftOut, record.Milliseconds);
  }

  /// <summary>
  /// Who triggers the read, as the log line says it: never the user's address or browser (D5). An empty
  /// <see cref="ReadTrigger"/> ends the read as an exception, and its line is still written (c006 design.md D6).
  /// </summary>
  private static string WhoOf(ReadTrigger trigger) => trigger.Value switch {
    PresentUser => "a present user",
    Unattended => "nobody (unattended)",
    _ => "an empty trigger",
  };

  /// <summary>
  /// The reason an exception other than <see cref="BankReadException"/> gives in the log line: its type name only, never
  /// its message, which could hold anything (c006 design.md D8 a).
  /// </summary>
  private static string ReasonOf(Exception exception) => exception.GetType().Name;

  private static string OutcomeOf<T>(BankResult<T> result) => result.Value switch {
    BankAccessExpired => Outcome.ACCESS_EXPIRED,
    BankRateLimited => Outcome.RATE_LIMITED,
    BankUnavailable => Outcome.BANK_UNAVAILABLE,
    _ => Outcome.READ,
  };

  /// <summary>A read is information; a failure case is a warning (the owner, or the bank, has something to fix).</summary>
  private static LogLevel LevelOf<T>(BankResult<T> result) => result.Value is BankAccessExpired or BankRateLimited or BankUnavailable ? LogLevel.Warning : LogLevel.Information;

  /// <summary>
  /// The balance read's line: who triggered it, how it ended, the answer's HTTP status (or why there was none), the
  /// Enable Banking error code, the reason for an unexpected end (c006 design.md D8 a: the
  /// <see cref="BankReadException"/>'s message, another exception's type name, <c>none</c> otherwise), the time taken. The
  /// trace id comes with the logging scope (the host's default activity tracking, D5).
  /// </summary>
  [LoggerMessage(EventId = 1, Message = "Bank balance read for {Who}: {Outcome}; HTTP status {Status}, error code {ErrorCode}, reason {Reason}, {DurationMs} ms")]
  private static partial void LogBalanceRead(ILogger logger, LogLevel level, string who, string outcome, string status, string errorCode, string reason, long durationMs);

  /// <summary>The transactions read's line: as the balance read's, with the status of the last page, the pages requested and how many transactions were left out (D3).</summary>
  [LoggerMessage(EventId = 2, Message = "Bank transactions read for {Who}: {Outcome}; HTTP status {Status} on the last page, error code {ErrorCode}, reason {Reason}, {Pages} pages, {LeftOut} left out, {DurationMs} ms")]
  private static partial void LogTransactionsRead(ILogger logger, LogLevel level, string who, string outcome, string status, string errorCode, string reason, int pages, int leftOut, long durationMs);

  /// <summary>
  /// What an error answer carried as its <c>error</c> value (c006 design.md D3, D7): a code (<see cref="Code"/>, a value of
  /// the code shape, quoted as received), no value, or a value of another shape (<see cref="IsUnrecognised"/>), which
  /// counts as no code and is never quoted.
  /// </summary>
  private readonly record struct ErrorValue(string? Code, bool IsUnrecognised) {
    public static ErrorValue None => default;

    public static ErrorValue OfAnotherShape => new(Code: null, IsUnrecognised: true);

    /// <summary>As the log line says it: the code as received, <c>none</c> or <c>unrecognised</c>.</summary>
    public string Logged => Code ?? (IsUnrecognised ? UNRECOGNISED : NONE);

    /// <summary>A blank text is no value, a text of the code shape a code, any other text a value of another shape.</summary>
    public static ErrorValue Of(string? text) =>
      string.IsNullOrWhiteSpace(text) ? None
        : EnableBankingErrorCode.HasCodeShape(text) ? new(Code: text, IsUnrecognised: false)
        : OfAnotherShape;
  }

  /// <summary>How a read ended, as the log line says it.</summary>
  private static class Outcome {
    public const string READ = "read";
    public const string ACCESS_EXPIRED = "access expired";
    public const string RATE_LIMITED = "rate limited";
    public const string BANK_UNAVAILABLE = "bank unavailable";
    public const string UNEXPECTED = "an answer no case fits, or one that cannot be read";
    public const string CANCELLED = "cancelled by the caller";
  }

  /// <summary>
  /// What one read saw, for its log line: the requests sent, the last answer's HTTP status (or why there was none) and
  /// Enable Banking error code, and the time since the read began (from the injected <see cref="TimeProvider"/>).
  /// </summary>
  private sealed class ReadRecord(TimeProvider time) {
    private readonly long _started = time.GetTimestamp();

    public int Requests { get; private set; }

    public string Status { get; private set; } = NONE;

    public string ErrorCode { get; private set; } = NONE;

    public long Milliseconds => (long)time.GetElapsedTime(_started).TotalMilliseconds;

    public void Sent() => Requests++;

    public void Answered(HttpStatusCode status) {
      Status = ((int)status).ToString(CultureInfo.InvariantCulture);
      ErrorCode = NONE;
    }

    public void ErrorCodeIs(string errorCode) => ErrorCode = errorCode;

    public void NotAnswered(string why) {
      Status = $"{NONE} ({why})";
      ErrorCode = NONE;
    }
  }
}