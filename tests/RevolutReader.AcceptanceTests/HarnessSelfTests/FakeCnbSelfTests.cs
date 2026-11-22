using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.AcceptanceTests.Drivers;
using Shouldly;

namespace RevolutReader.AcceptanceTests.HarnessSelfTests;

/// <summary>
/// Checks of the test harness itself, not of the app (c017 design.md D10; tasks.md 1.1): by default the fake CNB answers
/// the CNB's captured answer with only the euro's rate and day replaced, a rate no scenario names for the clock's date; it
/// answers only the request the app sends (D1: the latest daily rates, no <c>date</c>, no <c>lang</c>), and counts every
/// request. The requests are sent by this test, as the app's CNB client sends them: a plain <c>GET</c>.
/// </summary>
public sealed class FakeCnbSelfTests {
  /// <summary>The fake's own default rate (D10), which no scenario names.</summary>
  private const decimal DEFAULT_CZK_PER_EUR = 25.125m;

  /// <summary>The CNB's latest daily rates (D1).</summary>
  private const string DAILY_RATES = "/cnbapi/exrates/daily";

  /// <summary>The clock's time: half past midnight at UTC+1, still 2026-12-03 in UTC, so the default's day is the clock's UTC date.</summary>
  private static readonly DateTimeOffset _clockNow = new(2026, 12, 4, 0, 30, 0, TimeSpan.FromHours(1));

  [Test]
  public async Task By_default_it_answers_the_capture_with_the_euro_at_its_own_rate_for_the_clocks_UTC_date() {
    using FakeCnb fake = FakeCnb.Start(new FakeTimeProvider(_clockNow));
    using HttpClient http = new();

    using HttpResponseMessage response = await http.GetAsync(new Uri(fake.Address, DAILY_RATES));
    string body = Encoding.UTF8.GetString(await response.Content.ReadAsByteArrayAsync());

    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    MediaTypeHeaderValue type = response.Content.Headers.ContentType.ShouldNotBeNull("the answer names its type");
    type.MediaType.ShouldBe("application/json", "as the CNB names its answer's type");
    type.CharSet.ShouldBeNull("the CNB names no charset");
    body.ShouldContain("Čína", Case.Sensitive, "the Czech names as the CNB writes them: UTF-8, not escaped");

    JsonArray rates = RatesOf(body);
    JsonArray captured = RatesOf(FakeCnb.CapturedAnswer);
    rates.Count.ShouldBe(captured.Count, "every entry of the capture");

    for (int index = 0; index < captured.Count; index++) {
      JsonObject entry = rates[index].ShouldNotBeNull().AsObject();
      JsonObject expected = captured[index].ShouldNotBeNull().AsObject();

      if (CodeOf(expected) == "EUR") {
        entry["rate"].ShouldNotBeNull().GetValue<decimal>().ShouldBe(DEFAULT_CZK_PER_EUR, "the euro's rate, the fake's own");
        entry["validFor"].ShouldNotBeNull().GetValue<string>().ShouldBe("2026-12-03", "the euro's day, the clock's UTC date");
        WithoutRateAndDay(entry).ShouldBe(WithoutRateAndDay(expected), "the euro's other members as captured");
      }
      else {
        entry.ToJsonString().ShouldBe(expected.ToJsonString(), $"the entry {CodeOf(expected)} as captured");
      }
    }
  }

  [Test]
  public async Task It_answers_only_a_GET_of_the_latest_daily_rates_and_counts_every_request() {
    using FakeCnb fake = FakeCnb.Start(new FakeTimeProvider(_clockNow));

    (await StatusOf(fake, $"{DAILY_RATES}?date=2026-11-08")).ShouldBe(HttpStatusCode.NotFound, "a given day's rates, not the latest");
    (await StatusOf(fake, $"{DAILY_RATES}?lang=EN")).ShouldBe(HttpStatusCode.NotFound, "the rates in another language");
    (await StatusOf(fake, "/cnbapi/fxrates/daily-month")).ShouldBe(HttpStatusCode.NotFound, "another list");
    (await StatusOf(fake, DAILY_RATES)).ShouldBe(HttpStatusCode.OK, "the latest daily rates");

    fake.RequestsReceived.ShouldBe(4, "every request, answered or not");
  }

  /// <summary>The <c>rates</c> array of an answer.</summary>
  private static JsonArray RatesOf(string answer) => JsonNode.Parse(answer).ShouldNotBeNull()["rates"].ShouldNotBeNull().AsArray();

  /// <summary>An entry's <c>currencyCode</c>.</summary>
  private static string CodeOf(JsonObject entry) => entry["currencyCode"].ShouldNotBeNull().GetValue<string>();

  /// <summary>The entry's JSON without its <c>rate</c> and <c>validFor</c>, the two members the fake replaces.</summary>
  private static string WithoutRateAndDay(JsonObject entry) {
    JsonObject copy = entry.DeepClone().AsObject();
    _ = copy.Remove("rate");
    _ = copy.Remove("validFor");

    return copy.ToJsonString();
  }

  /// <summary>A plain <c>GET</c> of <paramref name="pathAndQuery"/> at the fake, from a client of its own; the answer's status.</summary>
  private static async Task<HttpStatusCode> StatusOf(FakeCnb fake, string pathAndQuery) {
    using HttpClient http = new();
    using HttpResponseMessage response = await http.GetAsync(new Uri(fake.Address, pathAndQuery));

    return response.StatusCode;
  }
}