using System.Buffers.Text;
using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Push;

/// <summary>
/// A subscription the app cannot use is refused at the subscription endpoint (spec push-devices, "Only push addresses at
/// known push services are accepted" and "A malformed subscription is refused"; c011 design.md D9; tasks 42.1, 42.7,
/// 42.9, 43.1, 45.1–45.6). Lucie, signed in and allowed, registers a subscription whose push address is at no known
/// service, on this machine at a service the settings do not name, left out or empty, or whose keys are missing, of the
/// wrong size, not base64url without padding, or whose public key is not a point on P-256: each gets 400, FastEndpoints' validation problem
/// (<c>application/problem+json</c>, titled <c>Bad Request</c>, <c>errors</c> an array of <c>{ name, reason }</c>) naming
/// exactly each refused member (<c>endpoint</c>, <c>keys.p256dh</c>, <c>keys.auth</c>) once, with a fixed reason and
/// nothing the request sent, and nothing is stored. The scenarios pin a refusal through the DSL; here the problem's whole
/// shape and the store. Each test has its own app copy (<see cref="SubscriptionEndpointApp"/>).
/// </summary>
public sealed class RefusedSubscriptionTests {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  private const string LUCIE = MessageEndpointApp.ALLOWED_ACCOUNT;

  /// <summary>The members a refusal names, as the browser's subscription names them (D9).</summary>
  private const string PUSH_ADDRESS_MEMBER = "endpoint";
  private const string PUBLIC_KEY_MEMBER = "keys.p256dh";
  private const string SECRET_MEMBER = "keys.auth";

  /// <summary>The device's public key (<c>p256dh</c>): the uncompressed P-256 point, 0x04 then X and Y (D9).</summary>
  private const int POINT_BYTES = 65;
  private const byte UNCOMPRESSED_POINT = 0x04;

  /// <summary>The device's secret (<c>auth</c>): 16 random bytes (D9).</summary>
  private const int SECRET_BYTES = 16;

  /// <summary>
  /// The harness's own check: a subscription at a known push service, from Lucie signed in, is answered 204 and stored
  /// under her account. So the login cookie, the request's shape and the store the tests read are the ones the endpoint
  /// uses, and a refusal below is the endpoint's, not the harness's.
  /// </summary>
  [Test]
  public async Task A_subscription_at_a_known_push_service_is_stored_under_the_signed_in_account() {
    await using SubscriptionEndpointApp app = new();
    using HttpClient lucie = app.SignedInAs(LUCIE);
    DeviceKeys keys = DeviceKeys.New();
    string pushAddress = PushAddressAtGoogle();

    using HttpResponseMessage response = await Register(lucie, Subscription(Quoted(pushAddress), keys));

    response.StatusCode.ShouldBe(HttpStatusCode.NoContent, await response.Content.ReadAsStringAsync());
    (await app.Devices.ReadAll(CancellationToken.None)).ShouldBe([new PushDevice(pushAddress, keys.P256dh, keys.Auth, LUCIE)]);
  }

  /// <param name="pushAddress">
  /// The subscription's push address without its token, which the test adds; empty, sent empty; <see langword="null"/>,
  /// left out.
  /// </param>
  [Test]
  [Arguments("https://push.example.com/device-")] // the scenario's host: no service names it
  [Arguments("http://127.0.0.1:5005/push/")] // this machine: no loopback service is named in the app's settings
  [Arguments("https://push.apple.com.example.com/")] // a service's host, then another domain
  [Arguments("https://made-up-user@fcm.googleapis.com/fcm/send/")] // user information before a service's host
  [Arguments("")] // empty
  [Arguments(null)] // left out
  public async Task A_push_address_outside_the_known_push_services_is_refused_naming_the_push_address_and_nothing_is_stored(string? pushAddress) {
    await using SubscriptionEndpointApp app = new();
    using HttpClient lucie = app.SignedInAs(LUCIE);
    DeviceKeys keys = DeviceKeys.New();
    string token = MadeUpToken();
    string? endpoint = pushAddress switch {
      null => null,
      "" => "\"\"",
      _ => Quoted($"{pushAddress}{token}"),
    };

    using HttpResponseMessage response = await Register(lucie, Subscription(endpoint, keys));

    await ShouldBeRefusedNaming(response, [PUSH_ADDRESS_MEMBER], sent: [token, "example.com", "127.0.0.1", "made-up-user", keys.P256dh, keys.Auth]);
    (await app.Devices.ReadAll(CancellationToken.None)).ShouldBeEmpty("a refused device is not stored");
  }

