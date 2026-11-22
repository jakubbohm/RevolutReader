using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using WireMock.Matchers;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;
using WireMock.Settings;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// The fake CNB every test app copy asks for the koruna rate (c017 design.md D10): a WireMock.Net server per test, started
/// before the app copy on the loopback address (<see cref="LoopbackWireMock"/>), in front of the app's real CNB client, so
/// no test ever reaches <c>api.cnb.cz</c>. Every app copy gets its settings (<see cref="Configure"/>), next to the fake
/// bank's, so the app starts whether or not the test needs a rate: its address as <c>Cnb:Address</c>, and the production
/// time limit, 2 s, as <c>Cnb:TimeLimit</c> (D10: a shorter limit could turn a slow fake under parallel load into a failed
/// ask and a wrong rate in an unrelated scenario).
/// <para>
/// It answers only what the app asks (D1): a <c>GET</c> of <c>/cnbapi/exrates/daily</c> with no query, so no <c>date</c>
/// (the latest declared rates) and no <c>lang</c>; anything else gets WireMock.Net's 404. Its answers are the CNB's real
/// answer captured on 2026-11-21 (<c>Drivers/CnbDaily.json</c>, § Bootstrap: public data, all 30 entries, UTF-8 with the
/// Czech names the API gives with no <c>lang</c>), sent as the API sends it (<c>application/json</c>, no charset; checked
/// 2026-11-21), with only the euro's <c>rate</c> and <c>validFor</c> replaced (<see cref="DailyRates"/>).
/// </para>
/// <para>
/// By default it answers <see cref="DEFAULT_CZK_PER_EUR"/> koruna per euro for the clock's date when it starts (the UTC date
/// of its time, as the app takes today), below every answer a test sets up (<see cref="FALLBACK_PRIORITY"/>): a rate no
/// scenario names (lessons.md R-15), so a scenario never passes on the default, and an app copy whose test names no rate
/// still gets one. <see cref="RequestsReceived"/> counts every request as it arrives, answered or not.
/// </para>
/// <para>
/// A test sets up one answer at a time, each replacing the one before: a rate (<see cref="AnswerRate"/>), a server error
/// (<see cref="AnswerServerError"/>) or no answer within the limit (<see cref="AnswerNeverInTime"/>).
/// </para>
/// </summary>
public sealed class FakeCnb : IDisposable {
  /// <summary>The rate no scenario names, which the fake answers by default (lessons.md R-15).</summary>
  internal const decimal DEFAULT_CZK_PER_EUR = 25.125m;

  /// <summary>The settings section the app's CNB client is bound to (design.md § Public API sketch, <c>CnbOptions</c>).</summary>
  private const string SECTION = "Cnb";

  /// <summary>The CNB's latest daily rates (D1).</summary>
  private const string DAILY_RATES = "/cnbapi/exrates/daily";

  /// <summary>As the API names its answer's type (no charset; the body is UTF-8).</summary>
  private const string JSON = "application/json";

  /// <summary>As the API writes a day (<c>validFor</c>).</summary>
  private const string DATE = "yyyy-MM-dd";

  /// <summary>The members of the answer the fake reads and replaces (D1).</summary>
  private const string RATES = "rates";
  private const string CURRENCY_CODE = "currencyCode";
  private const string RATE = "rate";
  private const string VALID_FOR = "validFor";
  private const string EURO = "EUR";

  /// <summary>
  /// The priority of the default answer: below every answer a test sets up (WireMock.Net: a lower value is a higher
  /// priority; a test's answers keep the default, 0), so any of them wins, whether set up before or after it.
  /// </summary>
  private const int FALLBACK_PRIORITY = 1;

