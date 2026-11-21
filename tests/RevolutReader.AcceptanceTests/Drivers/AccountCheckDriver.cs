using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// The account check through the API (spec account-check; c014 design.md D6–D8, D11, D16). Status codes, headers, JSON, the
/// app copy's services and the fake bank's held answer stay here; the DSL gets <see cref="CheckAnswer"/> and
/// <see cref="WholeAnswer"/> values. Modelled on <see cref="BalanceDriver"/> and <see cref="PushDriver"/>.
/// <list type="bullet">
/// <item><b>The key</b>: every app copy gets a made-up check key, new for every test (<see cref="NewKey"/>: 32 random bytes,
/// base64url without padding, as the real one), written into <c>AccountCheck:Key</c> by <see cref="Configure"/> next to the
/// fake bank's and the fake push service's settings, so the app starts whether or not the test asks for a check.</item>
/// <item><b>The phone</b> is the owner's iPhone Shortcut: an anonymous <see cref="HttpClient"/>, as Apple's URL loading
/// sends a request (D6): <c>POST /api/account/check</c> with <c>X-Check-Key</c> the test's key, <c>User-Agent</c> the
/// phone's browser name and <c>X-Forwarded-For</c> its address (the harness takes the client address from it, c009's
/// probe), no body, no fetch metadata (<c>Sec-Fetch-*</c>) and no <c>Origin</c>. A call naming no browser leaves out
/// <c>User-Agent</c> only. A bank the test set nothing up for answers <see cref="BankDsl.DEFAULT_BALANCE"/> EUR, as
/// <see cref="BalanceDriver"/> does: a fallback below every answer the test sets up, so a scenario about the phone's
/// headers needs no balance.</item>
/// <item><b>Exact shapes</b>, any other answer failing the step, naming it: 200 <c>application/json</c> with exactly
/// <c>changed</c>, a JSON boolean (<see cref="CheckAnswer.BalanceChanged"/>, <see cref="CheckAnswer.NothingChanged"/>); a
/// problem as <see cref="BalanceDriver"/> reads one, with the status its case belongs to by the driver's own table:
/// <see cref="ProblemDescription.BadRequest"/> 400, <see cref="ProblemDescription.BankAccessExpired"/> 503,
/// <see cref="ProblemDescription.BankRateLimited"/> 429, <see cref="ProblemDescription.BankUnavailable"/> 503,
/// <see cref="ProblemDescription.InternalServerError"/> 500 (no members but <c>type</c>, <c>title</c>, <c>status</c> and
/// <c>traceId</c>).</item>
/// <item><b>A wrong key</b>: the phone's request with <c>X-Check-Key</c> 32 made-up random bytes in base64url, as long as
/// the key and never it, read as a <see cref="WholeAnswer"/> as <see cref="PushDriver"/> reads one (the status, the content
/// type and the body without its <c>traceId</c>). <see cref="SendTheSameToAnUnknownApiAddress"/> sends the request
/// <see cref="CheckWithAWrongKey"/> sent last, the same method and headers, to <c>/api/no-such-address</c>.</item>
/// <item><b>The kept balances</b> are written and read through the app copy's own <c>ICheckedBalanceStore</c> (from its
/// services: the real Table adapter on the test's own table in Azurite; D16), each balance whole: its amount, read time and
/// rate. Never made by an earlier check, which would add a request at the bank.</item>
/// <item><b>A burst</b> (D16): the bank's next balance answer held (<see cref="FakeBank.HoldTheNextBalanceAnswer"/>), the
/// first call sent, its request at the bank awaited (<see cref="FakeBank.WaitUntilTheHeldRequestArrives"/>), the other calls
/// sent, then a bounded wait on the real clock until <c>AccountCheckQueue.CallersWaiting</c>, read through the app copy's
/// services, counts them all, the bank released, and every call's answer, in the order sent.</item>
/// <item><b>A caller that stops waiting</b> (D16): the bank's next balance answer held, the call sent with a cancellation
/// token of its own, its request at the bank awaited, the call cancelled and its end awaited, the bank released. What the
/// check sends afterwards the scenario awaits itself (<see cref="PushDsl.Eventually"/>).</item>
/// </list>
/// Filled in by the wiring groups (tasks.md 3.4, 5.1, 10.2, 16.1, 36.1, 39.1); until then every method that calls the app
/// or reads its services throws. The key and the clock are real now (tasks.md 1.1), and so are the wrong key's two calls
/// (tasks.md 3.4) and the call naming no browser, read with the exact shapes above (tasks.md 5.1).
/// </summary>
public sealed class AccountCheckDriver(HttpClient anonymous, FakeBank bank, FakeTimeProvider clock, IServiceProvider app, string key) {
  /// <summary>The settings section the check's key is bound to (D6).</summary>
  private const string SECTION = "AccountCheck";

