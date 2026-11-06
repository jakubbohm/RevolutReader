using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Bank;

/// <summary>
/// The bank port over Enable Banking's API (spec bank-reads, c004 design.md § Ports and contracts): read-only, for the one
/// configured account; every request a <c>GET</c> signed with the application's token.
/// </summary>
public sealed class EnableBankingClient(HttpClient http, IOptions<EnableBankingOptions> options, ApplicationToken token, TimeProvider time) : IBankAccount {
  private const string BEARER = "Bearer";

  /// <summary>A calendar date as the API reference writes it in a query.</summary>
  private const string DATE = "yyyy-MM-dd";

  /// <summary>The API reference's names: snake_case.</summary>
  private static readonly JsonSerializerOptions _json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

  /// <summary>The configured account's path, relative to the API address.</summary>
  private string AccountPath => $"accounts/{Uri.EscapeDataString(options.Value.AccountId)}";

  /// <summary><c>GET /accounts/{account}/balances</c>, then the available balance (D3).</summary>
  public async Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken) =>
    BalanceSelection.Available(await Get<EbBalances>($"{AccountPath}/balances", cancellationToken));

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

    return await Get<EbTransactionPage>($"{AccountPath}/transactions?{query}", cancellationToken);
  }

  /// <summary>A signed <c>GET</c> of <paramref name="pathAndQuery"/>, its JSON body read as <typeparamref name="T"/>.</summary>
  private async Task<T> Get<T>(string pathAndQuery, CancellationToken cancellationToken) where T : class {
    using HttpRequestMessage request = SignedGet(pathAndQuery);
    using HttpResponseMessage response = await http.SendAsync(request, cancellationToken);

    response.EnsureSuccessStatusCode();

    return await response.Content.ReadFromJsonAsync<T>(_json, cancellationToken)
      ?? throw new BankReadException($"The bank's answer is empty where a {typeof(T).Name} was expected.");
  }

  /// <summary>A <c>GET</c> of <paramref name="pathAndQuery"/>, relative to the API address, carrying a new application token.</summary>
  private HttpRequestMessage SignedGet(string pathAndQuery) => new(HttpMethod.Get, new Uri(pathAndQuery, UriKind.Relative)) {
    Headers = { Authorization = new AuthenticationHeaderValue(BEARER, token.Create(time.GetUtcNow())) },
  };
}