  /// <summary>The captured answer, as text, read once per test run.</summary>
  private static readonly Lazy<string> _capture = new(() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Drivers", "CnbDaily.json"), Encoding.UTF8));

  /// <summary>Writes the answer as the API does: its Czech letters as they are, not escaped.</summary>
  private static readonly JsonSerializerOptions _asTheCnbWrites = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

  private readonly WireMockServer _server;
  private readonly ArrivalCount _arrivals;

  /// <summary>
  /// The id of the answer a test sets up: each one is set up under it, so it replaces the one before (WireMock.Net replaces
  /// a mapping of the same id), rather than resting on which of two equal mappings WireMock.Net picks.
  /// </summary>
  private readonly Guid _answer = Guid.NewGuid();

  /// <summary>How long one ask may take (D4, D10): 2 s, as in production.</summary>
  public static TimeSpan TimeLimit { get; } = TimeSpan.FromSeconds(2);

  /// <summary>Where the server listens; the app copy's CNB address.</summary>
  public Uri Address { get; }

  /// <summary>Every request the fake received so far, answered or not, counted as it arrived (<see cref="ArrivalCount"/>).</summary>
  public int RequestsReceived => _arrivals.Count;

  /// <summary>The CNB's answer captured on 2026-11-21 (<c>Drivers/CnbDaily.json</c>), as text; for the fake's self-tests.</summary>
  internal static string CapturedAnswer => _capture.Value;

  private FakeCnb(WireMockServer server, ArrivalCount arrivals, string defaultAnswer) {
    _server = server;
    _arrivals = arrivals;
    Address = new Uri(server.Url ?? throw new InvalidOperationException("The fake CNB started without an address."));
    _server.Given(DailyRatesRequest()).AtPriority(FALLBACK_PRIORITY).RespondWith(JsonAnswer(defaultAnswer));
  }

  /// <summary>
  /// Starts a fake CNB on a free port of the loopback address (<see cref="LoopbackWireMock"/>), its own server kept out of
  /// every trace (<see cref="FakeBank.SilenceHostingTelemetry"/>), with <see cref="ArrivalCount"/> in front of WireMock.Net's
  /// own handling, answering <see cref="DEFAULT_CZK_PER_EUR"/> for the date of <paramref name="clock"/> now (the app copy's
  /// clock, <see cref="FakeMicrosoft.Clock"/>). Call it before the app copy starts, so its address is known.
  /// </summary>
  public static FakeCnb Start(TimeProvider clock) {
    ArgumentNullException.ThrowIfNull(clock);

    string defaultAnswer = DailyRates(DEFAULT_CZK_PER_EUR, DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime));
    ArrivalCount arrivals = new();
    WireMockServer server = LoopbackWireMock.Start(new WireMockServerSettings {
      AdditionalServiceRegistration = FakeBank.SilenceHostingTelemetry,
      PreWireMockMiddlewareInit = app => ((IApplicationBuilder)app).Use(arrivals.Record),
    });

    return new(server, arrivals, defaultAnswer);
  }

  /// <summary>
  /// Writes the fake CNB's settings into the app copy's <c>Cnb</c> section: its address and the 2 s time limit. Added as
  /// the last configuration source, so it wins over <c>appsettings.json</c> and over environment variables.
  /// </summary>
  public void Configure(IWebHostBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    Dictionary<string, string?> settings = new() {
      [$"{SECTION}:Address"] = Address.ToString(),
      [$"{SECTION}:TimeLimit"] = TimeLimit.ToString("c", CultureInfo.InvariantCulture),
    };

    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
  }

  /// <summary>
  /// The daily rates answer the capture with the euro at <paramref name="czkPerEur"/> koruna for <paramref name="clockDay"/>,
  /// a date of the app copy's clock (<see cref="DailyRates"/>), above the default; it replaces the answer set up before
  /// (the test's one answer, <see cref="_answer"/>).
  /// </summary>
  public void AnswerRate(decimal czkPerEur, DateOnly clockDay) {
    _arrivals.Holding = false;
    _server.Given(DailyRatesRequest()).WithGuid(_answer).RespondWith(JsonAnswer(DailyRates(czkPerEur, clockDay)));
  }

  /// <summary>
  /// The daily rates are answered with a server error (an HTTP 500, no body) instead of a rate; it replaces the answer set
  /// up before. Not captured: the CNB cannot be made to fail on demand, so the answer is written here.
  /// </summary>
  public void AnswerServerError() {
    _arrivals.Holding = false;
    _server.Given(DailyRatesRequest()).WithGuid(_answer).RespondWith(Response.Create().WithStatusCode(500));
  }