  /// <summary>
  /// At a known push service, keys the app cannot encrypt for are refused (D9): the problem names each wrong key, and the
  /// well-formed one is not named. The scenario pins an 8-byte secret.
  /// </summary>
  /// <param name="refusal">What is wrong with the keys.</param>
  [Test]
  [Arguments("a public key of 64 bytes")]
  [Arguments("a public key of 65 bytes starting with 0x02")]
  [Arguments("a public key of 65 bytes starting with 0x04 that is not a point on P-256")]
  [Arguments("a public key with padding")]
  [Arguments("a public key left out")]
  [Arguments("a secret of 17 bytes")]
  [Arguments("a secret with padding")]
  [Arguments("a secret that is null")]
  [Arguments("both keys of the wrong size")]
  [Arguments("the keys left out")]
  [Arguments("the keys null")]
  public async Task A_subscription_with_wrong_keys_is_refused_naming_each_wrong_key_and_nothing_is_stored(string refusal) {
    await using SubscriptionEndpointApp app = new();
    using HttpClient lucie = app.SignedInAs(LUCIE);
    DeviceKeys keys = DeviceKeys.New();
    string token = MadeUpToken();
    string endpoint = Quoted(PushAddressAtGoogle(token));
    string publicKey = Quoted(keys.P256dh);
    string secret = Quoted(keys.Auth);
    string shortPublicKey = Base64Url.EncodeToString(keys.Point.AsSpan(0, POINT_BYTES - 1));
    string otherPublicKey = Base64Url.EncodeToString([0x02, .. keys.Point.AsSpan(1)]);
    string offCurvePublicKey = Base64Url.EncodeToString([.. keys.Point.AsSpan(0, POINT_BYTES - 1), (byte)(keys.Point[^1] ^ 0x01)]);
    string longSecret = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(SECRET_BYTES + 1));
    string shortSecret = Base64Url.EncodeToString(keys.Secret.AsSpan(0, 8));
    (string Body, string[] Refused) subscription = refusal switch {
      "a public key of 64 bytes" => (Subscription(endpoint, Quoted(shortPublicKey), secret), [PUBLIC_KEY_MEMBER]),
      "a public key of 65 bytes starting with 0x02" => (Subscription(endpoint, Quoted(otherPublicKey), secret), [PUBLIC_KEY_MEMBER]),
      "a public key of 65 bytes starting with 0x04 that is not a point on P-256" => (Subscription(endpoint, Quoted(offCurvePublicKey), secret), [PUBLIC_KEY_MEMBER]),
      "a public key with padding" => (Subscription(endpoint, Quoted($"{keys.P256dh}="), secret), [PUBLIC_KEY_MEMBER]),
      "a public key left out" => (Subscription(endpoint, null, secret), [PUBLIC_KEY_MEMBER]),
      "a secret of 17 bytes" => (Subscription(endpoint, publicKey, Quoted(longSecret)), [SECRET_MEMBER]),
      "a secret with padding" => (Subscription(endpoint, publicKey, Quoted($"{keys.Auth}==")), [SECRET_MEMBER]),
      "a secret that is null" => (Subscription(endpoint, publicKey, "null"), [SECRET_MEMBER]),
      "both keys of the wrong size" => (Subscription(endpoint, Quoted(shortPublicKey), Quoted(shortSecret)), [PUBLIC_KEY_MEMBER, SECRET_MEMBER]),
      "the keys left out" => ($$"""{ "endpoint": {{endpoint}}, "expirationTime": null }""", [PUBLIC_KEY_MEMBER, SECRET_MEMBER]),
      "the keys null" => ($$"""{ "endpoint": {{endpoint}}, "expirationTime": null, "keys": null }""", [PUBLIC_KEY_MEMBER, SECRET_MEMBER]),
      _ => throw new ArgumentOutOfRangeException(nameof(refusal), refusal, "Not a known case."),
    };

    using HttpResponseMessage response = await Register(lucie, subscription.Body);

