using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;
using WireMock.Matchers;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;
using WireMock.Settings;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// The fake Enable Banking every test app copy talks to (testing.md § Fake bank, c004 design.md D1, D6): a WireMock.Net
/// server per test, started before the app copy, in front of the app's real Enable Banking client. Every app copy gets
/// its settings (<see cref="Configure"/>), so the app starts whether or not the test reads the bank: the server's address,
/// made-up application, session and account ids, an RSA key generated once per test run, a 5 s request timeout and no
/// wait between retries. No real secret and no real account data, ever.
/// <para>
/// The answers are set per test, by <see cref="BankDriver"/>. They are copied from the Mock ASPSP capture
/// (<c>spikes/enable-banking-mock/evidence/2026-11-06-account1-*.json</c>); what the mock cannot produce (several pages,
/// 429, an expired session, <c>ASPSP_ERROR</c>, a slow answer, an answer for the first request only, a connection that
/// breaks while the answer comes in) is written from the API reference and the M1 findings, and a gateway's maintenance
/// page from a typical gateway page, each with a comment saying so. The transactions answer matches only the expected
/// <c>date_from</c> and <c>continuation_key</c>; for the transactions through the API, where the app chooses the day, a
/// first page answers for any <c>date_from</c> (c010).
/// </para>
/// <para>
/// A balance answer can be held until the test releases it (<see cref="HoldTheNextBalanceAnswer"/>, c014 design.md D16),
/// so a test can line up calls that arrive while the app is still reading the bank, without waiting real time for it.
/// </para>
/// </summary>
public sealed class FakeBank : IDisposable {
  /// <summary>The settings section the app's Enable Banking client is bound to (D6).</summary>
  private const string SECTION = "EnableBanking";

  /// <summary>The name the fake bank's own host reports its telemetry to, which no tracer listens to (<see cref="SilenceHostingTelemetry"/>).</summary>
  private const string UNHEARD_TELEMETRY = "RevolutReader.AcceptanceTests.FakeBank";

  private const string JSON = "application/json";
  private const string HTML = "text/html";

  /// <summary>The transactions query's parameters (API reference).</summary>
  private const string DATE_FROM = "date_from";
  private const string CONTINUATION_KEY = "continuation_key";

  /// <summary>As the API reference writes a calendar date.</summary>
  private const string DATE = "yyyy-MM-dd";

  /// <summary>
  /// The priority of the page every first transactions request gets when nothing else the test set up answers it
  /// (<see cref="AnswerTransactionsForAnyDayByDefault"/>, c010): below every other answer, which keeps the default, 0, or
  /// takes <see cref="ONE_OFF_PRIORITY"/>, so any answer the test sets up wins, whether before or after it.
  /// </summary>
  private const int TRANSACTIONS_FALLBACK_PRIORITY = 1;

  /// <summary>
  /// The priority of an answer for the first matching request only (<see cref="AnswerOnce"/>): above every other answer
  /// (WireMock.Net: a lower value is a higher priority; every other answer keeps the default, 0, but a fallback, at
  /// <see cref="FALLBACK_PRIORITY"/>), so it wins whether the scenario sets it up before or after them.
  /// </summary>
  private const int ONE_OFF_PRIORITY = -1;

  /// <summary>
  /// The priority of a fallback answer (<see cref="AnswerBalancesByDefault"/>): below every other answer (every other
  /// answer keeps the default, 0, or <see cref="ONE_OFF_PRIORITY"/>), so any answer the test sets up wins, whether before
  /// or after it.
  /// </summary>
  private const int FALLBACK_PRIORITY = 1;

  /// <summary>The state a one-off answer's WireMock.Net scenario moves to once it has answered; it never answers again.</summary>
  private const string ANSWERED = "answered";

  /// <summary>
  /// One application key per test run: generating an RSA key takes tens of milliseconds, and nothing in a test depends
  /// on it being different from another test's. PKCS#8 PEM, as the Control Panel hands it out.
  /// </summary>
  private static readonly Lazy<string> _privateKey = new(CreatePrivateKey);

  /// <summary>
  /// How long <see cref="WaitUntilTheHeldRequestArrives"/> waits, on the real clock, for the held request before the step
  /// fails: far longer than an app copy takes to send a request, even on a busy machine running the full suite.
  /// </summary>
  private static readonly TimeSpan _heldRequestWithin = TimeSpan.FromSeconds(10);