  /// <summary>
  /// The daily rates are answered only later than the 2 s limit (<see cref="TimeLimit"/>), so the app's ask runs out of
  /// time; disposing the fake ends a request still waiting. Each request for them is held in front of WireMock.Net's own
  /// handling (<see cref="ArrivalCount"/>), counted, until the app gives up on it or the fake is disposed, and then cut off
  /// unanswered; an answer set up later (<see cref="AnswerRate"/>, <see cref="AnswerServerError"/>) replaces it.
  /// </summary>
  public void AnswerNeverInTime() => _arrivals.Holding = true;

  /// <summary>
  /// The captured answer with the euro's <c>rate</c> <paramref name="czkPerEur"/> and its <c>validFor</c>
  /// <paramref name="day"/>, as the API writes a day; every other entry and member as captured. Its <c>amount</c> stays 1.
  /// </summary>
  private static string DailyRates(decimal czkPerEur, DateOnly day) {
    JsonNode answer = JsonNode.Parse(CapturedAnswer) ?? throw new InvalidOperationException("Drivers/CnbDaily.json holds no JSON.");
    JsonObject euro = answer[RATES]?.AsArray().OfType<JsonObject>().SingleOrDefault(static entry => entry[CURRENCY_CODE]?.GetValue<string>() == EURO)
      ?? throw new InvalidOperationException("Drivers/CnbDaily.json holds no single euro entry.");

    euro[RATE] = czkPerEur;
    euro[VALID_FOR] = day.ToString(DATE, CultureInfo.InvariantCulture);

    return answer.ToJsonString(_asTheCnbWrites);
  }

  /// <summary>
  /// A <c>GET</c> of exactly <see cref="DAILY_RATES"/> with no query parameter (D1: no <c>date</c>, no <c>lang</c>).
  /// </summary>
  private static IRequestBuilder DailyRatesRequest() =>
    Request.Create().UsingGet().WithPath(new ExactMatcher(DAILY_RATES)).WithParam(static parameters => parameters.Count == 0);

  /// <summary>200 with this JSON body, as UTF-8 bytes.</summary>
  private static IResponseBuilder JsonAnswer(string body) =>
    Response.Create().WithStatusCode(200).WithHeader("Content-Type", JSON).WithBody(Encoding.UTF8.GetBytes(body));

  /// <summary>
  /// Counts every request the fake CNB's server received, as it arrives: a middleware in front of WireMock.Net's own
  /// handling, so a request still waiting for its answer counts (WireMock.Net logs a request only once it has answered it).
  /// While <see cref="Holding"/>, it holds each request for the daily rates instead of passing it on, until the client gives
  /// up on it or the fake stops (<see cref="Stop"/>), and then cuts it off unanswered (<see cref="AnswerNeverInTime"/>).
  /// </summary>
  private sealed class ArrivalCount {
    /// <summary>Ends every held request: completed when the fake stops.</summary>
    private readonly TaskCompletionSource _stopped = new(TaskCreationOptions.RunContinuationsAsynchronously);

    private int _count;
    private volatile bool _holding;

    /// <summary>The requests so far.</summary>
    public int Count => Volatile.Read(ref _count);

    /// <summary>Whether requests for the daily rates are held rather than answered.</summary>
    public bool Holding {
      set => _holding = value;
    }

    /// <summary>The middleware: counts the request, then holds it or passes it on.</summary>
    public async Task Record(HttpContext context, RequestDelegate next) {
      _ = Interlocked.Increment(ref _count);

      if (_holding && HttpMethods.IsGet(context.Request.Method) && context.Request.Path == DAILY_RATES) {
        try {
          await _stopped.Task.WaitAsync(context.RequestAborted);
        }
        catch (OperationCanceledException) {
          // The client gave up on it: its time limit ran out.
        }

        context.Abort();

        return;
      }

      await next(context);
    }

    /// <summary>Ends every held request, as the fake stops.</summary>
    public void Stop() => _stopped.TrySetResult();
  }

  #region IDisposable

  public void Dispose() {
    _arrivals.Stop();
    _server.Dispose();
  }

  #endregion
}