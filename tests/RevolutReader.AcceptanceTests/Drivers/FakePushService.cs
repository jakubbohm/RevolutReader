using System.Buffers.Text;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
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
/// Every request is recorded as it arrives (its path, headers and body), then checked as Apple would check a push, and
/// more: <c>Authorization</c> is <c>vapid t=&lt;JWT&gt;, k=&lt;key&gt;</c>, with <c>k</c> the run's VAPID public key and
/// the token an ES256 JWT signed with its private half, whose <c>aud</c> is this server's scheme and host (without the
/// port, as the library writes it, D1), whose <c>exp</c> lies in the future and at most 24 hours ahead (RFC 8292; on the
/// real clock, which the library signs with) and whose <c>sub</c> is an <c>https:</c> address; <c>TTL</c> and
/// <c>Urgency</c> are present; <c>Content-Encoding</c> is <c>aes128gcm</c>. A push that fails a check is answered 403, so
/// the app counts it as failed and the scenario goes red. Otherwise the answer is 410 for a device the test made gone
/// (<see cref="Gone"/>), 500 once for a device the test made fail once (<see cref="FailsOnce"/>), and 201 (the success
/// Apple and Google answer) for every other push.
/// </para>
/// <para>
/// The answers, the checks and the record are filled in by the wiring groups (tasks.md 10.4, 35.1, 38.1); until then
/// those methods throw.
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

  /// <summary>The private half of the run's VAPID pair, as the settings hold it.</summary>
  private static string VapidPrivateKey => _vapidPair.Value.PrivateKey;

  /// <summary>The server's public VAPID key the app copy serves and signs with, as the settings hold it; the run's.</summary>
  public string VapidPublicKey { get; } = _vapidPair.Value.PublicKey;

  /// <summary>Where the server listens, as a known push service names it: <c>http://127.0.0.1:&lt;port&gt;</c>, no path.</summary>
  public string Origin { get; }

  /// <summary>The made-up app address the app copy is configured with (<c>Push:Subject</c>).</summary>
  public string AppAddress { get; } = MADE_UP_APP_ADDRESS;

  /// <summary>Made up, unique per test: the message key the owner's messages carry (D5, D10), 32 random bytes in base64url.</summary>
  public string MessageKey { get; } = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(MESSAGE_KEY_BYTES));

  private FakePushService(WireMockServer server) {
    _server = server;
    Origin = string.Create(CultureInfo.InvariantCulture, $"http://{LOOPBACK}:{server.Port}");
  }

  /// <summary>
  /// Starts a fake push service on a free local port, its own server kept out of every trace, as <see cref="FakeBank"/>'s
  /// is (a push address in a trace would read as the app's). Call it before the app copy starts, so its origin is known.
  /// </summary>
  public static FakePushService Start() => new(WireMockServer.Start(new WireMockServerSettings { AdditionalServiceRegistration = FakeBank.SilenceHostingTelemetry }));

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

  /// <summary>From now on, every push to <paramref name="device"/> is answered 410: the device is gone.</summary>
  public void Gone(TestDevice device) => throw new NotImplementedException();

  /// <summary>The next push to <paramref name="device"/> is answered 500, an error of the push service's own; later ones as before.</summary>
  public void FailsOnce(TestDevice device) => throw new NotImplementedException();

  /// <summary>Every push the server received at <paramref name="device"/>'s push address, in the order received, however it answered.</summary>
  public IReadOnlyList<ReceivedPush> PushesFor(TestDevice device) => throw new NotImplementedException();

  /// <summary>Every request the server received, at any address, in the order received, however it answered.</summary>
  public IReadOnlyList<ReceivedPush> Pushes() => throw new NotImplementedException();

  private static VapidPair CreateVapidPair() {
    using ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    ECParameters parameters = key.ExportParameters(includePrivateParameters: true);

    return new VapidPair(
      Base64Url.EncodeToString(TestDevice.UncompressedPoint(parameters.Q)),
      Base64Url.EncodeToString(parameters.D ?? throw new UnreachableException("A key exported with its private parameters has its scalar.")));
  }

  /// <summary>A VAPID key pair in the settings' form (D5).</summary>
  private sealed record VapidPair(string PublicKey, string PrivateKey);

  #region IDisposable

  public void Dispose() => _server.Dispose();

  #endregion
}