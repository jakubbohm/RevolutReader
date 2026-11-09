using System.Buffers.Text;
using System.Diagnostics;
using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// Registering a device (spec push-devices, c011 design.md D3, D9, D11): a subscription whose push address lies at a known
/// push service and whose keys are well formed (<c>p256dh</c> the 65-byte uncompressed P-256 point, <c>auth</c> 16 bytes,
/// each in base64url) is saved under the signed-in account. An address is at a service when its scheme and port are the
/// entry's and its host is the entry's host, or, for an entry <c>*.</c> and a suffix, ends in "." and the suffix; plain
/// http only at a loopback service the settings name. Only the accepting side is here; the refusals are their own tasks.
/// The handler runs with the real <see cref="KnownPushServices"/> on the settings given and the in-memory store. Every
/// push address is made up (a new token each time) at a real push service's host, as browsers' addresses look; every key
/// is generated in the test, as a browser makes them.
/// </summary>
public sealed class RegisterDeviceHandlerTests {
  private const string LUCIE = "lucie@example.com";
  private const string PETR = "petr@example.com";

  /// <summary>The values registering never reads: only the known services are its business.</summary>
  private const string NOT_READ_WHEN_REGISTERING = "made up, not read when registering";

  /// <summary>The device's secret (<c>auth</c>): 16 random bytes (D9).</summary>
  private const int SECRET_BYTES = 16;

  /// <summary>The known push services <c>appsettings.json</c> declares (D9): two named exactly, two with a wildcard.</summary>
  private static readonly Dictionary<string, string> _knownServices = new(StringComparer.Ordinal) {
    ["Apple"] = "https://*.push.apple.com",
    ["Google"] = "https://fcm.googleapis.com",
    ["Mozilla"] = "https://updates.push.services.mozilla.com",
    ["Microsoft"] = "https://*.notify.windows.com",
  };

  [Test]
  public async Task A_device_at_a_known_push_service_with_well_formed_keys_is_saved_under_the_signed_in_account() {
    InMemoryPushDeviceStore store = new();
    DeviceKeys keys = DeviceKeys.New();
    string pushAddress = $"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}";

    RegistrationResult result = await Handler(store, _knownServices).Handle(new DeviceSubscription(pushAddress, keys.P256dh, keys.Auth), LUCIE, CancellationToken.None);

    result.Value.ShouldBeOfType<Registered>();
    (await store.ReadAll(CancellationToken.None)).ShouldBe([new PushDevice(pushAddress, keys.P256dh, keys.Auth, LUCIE)]);
  }

  /// <param name="addressAtTheService">A push address at a service the settings name by its exact host, without its token.</param>
  [Test]
  [Arguments("https://fcm.googleapis.com/fcm/send/")] // Google: https://fcm.googleapis.com
  [Arguments("https://updates.push.services.mozilla.com/wpush/v2/")] // Mozilla: https://updates.push.services.mozilla.com
  public async Task A_push_address_at_a_service_named_exactly_is_accepted(string addressAtTheService) =>
    await ShouldBeAccepted($"{addressAtTheService}{MadeUpToken()}", _knownServices);

  /// <param name="addressAtTheService">A push address on a host under a service the settings name with a wildcard, without its token.</param>
  [Test]
  [Arguments("https://web.push.apple.com/")] // Apple: https://*.push.apple.com
  [Arguments("https://wns2-par02p.notify.windows.com/w/?token=")] // Microsoft: https://*.notify.windows.com, its token in the query
  [Arguments("https://eu.web.push.apple.com/")] // two labels before the suffix: the host still ends in ".push.apple.com"
  public async Task A_push_address_under_a_service_named_with_a_wildcard_is_accepted(string addressAtTheService) =>
    await ShouldBeAccepted($"{addressAtTheService}{MadeUpToken()}", _knownServices);

  /// <summary>
  /// The accepting side: a plain-http address at a loopback service the settings name, as the acceptance tests' fake push
  /// service is named next to the real ones. The refusals (at a service named with https, on another port, at a host no
  /// service names) are tasks of their own.
  /// </summary>
  /// <param name="loopbackService">A loopback origin, named among the known services.</param>
  [Test]
  [Arguments("http://127.0.0.1:5005")]
  [Arguments("http://localhost:5005")]
  [Arguments("http://[::1]:5005")]
  public async Task A_plain_http_push_address_is_accepted_only_at_a_loopback_service_the_settings_name(string loopbackService) {
    Dictionary<string, string> services = new(_knownServices, StringComparer.Ordinal) { ["LocalFake"] = loopbackService };

    await ShouldBeAccepted($"{loopbackService}/push/{MadeUpToken()}", services);
  }

