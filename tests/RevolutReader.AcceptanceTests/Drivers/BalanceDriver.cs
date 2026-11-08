using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Asks the app copy for the balance, <c>GET /api/balance</c> (spec account-balance, c009 design.md D1), in the signed-in
/// browser: the <see cref="HttpClient"/> <see cref="SignInDriver"/> signs in with, its cookies the login. Status codes,
/// headers and JSON stay here; the DSL gets a <see cref="BalanceReading"/>.
/// <list type="bullet">
/// <item>Every request carries <c>X-Forwarded-For</c> with the user's address and <c>User-Agent</c> with the user's browser,
/// as the hosting proxy and the browser send them: the in-process server sets no client address and the test client sends
/// no <c>User-Agent</c>, so without them every request would answer 400 (design.md § Risks). The request naming no browser
/// leaves out <c>User-Agent</c> only.</item>
/// <item>A bank the test set nothing up for answers <see cref="BankDsl.DEFAULT_BALANCE"/> EUR, as <see cref="BankDsl"/>
/// does by default: a fallback below every answer a test sets up, so a scenario about the user headers needs no balance.</item>
/// <item>A <see cref="BalanceReading"/> only when the answer's exact shape fits: a 200 has exactly <c>amount</c>,
/// <c>readAt</c> and <c>czkPerEur</c>; a problem has <c>application/problem+json</c>, a body <c>status</c> equal to the
/// response's, and the status its case belongs to (its <c>type</c> as <see cref="ProblemDescription.Type"/>,
/// <see langword="null"/> for RFC 9110's); a 500 has no members but <c>type</c>, <c>title</c>, <c>status</c> and
/// <c>traceId</c>, so nothing about the failure. Any other answer fails the step. <c>readAt</c> is compared as an
/// instant.</item>
/// <item>The status each case belongs to is the driver's own table, as <see cref="ApiDriver"/>'s:
/// <see cref="ProblemDescription.BadRequest"/> 400, <see cref="ProblemDescription.BankAccessExpired"/> 503,
/// <see cref="ProblemDescription.BankRateLimited"/> 429, <see cref="ProblemDescription.BankUnavailable"/> 503,
/// <see cref="ProblemDescription.InternalServerError"/> 500. The answer gives a reading only when its status matches its
/// case; status codes never reach the DSL.</item>
/// </list>
/// Filled in by the wiring groups: <see cref="AskForBalanceNamingNoBrowser"/> and <see cref="BankAnswersAnErrorNoCaseFits"/>
/// still throw until theirs.
/// </summary>
public sealed class BalanceDriver(HttpClient browser, FakeBank bank, FakeTimeProvider clock) {
  /// <summary>The balance (D1).</summary>
  private const string BALANCE = "/api/balance";

  /// <summary>The headers the hosting proxy and the browser send, which name the present user (C13).</summary>
  private const string X_FORWARDED_FOR = "X-Forwarded-For";
  private const string USER_AGENT = "User-Agent";

  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>The balance answer's members (D1).</summary>
  private const string AMOUNT = "amount";
  private const string READ_AT = "readAt";
  private const string CZK_PER_EUR = "czkPerEur";

  /// <summary>The problem description's members the driver reads (RFC 9457), and the trace id ASP.NET adds.</summary>
  private const string TYPE = "type";
  private const string TITLE = "title";
  private const string STATUS = "status";
  private const string TRACE_ID = "traceId";

  /// <summary>How each of RFC 9110's types starts, which ASP.NET gives a problem of a plain status.</summary>
  private const string RFC_9110_TYPE = "https://tools.ietf.org/html/rfc9110#section-";

  /// <summary>The problem descriptions the DSL knows for the balance, with the status each case belongs to.</summary>
  private static readonly Dictionary<ProblemDescription, HttpStatusCode> _statusByCase = new() {
    [ProblemDescription.BadRequest] = HttpStatusCode.BadRequest,
    [ProblemDescription.BankAccessExpired] = HttpStatusCode.ServiceUnavailable,
    [ProblemDescription.BankRateLimited] = HttpStatusCode.TooManyRequests,
    [ProblemDescription.BankUnavailable] = HttpStatusCode.ServiceUnavailable,
    [ProblemDescription.InternalServerError] = HttpStatusCode.InternalServerError,
  };

  /// <summary>The only members a 500 may have: nothing about the failure (spec api-errors).</summary>
  private static readonly HashSet<string> _internalErrorMembers = new(StringComparer.Ordinal) { TYPE, TITLE, STATUS, TRACE_ID };

  /// <summary>Whether the fake bank already has the default balance below the test's own answers.</summary>
  private bool _defaultBalanceGiven;

  /// <summary>The signed-in browser.</summary>
  private HttpClient Browser => browser;

  /// <summary>The fake bank this test's app copy reads.</summary>
  private FakeBank Bank => bank;

  /// <summary>
  /// The app copy's clock (<see cref="FakeMicrosoft.Clock"/>), read as it is: a property may not throw
  /// <see cref="NotImplementedException"/> (CA1065), so this one member is no stub.
  /// </summary>
  public DateTimeOffset Now => clock.GetUtcNow();

  /// <summary><c>GET /api/balance</c> from this user's phone: <c>X-Forwarded-For</c> its address, <c>User-Agent</c> its browser.</summary>
  public Task<BalanceReading> AskForBalance(UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    return Ask(user.IpAddress, user.Browser);
  }

  /// <summary><c>GET /api/balance</c> with <c>X-Forwarded-For</c> <paramref name="ipAddress"/> and no <c>User-Agent</c>.</summary>
  public Task<BalanceReading> AskForBalanceNamingNoBrowser(string ipAddress) => throw new NotImplementedException();

