using System.Buffers.Text;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Primitives;
using WireMock.Server;
using WireMock.Settings;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// The fake push service every test app copy sends its pushes to (testing.md § Decided later, c011 design.md D7): a
/// WireMock.Net server per test, started before the app copy, standing in for Apple's or Google's push service in front of
/// the app's real Web Push sender. Every app copy gets its settings (<see cref="Configure"/>), so the app starts whether or
/// not the test sends a push: a made-up VAPID pair generated once per test run, a made-up message key per test, a made-up
/// app address as <c>Subject</c>, and this server's own origin as one more known push service. No real secret, ever.
/// <para>
/// Each <see cref="TestDevice"/> (<see cref="NewDevice"/>) has its push address on this server,
/// <c>http://127.0.0.1:&lt;port&gt;/push/&lt;device&gt;</c>, so the app may send to it only because the settings name
/// this origin (plain <c>http</c> is allowed only on a loopback host, D9).
/// </para>
/// <para>
/// Every request is answered by this class itself, a middleware in front of WireMock.Net's own handling (as
/// <see cref="FakeBank"/>'s arrival log is), checked as Apple would check a push, and more (D7):
/// <list type="bullet">
/// <item><c>Authorization</c> is <c>vapid t=&lt;JWT&gt;, k=&lt;key&gt;</c> (RFC 8292 § 3), <c>k</c> the run's VAPID public
/// key, and the token an ES256 JWT signed with its private half, whose <c>aud</c> is this server's scheme and host
/// (without the port, as the library writes it, D1; the real push services have none), whose <c>exp</c> lies in the
/// future and at most 24 hours ahead (RFC 8292 § 2; on the real clock, which the library signs with) and whose
/// <c>sub</c> is an <c>https:</c> address;</item>
/// <item><c>TTL</c> is present, a number of seconds (RFC 8030 § 5.2);</item>
/// <item><c>Urgency</c>, when present, is one of RFC 8030's four values (<c>very-low</c>, <c>low</c>, <c>normal</c>,
/// <c>high</c>); a push without it is of normal urgency (RFC 8030 § 5.3; the library sends none for normal) and passes
/// (the owner, 2026-11-09);</item>
/// <item><c>Content-Encoding</c> is exactly <c>aes128gcm</c> (RFC 8291 § 4).</item>
/// </list>
/// A push that fails a check is answered 403, so the app counts it as failed and the scenario goes red. Otherwise the
/// answer is 410 for a device the test made gone (<see cref="Gone"/>), 500 once for a device the test made fail once
/// (<see cref="FailsOnce"/>), and 201 (the success Apple and Google answer) for every other push. The body is not read
/// here: the device decrypts it (<see cref="TestDevice.Decrypt"/>), as only a phone can.
/// </para>
/// <para>
/// Every request is recorded as it arrived, with whether its token passed and the answer (<see cref="ReceivedPush"/>,
/// <see cref="Pushes"/>, <see cref="PushesFor"/>). Written by the test-writer, never by the implementer whose sending it
/// judges (tasks.md 9a); its self-tests (<c>HarnessSelfTests/FakePushServiceSelfTests</c>) prove each check bites.
/// </para>
/// </summary>
public sealed class FakePushService : IDisposable {
  /// <summary>The name this server has among the known push services (<c>Push:Services</c>, D9).</summary>
  public const string SERVICE_NAME = nameof(FakePushService);

  /// <summary>The settings section the app's push sender is bound to (D5).</summary>
  private const string SECTION = "Push";

  /// <summary>The loopback address the push addresses name, as a browser's would name a host (D7).</summary>
  private const string LOOPBACK = "127.0.0.1";

  /// <summary>Where a device's pushes arrive on this server: this path and a segment of the device's own, a new GUID, whatever the scenario calls the device.</summary>
  private const string PUSH_PATH = "/push/";

  /// <summary>
  /// The made-up app address, <c>Push:Subject</c>: the token's contact and the base of every page a tap opens (D2, D5).
  /// An <c>https</c> origin of a reserved domain, so it can never be a real app.
  /// </summary>
  private const string MADE_UP_APP_ADDRESS = "https://app.example.net";

  /// <summary>The message key's size (D5): 32 random bytes.</summary>
  private const int MESSAGE_KEY_BYTES = 32;

  /// <summary>
  /// One VAPID pair per test run, as <see cref="FakeBank"/>'s key: nothing in a test depends on it being different from
  /// another test's. In the settings' form (D5): base64url without padding, the public key the 65-byte uncompressed point,
  /// the private key the 32-byte scalar.
  /// </summary>
  private static readonly Lazy<VapidPair> _vapidPair = new(CreateVapidPair);

