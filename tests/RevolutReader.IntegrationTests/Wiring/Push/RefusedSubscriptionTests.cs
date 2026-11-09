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
/// Only push addresses at known push services are accepted at the subscription endpoint (spec push-devices, "Only push
/// addresses at known push services are accepted"; c011 design.md D9; tasks 42.1, 42.7, 42.9, 43.1). Lucie, signed in
/// and allowed, registers a subscription with well-formed keys whose push address is at no known service, on this machine
/// at a service the settings do not name, left out or empty: each gets 400, FastEndpoints' validation problem
/// (<c>application/problem+json</c>, titled <c>Bad Request</c>, <c>errors</c> an array of <c>{ name, reason }</c>) naming
/// exactly <c>endpoint</c>, with a fixed reason and nothing the request sent, and nothing is stored. The scenario pins the
/// refusal through the DSL; here the problem's whole shape and the store. Each test has its own app copy
/// (<see cref="SubscriptionEndpointApp"/>). Written by the test-writer while the endpoint already mapped the refusal
/// (group 10), so it may pass at once.
/// </summary>
public sealed class RefusedSubscriptionTests {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  private const string LUCIE = MessageEndpointApp.ALLOWED_ACCOUNT;

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
    string pushAddress = $"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}";

    using HttpResponseMessage response = await Register(lucie, Subscription($"\"{pushAddress}\"", keys));

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
      _ => $"\"{pushAddress}{token}\"",
    };

    using HttpResponseMessage response = await Register(lucie, Subscription(endpoint, keys));

    await ShouldBeRefusedNaming(response, "endpoint", sent: [token, "example.com", "127.0.0.1", "made-up-user", keys.P256dh, keys.Auth]);
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
  private static string Subscription(string? endpoint, DeviceKeys keys) {
    string endpointMember = endpoint is null ? string.Empty : $"\"endpoint\": {endpoint}, ";

    return $$"""{ {{endpointMember}}"expirationTime": null, "keys": { "p256dh": "{{keys.P256dh}}", "auth": "{{keys.Auth}}" } }""";
  }

  /// <summary>
  /// Expects FastEndpoints' validation problem naming exactly <paramref name="member"/> with a reason that is not blank,
  /// and none of <paramref name="sent"/> anywhere in it.
  /// </summary>
  private static async Task ShouldBeRefusedNaming(HttpResponseMessage response, string member, string[] sent) {
    string problemText = await response.Content.ReadAsStringAsync();
    string answer = $"{(int)response.StatusCode} {response.Content.Headers.ContentType} {problemText}";

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, answer);
    response.Content.Headers.ContentType?.MediaType.ShouldBe(PROBLEM_JSON, answer);

    using JsonDocument problem = JsonDocument.Parse(problemText);
    JsonElement root = problem.RootElement;
    JsonElement refused = root.GetProperty("errors").EnumerateArray().ShouldHaveSingleItem(answer);

    root.ShouldSatisfyAllConditions(
      () => root.GetProperty("title").GetString().ShouldBe("Bad Request", answer),
      () => refused.GetProperty("name").GetString().ShouldBe(member, answer),
      () => refused.GetProperty("reason").GetString().ShouldNotBeNullOrWhiteSpace(answer),
      () => sent.Where(value => problemText.Contains(value, StringComparison.OrdinalIgnoreCase)).ShouldBeEmpty($"never a value the request sent: {answer}"));
  }

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