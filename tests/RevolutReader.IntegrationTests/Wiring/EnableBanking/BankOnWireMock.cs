using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Bank;
using WireMock.Matchers;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// The Enable Banking client on its production wiring (<see cref="EnableBankingRegistration.AddEnableBanking"/>: settings,
/// key, token, typed <c>HttpClient</c> with the bank's retries, no wait between them unless a test sets one) in front of a
/// WireMock.Net server that answers every request the same way, except a first request a test answers on its own. The
/// settings are made up and the key is generated once per run, as the acceptance harness's fake bank does; no real secret
/// and no real account data. A test of a fault WireMock.Net cannot produce points the client at another address instead.
/// The client's log lines are kept for the tests (<see cref="CapturedLogLines"/>).
/// </summary>
public sealed class BankOnWireMock : IDisposable {
  private const string SECTION = "EnableBanking";

  /// <summary>The transactions query's parameter for a later page (API reference).</summary>
  private const string CONTINUATION_KEY = "continuation_key";

  /// <summary>
  /// The priority of the answer to the first request only (<see cref="AnswersTheFirstRequest"/>): above every other answer
  /// (WireMock.Net: a lower value is a higher priority; every other answer keeps the default, 0), so it wins whether the
  /// test sets it up before or after them.
  /// </summary>
  private const int FIRST_REQUEST_PRIORITY = -1;

  /// <summary>The state the first request's WireMock.Net scenario moves to once it has answered; it never answers again.</summary>
  private const string ANSWERED = "answered";

  private static readonly Lazy<string> _privateKey = new(CreatePrivateKey);

  private readonly WireMockServer _server = WireMockServer.Start();
  private readonly CapturedLogLines _log = new();
  private readonly ServiceProvider _services;

  /// <summary>Made up: the one linked account, whose id is in every request's path.</summary>
  public string AccountId { get; } = Guid.NewGuid().ToString();

  /// <summary>The port, as the app wires it.</summary>
  public IBankAccount Account => _services.GetRequiredService<IBankAccount>();

  /// <summary>The lines the client has logged so far (one per read).</summary>
  public IReadOnlyList<LogLine> LogLines => _log.Lines;

  /// <summary>How many requests reached the server so far, answered or not.</summary>
  public int RequestsReceived => _server.LogEntries.Count;

  /// <summary>The client's request timeout unless a test sets its own: long, so no other test runs into it.</summary>
  public static TimeSpan DefaultRequestTimeout { get; } = TimeSpan.FromSeconds(5);

  /// <summary>
  /// No wait before a retry unless a test sets its own (c008 design.md D7): retries run at once, so the tests stay fast
  /// and none runs into the request timeout. Production waits 0.8 s, declared in <c>appsettings.json</c>.
  /// </summary>
  public static TimeSpan DefaultRetryDelay { get; } = TimeSpan.Zero;

  /// <param name="apiBaseUrl">The client's Enable Banking address; the WireMock.Net server's unless given.</param>
  /// <param name="requestTimeout">The client's request timeout; <see cref="DefaultRequestTimeout"/> unless given.</param>
  /// <param name="retryDelay">The client's wait before a first retry; <see cref="DefaultRetryDelay"/> unless given.</param>
  public BankOnWireMock(Uri? apiBaseUrl = null, TimeSpan? requestTimeout = null, TimeSpan? retryDelay = null) {
    IConfiguration configuration = new ConfigurationBuilder()
      .AddInMemoryCollection(new Dictionary<string, string?> {
        [$"{SECTION}:ApiBaseUrl"] = apiBaseUrl?.ToString() ?? _server.Url,
        [$"{SECTION}:ApplicationId"] = Guid.NewGuid().ToString(),
        [$"{SECTION}:PrivateKey"] = _privateKey.Value,
        [$"{SECTION}:SessionId"] = Guid.NewGuid().ToString(),
        [$"{SECTION}:AccountId"] = AccountId,
        [$"{SECTION}:RequestTimeout"] = (requestTimeout ?? DefaultRequestTimeout).ToString("c", CultureInfo.InvariantCulture),
        [$"{SECTION}:RetryDelay"] = (retryDelay ?? DefaultRetryDelay).ToString("c", CultureInfo.InvariantCulture),
      })
      .Build();

    ServiceCollection services = new();

    services.AddSingleton(configuration);
    services.AddSingleton<ILoggerProvider>(_log);
    services.AddEnableBanking();

    _services = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
  }

