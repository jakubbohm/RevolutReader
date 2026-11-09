using System.Buffers.Text;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.Api.Push;

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

  /// <summary>Where a device is registered and forgotten (D9).</summary>
  private const string SUBSCRIPTION = "/api/push/subscription";

  /// <summary>The owner's message endpoint and its key's header (D10).</summary>
  private const string MESSAGES = "/api/push/messages";
  private const string MESSAGE_KEY = "X-Message-Key";

  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>The problem description's members the driver reads (RFC 9457).</summary>
  private const string TYPE = "type";
  private const string STATUS = "status";

  /// <summary>How each of RFC 9110's types starts, which ASP.NET gives a problem of a plain status.</summary>
  private const string RFC_9110_TYPE = "https://tools.ietf.org/html/rfc9110#section-";

  /// <summary>An address under <c>/api</c> no endpoint serves (D10's comparison).</summary>
  private const string UNKNOWN_API_ADDRESS = "/api/no-such-address";

  /// <summary>A whole answer's body member left out of the comparison, different for every request.</summary>
  private const string TRACE_ID = "traceId";

  /// <summary>A made-up wrong key's length in random bytes, as long as the message key (D10).</summary>
  private const int MESSAGE_KEY_BYTES = 32;

  /// <summary>The fetch metadata the app's own page sends with a write (c007 design.md D4).</summary>
  private const string SEC_FETCH_SITE = "Sec-Fetch-Site";
  private const string SAME_ORIGIN = "same-origin";
  private const string ORIGIN = "Origin";

  /// <summary>The push key answer's one member (D9).</summary>
  private const string PUBLIC_KEY = "publicKey";

  /// <summary>A subscription's members, as <c>PushSubscription.toJSON()</c> names them (D9).</summary>
  private const string ENDPOINT = "endpoint";
  private const string EXPIRATION_TIME = "expirationTime";
  private const string KEYS = "keys";
  private const string P256DH = "p256dh";
  private const string AUTH = "auth";

  /// <summary>The message request's members (D10).</summary>
  private const string ACCOUNT = "account";
  private const string TEXT = "text";
  private const string PAGE = "page";

  /// <summary>The message answer's members (D10).</summary>
  private const string DELIVERED = "delivered";
  private const string FAILED = "failed";
  private const string REMOVED = "removed";

  /// <summary>A Declarative Web Push message's members (D2); <see cref="TITLE"/> is the request's too.</summary>
  private const string WEB_PUSH = "web_push";
  private const int DECLARATIVE_WEB_PUSH = 8030;
  private const string NOTIFICATION = "notification";
  private const string TITLE = "title";
  private const string BODY = "body";
  private const string NAVIGATE = "navigate";

  /// <summary>A push's headers the device reads (RFC 8030 § 5.2, § 5.3).</summary>
  private const string TTL = "TTL";
  private const string URGENCY = "Urgency";

  /// <summary>
  /// The refusals the DSL knows for a message, with the status each case belongs to; the other cases of the class's table
  /// come with the wiring groups that read them.
  /// </summary>
  private static readonly Dictionary<ProblemDescription, HttpStatusCode> _statusByCase = new() {
    [ProblemDescription.PushAccountNotAllowed] = HttpStatusCode.NotFound,
  };

  /// <summary>The signed-in browser.</summary>
  private HttpClient Browser => browser;

  /// <summary>The owner's anonymous client, as PowerShell calls the message endpoint.</summary>
  private HttpClient Owner => owner;

  /// <summary>The fake push service this test's app copy sends to; its message key is the one the owner holds.</summary>
  private FakePushService PushService => pushService;

  /// <summary>The app copy's services, for its device store.</summary>
  private IServiceProvider App => app;

  /// <summary>The app copy's own device store: the real Table adapter on the test's own table in Azurite.</summary>
  private IPushDeviceStore Store => App.GetRequiredService<IPushDeviceStore>();

  /// <summary>The wrong key and the JSON body <see cref="SendMessageWithAWrongKey"/> sent last; <see langword="null"/> before it sent one.</summary>
  private (string Key, string Body)? _lastWrongKeyMessage;

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
  public Task<RegistrationAnswer> Register(TestDevice device) {
    ArgumentNullException.ThrowIfNull(device);

    return RegisterSubscription(device.PushAddress.AbsoluteUri, device.P256dh, device.Auth);
  }

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
  public async Task<MessageAnswer> SendMessage(string account, string? title, string? text, string? page) {
    ArgumentNullException.ThrowIfNull(account);

    Dictionary<string, string> message = new(StringComparer.Ordinal) { [ACCOUNT] = account };

    if (title is not null)
      message[TITLE] = title;

    if (text is not null)
      message[TEXT] = text;

    if (page is not null)
      message[PAGE] = page;

    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(MESSAGES, UriKind.Relative)) { Content = JsonContent.Create(message) };
    request.Headers.Add(MESSAGE_KEY, PushService.MessageKey);

    using HttpResponseMessage response = await Owner.SendAsync(request);

    return await MessageAnswerOf(response, message.Values);
  }

  /// <summary><c>POST /api/push/messages</c> from the owner's client, with a wrong message key, to <paramref name="account"/>, titled <paramref name="title"/>.</summary>
  public Task<WholeAnswer> SendMessageWithAWrongKey(string account, string title) {
    ArgumentNullException.ThrowIfNull(account);
    ArgumentNullException.ThrowIfNull(title);

    (string Key, string Body) message = (WrongMessageKey(), new JsonObject { [ACCOUNT] = account, [TITLE] = title }.ToJsonString());
    _lastWrongKeyMessage = message;

    return SendWithKey(MESSAGES, message.Key, message.Body);
  }

  /// <summary>The request <see cref="SendMessageWithAWrongKey"/> sent last, sent to an address under <c>/api</c> no endpoint serves; throws when none was sent.</summary>
  public Task<WholeAnswer> SendTheSameToAnUnknownApiAddress() {
    (string key, string body) = _lastWrongKeyMessage
      ?? throw new InvalidOperationException($"No message with a wrong key was sent to {MESSAGES} to send again.");

    return SendWithKey(UNKNOWN_API_ADDRESS, key, body);
  }

  /// <summary>Saves <paramref name="device"/> under <paramref name="account"/> through the app copy's own device store, as a registration would have.</summary>
  public Task SaveDeviceFor(TestDevice device, string account) {
    ArgumentNullException.ThrowIfNull(device);
    ArgumentNullException.ThrowIfNull(account);

    return Store.Save(new PushDevice(device.PushAddress.AbsoluteUri, device.P256dh, device.Auth, account), CancellationToken.None);
  }

  /// <summary>Whether the app copy's own device store holds <paramref name="device"/>'s push address, under any account.</summary>
  public async Task<bool> IsRegistered(TestDevice device) {
    ArgumentNullException.ThrowIfNull(device);

    IReadOnlyList<PushDevice> stored = await Store.ReadAll(CancellationToken.None);

    return stored.Any(kept => string.Equals(kept.Endpoint, device.PushAddress.AbsoluteUri, StringComparison.Ordinal));
  }

  /// <summary>Every push <paramref name="device"/>'s push service received, in the order received, as the device reads it.</summary>
  public IReadOnlyList<PushReceived> PushesReceivedFor(TestDevice device) {
    ArgumentNullException.ThrowIfNull(device);

    return [.. PushService.PushesFor(device).Select(push => AsTheDeviceReadsIt(device, push))];
  }

  /// <summary>How many requests the fake push service received at all, at any address.</summary>
  public int PushesReceivedAtAll() => PushService.Pushes().Count;

  /// <summary>
  /// <c>PUT /api/push/subscription</c> in the signed-in browser with a subscription as <c>PushSubscription.toJSON()</c>
  /// gives it, <c>{ "endpoint", "expirationTime": null, "keys": { "p256dh", "auth" } }</c>, and the fetch metadata the
  /// app's own page sends (<c>Sec-Fetch-Site: same-origin</c>, <c>Origin</c> the app's address); read as the class
  /// describes.
  /// </summary>
  private async Task<RegistrationAnswer> RegisterSubscription(string pushAddress, string p256dh, string auth) {
    JsonObject subscription = new() {
      [ENDPOINT] = pushAddress,
      [EXPIRATION_TIME] = null,
      [KEYS] = new JsonObject { [P256DH] = p256dh, [AUTH] = auth },
    };

    using HttpRequestMessage request = new(HttpMethod.Put, new Uri(SUBSCRIPTION, UriKind.Relative)) { Content = JsonContent.Create(subscription) };
    request.Headers.Add(SEC_FETCH_SITE, SAME_ORIGIN);
    request.Headers.Add(ORIGIN, AppOrigin());

    using HttpResponseMessage response = await Browser.SendAsync(request);

    return await RegistrationAnswerOf(response);
  }

  /// <summary>
  /// <c>POST</c> to <paramref name="address"/> from the owner's client, with <paramref name="key"/> as the message key and
  /// <paramref name="body"/> as JSON; read as a <see cref="WholeAnswer"/>.
  /// </summary>
  private async Task<WholeAnswer> SendWithKey(string address, string key, string body) {
    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(address, UriKind.Relative)) {
      Content = new StringContent(body, Encoding.UTF8, JSON),
    };
    request.Headers.Add(MESSAGE_KEY, key);

    using HttpResponseMessage response = await Owner.SendAsync(request);
    await response.Content.LoadIntoBufferAsync();

    ProblemDescription? problem = await ApiDriver.ProblemOf(response);
    string answer = await response.Content.ReadAsStringAsync();

    return new WholeAnswer(problem, $"{(int)response.StatusCode} {response.Content.Headers.ContentType} {WithoutTraceId(answer)}");
  }

  /// <summary>A wrong message key: <see cref="MESSAGE_KEY_BYTES"/> made-up random bytes in base64url, as long as the key and never it.</summary>
  private string WrongMessageKey() {
    string key;

    do
      key = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(MESSAGE_KEY_BYTES));
    while (string.Equals(key, PushService.MessageKey, StringComparison.Ordinal));

    return key;
  }

  /// <summary><paramref name="body"/> without its <c>traceId</c> when it is a JSON object; otherwise as it is.</summary>
  private static string WithoutTraceId(string body) {
    JsonNode? parsed;

    try {
      parsed = JsonNode.Parse(body);
    }
    catch (JsonException) {
      return body;
    }

    if (parsed is not JsonObject answer)
      return body;

    _ = answer.Remove(TRACE_ID);

    return answer.ToJsonString();
  }

  /// <summary>The app's own origin, the signed-in browser's address, as its page's requests name it.</summary>
  private string AppOrigin() =>
    (Browser.BaseAddress ?? throw new InvalidOperationException("The signed-in browser has no address.")).GetLeftPart(UriPartial.Authority);

  /// <summary>The answer as a <see cref="RegistrationAnswer"/>, when its exact shape fits one; otherwise the step fails, naming the answer.</summary>
  private static async Task<RegistrationAnswer> RegistrationAnswerOf(HttpResponseMessage response) {
    string body = await response.Content.ReadAsStringAsync();

    return response.StatusCode == HttpStatusCode.NoContent && body.Length == 0
      ? RegistrationAnswer.Registered
      : throw new InvalidOperationException($"PUT {SUBSCRIPTION} answered what no registration answer fits: {(int)response.StatusCode} {response.Content.Headers.ContentType} {body}");
  }

  /// <summary>
  /// The answer as a <see cref="MessageAnswer"/>, when its exact shape fits one: 200 <c>application/json</c> with exactly
  /// <c>delivered</c>, <c>failed</c> and <c>removed</c>, each a whole number, or a refusal (<see cref="RefusalOf"/>);
  /// otherwise the step fails, naming the answer. A refusal holding any of <paramref name="sentValues"/> fails the step.
  /// </summary>
  private static async Task<MessageAnswer> MessageAnswerOf(HttpResponseMessage response, IReadOnlyCollection<string> sentValues) {
    string mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
    string body = await response.Content.ReadAsStringAsync();
    JsonElement? json = JsonObjectOrNull(body);

    MessageAnswer? answer = response.StatusCode == HttpStatusCode.OK
      ? json is JsonElement counts && IsMediaType(mediaType, JSON) && counts.EnumerateObject().Count() == 3
        && Int(counts, DELIVERED) is int delivered && Int(counts, FAILED) is int failed && Int(counts, REMOVED) is int removed
        ? MessageAnswer.Counts(delivered, failed, removed)
        : null
      : json is JsonElement problem ? RefusalOf(response.StatusCode, mediaType, problem) : null;

    if (answer?.Problem is not null && sentValues.FirstOrDefault(value => body.Contains(value, StringComparison.OrdinalIgnoreCase)) is not null)
      throw new InvalidOperationException($"POST {MESSAGES} answered a refusal that holds a value the request sent: {(int)response.StatusCode} {response.Content.Headers.ContentType} {body}");

    return answer
      ?? throw new InvalidOperationException($"POST {MESSAGES} answered what no message answer fits: {(int)response.StatusCode} {response.Content.Headers.ContentType} {body}");
  }

  /// <summary>
  /// The refusal, when the answer is a problem description of a case in <see cref="_statusByCase"/> with that case's status:
  /// <c>application/problem+json</c>, a body <c>status</c> equal to the response's, a <c>title</c> and a <c>type</c> (RFC
  /// 9110's read as <see langword="null"/>). Otherwise <see langword="null"/>.
  /// </summary>
  private static MessageAnswer? RefusalOf(HttpStatusCode status, string mediaType, JsonElement problem) {
    if (!IsMediaType(mediaType, PROBLEM_JSON) || Int(problem, STATUS) != (int)status)
      return null;

    if (Text(problem, TITLE) is not string title || Text(problem, TYPE) is not string type)
      return null;

    ProblemDescription description = new(title, type.StartsWith(RFC_9110_TYPE, StringComparison.Ordinal) ? null : type);

    return _statusByCase.TryGetValue(description, out HttpStatusCode caseStatus) && caseStatus == status ? MessageAnswer.Refused(description) : null;
  }

  /// <summary>
  /// <paramref name="push"/> as <paramref name="device"/> reads it: its body decrypted with the device's own keys and read
  /// strictly as a Declarative Web Push message, its <c>TTL</c> and <c>Urgency</c> headers, whether its token passed the
  /// fake's checks, and whether the fake accepted it (201). Content that does not decrypt, or is not such a message, fails
  /// the step, naming why.
  /// </summary>
  private static PushReceived AsTheDeviceReadsIt(TestDevice device, ReceivedPush push) {
    string content;

    try {
      content = device.Decrypt(push.Body);
    }
    catch (CryptographicException exception) {
      throw new InvalidOperationException($"A push to {device.Name} does not decrypt with its own keys: {exception.Message}", exception);
    }

    (string title, string? text, string navigate) = DeclarativeMessage(device, content);

    return new PushReceived(
      title,
      text,
      navigate,
      LifetimeSeconds(device, push),
      push.Headers.TryGetValue(URGENCY, out string? urgency) ? urgency : null,
      push.SignedWithServerKey,
      ReachedThePhone: push.Answer == HttpStatusCode.Created);
  }

  /// <summary>
  /// The notification of a Declarative Web Push message: a JSON object of exactly <c>web_push</c>, the number 8030, and
  /// <c>notification</c>, an object of exactly <c>title</c> and <c>navigate</c>, strings, and <c>body</c>, a string, when
  /// there is text. Anything else fails the step, naming why.
  /// </summary>
  private static (string Title, string? Text, string Navigate) DeclarativeMessage(TestDevice device, string content) {
    JsonElement message = JsonObjectOrNull(content)
      ?? throw new InvalidOperationException($"A push to {device.Name} is not a JSON object: {content}");

    if (!HasExactly(message, WEB_PUSH, NOTIFICATION) || !message.GetProperty(WEB_PUSH).TryGetInt32(out int webPush) || webPush != DECLARATIVE_WEB_PUSH)
      throw new InvalidOperationException($"A push to {device.Name} is not a Declarative Web Push message (exactly {WEB_PUSH} {DECLARATIVE_WEB_PUSH} and {NOTIFICATION}): {content}");

    JsonElement notification = message.GetProperty(NOTIFICATION);

    bool wellFormed = notification.ValueKind == JsonValueKind.Object
      && (HasExactly(notification, TITLE, NAVIGATE) || HasExactly(notification, TITLE, BODY, NAVIGATE))
      && notification.EnumerateObject().All(static member => member.Value.ValueKind == JsonValueKind.String);

    return wellFormed && Text(notification, TITLE) is string title && Text(notification, NAVIGATE) is string navigate
      ? (title, Text(notification, BODY), navigate)
      : throw new InvalidOperationException($"A push to {device.Name} has a {NOTIFICATION} other than exactly {TITLE}, {NAVIGATE} and, with text, {BODY}, each a string: {content}");
  }

  /// <summary>The push's <c>TTL</c> in seconds; <see langword="null"/> when it has none. A <c>TTL</c> that is not a whole number fails the step.</summary>
  private static int? LifetimeSeconds(TestDevice device, ReceivedPush push) {
    if (!push.Headers.TryGetValue(TTL, out string? timeToLive))
      return null;

    return int.TryParse(timeToLive, NumberStyles.None, CultureInfo.InvariantCulture, out int seconds)
      ? seconds
      : throw new InvalidOperationException($"A push to {device.Name} has a {TTL} that is not a whole number of seconds: {timeToLive}");
  }

  /// <summary>Whether <paramref name="value"/> is an object with exactly the members <paramref name="names"/>, in any order.</summary>
  private static bool HasExactly(JsonElement value, params string[] names) =>
    value.ValueKind == JsonValueKind.Object
    && value.EnumerateObject().Select(static member => member.Name).Order(StringComparer.Ordinal).SequenceEqual(names.Order(StringComparer.Ordinal), StringComparer.Ordinal);

  /// <summary>The member <paramref name="name"/> when it is a JSON number an <see cref="int"/> holds; otherwise <see langword="null"/>.</summary>
  private static int? Int(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.Number && member.TryGetInt32(out int number) ? number : null;

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