    await ShouldBeRefusedNaming(response, subscription.Refused, sent: [token, keys.P256dh[..20], keys.Auth[..16], shortPublicKey[..20], otherPublicKey[..20], offCurvePublicKey[^20..], longSecret[..16], shortSecret]);
    (await app.Devices.ReadAll(CancellationToken.None)).ShouldBeEmpty("a refused device is not stored");
  }

  /// <summary><c>PUT</c> of <paramref name="body"/> as JSON to the subscription endpoint.</summary>
  private static async Task<HttpResponseMessage> Register(HttpClient client, string body) {
    using HttpRequestMessage request = new(HttpMethod.Put, new Uri(SubscriptionEndpointApp.SUBSCRIPTION, UriKind.Relative)) {
      Content = new StringContent(body, Encoding.UTF8, JSON),
    };

    return await client.SendAsync(request);
  }

  /// <summary>The browser's <c>PushSubscription.toJSON()</c>: <paramref name="endpoint"/> as JSON (left out when <see langword="null"/>), no expiry, and <paramref name="keys"/>.</summary>
  private static string Subscription(string? endpoint, DeviceKeys keys) => Subscription(endpoint, Quoted(keys.P256dh), Quoted(keys.Auth));

  /// <summary>
  /// The browser's <c>PushSubscription.toJSON()</c>: each member given as JSON, or left out when <see langword="null"/>,
  /// with no expiry.
  /// </summary>
  private static string Subscription(string? endpoint, string? publicKey, string? secret) {
    string endpointMember = endpoint is null ? string.Empty : $"\"endpoint\": {endpoint}, ";
    string[] keyMembers = [
      .. publicKey is null ? Array.Empty<string>() : [$"\"p256dh\": {publicKey}"],
      .. secret is null ? Array.Empty<string>() : [$"\"auth\": {secret}"],
    ];

    return $$"""{ {{endpointMember}}"expirationTime": null, "keys": { {{string.Join(", ", keyMembers)}} } }""";
  }

  /// <summary>
  /// Expects FastEndpoints' validation problem naming exactly <paramref name="members"/>, each once, in any order, each with
  /// a reason that is not blank, and none of <paramref name="sent"/> anywhere in it.
  /// </summary>
  private static async Task ShouldBeRefusedNaming(HttpResponseMessage response, string[] members, string[] sent) {
    string problemText = await response.Content.ReadAsStringAsync();
    string answer = $"{(int)response.StatusCode} {response.Content.Headers.ContentType} {problemText}";

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, answer);
    response.Content.Headers.ContentType?.MediaType.ShouldBe(PROBLEM_JSON, answer);

    using JsonDocument problem = JsonDocument.Parse(problemText);
    JsonElement root = problem.RootElement;
    JsonElement[] refused = [.. root.GetProperty("errors").EnumerateArray()];

    root.ShouldSatisfyAllConditions(
      () => root.GetProperty("title").GetString().ShouldBe("Bad Request", answer),
      () => refused.Select(static error => error.GetProperty("name").GetString()).ShouldBe(members, ignoreOrder: true, answer),
      () => refused.Where(static error => string.IsNullOrWhiteSpace(error.GetProperty("reason").GetString())).ShouldBeEmpty($"every reason given: {answer}"),
      () => sent.Where(value => problemText.Contains(value, StringComparison.OrdinalIgnoreCase)).ShouldBeEmpty($"never a value the request sent: {answer}"));
  }

  /// <summary><paramref name="text"/> as a JSON string; none of the tests' texts needs escaping.</summary>
  private static string Quoted(string text) => $"\"{text}\"";

  /// <summary>A push address at Google's push service, which the known services name exactly.</summary>
  private static string PushAddressAtGoogle(string? token = null) => $"https://fcm.googleapis.com/fcm/send/{token ?? MadeUpToken()}";

  /// <summary>A made-up token where a push service puts the device's own part of the address.</summary>
  private static string MadeUpToken() => $"made-up-{Guid.NewGuid():N}";

  /// <summary>A device's keys as a browser makes them (D9): a new P-256 public key, uncompressed, and a 16-byte secret.</summary>
  private sealed record DeviceKeys(byte[] Point, byte[] Secret) {
    /// <summary>The public key as the subscription carries it, base64url without padding.</summary>
    public string P256dh => Base64Url.EncodeToString(Point);

    /// <summary>The secret as the subscription carries it, base64url without padding.</summary>
    public string Auth => Base64Url.EncodeToString(Secret);

    public static DeviceKeys New() {
      using ECDiffieHellman key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
      ECPoint point = key.ExportParameters(includePrivateParameters: false).Q;

      byte[] x = point.X ?? throw new UnreachableException("An exported P-256 key has its point.");
      byte[] y = point.Y ?? throw new UnreachableException("An exported P-256 key has its point.");

      return new DeviceKeys([UNCOMPRESSED_POINT, .. x, .. y], RandomNumberGenerator.GetBytes(SECRET_BYTES));
    }
  }
}