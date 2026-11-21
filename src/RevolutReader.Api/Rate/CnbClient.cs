using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;

namespace RevolutReader.Api.Rate;

/// <summary>
/// The CNB port over the CNB's API (c017 design.md D1, D6, D9): one <c>GET</c> of the latest daily rates per ask, with no
/// date and no <c>lang</c>, on the named client <see cref="NAME"/>, whose base address is <see cref="CnbOptions.Address"/>
/// and whose timeout is <see cref="CnbOptions.TimeLimit"/> (<see cref="RateRegistration.AddKorunaRates"/>). The rate is the
/// euro entry's <c>rate / amount</c>, since the CNB quotes some currencies per 100, and its day the entry's
/// <c>validFor</c>. A singleton that creates its <see cref="HttpClient"/> per ask, so the factory can renew the handler
/// beneath it (D9). The answers it cannot use are tasks.md 21.1's and 23.1's: until then they throw.
/// </summary>
public sealed class CnbClient(IHttpClientFactory clients) : ICnbRates {
  /// <summary>The named client's name.</summary>
  public const string NAME = "cnb";

  /// <summary>The latest daily rates, relative to <see cref="CnbOptions.Address"/> (D1).</summary>
  private const string DAILY_RATES = "cnbapi/exrates/daily";

  /// <summary>The euro's <c>currencyCode</c>.</summary>
  private const string EURO = "EUR";

  /// <summary>As the API writes a day (<c>validFor</c>).</summary>
  private const string DATE = "yyyy-MM-dd";

  /// <summary>The API's names: camelCase.</summary>
  private static readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

  public async Task<CnbAnswer> ReadEuroRate(CancellationToken cancellationToken) {
    using HttpClient http = clients.CreateClient(NAME);
    using HttpResponseMessage answer = await http.GetAsync(new Uri(DAILY_RATES, UriKind.Relative), cancellationToken);

    _ = answer.EnsureSuccessStatusCode();

    CnbDailyRates daily = await answer.Content.ReadFromJsonAsync<CnbDailyRates>(_json, cancellationToken)
      ?? throw new InvalidOperationException("The CNB answered its daily rates with a JSON null.");
    CnbDailyRate euro = daily.Rates.Single(static entry => string.Equals(entry.CurrencyCode, EURO, StringComparison.Ordinal));

    return new KorunaRate(euro.Rate / euro.Amount, DateOnly.ParseExact(euro.ValidFor, DATE, CultureInfo.InvariantCulture));
  }
}