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

  /// <summary>The API reference's names: snake_case.</summary>
  private static readonly JsonSerializerOptions _json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

  /// <summary><c>GET /accounts/{account}/balances</c>, then the available balance (D3).</summary>
  public async Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken) {
    using HttpRequestMessage request = SignedGet($"accounts/{Uri.EscapeDataString(options.Value.AccountId)}/balances");
    using HttpResponseMessage response = await http.SendAsync(request, cancellationToken);

    response.EnsureSuccessStatusCode();

    EbBalances balances = await response.Content.ReadFromJsonAsync<EbBalances>(_json, cancellationToken)
      ?? throw new BankReadException("The bank's balances answer is empty.");

    return BalanceSelection.Available(balances);
  }

  public Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken) => throw new NotImplementedException();

  /// <summary>A <c>GET</c> of <paramref name="path"/>, relative to the API address, carrying a new application token.</summary>
  private HttpRequestMessage SignedGet(string path) => new(HttpMethod.Get, new Uri(path, UriKind.Relative)) {
    Headers = { Authorization = new AuthenticationHeaderValue(BEARER, token.Create(time.GetUtcNow())) },
  };
}