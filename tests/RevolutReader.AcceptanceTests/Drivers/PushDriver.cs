using System.Net;
using System.Text.Json;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Push through the API (specs push-devices, push-sending; c011 design.md D7, D9, D10). Status codes, headers, JSON, the
/// store and the fake push service's wire stay here; the DSL gets <see cref="RegistrationAnswer"/>,
/// <see cref="ForgetAnswer"/>, <see cref="MessageAnswer"/>, <see cref="WholeAnswer"/> and <see cref="PushReceived"/>
/// values. Modelled on C7a's <c>BalanceDriver</c>.
/// <list type="bullet">
/// <item><b>The browser</b> is the signed-in <see cref="HttpClient"/> <see cref="SignInDriver"/> signs in with, its cookies
/// the login. <c>GET /api/push/key</c>; <c>PUT /api/push/subscription</c> with the device's subscription as a browser's
/// <c>PushSubscription.toJSON()</c> gives it, <c>{ "endpoint", "expirationTime": null, "keys": { "p256dh", "auth" } }</c>;
/// <c>DELETE /api/push/subscription</c> with <c>{ "endpoint" }</c>. The writes carry <c>Sec-Fetch-Site: same-origin</c> and
/// the app's own <c>Origin</c>, as the app's page sends them (<see cref="SignInDriver.SignOut"/>'s).</item>
/// <item><b>The owner</b> is an anonymous <see cref="HttpClient"/> with no fetch metadata and no <c>Origin</c>, as
/// PowerShell sends a request: <c>POST /api/push/messages</c> with <c>X-Message-Key</c> and the JSON body
/// <c>{ "account", "title", "text", "page" }</c>, a member left out when the step gives no value. With the key: the fake
/// push service's <see cref="FakePushService.MessageKey"/>. With a wrong key: 32 made-up random bytes in base64url, as long
/// as the key and never it.</item>
/// <item><b>Exact shapes</b>, any other answer failing the step, naming it: the key is 200 <c>application/json</c> with
/// exactly <c>publicKey</c>, a string; a registration and a forget are 204 with no content
/// (<see cref="RegistrationAnswer.Registered"/>, <see cref="ForgetAnswer.Forgotten"/>; any other answer to a forget is
/// <see cref="ForgetAnswer.SomethingElse"/>); a message's counts are 200 <c>application/json</c> with exactly
/// <c>delivered</c>, <c>failed</c> and <c>removed</c>, each a whole number. A problem as <c>BalanceDriver</c>'s:
/// <c>application/problem+json</c>, a body <c>status</c> equal to the response's, a <c>title</c> and a <c>type</c> (RFC
/// 9110's read as <see langword="null"/>), and the status its case belongs to, by the driver's own table:
/// <see cref="ProblemDescription.BadRequest"/> 400, <see cref="ProblemDescription.PushAccountNotAllowed"/> 404,
/// <see cref="ProblemDescription.InternalServerError"/> 500 (no members but <c>type</c>, <c>title</c>, <c>status</c> and
/// <c>traceId</c>). A 400's <c>errors</c> (FastEndpoints' validation problem, D9, D10) name exactly one member, read as a
/// <see cref="RequestPart"/>: <c>endpoint</c> <see cref="RequestPart.PushAddress"/>, <c>keys.p256dh</c>
/// <see cref="RequestPart.DeviceKey"/>, <c>keys.auth</c> <see cref="RequestPart.Secret"/>, <c>account</c>, <c>title</c>,
/// <c>page</c>, <c>message</c> and <c>body</c> the parts of those names. A refusal never holds a value the request sent
/// (spec: the member, never its value): a problem in which the account, the title, the text, the page, the push address
/// or a key appears fails the step.</item>
/// <item><b>A whole answer</b> (<see cref="WholeAnswer"/>, D10): the problem description as <see cref="ApiDriver"/> reads
/// one, and the status, the content type and the body with its <c>traceId</c> left out, as text.
/// <see cref="SendTheSameToAnUnknownApiAddress"/> sends the request <see cref="SendMessageWithAWrongKey"/> sent last, the
/// same method, headers and body, to <c>/api/no-such-address</c>, an address under <c>/api</c> no endpoint serves.</item>
/// <item><b>Storage</b> is the app copy's own <c>IPushDeviceStore</c> (from its services, so the real Table adapter on the
/// test's own table in Azurite), for a device registered before its account left the allowlist, which the API can no
/// longer reach (design.md § How each scenario is verified, C7b's precedent).</item>
/// <item><b>What arrived</b> is the fake push service's record of the device's push address, each push decrypted with the
/// device's own keys (<see cref="TestDevice.Decrypt"/>) and read as <see cref="PushReceived"/> describes; its
/// <c>TTL</c> as the lifetime in seconds, its <c>Urgency</c> as it is, whether its token passed the fake's checks, and
/// whether the fake accepted it (201) as reaching the phone.</item>
/// </list>
/// Filled in by the wiring groups (tasks.md 3.4, 10.4, 22.1, 25.1, 48.1); until then every method throws.
/// </summary>
public sealed class PushDriver(HttpClient browser, HttpClient owner, FakePushService pushService, IServiceProvider app) {
  /// <summary>The server's public push key (D9).</summary>
  private const string PUSH_KEY = "/api/push/key";