  /// <summary>
  /// Runs the checks the host runs as the app starts (<c>ValidateOnStart</c>, through <see cref="IAsyncStartupValidator"/>):
  /// a setting that fails one throws its <see cref="OptionsValidationException"/>, and the app does not start.
  /// </summary>
  public async Task Starts() => await _services.GetRequiredService<IAsyncStartupValidator>().ValidateAsync(CancellationToken.None);

  /// <summary>Every request is answered with this status and body.</summary>
  public void Answers(HttpStatusCode status, string body, string contentType = "application/json") =>
    _server.Given(Request.Create().UsingAnyMethod()).RespondWith(Response.Create().WithStatusCode(status).WithHeader("Content-Type", contentType).WithBody(body));

  /// <summary>
  /// The first request is answered with this status and body, whatever else the test set up; later requests get that (a
  /// WireMock.Net scenario of its own, at <see cref="FIRST_REQUEST_PRIORITY"/>, which moves on to <see cref="ANSWERED"/>
  /// once it has answered).
  /// </summary>
  public void AnswersTheFirstRequest(HttpStatusCode status, string body, string contentType = "application/json") =>
    _server.Given(Request.Create().UsingAnyMethod()).AtPriority(FIRST_REQUEST_PRIORITY).InScenario($"first request {Guid.NewGuid()}").WillSetStateTo(ANSWERED)
      .RespondWith(Response.Create().WithStatusCode(status).WithHeader("Content-Type", contentType).WithBody(body));

  /// <summary>Every request is answered with this body, but only after <paramref name="delay"/>.</summary>
  public void AnswersAfter(TimeSpan delay, string body) =>
    _server.Given(Request.Create().UsingAnyMethod()).RespondWith(Response.Create().WithStatusCode(HttpStatusCode.OK).WithHeader("Content-Type", "application/json").WithBody(body).WithDelay(delay));

  /// <summary>
  /// The account's transactions come in <paramref name="pages"/> empty pages in a row: the first for a request without a
  /// continuation key, each further one for its own key (<see cref="KeyOfPage"/>), every page but the last carrying the
  /// next page's key. Any other request gets WireMock's 404.
  /// </summary>
  public void AnswersPagesInARow(int pages) {
    string path = $"/accounts/{AccountId}/transactions";

    for (int number = 1; number <= pages; number++) {
      IRequestBuilder request = number == 1
        ? Request.Create().UsingGet().WithPath(path).WithParam(static parameters => !parameters.ContainsKey(CONTINUATION_KEY))
        : Request.Create().UsingGet().WithPath(path).WithParam(CONTINUATION_KEY, new ExactMatcher(KeyOfPage(number)));
      string nextKey = number == pages ? "null" : $"\"{KeyOfPage(number + 1)}\"";

      _server.Given(request).RespondWith(Response.Create().WithStatusCode(HttpStatusCode.OK).WithHeader("Content-Type", "application/json")
        .WithBody($$"""{ "transactions": [], "continuation_key": {{nextKey}} }"""));
    }
  }

  /// <summary>The server stops: nothing listens at the client's address any more.</summary>
  public void StopsListening() => _server.Stop();

  /// <summary>The made-up continuation key of the page with this number (2 and up), different for every page.</summary>
  public static string KeyOfPage(int number) => $"ck-page-{number}-5e1d";

  private static string CreatePrivateKey() {
    using RSA key = RSA.Create(2048);

    return key.ExportPkcs8PrivateKeyPem();
  }

  #region IDisposable

  public void Dispose() {
    _services.Dispose();
    _server.Dispose();
    _log.Dispose();
  }

  #endregion
}