  /// <summary>
  /// A device is known by its push address (spec push-devices, D11): registering a stored address again, from another
  /// signed-in account, replaces the stored device whole. It ends up once, under the new account only, with the new
  /// registration's keys; the other devices, of either account, stay as they were.
  /// </summary>
  [Test]
  public async Task Registering_a_stored_push_address_under_another_account_saves_it_under_the_new_account() {
    InMemoryPushDeviceStore store = new();
    string sharedPhone = $"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}";
    DeviceKeys keysForLucie = DeviceKeys.New();
    DeviceKeys keysForPetr = DeviceKeys.New();
    DeviceKeys tabletKeys = DeviceKeys.New();
    DeviceKeys laptopKeys = DeviceKeys.New();
    PushDevice luciesTablet = new($"https://web.push.apple.com/{MadeUpToken()}", tabletKeys.P256dh, tabletKeys.Auth, LUCIE);
    PushDevice petrsLaptop = new($"https://updates.push.services.mozilla.com/wpush/v2/{MadeUpToken()}", laptopKeys.P256dh, laptopKeys.Auth, PETR);
    await store.Save(luciesTablet, CancellationToken.None);
    await store.Save(petrsLaptop, CancellationToken.None);
    RegisterDeviceHandler handler = Handler(store, _knownServices);
    (await handler.Handle(new DeviceSubscription(sharedPhone, keysForLucie.P256dh, keysForLucie.Auth), LUCIE, CancellationToken.None)).Value.ShouldBeOfType<Registered>("Lucie registers the phone first");

    RegistrationResult result = await handler.Handle(new DeviceSubscription(sharedPhone, keysForPetr.P256dh, keysForPetr.Auth), PETR, CancellationToken.None);

    result.Value.ShouldBeOfType<Registered>();
    (await store.ReadAll(CancellationToken.None)).ShouldBe(
      [luciesTablet, petrsLaptop, new PushDevice(sharedPhone, keysForPetr.P256dh, keysForPetr.Auth, PETR)],
      ignoreOrder: true,
      "the phone once, under Petr with the keys he registered; the tablet and the laptop as they were");
  }

  /// <summary>Registers a device with well-formed keys at <paramref name="pushAddress"/>; it must be registered and stored.</summary>
  private static async Task ShouldBeAccepted(string pushAddress, IReadOnlyDictionary<string, string> services) {
    InMemoryPushDeviceStore store = new();
    DeviceKeys keys = DeviceKeys.New();

    RegistrationResult result = await Handler(store, services).Handle(new DeviceSubscription(pushAddress, keys.P256dh, keys.Auth), LUCIE, CancellationToken.None);

    result.Value.ShouldBeOfType<Registered>($"a device at {pushAddress} is registered");
    (await store.ReadAll(CancellationToken.None)).ShouldContain(device => device.Endpoint == pushAddress, "the device is stored under its push address");
  }

  private static RegisterDeviceHandler Handler(IPushDeviceStore store, IReadOnlyDictionary<string, string> services) =>
    new(store, new KnownPushServices(Options.Create(new PushOptions {
      VapidPublicKey = NOT_READ_WHEN_REGISTERING,
      VapidPrivateKey = NOT_READ_WHEN_REGISTERING,
      MessageKey = NOT_READ_WHEN_REGISTERING,
      Subject = new Uri("https://app.example.net"),
      Services = services,
    })));

  /// <summary>A made-up token where a push service puts the device's own part of the address.</summary>
  private static string MadeUpToken() => $"made-up-{Guid.NewGuid():N}";

  /// <summary>A device's keys as a browser makes them (D9): a new P-256 public key, uncompressed, and a 16-byte secret, each base64url without padding.</summary>
  private sealed record DeviceKeys(string P256dh, string Auth) {
    public static DeviceKeys New() {
      using ECDiffieHellman key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
      ECPoint point = key.ExportParameters(includePrivateParameters: false).Q;

      byte[] x = point.X ?? throw new UnreachableException("An exported P-256 key has its point.");
      byte[] y = point.Y ?? throw new UnreachableException("An exported P-256 key has its point.");

      return new DeviceKeys(Base64Url.EncodeToString([0x04, .. x, .. y]), Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(SECRET_BYTES)));
    }
  }
}