  private readonly WireMockServer _server;
  private readonly ArrivalLog _arrivals;
  private readonly AnswerHolder _holder;
  private readonly AnswerBreaker _breaker;

  /// <summary>The ids of the two answers for any day (c010), so setting one up again replaces it (WireMock.Net keeps one mapping per id).</summary>
  private readonly Guid _transactionsForAnyDay = Guid.NewGuid();
  private readonly Guid _transactionsForAnyDayByDefault = Guid.NewGuid();

  /// <summary>
  /// Shorter than production's 15 s, so the slow-answer scenario stays bearable, yet long enough that no other test runs
  /// into it: with 1 s, an app copy's first request on a busy machine (the full suite, three test projects at once) took
  /// over a second and read as bank unavailable (the orchestrator's decision, 2026-11-07).
  /// </summary>
  public static TimeSpan RequestTimeout { get; } = TimeSpan.FromSeconds(5);

  /// <summary>
  /// No wait before a retry (c008 design.md D7): every app copy's clock, which the retries wait on, is a
  /// <c>FakeTimeProvider</c> (<see cref="FakeMicrosoft.Clock"/>) that moves only when a test moves it, so any other wait
  /// would never end. A zero wait does not depend on the clock. Production waits 0.8 s, declared in <c>appsettings.json</c>.
  /// </summary>
  public static TimeSpan RetryDelay { get; } = TimeSpan.Zero;

  /// <summary>The RSA private key the app signs its requests with, as PEM text; one per test run.</summary>
  public static string PrivateKey => _privateKey.Value;

  /// <summary>Made up, unique per test: the application's id (the token's key id).</summary>
  public string ApplicationId { get; } = MadeUpId();

  /// <summary>Made up, unique per test: the bank session the app reads through.</summary>
  public string SessionId { get; } = MadeUpId();

  /// <summary>Made up, unique per test: the one linked account.</summary>
  public string AccountId { get; } = MadeUpId();

  /// <summary>Where the server listens; the app copy's Enable Banking API address.</summary>
  public Uri Address { get; }

  /// <summary>The path of this account's balances, as the server receives it.</summary>
  private string BalancesPath => $"/accounts/{AccountId}/balances";

  /// <summary>The path of this account's transactions, as the server receives it.</summary>
  private string TransactionsPath => $"/accounts/{AccountId}/transactions";

  private FakeBank(WireMockServer server, ArrivalLog arrivals, AnswerHolder holder, AnswerBreaker breaker) {
    _server = server;
    _arrivals = arrivals;
    _holder = holder;
    _breaker = breaker;
    Address = new Uri(server.Url ?? throw new InvalidOperationException("The fake bank started without an address."));
  }

  /// <summary>
  /// Starts a fake bank on a free port of the loopback address (<see cref="LoopbackWireMock"/>), its own server kept out
  /// of every trace (<see cref="SilenceHostingTelemetry"/>), with three middlewares in front of WireMock.Net's own
  /// handling: <see cref="ArrivalLog"/>, then <see cref="AnswerHolder"/>, then <see cref="AnswerBreaker"/>. Call it before
  /// the app copy starts, so its address is known.
  /// </summary>
  public static FakeBank Start() {
    ArrivalLog arrivals = new();
    AnswerHolder holder = new();
    AnswerBreaker breaker = new();
    WireMockServer server = LoopbackWireMock.Start(new WireMockServerSettings {
      AdditionalServiceRegistration = SilenceHostingTelemetry,
      PreWireMockMiddlewareInit = app => ((IApplicationBuilder)app).Use(arrivals.Record).Use(holder.Answer).Use(breaker.Answer),
    });

    return new(server, arrivals, holder, breaker);
  }

  /// <summary>
  /// Writes the fake bank's settings into the app copy's <c>EnableBanking</c> section. Added as the last configuration
  /// source, so it wins over <c>appsettings.json</c> (whose secrets are <c>"&lt;secret&gt;"</c>) and over environment
  /// variables.
  /// </summary>
  public void Configure(IWebHostBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    Dictionary<string, string?> settings = new() {
      [$"{SECTION}:ApiBaseUrl"] = Address.ToString(),
      [$"{SECTION}:ApplicationId"] = ApplicationId,
      [$"{SECTION}:PrivateKey"] = PrivateKey,
      [$"{SECTION}:SessionId"] = SessionId,
      [$"{SECTION}:AccountId"] = AccountId,
      [$"{SECTION}:RequestTimeout"] = RequestTimeout.ToString("c", CultureInfo.InvariantCulture),
      [$"{SECTION}:RetryDelay"] = RetryDelay.ToString("c", CultureInfo.InvariantCulture),
    };

    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
  }

