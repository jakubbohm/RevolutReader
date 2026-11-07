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
/// real secret and no real account data.
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

  public BankOnWireMock() {
    IConfiguration configuration = new ConfigurationBuilder()
      .AddInMemoryCollection(new Dictionary<string, string?> {
        [$"{SECTION}:ApiBaseUrl"] = _server.Url,
        [$"{SECTION}:ApplicationId"] = Guid.NewGuid().ToString(),
        [$"{SECTION}:PrivateKey"] = _privateKey.Value,
        [$"{SECTION}:SessionId"] = Guid.NewGuid().ToString(),
        [$"{SECTION}:AccountId"] = AccountId,
        [$"{SECTION}:RequestTimeout"] = "00:00:05",
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