  private readonly WireMockServer _server;
  private readonly PushChecks _checks;

  /// <summary>
  /// The private half of the run's VAPID pair, as the settings hold it: for the app copy's settings, and for the self-tests,
  /// which sign a correct push with it by their own code.
  /// </summary>
  internal static string VapidPrivateKey => _vapidPair.Value.PrivateKey;

  /// <summary>The server's public VAPID key the app copy serves and signs with, as the settings hold it; the run's.</summary>
  public string VapidPublicKey { get; } = _vapidPair.Value.PublicKey;

  /// <summary>Where the server listens, as a known push service names it: <c>http://127.0.0.1:&lt;port&gt;</c>, no path.</summary>
  public string Origin { get; }

  /// <summary>The made-up app address the app copy is configured with (<c>Push:Subject</c>).</summary>
  public string AppAddress { get; } = MADE_UP_APP_ADDRESS;

  /// <summary>Made up, unique per test: the message key the owner's messages carry (D5, D10), 32 random bytes in base64url.</summary>
  public string MessageKey { get; } = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(MESSAGE_KEY_BYTES));

  private FakePushService(WireMockServer server, PushChecks checks) {
    _server = server;
    _checks = checks;
    Origin = string.Create(CultureInfo.InvariantCulture, $"http://{LOOPBACK}:{server.Port}");
  }

  /// <summary>
  /// Starts a fake push service on a free local port, its own server kept out of every trace, as <see cref="FakeBank"/>'s
  /// is (a push address in a trace would read as the app's), with <see cref="PushChecks"/> answering every request before
  /// WireMock.Net's own handling. Call it before the app copy starts, so its origin is known.
  /// </summary>
  public static FakePushService Start() {
    PushChecks checks = new(Base64Url.DecodeFromChars(_vapidPair.Value.PublicKey));
    WireMockServer server = WireMockServer.Start(new WireMockServerSettings {
      AdditionalServiceRegistration = FakeBank.SilenceHostingTelemetry,
      PreWireMockMiddlewareInit = app => ((IApplicationBuilder)app).Use(checks.Answer),
    });

    return new(server, checks);
  }

  /// <summary>
  /// Writes the push settings into the app copy's <c>Push</c> section, as the last configuration source, so they win over
  /// <c>appsettings.json</c> (whose secrets are <c>"&lt;secret&gt;"</c>): the run's VAPID pair, this test's message key,
  /// the made-up app address as <c>Subject</c>, and this server's origin as the known push service
  /// <c>Push:Services:FakePushService</c>, next to the real ones <c>appsettings.json</c> names.
  /// </summary>
  public void Configure(IWebHostBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    Dictionary<string, string?> settings = new() {
      [$"{SECTION}:VapidPublicKey"] = VapidPublicKey,
      [$"{SECTION}:VapidPrivateKey"] = VapidPrivateKey,
      [$"{SECTION}:MessageKey"] = MessageKey,
      [$"{SECTION}:Subject"] = AppAddress,
      [$"{SECTION}:Services:{SERVICE_NAME}"] = Origin,
    };

    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
  }

  /// <summary>A new device whose push address is on this server, under a name of its own, with new keys (<see cref="TestDevice"/>).</summary>
  public TestDevice NewDevice(string name) => new(name, new Uri($"{Origin}{PUSH_PATH}{Guid.NewGuid():N}"));

  /// <summary>From now on, every push to <paramref name="device"/> that passes the checks is answered 410: the device is gone.</summary>
  public void Gone(TestDevice device) {
    ArgumentNullException.ThrowIfNull(device);

    _checks.Gone(PathOf(device));
  }

  /// <summary>The next push to <paramref name="device"/> that passes the checks is answered 500, an error of the push service's own; later ones as before.</summary>
  public void FailsOnce(TestDevice device) {
    ArgumentNullException.ThrowIfNull(device);

    _checks.FailOnce(PathOf(device));
  }

  /// <summary>Every push the server received at <paramref name="device"/>'s push address, in the order received, however it answered.</summary>
  public IReadOnlyList<ReceivedPush> PushesFor(TestDevice device) {
    ArgumentNullException.ThrowIfNull(device);

    string path = PathOf(device);

    return [.. _checks.Received().Where(push => string.Equals(push.Path, path, StringComparison.Ordinal))];
  }

  /// <summary>Every request the server received, at any address, in the order received, however it answered.</summary>
  public IReadOnlyList<ReceivedPush> Pushes() => _checks.Received();

  /// <summary>The path a device's pushes arrive at on this server.</summary>
  private static string PathOf(TestDevice device) => device.PushAddress.AbsolutePath;

  private static VapidPair CreateVapidPair() {
    using ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    ECParameters parameters = key.ExportParameters(includePrivateParameters: true);

    return new VapidPair(
      Base64Url.EncodeToString(TestDevice.UncompressedPoint(parameters.Q)),
      Base64Url.EncodeToString(parameters.D ?? throw new UnreachableException("A key exported with its private parameters has its scalar.")));
  }

  /// <summary>A VAPID key pair in the settings' form (D5).</summary>
  private sealed record VapidPair(string PublicKey, string PrivateKey);

  /// <summary>
  /// The middleware that is the push service: reads each request, checks it as the class describes, records it with its
  /// answer, and answers it, never passing it on to WireMock.Net. Safe for requests at once (the app sends to every device
  /// of an account at once).
  /// </summary>
  private sealed class PushChecks(byte[] serverPublicKey) {
    /// <summary>The scheme a VAPID <c>Authorization</c> header names (RFC 8292 § 3).</summary>
    private const string VAPID_SCHEME = "vapid";

    /// <summary>The only content coding a push may have (RFC 8291 § 4).</summary>
    private const string AES128GCM = "aes128gcm";

    /// <summary>The token's one algorithm (RFC 8292 § 2: ECDSA on P-256 with SHA-256).</summary>
    private const string ES256 = "ES256";

    /// <summary>An ES256 signature in JWS form: R and S, 32 bytes each (RFC 7518 § 3.4).</summary>
    private const int SIGNATURE_BYTES = 64;

    /// <summary>How far ahead a token's <c>exp</c> may lie (RFC 8292 § 2).</summary>
    private static readonly TimeSpan _mostAhead = TimeSpan.FromHours(24);

    /// <summary>RFC 8030 § 5.3's four urgencies.</summary>
    private static readonly HashSet<string> _urgencies = new(StringComparer.Ordinal) { "very-low", "low", "normal", "high" };

    private readonly ConcurrentQueue<ReceivedPush> _received = new();
    private readonly ConcurrentDictionary<string, bool> _gone = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, bool> _failOnce = new(StringComparer.Ordinal);

    public IReadOnlyList<ReceivedPush> Received() => [.. _received];

    public void Gone(string path) => _gone[path] = true;

    public void FailOnce(string path) => _failOnce[path] = true;

    /// <summary>The middleware: checks, records and answers the request.</summary>
    public async Task Answer(HttpContext context, RequestDelegate next) {
      HttpRequest request = context.Request;
      using MemoryStream body = new();
      await request.Body.CopyToAsync(body, context.RequestAborted);

      string path = request.Path.Value ?? string.Empty;
      bool signedWithServerKey = TokenPasses(request.Headers.Authorization, $"{request.Scheme}://{request.Host.Host}", TimeProvider.System.GetUtcNow());
      bool passes = signedWithServerKey
        && HasTimeToLive(request.Headers["TTL"])
        && HasKnownUrgencyOrNone(request.Headers["Urgency"])
        && IsAes128Gcm(request.Headers.ContentEncoding);

      HttpStatusCode answer = !passes ? HttpStatusCode.Forbidden
        : _gone.ContainsKey(path) ? HttpStatusCode.Gone
        : _failOnce.TryRemove(path, out _) ? HttpStatusCode.InternalServerError
        : HttpStatusCode.Created;

      _received.Enqueue(new ReceivedPush(
        path,
        request.Headers.ToDictionary(static header => header.Key, static header => string.Join(", ", (IEnumerable<string?>)header.Value), StringComparer.OrdinalIgnoreCase),
        body.ToArray(),
        signedWithServerKey,
        answer));

      context.Response.StatusCode = (int)answer;
    }

    /// <summary>
    /// Whether <paramref name="authorization"/> is one <c>vapid t=…, k=…</c> header whose <c>k</c> is the server's key and
    /// whose token is an ES256 JWT signed with it, for <paramref name="audience"/>, expiring after <paramref name="now"/>
    /// and at most 24 hours later, with an <c>https:</c> contact.
    /// </summary>
    private bool TokenPasses(StringValues authorization, string audience, DateTimeOffset now) {
      if (authorization.Count != 1 || !TryReadVapid(authorization[0], out string? token, out string? key))
        return false;

      try {
        if (!Base64Url.DecodeFromChars(key).AsSpan().SequenceEqual(serverPublicKey))
          return false;

        string[] parts = token.Split('.');

        if (parts.Length != 3)
          return false;

        using JsonDocument header = JsonDocument.Parse(Base64Url.DecodeFromChars(parts[0]));
        using JsonDocument claims = JsonDocument.Parse(Base64Url.DecodeFromChars(parts[1]));
        byte[] signature = Base64Url.DecodeFromChars(parts[2]);

        return Text(header.RootElement, "alg") == ES256
          && signature.Length == SIGNATURE_BYTES
          && IsSignedWithServerKey(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), signature)
          && Text(claims.RootElement, "aud") == audience
          && ExpiresInTime(claims.RootElement, now)
          && IsHttpsAddress(Text(claims.RootElement, "sub"));
      }
      catch (FormatException) {
        return false; // a part that is not base64url
      }
      catch (JsonException) {
        return false; // a header or claims that are not JSON
      }
      catch (InvalidOperationException) {
        return false; // a header or claims that are not a JSON object
      }
    }

    /// <summary>Reads <c>vapid t=&lt;token&gt;, k=&lt;key&gt;</c>: the scheme ignoring case, each parameter once, both there.</summary>
    private static bool TryReadVapid(string? header, [NotNullWhen(true)] out string? token, [NotNullWhen(true)] out string? key) {
      token = null;
      key = null;
      int space = header?.IndexOf(' ', StringComparison.Ordinal) ?? -1;

      if (header is null || space <= 0 || !string.Equals(header[..space], VAPID_SCHEME, StringComparison.OrdinalIgnoreCase))
        return false;

      Dictionary<string, string> parameters = new(StringComparer.OrdinalIgnoreCase);

      foreach (string parameter in header[(space + 1)..].Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)) {
        int equals = parameter.IndexOf('=', StringComparison.Ordinal);

        if (equals <= 0 || !parameters.TryAdd(parameter[..equals].Trim(), parameter[(equals + 1)..].Trim()))
          return false;
      }

      return parameters.TryGetValue("t", out token) && parameters.TryGetValue("k", out key);
    }

    private bool IsSignedWithServerKey(byte[] signedPart, byte[] signature) {
      using ECDsa server = ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = TestDevice.PointOf(serverPublicKey) });

      return server.VerifyData(signedPart, signature, HashAlgorithmName.SHA256);
    }

    /// <summary>Whether the claims' <c>exp</c>, in whole seconds since 1970, lies after <paramref name="now"/> and at most 24 hours later.</summary>
    private static bool ExpiresInTime(JsonElement claims, DateTimeOffset now) =>
      claims.TryGetProperty("exp", out JsonElement exp)
      && exp.ValueKind == JsonValueKind.Number
      && exp.TryGetInt64(out long seconds)
      && seconds > now.ToUnixTimeSeconds()
      && seconds <= (now + _mostAhead).ToUnixTimeSeconds();

    private static bool IsHttpsAddress(string? contact) =>
      Uri.TryCreate(contact, UriKind.Absolute, out Uri? address) && address.Scheme == Uri.UriSchemeHttps;

    /// <summary>One <c>TTL</c> header, a whole number of seconds (RFC 8030 § 5.2: delta-seconds).</summary>
    private static bool HasTimeToLive(StringValues timeToLive) =>
      timeToLive.Count == 1 && uint.TryParse(timeToLive[0], NumberStyles.None, CultureInfo.InvariantCulture, out _);

    /// <summary>No <c>Urgency</c> header (normal), or one with one of RFC 8030's four values.</summary>
    private static bool HasKnownUrgencyOrNone(StringValues urgency) =>
      urgency.Count == 0 || (urgency.Count == 1 && urgency[0] is { } value && _urgencies.Contains(value));

    /// <summary>One <c>Content-Encoding</c>, exactly <c>aes128gcm</c> (content codings ignore case, RFC 9110 § 8.4.1).</summary>
    private static bool IsAes128Gcm(StringValues contentEncoding) =>
      contentEncoding.Count == 1 && string.Equals(contentEncoding[0]?.Trim(), AES128GCM, StringComparison.OrdinalIgnoreCase);

    /// <summary>The member <paramref name="name"/> when it is a JSON string; otherwise <see langword="null"/>.</summary>
    private static string? Text(JsonElement value, string name) =>
      value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.String ? member.GetString() : null;
  }

  #region IDisposable

  public void Dispose() => _server.Dispose();

  #endregion
}