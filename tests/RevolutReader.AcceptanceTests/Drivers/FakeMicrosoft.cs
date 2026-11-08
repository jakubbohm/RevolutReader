using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;
using WireMock.Server;
using WireMock.Settings;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// The fake Microsoft every test app copy signs in through (c007 design.md D6): a WireMock.Net server per test, started
/// before the app copy, in front of the app's real OpenID Connect and cookie handlers. Only Microsoft's endpoints are
/// faked; the handlers, the issuer check, the cookies and the allowlist run as production code.
/// <para>
/// Every app copy gets the sign-in settings (<see cref="Configure"/>), so the app starts whether or not the test signs in:
/// the authority is this server, the client id and secret are made up per test, and the allowlist is
/// <see cref="ALLOWED_EMAILS"/>, the only allowed test user. In test code, never as a setting: the handler may read this
/// server's plain-HTTP metadata, the cookies are protected by ephemeral keys, and the app's <see cref="TimeProvider"/> is
/// <see cref="Clock"/>.
/// </para>
/// <para>
/// The answers (task 5.4, filled in by the wiring groups): <c>GET /.well-known/openid-configuration</c> names the issuer
/// of the real personal-account service (<see cref="PERSONAL_ACCOUNTS_ISSUER"/>) and the authorize, token and keys
/// endpoints on this server; <c>GET /keys</c> the public half of an RSA key generated once per test run; <c>POST /token</c>
/// the ID token <see cref="AnswerToken"/> set up, signed with that key, carrying <c>iss</c>, <c>aud</c> = <see cref="ClientId"/>,
/// <c>nonce</c>, <c>iat</c>/<c>exp</c> (from the real clock, which checks them), <c>sub</c>, <c>oid</c>, <c>tid</c>,
/// <c>name</c> and <c>email</c>. Until then the server has no answers and <see cref="AnswerToken"/> throws. No real
/// secret and no real account, ever.
/// </para>
/// </summary>
public sealed class FakeMicrosoft : IDisposable {
  /// <summary>The allowlist every app copy gets (D6): Lucie's address, made up.</summary>
  public const string ALLOWED_EMAILS = "lucie@example.com";

  /// <summary>The tenant of Microsoft's service for personal Microsoft accounts (D3): fixed and public.</summary>
  public const string PERSONAL_ACCOUNTS_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

  /// <summary>The one issuer the real personal-account service's discovery document names (D3, D6).</summary>
  public const string PERSONAL_ACCOUNTS_ISSUER = $"https://login.microsoftonline.com/{PERSONAL_ACCOUNTS_TENANT}/v2.0";

  /// <summary>The settings section the app's sign-in is bound to (D11).</summary>
  private const string SECTION = "SignIn";

  private readonly WireMockServer _server;

  /// <summary>Where the server listens; the app copy's sign-in authority.</summary>
  public Uri Address { get; }

  /// <summary>Made up, unique per test: the app's client id at Microsoft, so the ID token's audience.</summary>
  public string ClientId { get; } = Guid.NewGuid().ToString();

  /// <summary>Made up, unique per test: the app's client secret.</summary>
  public string ClientSecret { get; } = $"made-up-client-secret-{Guid.NewGuid()}";

  /// <summary>
  /// The app copy's clock, started at the real current time (D6). The ID token's lifetime is checked against the real
  /// clock, so a scenario moves this clock only after signing in.
  /// </summary>
  public FakeTimeProvider Clock { get; } = new(TimeProvider.System.GetUtcNow());

  private FakeMicrosoft(WireMockServer server) {
    _server = server;
    Address = new Uri(server.Url ?? throw new InvalidOperationException("The fake Microsoft started without an address."));
  }

  /// <summary>
  /// Starts a fake Microsoft on a free local port, its own server kept out of every trace, as <see cref="FakeBank"/>'s is.
  /// Call it before the app copy starts, so its address is known.
  /// </summary>
  public static FakeMicrosoft Start() => new(WireMockServer.Start(new WireMockServerSettings { AdditionalServiceRegistration = FakeBank.SilenceHostingTelemetry }));

  /// <summary>
  /// Writes the sign-in settings into the app copy's <c>SignIn</c> section, as the last configuration source, so they win
  /// over <c>appsettings.json</c> (whose secrets are <c>"&lt;secret&gt;"</c>); and adds the test services, after the app's
  /// own: the OpenID Connect handler may read plain-HTTP metadata, Data Protection uses ephemeral keys, and
  /// <see cref="Clock"/> is the app's only <see cref="TimeProvider"/>.
  /// <para>
  /// <c>RequireHttpsMetadata</c> is switched off with <c>ConfigureAll</c>, not <c>PostConfigure</c>: the handler's own
  /// post-configure step checks it and builds the metadata reader, and it runs before any post-configure step registered
  /// after it, so a test's post-configure step would come too late (tried 2026-11-08 on .NET 11 RC3: it threw "The
  /// MetadataAddress or Authority must use HTTPS"). Every configure step runs before every post-configure step, and this
  /// one runs after the app's own.
  /// </para>
  /// </summary>
  public void Configure(IWebHostBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    Dictionary<string, string?> settings = new() {
      [$"{SECTION}:Authority"] = Address.ToString(),
      [$"{SECTION}:ClientId"] = ClientId,
      [$"{SECTION}:ClientSecret"] = ClientSecret,
      [$"{SECTION}:AllowedEmails"] = ALLOWED_EMAILS,
    };

    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
    builder.ConfigureTestServices(services => {
      services.ConfigureAll<OpenIdConnectOptions>(static options => options.RequireHttpsMetadata = false);
      services.AddDataProtection().UseEphemeralDataProtectionProvider();
      services.RemoveAll<TimeProvider>();
      services.AddSingleton<TimeProvider>(Clock);
    });
  }

  /// <summary>
  /// <c>POST /token</c> answers with an ID token for <paramref name="identity"/>, issued by its issuer and tenant, for this
  /// sign-in's <paramref name="nonce"/>, signed with the run's key (D6).
  /// </summary>
  public void AnswerToken(IdentityAtMicrosoft identity, string nonce) => throw new NotImplementedException();

  #region IDisposable

  public void Dispose() => _server.Dispose();

  #endregion
}