  /// <summary>
  /// <c>GET /accounts/{account}/balances</c> answers with these balances (the capture's shape), only on this account's
  /// path and only when the request carries a bearer token; any other request gets WireMock's 404.
  /// </summary>
  public void AnswerBalances(string body) => _server.Given(SignedGet(BalancesPath)).RespondWith(JsonAnswer(body));

  /// <summary>
  /// The same request as <see cref="AnswerBalances"/> matches is answered with these balances when nothing else the test set
  /// up answers it (<see cref="FALLBACK_PRIORITY"/>): any answer the test sets up wins, before or after this one.
  /// </summary>
  public void AnswerBalancesByDefault(string body) => _server.Given(SignedGet(BalancesPath)).AtPriority(FALLBACK_PRIORITY).RespondWith(JsonAnswer(body));

  /// <summary>
  /// <c>GET /accounts/{account}/transactions</c> answers with this page, only for this <c>date_from</c> (as the API
  /// reference writes a date, <c>yyyy-MM-dd</c>) and <c>continuation_key</c> (none on the first page), and only on this
  /// account's path with a bearer token; any other request gets WireMock's 404.
  /// </summary>
  public void AnswerTransactionsPage(DateOnly dateFrom, string? continuationKey, string body) =>
    _server.Given(TransactionsPage(dateFrom, continuationKey)).RespondWith(JsonAnswer(body));

  /// <summary>
  /// The same request as <see cref="AnswerTransactionsPage"/> matches, answered with this Enable Banking error
  /// (<c>{ message, code, error, detail }</c>) instead of a page.
  /// </summary>
  public void AnswerTransactionsPageError(DateOnly dateFrom, string? continuationKey, HttpStatusCode status, string body) =>
    _server.Given(TransactionsPage(dateFrom, continuationKey)).RespondWith(JsonAnswer(status, body));

  /// <summary>
  /// The first request for this page, as <see cref="AnswerTransactionsPage"/> matches it, is answered with this Enable
  /// Banking error instead of whatever else the test set up for it (<see cref="AnswerOnce"/>); later requests for the page
  /// get that.
  /// </summary>
  public void AnswerTransactionsPageErrorOnce(DateOnly dateFrom, string? continuationKey, HttpStatusCode status, string body) =>
    AnswerOnce(TransactionsPage(dateFrom, continuationKey), JsonAnswer(status, body));

  /// <summary>
  /// <c>GET /accounts/{account}/transactions</c> without a <c>continuation_key</c> answers with this page whatever its
  /// <c>date_from</c> (c010: the app chooses the day, the scenario only what the bank lists), only on this account's path
  /// with a bearer token; it replaces what this method set up before.
  /// </summary>
  public void AnswerTransactionsForAnyDay(string body) =>
    _server.Given(FirstTransactionsPageForAnyDay()).WithGuid(_transactionsForAnyDay).RespondWith(JsonAnswer(body));

  /// <summary>
  /// The same request as <see cref="AnswerTransactionsForAnyDay"/> matches is answered with this page when nothing else the
  /// test set up answers it (<see cref="TRANSACTIONS_FALLBACK_PRIORITY"/>); setting it up again replaces it.
  /// </summary>
  public void AnswerTransactionsForAnyDayByDefault(string body) =>
    _server.Given(FirstTransactionsPageForAnyDay()).WithGuid(_transactionsForAnyDayByDefault).AtPriority(TRANSACTIONS_FALLBACK_PRIORITY).RespondWith(JsonAnswer(body));

  /// <summary>
  /// The <c>date_from</c> of every request for this account's transactions the bank received, answered or not, in the order
  /// received (<see cref="ArrivalLog"/>). A request without a <c>date_from</c> the API reference's way, <c>yyyy-MM-dd</c>,
  /// fails the step.
  /// </summary>
  public IReadOnlyList<DateOnly> TransactionDaysReceived() => [.. TransactionDaysAndHeadersReceived().Select(static request => request.Day)];

