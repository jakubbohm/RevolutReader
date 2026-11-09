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
/// http only at a loopback service the settings name; it has no user information and is at most 2048 characters long.
/// Any other push address is refused, naming the push address (<c>endpoint</c>) with a fixed reason, never its value, and
/// nothing is stored: so a signed-in user can never make the server send requests to an address of their choosing.
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

  /// <summary>The member a refusal of the push address names, as the browser's subscription names it (D9).</summary>
  private const string PUSH_ADDRESS_MEMBER = "endpoint";

  /// <summary>The longest push address accepted (D9).</summary>
  private const int LONGEST_PUSH_ADDRESS = 2048;

  /// <summary>Where every made-up token starts, so a reason quoting any of them is caught.</summary>
  private const string MADE_UP_TOKEN_START = "made-up-";

  /// <summary>The loopback service the acceptance tests' fake push service is named as, next to the real ones (D9).</summary>
  private const string LOOPBACK_SERVICE = "http://127.0.0.1:5005";

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

  /// <param name="addressAtNoService">A push address, without its token, at a host none of the known services names (D9).</param>
  [Test]
  [Arguments("https://push.example.com/device-")] // the scenario's address
  [Arguments("https://169.254.169.254/metadata/")] // the cloud's instance metadata, what a forged request would aim at
  [Arguments("https://10.0.0.4/push/")] // an address inside the private network
  [Arguments("https://localhost/push/")] // this machine, when no loopback service is named
  [Arguments("http://127.0.0.1:5005/push/")] // plain http on this machine, when no loopback service is named
  public async Task A_push_address_at_a_host_no_service_names_is_refused_naming_the_push_address(string addressAtNoService) =>
    await ShouldBeRefusedNamingThePushAddress($"{addressAtNoService}{MadeUpToken()}", _knownServices);

  /// <summary>
  /// Plain http is accepted only at a loopback service the settings name (D9), here <see cref="LOOPBACK_SERVICE"/>, named
  /// next to the real services: another loopback host, the same host on another port, or https there is no service.
  /// </summary>
  /// <param name="addressAtNoService">A push address, without its token, on this machine but at no service the settings name.</param>
  [Test]
  [Arguments("http://127.0.0.1:5006/push/")] // the named host on another port
  [Arguments("http://localhost:5005/push/")] // another name for this machine: only 127.0.0.1 is named
  [Arguments("http://[::1]:5005/push/")] // this machine's IPv6 address: only 127.0.0.1 is named
  [Arguments("http://127.0.0.2:5005/push/")] // another loopback address
  [Arguments("https://127.0.0.1:5005/push/")] // the named host and port, but https
  [Arguments("http://127.0.0.1/push/")] // the named host on http's own port
  public async Task A_push_address_at_a_loopback_address_the_settings_do_not_name_is_refused(string addressAtNoService) {
    Dictionary<string, string> services = new(_knownServices, StringComparer.Ordinal) { ["LocalFake"] = LOOPBACK_SERVICE };

    await ShouldBeRefusedNamingThePushAddress($"{addressAtNoService}{MadeUpToken()}", services);
  }

  /// <param name="lookAlike">A push address, without its token, on a host that contains or resembles a service's host but is not at it (D9).</param>
  [Test]
  [Arguments("https://push.apple.com.example.com/")] // a wildcard service's suffix, then another domain
  [Arguments("https://web.push.apple.com.example.com/")] // a host under a wildcard service, then another domain
  [Arguments("https://evilpush.apple.com/")] // ends in the suffix, but not in "." and the suffix
  [Arguments("https://push.apple.com/")] // a wildcard service's bare suffix: no host under it
  [Arguments("https://notify.windows.com/w/?token=")] // the other wildcard service's bare suffix
  [Arguments("https://fcm.googleapis.com.example.com/fcm/send/")] // an exactly named service's host, then another domain
  [Arguments("https://evil.fcm.googleapis.com/fcm/send/")] // a host under an exactly named service: an exact entry has no wildcard
  [Arguments("https://evilfcm.googleapis.com/fcm/send/")] // ends in an exactly named service's host
  [Arguments("https://fcm.googleapis.co/fcm/send/")] // an exactly named service's host, cut short
  [Arguments("https://fcm.googleаpis.com/fcm/send/")] // an exactly named service's host with a Cyrillic "а"
  [Arguments("https://updates.push.services.mozilla.com.example.com/wpush/v2/")] // the other exactly named service, then another domain
  public async Task A_host_that_only_looks_like_a_services_host_is_refused(string lookAlike) =>
    await ShouldBeRefusedNamingThePushAddress($"{lookAlike}{MadeUpToken()}", _knownServices);

  /// <param name="addressOnAnotherPort">A push address, without its token, at a service's host but on another port than the service's (D9).</param>
  [Test]
  [Arguments("https://fcm.googleapis.com:8443/fcm/send/")] // an exactly named service, https's own port being the service's
  [Arguments("https://fcm.googleapis.com:80/fcm/send/")] // an exactly named service, on http's own port
  [Arguments("https://web.push.apple.com:444/")] // a host under a wildcard service
  [Arguments("https://updates.push.services.mozilla.com:5005/wpush/v2/")] // the port the loopback service is named with
  public async Task A_push_address_on_another_port_than_its_services_is_refused(string addressOnAnotherPort) {
    Dictionary<string, string> services = new(_knownServices, StringComparer.Ordinal) { ["LocalFake"] = LOOPBACK_SERVICE };

    await ShouldBeRefusedNamingThePushAddress($"{addressOnAnotherPort}{MadeUpToken()}", services);
  }

  /// <param name="plainHttpAddress">A push address, without its token, in plain http at a host of a service named with https (D9).</param>
  [Test]
  [Arguments("http://fcm.googleapis.com/fcm/send/")] // an exactly named service
  [Arguments("http://web.push.apple.com/")] // a host under a wildcard service
  [Arguments("http://fcm.googleapis.com:443/fcm/send/")] // the service's port, the scheme alone differs
  [Arguments("http://web.push.apple.com:443/")] // the same under a wildcard service
  public async Task A_plain_http_push_address_at_a_service_named_with_https_is_refused(string plainHttpAddress) =>
    await ShouldBeRefusedNamingThePushAddress($"{plainHttpAddress}{MadeUpToken()}", _knownServices);

  /// <param name="userInformation">User information put before a known service's host (D9).</param>
  [Test]
  [Arguments("user@")]
  [Arguments("user:password@")]
  [Arguments("evil.example@")] // reads like another host, but is user information before the service's host
  public async Task A_push_address_with_user_information_is_refused(string userInformation) =>
    await ShouldBeRefusedNamingThePushAddress($"https://{userInformation}fcm.googleapis.com/fcm/send/{MadeUpToken()}", _knownServices);

  /// <param name="length">The push address's length in characters: one more than the longest accepted (D9), and far more.</param>
  [Test]
  [Arguments(LONGEST_PUSH_ADDRESS + 1)]
  [Arguments(65_536)]
  public async Task A_push_address_longer_than_2048_characters_is_refused(int length) =>
    await ShouldBeRefusedNamingThePushAddress(PushAddressOfLength(length), _knownServices);

  /// <summary>The boundary of task 42.6: the longest push address accepted is 2048 characters (D9).</summary>
  [Test]
  public async Task A_push_address_of_exactly_2048_characters_is_accepted() =>
    await ShouldBeAccepted(PushAddressOfLength(LONGEST_PUSH_ADDRESS), _knownServices);

  /// <param name="notAnAbsoluteAddress">No push address, or one that is not absolute: nothing tells at which service it lies (D9).</param>
  [Test]
  [Arguments(null)] // left out
  [Arguments("")]
  [Arguments("   ")]
  [Arguments("/fcm/send/made-up-token")] // a path alone
  [Arguments("fcm.googleapis.com/fcm/send/made-up-token")] // no scheme
  [Arguments("//fcm.googleapis.com/fcm/send/made-up-token")] // no scheme, a network path
  public async Task A_missing_or_relative_push_address_is_refused(string? notAnAbsoluteAddress) =>
    await ShouldBeRefusedNamingThePushAddress(notAnAbsoluteAddress, _knownServices);

  /// <summary>
  /// A refused subscription stores nothing (spec push-devices; D9) and changes nothing stored: the store holds Lucie's
  /// tablet and Petr's phone, and a registration from Lucie is refused, either for its push address, which no service
  /// names, or for a missing key on Petr's phone's own push address, which must not move the phone to Lucie or change
  /// its keys.
  /// </summary>
  /// <param name="refusal">What makes the registration refused.</param>
  [Test]
  [Arguments("a push address at no known service")]
  [Arguments("the stored phone's push address without its public key")]
  [Arguments("the stored phone's push address without its secret")]
  public async Task A_refused_subscription_stores_nothing(string refusal) {
    InMemoryPushDeviceStore store = new();
    DeviceKeys tabletKeys = DeviceKeys.New();
    DeviceKeys phoneKeys = DeviceKeys.New();
    DeviceKeys newKeys = DeviceKeys.New();
    PushDevice luciesTablet = new($"https://web.push.apple.com/{MadeUpToken()}", tabletKeys.P256dh, tabletKeys.Auth, LUCIE);
    PushDevice petrsPhone = new($"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}", phoneKeys.P256dh, phoneKeys.Auth, PETR);
    await store.Save(luciesTablet, CancellationToken.None);
    await store.Save(petrsPhone, CancellationToken.None);
    DeviceSubscription subscription = refusal switch {
      "a push address at no known service" => new DeviceSubscription($"https://push.example.com/device-{MadeUpToken()}", newKeys.P256dh, newKeys.Auth),
      "the stored phone's push address without its public key" => new DeviceSubscription(petrsPhone.Endpoint, null, newKeys.Auth),
      "the stored phone's push address without its secret" => new DeviceSubscription(petrsPhone.Endpoint, newKeys.P256dh, null),
      _ => throw new ArgumentOutOfRangeException(nameof(refusal), refusal, "Not a known case."),
    };

    RegistrationResult result = await Handler(store, _knownServices).Handle(subscription, LUCIE, CancellationToken.None);

    result.Value.ShouldBeOfType<SubscriptionRefused>();
    (await store.ReadAll(CancellationToken.None)).ShouldBe([luciesTablet, petrsPhone], ignoreOrder: true, "the store as it was");
  }

  /// <summary>
  /// Registers a device with well-formed keys at <paramref name="pushAddress"/>; it must be refused naming the push
  /// address alone, with a reason that quotes no part of it, and nothing stored.
  /// </summary>
  private static async Task ShouldBeRefusedNamingThePushAddress(string? pushAddress, IReadOnlyDictionary<string, string> services) {
    InMemoryPushDeviceStore store = new();
    DeviceKeys keys = DeviceKeys.New();

    RegistrationResult result = await Handler(store, services).Handle(new DeviceSubscription(pushAddress, keys.P256dh, keys.Auth), LUCIE, CancellationToken.None);

    SubscriptionRefused refused = result.Value.ShouldBeOfType<SubscriptionRefused>($"a device at {pushAddress ?? "no push address"} is refused");
    RefusedMember member = refused.Members.ShouldHaveSingleItem("only the push address is refused: the keys are well formed");
    member.ShouldSatisfyAllConditions(
      () => member.Member.ShouldBe(PUSH_ADDRESS_MEMBER),
      () => member.Reason.ShouldNotBeNullOrWhiteSpace(),
      () => member.Reason.ShouldNotContain(MADE_UP_TOKEN_START, Case.Insensitive, "the reason is fixed, never the push address"),
      () => member.Reason.ShouldNotContain("example", Case.Insensitive, "the reason is fixed, never the push address"));
    (await store.ReadAll(CancellationToken.None)).ShouldBeEmpty("a refused device is not stored");
  }

  /// <summary>An address at Google's push service, its made-up token padded to exactly <paramref name="length"/> characters.</summary>
  private static string PushAddressOfLength(int length) {
    string start = $"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}";

    return $"{start}{new string('x', length - start.Length)}";
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