  /// <summary>The check key's size (D6): 32 random bytes, as the message key's.</summary>
  private const int KEY_BYTES = 32;

  /// <summary>The check endpoint and its key's header (D6).</summary>
  private const string CHECK = "/api/account/check";
  private const string KEY_HEADER = "X-Check-Key";

  /// <summary>The headers the hosting proxy and the phone send, which name the present user (C13, D7).</summary>
  private const string X_FORWARDED_FOR = "X-Forwarded-For";
  private const string USER_AGENT = "User-Agent";

  /// <summary>An address under <c>/api</c> no endpoint serves (D6's comparison).</summary>
  private const string UNKNOWN_API_ADDRESS = "/api/no-such-address";

  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>The check answer's one member (D11).</summary>
  private const string CHANGED = "changed";

  /// <summary>
  /// The problem description's members the driver reads (RFC 9457), and the trace id ASP.NET adds, which a whole answer
  /// leaves out of the comparison: it differs for every request.
  /// </summary>
  private const string TYPE = "type";
  private const string TITLE = "title";
  private const string STATUS = "status";
  private const string TRACE_ID = "traceId";

  /// <summary>How each of RFC 9110's types starts, which ASP.NET gives a problem of a plain status.</summary>
  private const string RFC_9110_TYPE = "https://tools.ietf.org/html/rfc9110#section-";

  /// <summary>The problem descriptions the DSL knows for a check, with the status each case belongs to (as <see cref="BalanceDriver"/>'s, D11).</summary>
  private static readonly Dictionary<ProblemDescription, HttpStatusCode> _statusByCase = new() {
    [ProblemDescription.BadRequest] = HttpStatusCode.BadRequest,
    [ProblemDescription.BankAccessExpired] = HttpStatusCode.ServiceUnavailable,
    [ProblemDescription.BankRateLimited] = HttpStatusCode.TooManyRequests,
    [ProblemDescription.BankUnavailable] = HttpStatusCode.ServiceUnavailable,
    [ProblemDescription.InternalServerError] = HttpStatusCode.InternalServerError,
  };

  /// <summary>The only members a 500 may have: nothing about the failure (spec api-errors).</summary>
  private static readonly HashSet<string> _internalErrorMembers = new(StringComparer.Ordinal) { TYPE, TITLE, STATUS, TRACE_ID };

  /// <summary>The wrong key and the phone <see cref="CheckWithAWrongKey"/> sent last; <see langword="null"/> before it sent one.</summary>
  private (string WrongKey, UserAtDevice Phone)? _lastWrongKeyCheck;

  /// <summary>Whether the fake bank already has the default balance below the test's own answers.</summary>
  private bool _defaultBalanceGiven;

  /// <summary>
  /// The app copy's clock (<see cref="FakeMicrosoft.Clock"/>), read as it is: a property may not throw
  /// <see cref="NotImplementedException"/> (CA1065), so this one member is no stub.
  /// </summary>
  public DateTimeOffset Now => clock.GetUtcNow();

  /// <summary>The phone's anonymous client, as the Shortcut calls the check endpoint.</summary>
  internal HttpClient Phone => anonymous;