  /// <summary>
  /// The <c>date_from</c> and the headers of every request for this account's transactions the bank received, answered or
  /// not, in the order received: the days as <see cref="TransactionDaysReceived"/> reads them, the headers as
  /// <see cref="RequestHeadersReceived"/>'s (c018: a check's transactions read told apart from a signed-in user's by them).
  /// </summary>
  public IReadOnlyList<(DateOnly Day, IReadOnlyDictionary<string, string> Headers)> TransactionDaysAndHeadersReceived() => [
    .. _arrivals.Requests().Where(request => request.Path == TransactionsPath).Select(static request => (DayFrom(request), request.Headers)),
  ];

  /// <summary>
  /// The headers of every request for this account's transactions the bank received, each page and each attempt, answered
  /// or not, in the order received (<see cref="ArrivalLog"/>), looked up as <see cref="RequestHeadersReceived"/>'s;
  /// requests for anything else are left out (c018 design.md D10).
  /// </summary>
  public IReadOnlyList<IReadOnlyDictionary<string, string>> TransactionRequestHeadersReceived() => [
    .. _arrivals.Requests().Where(request => request.Path == TransactionsPath).Select(static request => request.Headers),
  ];

  /// <summary>
  /// Every request for this account's transactions, each page and each attempt, is answered with this Enable Banking error
  /// (<c>{ message, code, error, detail }</c>), the bank's own (c018 design.md D10), above every transactions answer the
  /// test set up, before or after it; the balances are answered as set.
  /// </summary>
  public void AnswerTransactionsWithOwnError(HttpStatusCode status, string body) =>
    throw new NotImplementedException("c018 tasks.md 1.13: every transactions request answered with the bank's own error, filled in wiring (slice 11).");

  /// <summary>Every request is answered with this Enable Banking error (<c>{ message, code, error, detail }</c>).</summary>
  public void AnswerError(HttpStatusCode status, string body) => _server.Given(Request.Create().UsingAnyMethod()).RespondWith(JsonAnswer(status, body));

  /// <summary>
  /// The first request, whatever it asks for, is answered with this Enable Banking error instead of whatever else the test
  /// set up (<see cref="AnswerOnce"/>); later requests get that.
  /// </summary>
  public void AnswerErrorOnce(HttpStatusCode status, string body) => AnswerOnce(Request.Create().UsingAnyMethod(), JsonAnswer(status, body));

  /// <summary>
  /// The answer to the next request the server receives starts and breaks off (<see cref="AnswerBreaker"/>): its status
  /// and headers, which promise the whole body, and half of the body, then the connection ends. The answer is whatever the
  /// test set up for that request, and the request counts as received; later requests are answered whole.
  /// </summary>
  public void BreakTheNextAnswer() => _breaker.BreakTheNextAnswer();

  /// <summary>
  /// The next request for this account's balances is held (<see cref="AnswerHolder"/>): it counts as received at once, and
  /// gets its answer, whatever the test set up for it, only once the test calls <see cref="ReleaseTheHeldAnswer"/>. Every
  /// other request, and every later balance request, is answered as before, also while one is held. One held answer at a
  /// time: arming a second before the first was released fails the step. Not captured: the Mock ASPSP cannot be held.
  /// </summary>
  public void HoldTheNextBalanceAnswer() => _holder.HoldNext(BalancesPath);

  /// <summary>
  /// Waits until the request <see cref="HoldTheNextBalanceAnswer"/> holds has arrived, on the real clock, bounded: the step
  /// fails with <see cref="TimeoutException"/> when it has not arrived within 10 s.
  /// </summary>
  public Task WaitUntilTheHeldRequestArrives() => _holder.Arrived(_heldRequestWithin);

  /// <summary>Lets the held request go on to its answer; with none held, or one already released, nothing happens.</summary>
  public void ReleaseTheHeldAnswer() => _holder.Release();

  /// <summary>
  /// The headers of every request for this account's balances the bank received, answered or not, in the order received
  /// (<see cref="ArrivalLog"/>), looked up as <see cref="RequestHeadersReceived"/>'s; requests for anything else are left out.
  /// </summary>
  public IReadOnlyList<IReadOnlyDictionary<string, string>> BalanceRequestHeadersReceived() => [
    .. _arrivals.Requests().Where(request => request.Path == BalancesPath).Select(static request => request.Headers),
  ];

  /// <summary>
  /// Every request is answered with this status and this HTML page (<c>text/html</c>), as a gateway in front of Enable
  /// Banking answers: no Enable Banking error body, so no error code.
  /// </summary>
  public void AnswerHtmlPage(HttpStatusCode status, string html) =>
    _server.Given(Request.Create().UsingAnyMethod()).RespondWith(Response.Create().WithStatusCode(status).WithHeader("Content-Type", HTML).WithBody(html));

