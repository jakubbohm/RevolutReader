using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.Api.Rate;
using RevolutReader.UnitTests.Rate;
using WireMock.Matchers;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;
using WireMock.Settings;

namespace RevolutReader.IntegrationTests.Wiring.Cnb;

/// <summary>
/// The CNB client on its production wiring (<see cref="RateRegistration.AddKorunaRates"/>: settings checked at start, the
/// named client with its base address and time limit, <see cref="CnbClient"/> as <see cref="ICnbRates"/>; c017 design.md
/// D9) in front of a WireMock.Net server on the loopback address (<see cref="LoopbackWireMock"/>). The settings are the
/// app's own <c>appsettings.json</c> with the CNB's address pointed at the server, and whatever a test sets over them. The
/// kept rate's store, which <see cref="KorunaRates"/> needs and <c>AddKorunaRateStore</c> registers in the app, is the
/// unit tests' in-memory one, so the container can check every registration as it is built.
/// </summary>
internal sealed class CnbOnWireMock : IDisposable {
  private const string SECTION = "Cnb";

  /// <summary>The app's own settings file, which the build copies next to the tests from the API project.</summary>
  private const string APP_SETTINGS = "appsettings.json";

  /// <summary>The CNB's latest daily rates (D1).</summary>
  private const string DAILY_RATES = "/cnbapi/exrates/daily";

  private readonly WireMockServer _server;
  private readonly ServiceProvider _services;

  /// <param name="settings">Settings over the app's own and the server's address, such as the address removed or another time limit.</param>
  public CnbOnWireMock(IReadOnlyDictionary<string, string?>? settings = null) {
    _server = LoopbackWireMock.Start(new WireMockServerSettings());

    IConfiguration configuration = new ConfigurationBuilder()
      .AddJsonFile(Path.Combine(AppContext.BaseDirectory, APP_SETTINGS), optional: false)
      .AddInMemoryCollection(new Dictionary<string, string?> { [$"{SECTION}:Address"] = _server.Url })
      .AddInMemoryCollection(settings ?? new Dictionary<string, string?>())
      .Build();

    ServiceCollection services = new();

    services.AddSingleton(configuration);
    services.AddLogging();
    services.AddSingleton<IKorunaRateStore, InMemoryKorunaRateStore>();
    services.AddKorunaRates();

    _services = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
  }

  /// <summary>The port, as the app wires it.</summary>
  public ICnbRates Cnb => _services.GetRequiredService<ICnbRates>();

  /// <summary>
  /// Runs the checks the host runs as the app starts (<c>ValidateOnStart</c>, through <see cref="IAsyncStartupValidator"/>):
  /// a setting that fails one throws its <see cref="OptionsValidationException"/>, and the app does not start.
  /// </summary>
  public async Task Starts() => await _services.GetRequiredService<IAsyncStartupValidator>().ValidateAsync(CancellationToken.None);

  /// <summary>
  /// A <c>GET</c> of exactly <see cref="DAILY_RATES"/> with no query parameter (D1: no <c>date</c>, no <c>lang</c>) is
  /// answered 200 with this JSON body; anything else gets WireMock.Net's 404.
  /// </summary>
  public void AnswersTheDailyRates(string body) =>
    _server.Given(Request.Create().UsingGet().WithPath(new ExactMatcher(DAILY_RATES)).WithParam(static parameters => parameters.Count == 0))
      .RespondWith(Response.Create().WithStatusCode(200).WithHeader("Content-Type", "application/json").WithBody(body));

  #region IDisposable

  public void Dispose() {
    _services.Dispose();
    _server.Dispose();
  }

  #endregion
}