  /// <summary>The fake bank this test's app copy reads, whose balance answer a burst and a caller that stops waiting hold.</summary>
  internal FakeBank Bank => bank;

  /// <summary>The app copy's services, for its store of the check's balances and the check queue's count of waiting callers.</summary>
  internal IServiceProvider App => app;

  /// <summary>This test's check key, the one the app copy is configured with (<see cref="Configure"/>).</summary>
  internal string Key => key;

  /// <summary>A new made-up check key: 32 random bytes in base64url without padding (D6), never a real one.</summary>
  public static string NewKey() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(KEY_BYTES));

  /// <summary>
  /// Writes <paramref name="key"/> into the app copy's <c>AccountCheck:Key</c>, as the last configuration source, so it wins
  /// over <c>appsettings.json</c> (whose secret is <c>"&lt;secret&gt;"</c>), as <see cref="FakePushService.Configure"/>
  /// writes the push settings.
  /// </summary>
  public static void Configure(IWebHostBuilder builder, string key) {
    ArgumentNullException.ThrowIfNull(builder);
    ArgumentException.ThrowIfNullOrWhiteSpace(key);

    Dictionary<string, string?> settings = new() { [$"{SECTION}:Key"] = key };

    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
  }

  /// <summary><c>POST /api/account/check</c> from <paramref name="phone"/> with the check key: its address and its browser name.</summary>
  public Task<CheckAnswer> Check(UserAtDevice phone) => throw new NotImplementedException();

  /// <summary><c>POST /api/account/check</c> with the check key and <c>X-Forwarded-For</c> <paramref name="ipAddress"/>, but no <c>User-Agent</c>.</summary>
  public Task<CheckAnswer> CheckNamingNoBrowser(string ipAddress) {
    ArgumentNullException.ThrowIfNull(ipAddress);

    return SendCheck(ipAddress, browserName: null);
  }

  /// <summary><c>POST /api/account/check</c> from <paramref name="phone"/>, with a wrong check key.</summary>
  public Task<WholeAnswer> CheckWithAWrongKey(UserAtDevice phone) {
    ArgumentNullException.ThrowIfNull(phone);

    (string WrongKey, UserAtDevice Phone) check = (WrongKey(), phone);
    _lastWrongKeyCheck = check;

    return SendWithKey(CHECK, check.WrongKey, check.Phone);
  }

  /// <summary>The request <see cref="CheckWithAWrongKey"/> sent last, sent to an address under <c>/api</c> no endpoint serves; throws when none was sent.</summary>
  public Task<WholeAnswer> SendTheSameToAnUnknownApiAddress() {
    (string wrongKey, UserAtDevice phone) = _lastWrongKeyCheck
      ?? throw new InvalidOperationException($"No check with a wrong key was sent to {CHECK} to send again.");

    return SendWithKey(UNKNOWN_API_ADDRESS, wrongKey, phone);
  }

  /// <summary>Whether the app copy's store holds any of the check's balances.</summary>
  public Task<bool> KeepsAnyBalance() => throw new NotImplementedException();

  /// <summary>
  /// Writes the check's two balances into the app copy's store, replacing what it held: last seen
  /// <paramref name="lastSeen"/> EUR read at <paramref name="lastSeenReadAt"/>, last notified <paramref name="lastNotified"/>
  /// EUR read at <paramref name="lastNotifiedReadAt"/>, both at <paramref name="czkPerEur"/> koruna per euro.
  /// </summary>
  public Task Keep(decimal lastSeen, DateTimeOffset lastSeenReadAt, decimal lastNotified, DateTimeOffset lastNotifiedReadAt, decimal czkPerEur) =>
    throw new NotImplementedException();

  /// <summary>
  /// A check from <paramref name="phone"/>, and <paramref name="checks"/> more from it while the first is still reading the
  /// bank, lined up as the class describes; every call's answer, the first first.
  /// </summary>
  public Task<IReadOnlyList<CheckAnswer>> ChecksWhileTheFirstReadsTheBank(UserAtDevice phone, int checks) => throw new NotImplementedException();

  /// <summary>A check from <paramref name="phone"/>, whose call is cancelled while the check is still reading the bank, as the class describes.</summary>
  public Task CheckThenStopWaitingWhileTheBankReads(UserAtDevice phone) => throw new NotImplementedException();

  /// <summary>
  /// <c>POST /api/account/check</c> from the phone's anonymous client with the test's check key, <c>X-Forwarded-For</c>
  /// <paramref name="ipAddress"/> and, when given, <c>User-Agent</c> <paramref name="browserName"/>; the default balance
  /// below everything first; read as a <see cref="CheckAnswer"/> (<see cref="CheckAnswerOf"/>).
  /// </summary>
  private async Task<CheckAnswer> SendCheck(string ipAddress, string? browserName) {
    AnswerTheDefaultBalanceBelowEverything();

    using HttpRequestMessage request = CheckRequest(CHECK, Key, ipAddress, browserName);
    using HttpResponseMessage response = await Phone.SendAsync(request);

    return await CheckAnswerOf(response);
  }

  /// <summary>
  /// <c>POST</c> to <paramref name="address"/> from the phone's anonymous client with <paramref name="checkKey"/> and
  /// <paramref name="phone"/>'s address and browser name; read as a <see cref="WholeAnswer"/>: the problem description as
  /// <see cref="ApiDriver"/> reads one, and the status, the content type and the body without its <c>traceId</c>, as text.
  /// </summary>
  private async Task<WholeAnswer> SendWithKey(string address, string checkKey, UserAtDevice phone) {
    using HttpRequestMessage request = CheckRequest(address, checkKey, phone.IpAddress, phone.Browser);
    using HttpResponseMessage response = await Phone.SendAsync(request);
    await response.Content.LoadIntoBufferAsync();

    ProblemDescription? problem = await ApiDriver.ProblemOf(response);
    string answer = await response.Content.ReadAsStringAsync();

    return new WholeAnswer(problem, $"{(int)response.StatusCode} {response.Content.Headers.ContentType} {WithoutTraceId(answer)}");
  }

  /// <summary>
  /// A <c>POST</c> to <paramref name="address"/> as the Shortcut sends it (the class describes it): no body,
  /// <c>X-Check-Key</c> <paramref name="checkKey"/>, <c>X-Forwarded-For</c> <paramref name="ipAddress"/> and, when given,
  /// <c>User-Agent</c> <paramref name="browserName"/>, each sent as it is; no fetch metadata and no <c>Origin</c>. A request
  /// naming no browser fails the step when the phone's client would add a <c>User-Agent</c> of its own.
  /// </summary>
  private HttpRequestMessage CheckRequest(string address, string checkKey, string ipAddress, string? browserName) {
    if (browserName is null && Phone.DefaultRequestHeaders.Contains(USER_AGENT))
      throw new InvalidOperationException($"The phone's client sends a {USER_AGENT} of its own, so a request naming no browser would name one.");

    HttpRequestMessage request = new(HttpMethod.Post, new Uri(address, UriKind.Relative));
    AddAsItIs(request, KEY_HEADER, checkKey);
    AddAsItIs(request, X_FORWARDED_FOR, ipAddress);

    if (browserName is not null)
      AddAsItIs(request, USER_AGENT, browserName);

    return request;
  }

  /// <summary>
  /// Once per test, before its first check: the default balance (<see cref="BankDsl.DEFAULT_BALANCE"/> EUR) as the fake
  /// bank's fallback, below every answer the test sets up (<see cref="FakeBank.AnswerBalancesByDefault"/>), as
  /// <see cref="BalanceDriver"/> gives it.
  /// </summary>
  private void AnswerTheDefaultBalanceBelowEverything() {
    if (_defaultBalanceGiven)
      return;

    Bank.AnswerBalancesByDefault(BankDriver.BalancesJson(BankDsl.DEFAULT_BALANCE, TransactionAtBank.DEFAULT_CURRENCY));
    _defaultBalanceGiven = true;
  }

  /// <summary>
  /// The answer as a <see cref="CheckAnswer"/>, when its exact shape fits one: 200 <c>application/json</c> with exactly
  /// <c>changed</c>, a JSON boolean (<see cref="ChangeOf"/>), or a problem of a case the driver knows (<see cref="FailureOf"/>);
  /// otherwise the step fails, naming the answer.
  /// </summary>
  private static async Task<CheckAnswer> CheckAnswerOf(HttpResponseMessage response) {
    string mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
    string body = await response.Content.ReadAsStringAsync();

    CheckAnswer? answer = JsonObjectOrNull(body) is not JsonElement json ? null
      : response.StatusCode == HttpStatusCode.OK ? ChangeOf(mediaType, json)
      : FailureOf(response.StatusCode, mediaType, json);

    return answer
      ?? throw new InvalidOperationException($"POST {CHECK} answered what no check answer fits: {(int)response.StatusCode} {response.Content.Headers.ContentType} {body}");
  }

  /// <summary>
  /// Whether the balance changed, when the answer is <c>application/json</c> with exactly <c>changed</c>, a JSON boolean:
  /// <see cref="CheckAnswer.BalanceChanged"/> or <see cref="CheckAnswer.NothingChanged"/>. Otherwise <see langword="null"/>.
  /// </summary>
  private static CheckAnswer? ChangeOf(string mediaType, JsonElement answer) {
    if (!IsMediaType(mediaType, JSON) || answer.EnumerateObject().Count() != 1 || !answer.TryGetProperty(CHANGED, out JsonElement changed))
      return null;

    return changed.ValueKind switch {
      JsonValueKind.True => CheckAnswer.BalanceChanged,
      JsonValueKind.False => CheckAnswer.NothingChanged,
      _ => null,
    };
  }

  /// <summary>
  /// The failure, when the answer is a problem description of a case in <see cref="_statusByCase"/> with that case's status:
  /// <c>application/problem+json</c>, a body <c>status</c> equal to the response's, a <c>title</c> and a <c>type</c> (RFC
  /// 9110's read as <see langword="null"/>); a 500 with no members but <see cref="_internalErrorMembers"/>. Otherwise
  /// <see langword="null"/>.
  /// </summary>
  private static CheckAnswer? FailureOf(HttpStatusCode status, string mediaType, JsonElement problem) {
    if (!IsMediaType(mediaType, PROBLEM_JSON) || Int(problem, STATUS) != (int)status)
      return null;

    if (status == HttpStatusCode.InternalServerError && !problem.EnumerateObject().All(static member => _internalErrorMembers.Contains(member.Name)))
      return null;

    if (Text(problem, TITLE) is not string title || Text(problem, TYPE) is not string type)
      return null;

    ProblemDescription description = new(title, type.StartsWith(RFC_9110_TYPE, StringComparison.Ordinal) ? null : type);

    return _statusByCase.TryGetValue(description, out HttpStatusCode caseStatus) && caseStatus == status ? CheckAnswer.Failed(description) : null;
  }

  /// <summary>A wrong check key: <see cref="KEY_BYTES"/> made-up random bytes in base64url, as long as the key and never it.</summary>
  private string WrongKey() {
    string wrongKey;

    do
      wrongKey = NewKey();
    while (string.Equals(wrongKey, Key, StringComparison.Ordinal));

    return wrongKey;
  }

  /// <summary>Adds the header unvalidated, so it goes out exactly as given.</summary>
  private static void AddAsItIs(HttpRequestMessage request, string name, string value) {
    if (!request.Headers.TryAddWithoutValidation(name, value))
      throw new InvalidOperationException($"The request header {name} could not be added.");
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

  /// <summary>The member <paramref name="name"/> when it is a JSON number an <see cref="int"/> holds; otherwise <see langword="null"/>.</summary>
  private static int? Int(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.Number && member.TryGetInt32(out int number) ? number : null;

  /// <summary>The member <paramref name="name"/> when it is a JSON string; otherwise <see langword="null"/>.</summary>
  private static string? Text(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.String ? member.GetString() : null;
}