  /// <summary>Every answer comes only after this delay.</summary>
  public void AnswerAfter(TimeSpan delay) => _server.AddGlobalProcessingDelay(delay);

  /// <summary>
  /// The headers of every request the bank received, answered or not, in the order received (<see cref="ArrivalLog"/>).
  /// Names are looked up ignoring case, as HTTP compares them; a header sent more than once has its values joined with
  /// <c>", "</c>.
  /// </summary>
  public IReadOnlyList<IReadOnlyDictionary<string, string>> RequestHeadersReceived() => [.. _arrivals.Requests().Select(static request => request.Headers)];

  /// <summary>
  /// The <c>continuation_key</c> of every request for this account's transactions the bank received, answered or not, in
  /// the order received (<see cref="ArrivalLog"/>); <see langword="null"/> for a request without one (a first page).
  /// </summary>
  public IReadOnlyList<string?> ContinuationKeysReceived() => [
    .. _arrivals.Requests().Where(request => request.Path == TransactionsPath).Select(static request => request.ContinuationKey),
  ];

  private static string MadeUpId() => Guid.NewGuid().ToString();

  /// <summary>
  /// Answers the first request that matches <paramref name="request"/> with <paramref name="response"/>, and no later one:
  /// a WireMock.Net scenario of its own, which moves on to <see cref="ANSWERED"/> once it has answered, at
  /// <see cref="ONE_OFF_PRIORITY"/>, so it wins over the test's other answers for that one request. The mapping moves the
  /// scenario on before the answer goes out, so a request sent after it gets the other answers.
  /// </summary>
  private void AnswerOnce(IRequestBuilder request, IResponseBuilder response) =>
    _server.Given(request).AtPriority(ONE_OFF_PRIORITY).InScenario($"one-off {Guid.NewGuid()}").WillSetStateTo(ANSWERED).RespondWith(response);

  /// <summary>A <c>GET</c> of exactly <paramref name="path"/> that carries a bearer token (the application's JWT).</summary>
  private static IRequestBuilder SignedGet(string path) =>
    Request.Create().UsingGet().WithPath(new ExactMatcher(path)).WithHeader("Authorization", "Bearer *");

  /// <summary>A signed <c>GET</c> of this account's transactions for exactly this <c>date_from</c> and <c>continuation_key</c> (none: no such parameter).</summary>
  private IRequestBuilder TransactionsPage(DateOnly dateFrom, string? continuationKey) {
    IRequestBuilder request = SignedGet(TransactionsPath)
      .WithParam(DATE_FROM, new ExactMatcher(dateFrom.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));

    return continuationKey is null
      ? request.WithParam(static parameters => !parameters.ContainsKey(CONTINUATION_KEY))
      : request.WithParam(CONTINUATION_KEY, new ExactMatcher(continuationKey));
  }

  /// <summary>A signed <c>GET</c> of this account's transactions without a <c>continuation_key</c>, whatever its <c>date_from</c> (c010).</summary>
  private IRequestBuilder FirstTransactionsPageForAnyDay() =>
    SignedGet(TransactionsPath).WithParam(static parameters => !parameters.ContainsKey(CONTINUATION_KEY));

  /// <summary>200 with this JSON body.</summary>
  private static IResponseBuilder JsonAnswer(string body) => JsonAnswer(HttpStatusCode.OK, body);

  /// <summary>This status with this JSON body.</summary>
  private static IResponseBuilder JsonAnswer(HttpStatusCode status, string body) => Response.Create().WithStatusCode(status).WithHeader("Content-Type", JSON).WithBody(body);

  /// <summary>
  /// Keeps the fake bank's own server out of every trace (for the guard <c>Conventions/BankTelemetryTests</c>, c004
  /// design.md D5). WireMock.Net hosts on ASP.NET Core inside the test process, and its hosting layer reports each request
  /// it serves to the "Microsoft.AspNetCore" activity source and diagnostic listener, which the app copy's tracing listens
  /// to process-wide. Those server activities carry the request's path, so the account id, and the guard would count them
  /// as the app's. Given a listener and a source under a name no tracer listens to, the fake bank's host records nothing.
  /// Checked 2026-11-06 (WireMock.Net 2.21.0, .NET 11 RC3): before, one server activity per request reached the app
  /// copy's exporter, with <c>url.path</c>; after, none. If one ever comes back, the guard fails on it rather than missing
  /// anything. <see cref="FakeMicrosoft"/>'s server uses it too.
  /// </summary>
  internal static void SilenceHostingTelemetry(IServiceCollection services) {
    services.AddSingleton(static _ => new DiagnosticListener(UNHEARD_TELEMETRY));
    services.AddSingleton<DiagnosticSource>(static provider => provider.GetRequiredService<DiagnosticListener>());
    services.AddSingleton(static _ => new ActivitySource(UNHEARD_TELEMETRY));
  }

