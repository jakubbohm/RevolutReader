using System.Buffers.Text;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using RevolutReader.AcceptanceTests.Drivers;
using Shouldly;

namespace RevolutReader.AcceptanceTests.HarnessSelfTests;

/// <summary>
/// Checks of the test harness itself, not of the app (c011 design.md D7, tasks.md 9a.2, 9a.3): the fake push service's
/// checks, the only test that the app's pushes follow RFC 8292 and RFC 8030, each bite. A push built by this test's own
/// code, never the Web Push library, is accepted when correct and refused with 403 when it breaks any one check; every
/// request is recorded with whether its token passed and the answer; a device made gone is answered 410 from then on, one
/// made to fail once 500 once. The token is signed with .NET's <see cref="ECDsa"/> and checked against the real clock, as
/// the fake checks it (the library signs with the real clock); no test waits. The keys are the test run's made-up VAPID
/// pair, or new ones; the bodies random bytes, which the fake never reads.
/// </summary>
public sealed class FakePushServiceSelfTests {
  /// <summary>A contact the fake accepts: an <c>https:</c> address (the made-up app address).</summary>
  private const string CONTACT = "https://app.example.net";

  private const string AES128GCM = "aes128gcm";

  /// <summary>How long the library's tokens live by default (12 hours, D1).</summary>
  private static readonly TimeSpan _tokenLifetime = TimeSpan.FromHours(12);

  /// <param name="variant">A correct push, with each of RFC 8030's four urgencies, without one (normal), or with a token that lives the full 24 hours RFC 8292 allows.</param>
  [Test]
  [Arguments("with Urgency high")]
  [Arguments("with Urgency normal")]
  [Arguments("with Urgency low")]
  [Arguments("with Urgency very-low")]
  [Arguments("without Urgency")]
  [Arguments("with a token that expires a full 24 hours ahead")]
  public async Task A_correct_push_is_accepted(string variant) {
    using FakePushService fake = FakePushService.Start();
    TestDevice device = fake.NewDevice("phone");
    Push push = variant switch {
      "with Urgency high" => CorrectPush(fake) with { Urgency = "high" },
      "with Urgency normal" => CorrectPush(fake) with { Urgency = "normal" },
      "with Urgency low" => CorrectPush(fake) with { Urgency = "low" },
      "with Urgency very-low" => CorrectPush(fake) with { Urgency = "very-low" },
      "without Urgency" => CorrectPush(fake) with { Urgency = null },
      "with a token that expires a full 24 hours ahead" => CorrectPush(fake) with { Authorization = Vapid(Token(fake, expiresIn: TimeSpan.FromHours(24)), fake.VapidPublicKey) },
      _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, "Not a known case."),
    };

