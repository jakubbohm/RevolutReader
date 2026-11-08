using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
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
/// The answers: <c>GET /.well-known/openid-configuration</c> names the issuer of the real personal-account service
/// (<see cref="PERSONAL_ACCOUNTS_ISSUER"/>) and the authorize, token and keys endpoints on this server; <c>GET /keys</c>
/// the public half of an RSA key generated once per test run; <c>POST /token</c> the ID token <see cref="AnswerToken"/>
/// set up, signed with that key, carrying <c>iss</c>, <c>aud</c> = <see cref="ClientId"/>, <c>nonce</c>,
/// <c>iat</c>/<c>exp</c> (from the real clock, which checks them), <c>sub</c>, <c>oid</c>, <c>tid</c>, <c>name</c> and
/// <c>email</c>; before <see cref="AnswerToken"/>, <c>POST /token</c> has no answer. Nobody calls the authorize endpoint: the visitor's browser would show
/// Microsoft's page there, and <see cref="SignInDriver"/> plays the page's answer instead. No real secret and no real
/// account, ever.
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

  /// <summary>Where the OpenID Connect handler reads the provider's settings: under the authority (OpenID Connect Discovery).</summary>
  private const string DISCOVERY_PATH = "/.well-known/openid-configuration";

  private const string AUTHORIZE_PATH = "authorize";
  private const string TOKEN_PATH = "token";
  private const string KEYS_PATH = "keys";

  private const string JSON = "application/json";

  /// <summary>The run's signing key's id, as the ID tokens' header and the key set name it.</summary>
  private const string SIGNING_KEY_ID = "fake-microsoft-signing-key";

  /// <summary>
  /// One signing key per test run, as <see cref="FakeBank"/>'s key: generating an RSA key takes tens of milliseconds, and
  /// nothing in a test depends on it being different from another test's.
  /// </summary>
  private static readonly Lazy<RsaSecurityKey> _signingKey = new(CreateSigningKey);

  /// <summary>The token answer's mapping, so a later <see cref="AnswerToken"/> replaces the earlier one.</summary>
  private readonly Guid _tokenAnswer = Guid.NewGuid();

  private readonly WireMockServer _server;

  /// <summary>Where the server listens; the app copy's sign-in authority.</summary>
  public Uri Address { get; }

  /// <summary>Where the app sends a visitor to sign in (the discovery document's <c>authorization_endpoint</c>).</summary>
  public Uri AuthorizeEndpoint => new(Address, AUTHORIZE_PATH);

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

    _server.Given(Request.Create().UsingGet().WithPath(DISCOVERY_PATH)).RespondWith(JsonAnswer(Discovery()));
    _server.Given(Request.Create().UsingGet().WithPath($"/{KEYS_PATH}")).RespondWith(JsonAnswer(KeySet()));
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
  public void AnswerToken(IdentityAtMicrosoft identity, string nonce) {
    ArgumentNullException.ThrowIfNull(identity);
    ArgumentException.ThrowIfNullOrEmpty(nonce);

    JsonObject answer = new() {
      ["token_type"] = "Bearer",
      ["scope"] = "openid profile email",
      ["expires_in"] = 3600,
      // Required next to the ID token in a token answer; the app neither keeps nor uses it.
      ["access_token"] = $"made-up-access-token-{Guid.NewGuid()}",
      ["id_token"] = IdToken(identity, nonce),
    };

    _server.Given(Request.Create().UsingPost().WithPath($"/{TOKEN_PATH}")).WithGuid(_tokenAnswer).RespondWith(JsonAnswer(answer));
  }

  /// <summary>
  /// The discovery document, shaped as the real personal-account service's (fields the handler does not use left out): its
  /// issuer, and the authorize, token and keys endpoints on this server.
  /// </summary>
  private JsonObject Discovery() => new() {
    ["issuer"] = PERSONAL_ACCOUNTS_ISSUER,
    ["authorization_endpoint"] = AuthorizeEndpoint.AbsoluteUri,
    ["token_endpoint"] = new Uri(Address, TOKEN_PATH).AbsoluteUri,
    ["jwks_uri"] = new Uri(Address, KEYS_PATH).AbsoluteUri,
    ["response_types_supported"] = new JsonArray("code", "id_token", "code id_token", "id_token token"),
    ["response_modes_supported"] = new JsonArray("query", "fragment", "form_post"),
    ["subject_types_supported"] = new JsonArray("pairwise"),
    ["id_token_signing_alg_values_supported"] = new JsonArray(SecurityAlgorithms.RsaSha256),
    ["scopes_supported"] = new JsonArray("openid", "profile", "email", "offline_access"),
    ["token_endpoint_auth_methods_supported"] = new JsonArray("client_secret_post", "private_key_jwt", "client_secret_basic"),
  };

  /// <summary>The key set: only the public half of the run's signing key, its modulus and exponent.</summary>
  private static JsonObject KeySet() {
    RSAParameters key = _signingKey.Value.Parameters;

    return new() {
      ["keys"] = new JsonArray(new JsonObject {
        ["kty"] = "RSA",
        ["use"] = "sig",
        ["kid"] = SIGNING_KEY_ID,
        ["n"] = Base64Url.EncodeToString(key.Modulus),
        ["e"] = Base64Url.EncodeToString(key.Exponent),
      }),
    };
  }

  /// <summary>
  /// The ID token for <paramref name="identity"/>, valid for an hour from the real clock, signed with the run's key. Its
  /// subject and object id are made up from the identity, so the same account always gets the same ones, as at Microsoft.
  /// </summary>
  private string IdToken(IdentityAtMicrosoft identity, string nonce) {
    DateTime now = TimeProvider.System.GetUtcNow().UtcDateTime;
    byte[] account = SHA256.HashData(Encoding.UTF8.GetBytes($"{identity.Issuer} {identity.Email}"));

    SecurityTokenDescriptor token = new() {
      Issuer = identity.Issuer,
      Audience = ClientId,
      IssuedAt = now,
      NotBefore = now,
      Expires = now.AddHours(1),
      Claims = new Dictionary<string, object> {
        ["nonce"] = nonce,
        ["sub"] = Base64Url.EncodeToString(account),
        ["oid"] = new Guid(account.AsSpan(0, 16)).ToString(),
        ["tid"] = identity.TenantId,
        ["name"] = identity.Name,
        ["email"] = identity.Email,
      },
      SigningCredentials = new SigningCredentials(_signingKey.Value, SecurityAlgorithms.RsaSha256),
    };

    return new JsonWebTokenHandler().CreateToken(token);
  }

  /// <summary>200 with this JSON body.</summary>
  private static IResponseBuilder JsonAnswer(JsonObject body) => Response.Create().WithStatusCode(200).WithHeader("Content-Type", JSON).WithBody(body.ToJsonString());

  private static RsaSecurityKey CreateSigningKey() {
    using RSA key = RSA.Create(2048);

    return new RsaSecurityKey(key.ExportParameters(includePrivateParameters: true)) { KeyId = SIGNING_KEY_ID };
  }

  #region IDisposable

  public void Dispose() => _server.Dispose();

  #endregion
}