using System.Globalization;
using System.Net;
using System.Text.Json;

namespace RevolutReader.Api.Rate;

/// <summary>
/// The CNB port over the CNB's API (c017 design.md D1, D6, D9): one <c>GET</c> of the latest daily rates per ask, with no
/// date and no <c>lang</c>, on the named client <see cref="NAME"/>, whose base address is <see cref="CnbOptions.Address"/>
/// and whose timeout is <see cref="CnbOptions.TimeLimit"/> (<see cref="RateRegistration.AddKorunaRates"/>). A singleton that
/// creates its <see cref="HttpClient"/> per ask, so the factory can renew the handler beneath it (D9).
/// <list type="bullet">
/// <item>A rate: a 200 whose JSON has a <c>rates</c> array with exactly one entry whose <c>currencyCode</c> is <c>EUR</c>,
/// whose <c>rate</c> and <c>amount</c> are positive numbers and whose <c>validFor</c> is a <c>yyyy-MM-dd</c> date. The rate
/// is <c>rate / amount</c>, since the CNB quotes some currencies per 100; its day is <c>validFor</c>.</item>
/// <item>Anything else is a <see cref="CnbFailed"/> with its kind: <see cref="CnbFailure.NoAnswerInTime"/> when the time
/// limit ran out, <see cref="CnbFailure.Unreachable"/> for a network error, <see cref="CnbFailure.Status"/> with the code for
/// any status but 200, <see cref="CnbFailure.Unreadable"/> for an answer of another shape.</item>
/// <item>The caller's own cancellation is no failure of the CNB: it passes on as an <see cref="OperationCanceledException"/>.</item>
/// </list>
/// No retries: the named client has no handler of its own. Logs nothing: <see cref="KorunaRates"/> logs a failed ask.
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

  /// <summary>The API's names, camelCase, matched exactly; a number only as a JSON number.</summary>
  private static readonly JsonSerializerOptions _json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

  private static readonly CnbFailed _unreadable = new(CnbFailure.Unreadable);

  public async Task<CnbAnswer> ReadEuroRate(CancellationToken cancellationToken) {
    using HttpClient http = clients.CreateClient(NAME);

    try {
      // The whole answer is read within the time limit (HttpCompletionOption.ResponseContentRead, GetAsync's default).
      using HttpResponseMessage answer = await http.GetAsync(new Uri(DAILY_RATES, UriKind.Relative), cancellationToken);

      return answer.StatusCode == HttpStatusCode.OK
        ? EuroRate(await DailyRates(answer.Content, cancellationToken))
        : new CnbFailed(CnbFailure.Status, (int)answer.StatusCode);
    }
    catch (HttpRequestException) {
      return new CnbFailed(CnbFailure.Unreachable);
    }
    catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested) {
      // The named client's Timeout (CnbOptions.TimeLimit) ran out, not the caller's patience.
      return new CnbFailed(CnbFailure.NoAnswerInTime);
    }
  }

  /// <summary>The answer's JSON as <see cref="CnbDailyRates"/>; <see langword="null"/> when it is not JSON of that shape, or a JSON <c>null</c>.</summary>
  private static async Task<CnbDailyRates?> DailyRates(HttpContent content, CancellationToken cancellationToken) {
    await using Stream body = await content.ReadAsStreamAsync(cancellationToken);

    try {
      return await JsonSerializer.DeserializeAsync<CnbDailyRates>(body, _json, cancellationToken);
    }
    catch (JsonException) {
      return null;
    }
  }

  /// <summary>The euro's rate and day, when the answer holds them as the class describes; otherwise <see cref="CnbFailure.Unreadable"/>.</summary>
  private static CnbAnswer EuroRate(CnbDailyRates? daily) {
    CnbDailyRate[] euros = [.. (daily?.Rates ?? []).OfType<CnbDailyRate>().Where(static entry => string.Equals(entry.CurrencyCode, EURO, StringComparison.Ordinal))];

    if (euros is not [{ Amount: > 0m, Rate: > 0m, ValidFor: { } validFor } euro]
      || !DateOnly.TryParseExact(validFor, DATE, CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly day))
      return _unreadable;

    return PerEuro(euro) is decimal czkPerEur ? new KorunaRate(czkPerEur, day) : _unreadable;
  }

  /// <summary>The entry's <c>rate / amount</c>; <see langword="null"/> when that is beyond a decimal, as only an amount below 1 could make it.</summary>
  private static decimal? PerEuro(CnbDailyRate euro) {
    try {
      return euro.Rate / euro.Amount;
    }
    catch (OverflowException) {
      return null;
    }
  }
}