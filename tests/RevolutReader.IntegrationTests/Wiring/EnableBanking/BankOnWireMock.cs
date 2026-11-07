using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.Api.Bank;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// The Enable Banking client on its production wiring (<see cref="EnableBankingRegistration.AddEnableBanking"/>: settings,
/// key, token, typed <c>HttpClient</c>, no retries) in front of a WireMock.Net server that answers every request the same
/// way. The settings are made up and the key is generated once per run, as the acceptance harness's fake bank does; no
/// real secret and no real account data. A test of a fault WireMock.Net cannot produce points the client at another
/// address instead.
/// </summary>
public sealed class BankOnWireMock : IDisposable {
  private const string SECTION = "EnableBanking";

  private static readonly Lazy<string> _privateKey = new(CreatePrivateKey);

  private readonly WireMockServer _server = WireMockServer.Start();
  private readonly ServiceProvider _services;

  /// <summary>Made up: the one linked account, whose id is in every request's path.</summary>
  public string AccountId { get; } = Guid.NewGuid().ToString();

  /// <summary>The port, as the app wires it.</summary>
  public IBankAccount Account => _services.GetRequiredService<IBankAccount>();

  /// <summary>The client's request timeout unless a test sets its own: long, so no other test runs into it.</summary>
  public static TimeSpan DefaultRequestTimeout { get; } = TimeSpan.FromSeconds(5);

  /// <param name="apiBaseUrl">The client's Enable Banking address; the WireMock.Net server's unless given.</param>
  /// <param name="requestTimeout">The client's request timeout; <see cref="DefaultRequestTimeout"/> unless given.</param>
  public BankOnWireMock(Uri? apiBaseUrl = null, TimeSpan? requestTimeout = null) {
    IConfiguration configuration = new ConfigurationBuilder()
      .AddInMemoryCollection(new Dictionary<string, string?> {
        [$"{SECTION}:ApiBaseUrl"] = apiBaseUrl?.ToString() ?? _server.Url,
        [$"{SECTION}:ApplicationId"] = Guid.NewGuid().ToString(),
        [$"{SECTION}:PrivateKey"] = _privateKey.Value,
        [$"{SECTION}:SessionId"] = Guid.NewGuid().ToString(),
        [$"{SECTION}:AccountId"] = AccountId,
        [$"{SECTION}:RequestTimeout"] = (requestTimeout ?? DefaultRequestTimeout).ToString("c", CultureInfo.InvariantCulture),
      })
      .Build();

    ServiceCollection services = new();

    services.AddSingleton(configuration);
    services.AddEnableBanking();

    _services = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
  }

  /// <summary>Every request is answered with this status and body.</summary>
  public void Answers(HttpStatusCode status, string body, string contentType = "application/json") =>
    _server.Given(Request.Create().UsingAnyMethod()).RespondWith(Response.Create().WithStatusCode(status).WithHeader("Content-Type", contentType).WithBody(body));

  /// <summary>Every request is answered with this body, but only after <paramref name="delay"/>.</summary>
  public void AnswersAfter(TimeSpan delay, string body) =>
    _server.Given(Request.Create().UsingAnyMethod()).RespondWith(Response.Create().WithStatusCode(HttpStatusCode.OK).WithHeader("Content-Type", "application/json").WithBody(body).WithDelay(delay));

  /// <summary>The server stops: nothing listens at the client's address any more.</summary>
  public void StopsListening() => _server.Stop();

  private static string CreatePrivateKey() {
    using RSA key = RSA.Create(2048);

    return key.ExportPkcs8PrivateKeyPem();
  }

  #region IDisposable

  public void Dispose() {
    _services.Dispose();
    _server.Dispose();
  }

  #endregion
}