  private const string JSON = "application/json";

  /// <summary>The push key answer's one member (D9).</summary>
  private const string PUBLIC_KEY = "publicKey";

  /// <summary>The signed-in browser.</summary>
  private HttpClient Browser => browser;

  /// <summary>The owner's anonymous client, as PowerShell calls the message endpoint.</summary>
  private HttpClient Owner => owner;

  /// <summary>The fake push service this test's app copy sends to; its message key is the one the owner holds.</summary>
  private FakePushService PushService => pushService;

  /// <summary>The app copy's services, for its device store.</summary>
  private IServiceProvider App => app;

  /// <summary><c>GET /api/push/key</c> in the signed-in browser: the public key, when the answer is exactly <c>{ publicKey }</c>.</summary>
  public async Task<string> AskForThePushKey() {
    using HttpResponseMessage response = await Browser.GetAsync(new Uri(PUSH_KEY, UriKind.Relative));
    string mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
    string body = await response.Content.ReadAsStringAsync();

    string? publicKey = response.StatusCode == HttpStatusCode.OK && IsMediaType(mediaType, JSON) && JsonObjectOrNull(body) is JsonElement answer && answer.EnumerateObject().Count() == 1
      ? Text(answer, PUBLIC_KEY)
      : null;

    return publicKey
      ?? throw new InvalidOperationException($"GET {PUSH_KEY} answered what no push key fits: {(int)response.StatusCode} {response.Content.Headers.ContentType} {body}");
  }

  /// <summary><c>PUT /api/push/subscription</c> in the signed-in browser, with <paramref name="device"/>'s own subscription.</summary>
  public Task<RegistrationAnswer> Register(TestDevice device) => throw new NotImplementedException();

  /// <summary>
  /// <c>PUT /api/push/subscription</c> in the signed-in browser, with <paramref name="pushAddress"/> as the push address and
  /// well-formed keys made up for it (a new P-256 public point and a 16-byte secret), so only the address can be refused.
  /// </summary>
  public Task<RegistrationAnswer> RegisterAt(string pushAddress) => throw new NotImplementedException();

  /// <summary>
  /// <c>PUT /api/push/subscription</c> in the signed-in browser, with <paramref name="device"/>'s push address and public
  /// key, and a secret of <paramref name="bytes"/> made-up random bytes in base64url instead of its own.
  /// </summary>
  public Task<RegistrationAnswer> RegisterWithSecretOfBytes(TestDevice device, int bytes) => throw new NotImplementedException();

  /// <summary><c>DELETE /api/push/subscription</c> in the signed-in browser, naming <paramref name="device"/>'s push address.</summary>
  public Task<ForgetAnswer> Forget(TestDevice device) => throw new NotImplementedException();

  /// <summary><c>POST /api/push/messages</c> from the owner, with the message key, to <paramref name="account"/>; a part not given is left out.</summary>
  public Task<MessageAnswer> SendMessage(string account, string? title, string? text, string? page) => throw new NotImplementedException();

  /// <summary><c>POST /api/push/messages</c> from the owner's client, with a wrong message key, to <paramref name="account"/>, titled <paramref name="title"/>.</summary>
  public Task<WholeAnswer> SendMessageWithAWrongKey(string account, string title) => throw new NotImplementedException();

  /// <summary>The request <see cref="SendMessageWithAWrongKey"/> sent last, sent to an address under <c>/api</c> no endpoint serves; throws when none was sent.</summary>
  public Task<WholeAnswer> SendTheSameToAnUnknownApiAddress() => throw new NotImplementedException();

  /// <summary>Saves <paramref name="device"/> under <paramref name="account"/> through the app copy's own device store, as a registration would have.</summary>
  public Task SaveDeviceFor(TestDevice device, string account) => throw new NotImplementedException();

  /// <summary>Whether the app copy's own device store holds <paramref name="device"/>'s push address, under any account.</summary>
  public Task<bool> IsRegistered(TestDevice device) => throw new NotImplementedException();

  /// <summary>Every push <paramref name="device"/>'s push service received, in the order received, as the device reads it.</summary>
  public IReadOnlyList<PushReceived> PushesReceivedFor(TestDevice device) => throw new NotImplementedException();

  /// <summary>How many requests the fake push service received at all, at any address.</summary>
  public int PushesReceivedAtAll() => throw new NotImplementedException();

  /// <summary>The body as a JSON object, detached from its document; <see langword="null"/> when it is not one.</summary>
  private static JsonElement? JsonObjectOrNull(string body) {
    try {
      using JsonDocument document = JsonDocument.Parse(body);

      return document.RootElement.ValueKind == JsonValueKind.Object ? document.RootElement.Clone() : null;
    }
    catch (JsonException) {
      return null;
    }
  }

  /// <summary>Whether <paramref name="mediaType"/> is <paramref name="expected"/>, ignoring case; a parameter such as <c>charset</c> is not part of it.</summary>
  private static bool IsMediaType(string mediaType, string expected) => string.Equals(mediaType, expected, StringComparison.OrdinalIgnoreCase);

  /// <summary>The member <paramref name="name"/> when it is a JSON string; otherwise <see langword="null"/>.</summary>
  private static string? Text(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.String ? member.GetString() : null;
}