  /// <summary>
  /// Every request: an Enable Banking error answer (<c>ErrorResponse</c>, written from the API reference, with a comment
  /// saying so) whose error code no case maps (c004 design.md D4), so the adapter throws <c>BankReadException</c>.
  /// </summary>
  public void BankAnswersAnErrorNoCaseFits() => throw new NotImplementedException();

  /// <summary>
  /// <c>GET /api/balance</c> in the signed-in browser with <c>X-Forwarded-For</c> <paramref name="ipAddress"/>, and
  /// <c>User-Agent</c> <paramref name="browserName"/> when given, sent as it is; read as the class describes.
  /// </summary>
  private async Task<BalanceReading> Ask(string ipAddress, string? browserName) {
    AnswerTheDefaultBalanceBelowEverything();

    using HttpRequestMessage request = new(HttpMethod.Get, new Uri(BALANCE, UriKind.Relative));
    AddAsItIs(request, X_FORWARDED_FOR, ipAddress);

    if (browserName is not null)
      AddAsItIs(request, USER_AGENT, browserName);

    using HttpResponseMessage response = await Browser.SendAsync(request);

    return await ReadingOf(response);
  }

  /// <summary>
  /// Once per test, before its first request: the default balance (<see cref="BankDsl.DEFAULT_BALANCE"/> EUR) as the fake
  /// bank's fallback, below every answer the test sets up (<see cref="FakeBank.AnswerBalancesByDefault"/>).
  /// </summary>
  private void AnswerTheDefaultBalanceBelowEverything() {
    if (_defaultBalanceGiven)
      return;

    Bank.AnswerBalancesByDefault(BankDriver.BalancesJson(BankDsl.DEFAULT_BALANCE, TransactionAtBank.DEFAULT_CURRENCY));
    _defaultBalanceGiven = true;
  }

  /// <summary>Adds the header unvalidated, so it goes out exactly as given.</summary>
  private static void AddAsItIs(HttpRequestMessage request, string name, string value) {
    if (!request.Headers.TryAddWithoutValidation(name, value))
      throw new InvalidOperationException($"The request header {name} could not be added.");
  }

  /// <summary>The answer as a <see cref="BalanceReading"/>, when its exact shape fits one (as the class describes); otherwise the step fails, naming the answer.</summary>
  private static async Task<BalanceReading> ReadingOf(HttpResponseMessage response) {
    string mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
    string body = await response.Content.ReadAsStringAsync();

    BalanceReading? reading = JsonObjectOrNull(body) is not JsonElement answer ? null
      : response.StatusCode == HttpStatusCode.OK ? BalanceOf(mediaType, answer)
      : FailureOf(response.StatusCode, mediaType, answer);

    return reading
      ?? throw new InvalidOperationException($"GET {BALANCE} answered what no balance reading fits: {(int)response.StatusCode} {response.Content.Headers.ContentType} {body}");
  }

  /// <summary>
  /// The balance, when the answer is <c>application/json</c> with exactly <c>amount</c> and <c>czkPerEur</c> as numbers and
  /// <c>readAt</c> as a date and time; the read time as an instant (in UTC). Otherwise <see langword="null"/>.
  /// </summary>
  private static BalanceReading? BalanceOf(string mediaType, JsonElement answer) {
    if (!IsMediaType(mediaType, JSON) || answer.EnumerateObject().Count() != 3)
      return null;

    return Number(answer, AMOUNT) is decimal amount && Instant(answer, READ_AT) is DateTimeOffset readAt && Number(answer, CZK_PER_EUR) is decimal czkPerEur
      ? BalanceReading.Of(amount, readAt.ToUniversalTime(), czkPerEur)
      : null;
  }

  /// <summary>
  /// The failure, when the answer is a problem description of a case in <see cref="_statusByCase"/> with that case's status:
  /// <c>application/problem+json</c>, a body <c>status</c> equal to the response's, a <c>title</c> and a <c>type</c> (RFC
  /// 9110's read as <see langword="null"/>); a 500 with no members but <see cref="_internalErrorMembers"/>. Otherwise
  /// <see langword="null"/>.
  /// </summary>
  private static BalanceReading? FailureOf(HttpStatusCode status, string mediaType, JsonElement problem) {
    if (!IsMediaType(mediaType, PROBLEM_JSON) || Int(problem, STATUS) != (int)status)
      return null;

    if (status == HttpStatusCode.InternalServerError && !problem.EnumerateObject().All(static member => _internalErrorMembers.Contains(member.Name)))
      return null;

    if (Text(problem, TITLE) is not string title || Text(problem, TYPE) is not string type)
      return null;

    ProblemDescription description = new(title, type.StartsWith(RFC_9110_TYPE, StringComparison.Ordinal) ? null : type);

    return _statusByCase.TryGetValue(description, out HttpStatusCode caseStatus) && caseStatus == status ? BalanceReading.Failed(description) : null;
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

  /// <summary>The member <paramref name="name"/> when it is a JSON number a <see cref="decimal"/> holds; otherwise <see langword="null"/>.</summary>
  private static decimal? Number(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.Number && member.TryGetDecimal(out decimal number) ? number : null;

  /// <summary>The member <paramref name="name"/> when it is a JSON number an <see cref="int"/> holds; otherwise <see langword="null"/>.</summary>
  private static int? Int(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.Number && member.TryGetInt32(out int number) ? number : null;

  /// <summary>The member <paramref name="name"/> when it is a JSON string holding an ISO 8601 date and time; otherwise <see langword="null"/>.</summary>
  private static DateTimeOffset? Instant(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.String && member.TryGetDateTimeOffset(out DateTimeOffset instant) ? instant : null;

  /// <summary>The member <paramref name="name"/> when it is a JSON string; otherwise <see langword="null"/>.</summary>
  private static string? Text(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.String ? member.GetString() : null;
}