  private static string CreatePrivateKey() {
    using RSA key = RSA.Create(2048);

    return key.ExportPkcs8PrivateKeyPem();
  }

  /// <summary>
  /// Every request the fake bank's server received, as it arrived: a middleware in front of WireMock.Net's own handling,
  /// so a request still waiting for its answer counts. WireMock.Net logs a request only once it has answered it: a request
  /// the test delays (<see cref="AnswerAfter"/>) is missing from its log until the delay ends, after the app has given up.
  /// </summary>
  private sealed class ArrivalLog {
    private readonly ConcurrentQueue<RequestArrived> _requests = new();

    /// <summary>Every request so far, in the order received.</summary>
    public IReadOnlyList<RequestArrived> Requests() => [.. _requests];

    /// <summary>The middleware: notes the request, then passes it on.</summary>
    public Task Record(HttpContext context, RequestDelegate next) {
      HttpRequest request = context.Request;
      string? continuationKey = request.Query.TryGetValue(CONTINUATION_KEY, out StringValues keys) ? keys.FirstOrDefault() : null;
      string? dateFrom = request.Query.TryGetValue(DATE_FROM, out StringValues days) ? days.FirstOrDefault() : null;

      _requests.Enqueue(new RequestArrived(
        request.Path.Value ?? string.Empty,
        continuationKey,
        request.Headers.ToDictionary(static header => header.Key, static header => string.Join(", ", (IEnumerable<string?>)header.Value), StringComparer.OrdinalIgnoreCase),
        dateFrom));

      return next(context);
    }
  }

  /// <summary>A transactions request's <c>date_from</c>; one not given the API reference's way, <c>yyyy-MM-dd</c>, fails the step.</summary>
  private static DateOnly DayFrom(RequestArrived request) =>
    DateOnly.TryParseExact(request.DateFrom, DATE, CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly day)
      ? day
      : throw new InvalidOperationException("The fake bank received a transactions request without a date_from as yyyy-MM-dd.");

  /// <summary>
  /// A request as it arrived: its path, its decoded <c>continuation_key</c> (none: <see langword="null"/>), its headers,
  /// and its decoded <c>date_from</c> (none: <see langword="null"/>; c010).
  /// </summary>
  private sealed record RequestArrived(string Path, string? ContinuationKey, IReadOnlyDictionary<string, string> Headers, string? DateFrom);

  /// <summary>
  /// Holds one request's answer until the test releases it, once armed (<see cref="HoldTheNextBalanceAnswer"/>): a
  /// middleware in front of WireMock.Net's own handling, in the fake bank's server, after <see cref="ArrivalLog"/>, so the
  /// held request counts as received while it waits. The first request on the armed path waits for the release, then goes
  /// on to WireMock.Net as any other, so it gets the answer the test set up for it; requests on other paths, and later ones
  /// on that path, pass at once. A held request whose caller gives up stops waiting and is answered nothing. Disposing the
  /// fake bank releases it, so a test that fails before the release leaves nothing waiting.
  /// </summary>
  private sealed class AnswerHolder {
    private readonly Lock _lock = new();

    /// <summary>The path whose next request is held; <see langword="null"/> while none is armed.</summary>
    private string? _armedPath;

    /// <summary>Set once the armed request has arrived.</summary>
    private TaskCompletionSource _arrived = NewSignal();

    /// <summary>Set once the test releases the held request.</summary>
    private TaskCompletionSource _released = NewSignal();

    public void HoldNext(string path) {
      lock (_lock) {
        if (_armedPath is not null || (_arrived.Task.IsCompleted && !_released.Task.IsCompleted))
          throw new InvalidOperationException("The fake bank already holds an answer: release it before holding the next.");

        _armedPath = path;
        _arrived = NewSignal();
        _released = NewSignal();
      }
    }

