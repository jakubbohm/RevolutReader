using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
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
/// made-up application, session and account ids, an RSA key generated once per test run, and a 1 s request timeout. No
/// real secret and no real account data, ever.
/// <para>
/// The answers are set per test, by <see cref="BankDriver"/>. They are copied from the Mock ASPSP capture
/// (<c>spikes/enable-banking-mock/evidence/2026-11-06-account1-*.json</c>); what the mock cannot produce (several pages,
/// 429, an expired session, <c>ASPSP_ERROR</c>, a slow answer) is written from the API reference and the M1 findings,
/// with a comment saying so. The transactions answer matches only the expected <c>date_from</c> and
/// <c>continuation_key</c>. Filled in by the wiring groups; until then the answer methods throw.
/// </para>
/// </summary>
public sealed class FakeBank : IDisposable {
  /// <summary>The settings section the app's Enable Banking client is bound to (D6).</summary>
  private const string SECTION = "EnableBanking";

  /// <summary>The name the fake bank's own host reports its telemetry to, which no tracer listens to (<see cref="SilenceHostingTelemetry"/>).</summary>
  private const string UNHEARD_TELEMETRY = "RevolutReader.AcceptanceTests.FakeBank";

  private const string JSON = "application/json";

  /// <summary>
  /// One application key per test run: generating an RSA key takes tens of milliseconds, and nothing in a test depends
  /// on it being different from another test's. PKCS#8 PEM, as the Control Panel hands it out.
  /// </summary>
  private static readonly Lazy<string> _privateKey = new(CreatePrivateKey);

  private readonly WireMockServer _server;

  /// <summary>Short, so the slow-answer scenario needs only a second (D6); production uses 15 s.</summary>
  public static TimeSpan RequestTimeout { get; } = TimeSpan.FromSeconds(1);

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

  private FakeBank(WireMockServer server) {
    _server = server;
    Address = new Uri(server.Url ?? throw new InvalidOperationException("The fake bank started without an address."));
  }

  /// <summary>
  /// Starts a fake bank on a free local port, its own server kept out of every trace (<see cref="SilenceHostingTelemetry"/>).
  /// Call it before the app copy starts, so its address is known.
  /// </summary>
  public static FakeBank Start() => new(WireMockServer.Start(new WireMockServerSettings { AdditionalServiceRegistration = SilenceHostingTelemetry }));

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
    };

    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
  }

  /// <summary>
  /// <c>GET /accounts/{account}/balances</c> answers with these balances (the capture's shape), only on this account's
  /// path and only when the request carries a bearer token; any other request gets WireMock's 404.
  /// </summary>
  public void AnswerBalances(string body) =>
    _server
      .Given(SignedGet($"/accounts/{AccountId}/balances"))
      .RespondWith(Response.Create().WithStatusCode(HttpStatusCode.OK).WithHeader("Content-Type", JSON).WithBody(body));

  /// <summary>
  /// <c>GET /accounts/{account}/transactions</c> answers with this page, only for this <c>date_from</c> and
  /// <c>continuation_key</c> (none on the first page).
  /// </summary>
  public void AnswerTransactionsPage(DateOnly dateFrom, string? continuationKey, string body) => throw new NotImplementedException();

  /// <summary>Every request is answered with this Enable Banking error (<c>{ message, code, error, detail }</c>).</summary>
  public void AnswerError(HttpStatusCode status, string body) => throw new NotImplementedException();

  /// <summary>Every answer comes only after this delay.</summary>
  public void AnswerAfter(TimeSpan delay) => throw new NotImplementedException();

  /// <summary>The requests the bank received, in order, from the server's request log.</summary>
  public IReadOnlyList<IReadOnlyDictionary<string, string>> RequestHeadersReceived() => throw new NotImplementedException();

  private static string MadeUpId() => Guid.NewGuid().ToString();

  /// <summary>A <c>GET</c> of exactly <paramref name="path"/> that carries a bearer token (the application's JWT).</summary>
  private static IRequestBuilder SignedGet(string path) =>
    Request.Create().UsingGet().WithPath(new ExactMatcher(path)).WithHeader("Authorization", "Bearer *");

  /// <summary>
  /// Keeps the fake bank's own server out of every trace (for the guard <c>Conventions/BankTelemetryTests</c>, c004
  /// design.md D5). WireMock.Net hosts on ASP.NET Core inside the test process, and its hosting layer reports each request
  /// it serves to the "Microsoft.AspNetCore" activity source and diagnostic listener, which the app copy's tracing listens
  /// to process-wide. Those server activities carry the request's path, so the account id, and the guard would count them
  /// as the app's. Given a listener and a source under a name no tracer listens to, the fake bank's host records nothing.
  /// Checked 2026-11-06 (WireMock.Net 2.21.0, .NET 11 RC3): before, one server activity per request reached the app
  /// copy's exporter, with <c>url.path</c>; after, none. If one ever comes back, the guard fails on it rather than missing
  /// anything.
  /// </summary>
  private static void SilenceHostingTelemetry(IServiceCollection services) {
    services.AddSingleton(static _ => new DiagnosticListener(UNHEARD_TELEMETRY));
    services.AddSingleton<DiagnosticSource>(static provider => provider.GetRequiredService<DiagnosticListener>());
    services.AddSingleton(static _ => new ActivitySource(UNHEARD_TELEMETRY));
  }

  private static string CreatePrivateKey() {
    using RSA key = RSA.Create(2048);

    return key.ExportPkcs8PrivateKeyPem();
  }

  #region IDisposable

  public void Dispose() => _server.Dispose();

  #endregion
}