    (await Send(device, push)).ShouldBe(HttpStatusCode.Created);
  }

  /// <param name="failing">The one thing about an otherwise correct push that a push service must refuse (RFC 8292, RFC 8030, RFC 8291 § 4; D7).</param>
  [Test]
  [Arguments("a token signed with another key")]
  [Arguments("a k that is not the server's key")]
  [Arguments("a token naming an algorithm other than ES256")]
  [Arguments("an expired token")]
  [Arguments("a token that expires more than 24 hours ahead")]
  [Arguments("a token for another audience")]
  [Arguments("a token whose contact is not an https address")]
  [Arguments("no Authorization")]
  [Arguments("the older WebPush scheme instead of vapid")]
  [Arguments("no TTL")]
  [Arguments("an unknown Urgency")]
  [Arguments("another Content-Encoding")]
  public async Task A_push_failing_a_check_is_refused(string failing) {
    using FakePushService fake = FakePushService.Start();
    TestDevice device = fake.NewDevice("phone");
    using ECDsa anotherKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    Push correct = CorrectPush(fake);
    Push push = failing switch {
      "a token signed with another key" => correct with { Authorization = Vapid(Token(fake, signer: anotherKey), fake.VapidPublicKey) },
      "a k that is not the server's key" => correct with { Authorization = Vapid(Token(fake), PublicKeyOf(anotherKey)) },
      "a token naming an algorithm other than ES256" => correct with { Authorization = Vapid(Token(fake, algorithm: "ES384"), fake.VapidPublicKey) },
      "an expired token" => correct with { Authorization = Vapid(Token(fake, expiresIn: TimeSpan.FromMinutes(-1)), fake.VapidPublicKey) },
      "a token that expires more than 24 hours ahead" => correct with { Authorization = Vapid(Token(fake, expiresIn: TimeSpan.FromHours(25)), fake.VapidPublicKey) },
      "a token for another audience" => correct with { Authorization = Vapid(Token(fake, audience: "https://fcm.googleapis.com"), fake.VapidPublicKey) },
      "a token whose contact is not an https address" => correct with { Authorization = Vapid(Token(fake, contact: "http://app.example.net"), fake.VapidPublicKey) },
      "no Authorization" => correct with { Authorization = null },
      "the older WebPush scheme instead of vapid" => correct with { Authorization = $"WebPush {Token(fake)}" },
      "no TTL" => correct with { TimeToLive = null },
      "an unknown Urgency" => correct with { Urgency = "urgent" },
      "another Content-Encoding" => correct with { ContentEncoding = "aesgcm" }, // the older draft's coding
      _ => throw new ArgumentOutOfRangeException(nameof(failing), failing, "Not a known case."),
    };

    (await Send(device, push)).ShouldBe(HttpStatusCode.Forbidden);
  }

  [Test]
  public async Task Every_request_is_recorded_as_it_arrived_with_whether_its_token_passed_and_the_answer() {
    using FakePushService fake = FakePushService.Start();
    TestDevice phone = fake.NewDevice("phone");
    TestDevice tablet = fake.NewDevice("tablet");
    using ECDsa anotherKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    Push correct = CorrectPush(fake);

    _ = await Send(phone, correct);
    _ = await Send(phone, correct with { Authorization = Vapid(Token(fake, signer: anotherKey), fake.VapidPublicKey) });
    _ = await Send(phone, correct with { TimeToLive = null });
    _ = await Send(tablet, correct);

    IReadOnlyList<ReceivedPush> phonePushes = fake.PushesFor(phone);
    phonePushes.ShouldSatisfyAllConditions(
      () => phonePushes.Select(static push => push.Answer).ShouldBe([HttpStatusCode.Created, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden], "the phone's answers, in the order sent"),
      () => phonePushes.Select(static push => push.SignedWithServerKey).ShouldBe([true, false, true], "whether each token passed: only the second was signed with another key"),
      () => phonePushes.ShouldAllBe(push => push.Path == phone.PushAddress.AbsolutePath),
      () => phonePushes[0].Body.ToArray().ShouldBe(correct.Body, "the body as sent"),
      () => phonePushes[0].Headers["ttl"].ShouldBe(correct.TimeToLive, "the TTL as sent, looked up ignoring case"),
      () => phonePushes[0].Headers["Urgency"].ShouldBe(correct.Urgency),
      () => phonePushes[0].Headers["Content-Encoding"].ShouldBe(AES128GCM));
    fake.PushesFor(tablet).ShouldHaveSingleItem().Answer.ShouldBe(HttpStatusCode.Created);
    fake.Pushes().Count.ShouldBe(4, "every request, at any address");
  }

  [Test]
  public async Task A_gone_device_is_answered_410_from_then_on_and_other_devices_as_before() {
    using FakePushService fake = FakePushService.Start();
    TestDevice phone = fake.NewDevice("phone");
    TestDevice tablet = fake.NewDevice("tablet");
    Push correct = CorrectPush(fake);

    fake.Gone(phone);

    (await Send(phone, correct)).ShouldBe(HttpStatusCode.Gone);
    (await Send(phone, correct)).ShouldBe(HttpStatusCode.Gone);
    (await Send(tablet, correct)).ShouldBe(HttpStatusCode.Created);
    fake.PushesFor(phone).Select(static push => push.Answer).ShouldBe([HttpStatusCode.Gone, HttpStatusCode.Gone], "recorded with its answer");
  }

  [Test]
  public async Task A_device_that_fails_once_is_answered_500_once_then_as_before_and_other_devices_as_before() {
    using FakePushService fake = FakePushService.Start();
    TestDevice phone = fake.NewDevice("phone");
    TestDevice tablet = fake.NewDevice("tablet");
    Push correct = CorrectPush(fake);

    fake.FailsOnce(phone);

    (await Send(tablet, correct)).ShouldBe(HttpStatusCode.Created);
    (await Send(phone, correct)).ShouldBe(HttpStatusCode.InternalServerError);
    (await Send(phone, correct)).ShouldBe(HttpStatusCode.Created);
    fake.PushesFor(phone).Select(static push => push.Answer).ShouldBe([HttpStatusCode.InternalServerError, HttpStatusCode.Created], "recorded with its answer");
  }

  /// <summary>A push the fake must accept: a token signed with the run's VAPID key, that key as <c>k</c>, a TTL, urgent, <c>aes128gcm</c>, a random body.</summary>
  private static Push CorrectPush(FakePushService fake) =>
    new(Vapid(Token(fake), fake.VapidPublicKey), TimeToLive: "86400", Urgency: "high", ContentEncoding: AES128GCM, Body: RandomNumberGenerator.GetBytes(100));

  /// <summary>RFC 8292 § 3's header: <c>vapid t=&lt;token&gt;, k=&lt;key&gt;</c>.</summary>
  private static string Vapid(string token, string key) => $"vapid t={token}, k={key}";

  /// <summary>
  /// A VAPID token (RFC 8292 § 2), built here, never by the library: a JWT whose header names <paramref name="algorithm"/>,
  /// whose claims are <c>aud</c>, <c>exp</c> (the real clock's now and <paramref name="expiresIn"/>) and <c>sub</c>, signed
  /// ES256 by <paramref name="signer"/> (the run's VAPID key when none is given). By default it is the token the fake must
  /// accept: for the fake's own scheme and host, valid for 12 hours, with an https contact.
  /// </summary>
  private static string Token(FakePushService fake, ECDsa? signer = null, string algorithm = "ES256", string? audience = null, TimeSpan? expiresIn = null, string contact = CONTACT) {
    Uri origin = new(fake.Origin);
    string header = Base64Url.EncodeToString(Encoding.UTF8.GetBytes(new JsonObject { ["typ"] = "JWT", ["alg"] = algorithm }.ToJsonString()));
    string claims = Base64Url.EncodeToString(Encoding.UTF8.GetBytes(new JsonObject {
      ["aud"] = audience ?? $"{origin.Scheme}://{origin.Host}",
      ["exp"] = (TimeProvider.System.GetUtcNow() + (expiresIn ?? _tokenLifetime)).ToUnixTimeSeconds(),
      ["sub"] = contact,
    }.ToJsonString()));
    byte[] signedPart = Encoding.ASCII.GetBytes($"{header}.{claims}");

    using ECDsa serverKey = ServerKey(fake);
    byte[] signature = (signer ?? serverKey).SignData(signedPart, HashAlgorithmName.SHA256);

    return $"{header}.{claims}.{Base64Url.EncodeToString(signature)}";
  }

  /// <summary>The run's VAPID pair, as the app copy signs with it.</summary>
  private static ECDsa ServerKey(FakePushService fake) => ECDsa.Create(new ECParameters {
    Curve = ECCurve.NamedCurves.nistP256,
    D = Base64Url.DecodeFromChars(FakePushService.VapidPrivateKey),
    Q = TestDevice.PointOf(Base64Url.DecodeFromChars(fake.VapidPublicKey)),
  });

  /// <summary>A key's public half in the form <c>k</c> takes: the uncompressed point, base64url.</summary>
  private static string PublicKeyOf(ECDsa key) => Base64Url.EncodeToString(TestDevice.UncompressedPoint(key.ExportParameters(includePrivateParameters: false).Q));

  /// <summary>Sends <paramref name="push"/> to <paramref name="device"/>'s push address, each header only when given; the fake's answer.</summary>
  private static async Task<HttpStatusCode> Send(TestDevice device, Push push) {
    using HttpClient http = new();
    using ByteArrayContent body = new(push.Body);
    using HttpRequestMessage request = new(HttpMethod.Post, device.PushAddress) { Content = body };
    body.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");

    if (push.Authorization is not null)
      _ = request.Headers.TryAddWithoutValidation("Authorization", push.Authorization);

    if (push.TimeToLive is not null)
      _ = request.Headers.TryAddWithoutValidation("TTL", push.TimeToLive);

    if (push.Urgency is not null)
      _ = request.Headers.TryAddWithoutValidation("Urgency", push.Urgency);

    if (push.ContentEncoding is not null)
      _ = body.Headers.TryAddWithoutValidation("Content-Encoding", push.ContentEncoding);

    using HttpResponseMessage response = await http.SendAsync(request);

    return response.StatusCode;
  }

  /// <summary>A push request as this test builds it: each header left out when <see langword="null"/>.</summary>
  private sealed record Push(string? Authorization, string? TimeToLive, string? Urgency, string? ContentEncoding, byte[] Body);
}