    public Task Arrived(TimeSpan within) {
      Task arrived;

      lock (_lock)
        arrived = _arrived.Task;

      return arrived.WaitAsync(within);
    }

    public void Release() {
      lock (_lock)
        _ = _released.TrySetResult();
    }

    /// <summary>The middleware: holds the armed request until the release, then passes it on; passes every other request at once.</summary>
    public async Task Answer(HttpContext context, RequestDelegate next) {
      Task? release = null;

      lock (_lock) {
        if (_armedPath is not null && string.Equals(context.Request.Path.Value, _armedPath, StringComparison.Ordinal)) {
          _armedPath = null;
          release = _released.Task;
          _ = _arrived.TrySetResult();
        }
      }

      if (release is not null) {
        try {
          await release.WaitAsync(context.RequestAborted);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) {
          return; // the caller gave up while its request was held
        }
      }

      await next(context);
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
  }

  /// <summary>
  /// Breaks the connection while an answer comes in, once armed (<see cref="BreakTheNextAnswer"/>): a middleware in front
  /// of WireMock.Net's own handling, in the fake bank's server. Not captured: the Mock ASPSP cannot break a connection on
  /// demand, and WireMock.Net's faults cannot break it mid-answer (its "malformed chunk" still ends the answer properly).
  /// <para>
  /// The armed request counts as received (<see cref="ArrivalLog"/> runs first) and goes through WireMock.Net as any
  /// other, so it gets the answer the test set up for it, kept in memory instead of sent. Then the status and the headers
  /// go out with a <c>Content-Length</c> of the whole body, then half of the body, and the answer ends there. Kestrel, the
  /// server under WireMock.Net, then closes the connection, because the client cannot know how much more is coming (its
  /// "too few bytes written" error, logged by the fake bank's own host only). So the client has the start of the answer and
  /// runs into the end of the connection while the body comes in: the network failure
  /// <c>IntegrationTests/Wiring/EnableBanking/ConnectionBreakingServer</c> produces for the adapter's edge tests. Checked
  /// 2026-11-08 (WireMock.Net 2.21.0, .NET 11 RC3) with a raw client: the status line, the headers with the whole body's
  /// <c>Content-Length</c>, half of the body, then the connection's orderly end, no reset; an <c>HttpClient</c> failed with
  /// "Error while copying content to a stream".
  /// </para>
  /// <para>
  /// It must break after the answer has started (c008 design.md § How each scenario is verified): .NET's HTTP stack resends
  /// a bodiless request by itself when a reused connection closes before any answer came, so a break before the answer
  /// could be absorbed without the app's retries.
  /// </para>
  /// </summary>
  private sealed class AnswerBreaker {
    /// <summary>1 while the next request's answer is to be broken, 0 otherwise.</summary>
    private int _breakTheNext;

    public void BreakTheNextAnswer() => Interlocked.Exchange(ref _breakTheNext, 1);

    /// <summary>The middleware: passes every request on to WireMock.Net, and breaks the answer to the first one after <see cref="BreakTheNextAnswer"/>.</summary>
    public async Task Answer(HttpContext context, RequestDelegate next) {
      if (Interlocked.Exchange(ref _breakTheNext, 0) == 0) {
        await next(context);

        return;
      }

      byte[] body = await AnswerInMemory(context, next);

      context.Response.ContentLength = body.Length;
      await context.Response.StartAsync(context.RequestAborted);
      await context.Response.Body.WriteAsync(body.AsMemory(0, body.Length / 2), context.RequestAborted);
      await context.Response.Body.FlushAsync(context.RequestAborted);
    }

    /// <summary>WireMock.Net answers the request with its body written to memory, not sent; the status and headers it sets stay on the response.</summary>
    private static async Task<byte[]> AnswerInMemory(HttpContext context, RequestDelegate next) {
      IHttpResponseBodyFeature server = context.Features.GetRequiredFeature<IHttpResponseBodyFeature>();
      using MemoryStream memory = new();
      StreamResponseBodyFeature inMemory = new(memory);
      context.Features.Set<IHttpResponseBodyFeature>(inMemory);

      try {
        await next(context);
        await inMemory.CompleteAsync();
      }
      finally {
        context.Features.Set(server);
      }

      return memory.ToArray();
    }
  }

  #region IDisposable

  public void Dispose() {
    _holder.Release();
    _server.Dispose();
  }

  #endregion
}