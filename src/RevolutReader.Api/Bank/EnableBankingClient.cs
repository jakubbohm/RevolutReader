using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Bank;

/// <summary>
/// The bank port over Enable Banking's API (spec bank-reads, c004 design.md § Ports and contracts): read-only, for the one
/// configured account; every request a <c>GET</c> signed with the application's token, carrying the user headers of who
/// triggers the read (D2). An error answer becomes the read's failure case, or a <see cref="BankReadException"/> when no
/// case fits (D4); a network failure is the bank unavailable; an answer it cannot read is a <see cref="BankReadException"/>.
/// No exception quotes a URL or a body (D5).
/// </summary>
public sealed class EnableBankingClient(HttpClient http, IOptions<EnableBankingOptions> options, ApplicationToken token, TimeProvider time) : IBankAccount {
  private const string BEARER = "Bearer";

  /// <summary>A calendar date as the API reference writes it in a query.</summary>
  private const string DATE = "yyyy-MM-dd";

  /// <summary>
  /// The API reference's names: snake_case. Lenient about missing or null members: each reader checks what it reads, so
  /// a malformed transaction a read leaves out does not fail it (D3).
  /// </summary>
  private static readonly JsonSerializerOptions _json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

  /// <summary>The configured account's path, relative to the API address.</summary>
  private string AccountPath => $"accounts/{Uri.EscapeDataString(options.Value.AccountId)}";

  /// <summary><c>GET /accounts/{account}/balances</c>, then the available balance (D3).</summary>
  public async Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken) =>
    (await Get<EbBalances>($"{AccountPath}/balances", trigger, HoldsBalances, cancellationToken)) switch {
      EbBalances balances => BalanceSelection.Available(balances),
      BankAccessExpired expired => expired,
      BankRateLimited rateLimited => rateLimited,
      BankUnavailable unavailable => unavailable,
    };

  /// <summary>Every page from <paramref name="from"/> (D7), joined, then the mapping (D3); a failed page fails the read.</summary>
  public async Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken) =>
    (await TransactionPages.ReadAll(continuationKey => ReadTransactionPage(from, continuationKey, trigger, cancellationToken))) switch {
      JoinedPages joined => new Transactions(TransactionMapping.Map(joined.Transactions).Kept),
      BankAccessExpired expired => expired,
      BankRateLimited rateLimited => rateLimited,
      BankUnavailable unavailable => unavailable,
    };

  /// <summary>
  /// One raw page, <c>GET /accounts/{account}/transactions?date_from=…</c>, with <c>&amp;continuation_key=…</c> (escaped)
  /// for a later page; used by <see cref="ReadTransactions"/> and by Check 2's field counts (D7).
  /// </summary>
  public async Task<BankResult<EbTransactionPage>> ReadTransactionPage(DateOnly from, string? continuationKey, ReadTrigger trigger, CancellationToken cancellationToken) {
    string query = $"date_from={from.ToString(DATE, CultureInfo.InvariantCulture)}";

    if (continuationKey is not null)
      query += $"&continuation_key={Uri.EscapeDataString(continuationKey)}";

    return await Get<EbTransactionPage>($"{AccountPath}/transactions?{query}", trigger, HoldsTransactions, cancellationToken);
  }

  /// <summary>
  /// A signed <c>GET</c> of <paramref name="pathAndQuery"/> with the user headers of <paramref name="trigger"/>
  /// (<see cref="PsuHeaders"/>). A success answer is its JSON body read as <typeparamref name="T"/>, which must be
  /// <paramref name="whole"/>; an error answer is its failure case (<see cref="FailureOf{T}"/>).
  /// </summary>
  private async Task<BankResult<T>> Get<T>(string pathAndQuery, ReadTrigger trigger, Func<T, bool> whole, CancellationToken cancellationToken) where T : class {
    using HttpRequestMessage request = SignedGet(pathAndQuery);

    foreach ((string name, string value) in PsuHeaders.For(trigger))
      request.Headers.Add(name, value);

    using HttpResponseMessage? response = await Send(request, cancellationToken);

    if (response is null)
      return new BankUnavailable();

    if (!response.IsSuccessStatusCode)
      return FailureOf<T>(response.StatusCode, await ErrorCodeOf(response, cancellationToken));

    T? body = await ReadJson<T>(response.Content, cancellationToken);

    return body is not null && whole(body) ? body : throw new BankReadException($"The bank's answer lacks what a {typeof(T).Name} must hold.");
  }

  /// <summary>
  /// The answer, its body read whole; <see langword="null"/> when the bank cannot be reached or the connection breaks
  /// before the answer is read (a network failure: the bank unavailable, § Error model). The caller's own cancellation is
  /// not a network failure: its <see cref="OperationCanceledException"/> passes on.
  /// </summary>
  private async Task<HttpResponseMessage?> Send(HttpRequestMessage request, CancellationToken cancellationToken) {
    try {
      return await http.SendAsync(request, cancellationToken);
    }
    catch (HttpRequestException) {
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
  /// The <c>error</c> code of an error answer; <see langword="null"/> when it has none: no body, a JSON <c>null</c>, or
  /// a blank or missing <c>error</c> (D4). A body that is not such JSON is a <see cref="BankReadException"/> naming only
  /// the status.
  /// </summary>
  private static async Task<string?> ErrorCodeOf(HttpResponseMessage response, CancellationToken cancellationToken) {
    byte[] body = await response.Content.ReadAsByteArrayAsync(cancellationToken);

    if (body.All(static character => character is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n'))
      return null;

    try {
      string? errorCode = JsonSerializer.Deserialize<EbError>(body, _json)?.Error;

      return string.IsNullOrWhiteSpace(errorCode) ? null : errorCode;
    }
    catch (JsonException) {
      throw new BankReadException(string.Create(CultureInfo.InvariantCulture, $"Enable Banking answered {(int)response.StatusCode} with an error body that is not JSON in the shape of an error answer."));
    }
  }

  /// <summary>D4's case for an error answer; one a read has no case for is a <see cref="BankReadException"/> naming its status and code.</summary>
  private static BankResult<T> FailureOf<T>(HttpStatusCode status, string? errorCode) => BankErrorClassification.Classify(status, errorCode) switch {
    BankErrorKind.AccessExpired => new BankAccessExpired(),
    BankErrorKind.RateLimited => new BankRateLimited(),
    BankErrorKind.Unavailable => new BankUnavailable(),
    BankErrorKind.Unexpected => throw new BankReadException(status, errorCode),
    _ => throw new UnreachableException("Not a kind of error answer."),
  };

  /// <summary>A balances answer holds its list of balances, with no gaps in it.</summary>
  private static bool HoldsBalances(EbBalances balances) => balances.Balances is not null && balances.Balances.All(static balance => balance is not null);

  /// <summary>A page holds its list of transactions, with no gaps in it.</summary>
  private static bool HoldsTransactions(EbTransactionPage page) => page.Transactions is not null && page.Transactions.All(static transaction => transaction is not null);

  /// <summary>A <c>GET</c> of <paramref name="pathAndQuery"/>, relative to the API address, carrying a new application token.</summary>
  private HttpRequestMessage SignedGet(string pathAndQuery) => new(HttpMethod.Get, new Uri(pathAndQuery, UriKind.Relative)) {
    Headers = { Authorization = new AuthenticationHeaderValue(BEARER, token.Create(time.GetUtcNow())) },
  };
}