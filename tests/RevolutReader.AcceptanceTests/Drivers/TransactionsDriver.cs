using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.Api.Account;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// The transactions through the API (spec account-transactions, c010 design.md D10, D12), in the signed-in browser: the
/// <see cref="HttpClient"/> <see cref="SignInDriver"/> signs in with, its cookies the login. Status codes, headers, JSON,
/// the store and the fake bank's wire stay here; the DSL gets <see cref="TransactionsReading"/> values and dates of the
/// scenario's calendar. Modelled on C7a's <c>BalanceDriver</c>.
/// <list type="bullet">
/// <item><c>GET /api/transactions</c> carries <c>X-Forwarded-For</c> with the user's address and <c>User-Agent</c> with the
/// user's browser, as the hosting proxy and the browser send them, each added as it is; the request naming no browser
/// leaves out <c>User-Agent</c> only. <c>GET /api/transactions/older?before=</c> sends the day shifted onto the clock, as
/// <c>yyyy-MM-dd</c>.</item>
/// <item>A bank the test set nothing up for lists no transactions: before the first request, an empty page (the capture's
/// shape, <c>continuation_key: null</c>) for any <c>date_from</c>, below every answer the test sets up, so a scenario about
/// the user headers or the read's start needs no list. <see cref="BankLists"/> writes the listed transactions, each day
/// shifted onto the clock, in the capture's shape with the type code as <c>bank_transaction_code.code</c>
/// (<see cref="BankDriver"/>'s), as one page answered for any <c>date_from</c>; it replaces what it listed before.</item>
/// <item>A <see cref="TransactionsReading"/> only when the answer's exact shape fits: a 200 is <c>application/json</c>
/// with exactly <c>transactions</c>, <c>olderBefore</c> (a date or <c>null</c>), <c>czkPerEur</c> and <c>rateDate</c>,
/// and each transaction exactly <c>date</c>, <c>amount</c>, <c>currency</c> (<c>EUR</c>), <c>pending</c>,
/// <c>counterparty</c> (a string or <c>null</c>), <c>details</c> (strings) and <c>kind</c> (a string); dates read as
/// <c>yyyy-MM-dd</c>. <c>date</c> and <c>olderBefore</c> are shifted back to the scenario's calendar; <c>rateDate</c> is
/// C13's fixed date, not a date of the calendar, and stays as answered. A problem as <c>BalanceDriver</c>'s:
/// <c>application/problem+json</c>, a body <c>status</c> equal to the response's, a <c>title</c> and a <c>type</c> (RFC
/// 9110's read as <see langword="null"/>), and the status its case belongs to, by the driver's own table:
/// <see cref="ProblemDescription.BadRequest"/> 400, <see cref="ProblemDescription.BankAccessExpired"/> 503,
/// <see cref="ProblemDescription.BankRateLimited"/> 429, <see cref="ProblemDescription.BankUnavailable"/> 503,
/// <see cref="ProblemDescription.InternalServerError"/> 500 (no members but <c>type</c>, <c>title</c>, <c>status</c> and
/// <c>traceId</c>). Any other answer fails the step, naming it; status codes never reach the DSL.</item>
/// <item><see cref="Keep"/> writes through the app copy's own store (<c>ITransactionStore</c> from its services, so the
/// real Table adapter on the test's own table in Azurite): each transaction settled, with a unique made-up reference, its
/// day shifted onto the clock, and its place within its day in the order given, after those this test kept on that day
/// before.</item>
/// <item><see cref="DaysTheBankWasAskedFrom"/> reads the <c>date_from</c> of every request for the account's transactions
/// the fake bank received, in order, shifted back to the scenario's calendar.</item>
/// </list>
/// <see cref="AskForOlder"/> is filled in by the wiring group of the older pages; until then it throws.
/// </summary>
public sealed class TransactionsDriver(HttpClient browser, FakeBank bank, ScenarioCalendar calendar, IServiceProvider app) {
  /// <summary>The newest page (D10).</summary>
  private const string NEWEST = "/api/transactions";

  /// <summary>The headers the hosting proxy and the browser send, which name the present user (C13).</summary>
  private const string X_FORWARDED_FOR = "X-Forwarded-For";
  private const string USER_AGENT = "User-Agent";

  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>A page's members (D10).</summary>
  private const string TRANSACTIONS = "transactions";
  private const string OLDER_BEFORE = "olderBefore";
  private const string CZK_PER_EUR = "czkPerEur";
  private const string RATE_DATE = "rateDate";

  /// <summary>A transaction's members (D10).</summary>
  private const string DATE = "date";
  private const string AMOUNT = "amount";
  private const string CURRENCY = "currency";
  private const string PENDING = "pending";
  private const string COUNTERPARTY = "counterparty";
  private const string DETAILS = "details";
  private const string KIND = "kind";

  /// <summary>The problem description's members the driver reads (RFC 9457), and the trace id ASP.NET adds.</summary>
  private const string TYPE = "type";
  private const string TITLE = "title";
  private const string STATUS = "status";
  private const string TRACE_ID = "traceId";

  /// <summary>How each of RFC 9110's types starts, which ASP.NET gives a problem of a plain status.</summary>
  private const string RFC_9110_TYPE = "https://tools.ietf.org/html/rfc9110#section-";

  /// <summary>How the answer writes a date.</summary>
  private const string DATE_FORMAT = "yyyy-MM-dd";

  /// <summary>The members of a page and of a transaction in it: exactly these (D10).</summary>
  private const int PAGE_MEMBERS = 4;
  private const int TRANSACTION_MEMBERS = 7;

  /// <summary>The problem descriptions the DSL knows for the transactions, with the status each case belongs to.</summary>
  private static readonly Dictionary<ProblemDescription, HttpStatusCode> _statusByCase = new() {
    [ProblemDescription.BadRequest] = HttpStatusCode.BadRequest,
    [ProblemDescription.BankAccessExpired] = HttpStatusCode.ServiceUnavailable,
    [ProblemDescription.BankRateLimited] = HttpStatusCode.TooManyRequests,
    [ProblemDescription.BankUnavailable] = HttpStatusCode.ServiceUnavailable,
    [ProblemDescription.InternalServerError] = HttpStatusCode.InternalServerError,
  };

  /// <summary>The only members a 500 may have: nothing about the failure (spec api-errors).</summary>
  private static readonly HashSet<string> _internalErrorMembers = new(StringComparer.Ordinal) { TYPE, TITLE, STATUS, TRACE_ID };

  /// <summary>The next place within each day (on the clock) for a transaction <see cref="Keep"/> keeps.</summary>
  private readonly Dictionary<DateOnly, int> _nextPositionOn = [];

  /// <summary>Whether the fake bank already lists no transactions below the test's own answers.</summary>
  private bool _noTransactionsGiven;

  /// <summary><c>GET /api/transactions</c> from this user's phone: <c>X-Forwarded-For</c> its address, <c>User-Agent</c> its browser.</summary>
  public Task<TransactionsReading> AskForNewest(UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    return AskForNewest(user.IpAddress, user.Browser);
  }

  /// <summary><c>GET /api/transactions</c> with <c>X-Forwarded-For</c> <paramref name="ipAddress"/> and no <c>User-Agent</c>.</summary>
  public Task<TransactionsReading> AskForNewestNamingNoBrowser(string ipAddress) {
    ArgumentNullException.ThrowIfNull(ipAddress);

    return AskForNewest(ipAddress, browserName: null);
  }

  /// <summary><c>GET /api/transactions/older?before=</c> the clock's date for <paramref name="before"/>, in the signed-in browser.</summary>
  public Task<TransactionsReading> AskForOlder(DateOnly before) => throw new NotImplementedException();

  /// <summary>The fake bank lists these transactions, in this order, as one page for any <c>date_from</c>, replacing what it listed before.</summary>
  public void BankLists(IReadOnlyList<TransactionAtBank> transactions) {
    ArgumentNullException.ThrowIfNull(transactions);

    ListNoTransactionsBelowEverything();
    bank.AnswerTransactionsForAnyDay(BankDriver.LastPageOf(transactions.Select(transaction => transaction with { Day = calendar.ToClock(transaction.Day) })));
  }

  /// <summary>Keeps these settled transactions in the app copy's own table, through its store.</summary>
  public Task Keep(params IEnumerable<KeptAtApp> transactions) {
    ArgumentNullException.ThrowIfNull(transactions);

    KeptTransaction[] kept = [.. transactions.Select(Kept)];

    return app.GetRequiredService<ITransactionStore>().Keep(kept, CancellationToken.None);
  }

  /// <summary>The <c>date_from</c> of every transactions request the fake bank received, in order, as the scenario's dates.</summary>
  public IReadOnlyList<DateOnly> DaysTheBankWasAskedFrom() => [.. bank.TransactionDaysReceived().Select(calendar.FromClock)];

  /// <summary>
  /// <c>GET /api/transactions</c> in the signed-in browser with <c>X-Forwarded-For</c> <paramref name="ipAddress"/>, and
  /// <c>User-Agent</c> <paramref name="browserName"/> when given, sent as it is; read as the class describes.
  /// </summary>
  private async Task<TransactionsReading> AskForNewest(string ipAddress, string? browserName) {
    ListNoTransactionsBelowEverything();

    using HttpRequestMessage request = new(HttpMethod.Get, new Uri(NEWEST, UriKind.Relative));
    AddAsItIs(request, X_FORWARDED_FOR, ipAddress);

    if (browserName is not null)
      AddAsItIs(request, USER_AGENT, browserName);

    using HttpResponseMessage response = await browser.SendAsync(request);

    return await ReadingOf(response, NEWEST);
  }

  /// <summary>
  /// Once per test, before its first request or list: an empty page for any day as the fake bank's fallback, below every
  /// answer the test sets up (<see cref="FakeBank.AnswerTransactionsForAnyDayByDefault"/>).
  /// </summary>
  private void ListNoTransactionsBelowEverything() {
    if (_noTransactionsGiven)
      return;

    bank.AnswerTransactionsForAnyDayByDefault(BankDriver.LastPageOf([]));
    _noTransactionsGiven = true;
  }

  /// <summary>A kept transaction as the store keeps it: settled, a unique made-up reference, its day on the clock, its place next on that day, in euros, with no details and no type code.</summary>
  private KeptTransaction Kept(KeptAtApp transaction) {
    DateOnly day = calendar.ToClock(transaction.Date);
    int position = _nextPositionOn.GetValueOrDefault(day);
    _nextPositionOn[day] = position + 1;

    return new KeptTransaction(
      $"c010-kept-{Guid.NewGuid():N}",
      day,
      position,
      transaction.Amount,
      TransactionAtBank.DEFAULT_CURRENCY,
      transaction.Counterparty,
      PaymentDetails: [],
      TypeCode: null);
  }

  /// <summary>Adds the header unvalidated, so it goes out exactly as given.</summary>
  private static void AddAsItIs(HttpRequestMessage request, string name, string value) {
    if (!request.Headers.TryAddWithoutValidation(name, value))
      throw new InvalidOperationException($"The request header {name} could not be added.");
  }

  /// <summary>The answer as a <see cref="TransactionsReading"/>, when its exact shape fits one (as the class describes); otherwise the step fails, naming the answer.</summary>
  private async Task<TransactionsReading> ReadingOf(HttpResponseMessage response, string path) {
    string mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
    string body = await response.Content.ReadAsStringAsync();

    TransactionsReading? reading = JsonObjectOrNull(body) is not JsonElement answer ? null
      : response.StatusCode == HttpStatusCode.OK ? PageOf(mediaType, answer)
      : FailureOf(response.StatusCode, mediaType, answer);

    return reading
      ?? throw new InvalidOperationException($"GET {path} answered what no transactions reading fits: {(int)response.StatusCode} {response.Content.Headers.ContentType} {body}");
  }

  /// <summary>
  /// The page, when the answer is <c>application/json</c> with exactly its four members and each transaction exactly its
  /// seven, as the class describes; the dates of the calendar shifted back. Otherwise <see langword="null"/>.
  /// </summary>
  private TransactionsReading? PageOf(string mediaType, JsonElement answer) {
    if (!IsMediaType(mediaType, JSON) || answer.EnumerateObject().Count() != PAGE_MEMBERS)
      return null;

    if (!answer.TryGetProperty(TRANSACTIONS, out JsonElement list) || list.ValueKind != JsonValueKind.Array)
      return null;

    List<TransactionSeenInApi> transactions = [];

    foreach (JsonElement item in list.EnumerateArray()) {
      if (TransactionOf(item) is not TransactionSeenInApi transaction)
        return null;

      transactions.Add(transaction);
    }

    if (!DateOrNull(answer, OLDER_BEFORE, out DateOnly? olderBefore) || Number(answer, CZK_PER_EUR) is not decimal czkPerEur || Date(answer, RATE_DATE) is not DateOnly rateDate)
      return null;

    return TransactionsReading.Of(transactions, olderBefore is DateOnly day ? calendar.FromClock(day) : null, czkPerEur, rateDate);
  }

  /// <summary>A transaction, when it is an object of exactly its seven members, in euros, as the class describes; its date shifted back. Otherwise <see langword="null"/>.</summary>
  private TransactionSeenInApi? TransactionOf(JsonElement item) {
    if (item.ValueKind != JsonValueKind.Object || item.EnumerateObject().Count() != TRANSACTION_MEMBERS)
      return null;

    if (Text(item, CURRENCY) != TransactionAtBank.DEFAULT_CURRENCY || !TextOrNull(item, COUNTERPARTY, out string? counterparty))
      return null;

    return Date(item, DATE) is DateOnly date
      && Number(item, AMOUNT) is decimal amount
      && Bool(item, PENDING) is bool pending
      && Texts(item, DETAILS) is List<string> details
      && Text(item, KIND) is string kind
        ? new TransactionSeenInApi(calendar.FromClock(date), amount, pending, counterparty, new Lines(details), kind)
        : null;
  }

  /// <summary>
  /// The failure, when the answer is a problem description of a case in <see cref="_statusByCase"/> with that case's status:
  /// <c>application/problem+json</c>, a body <c>status</c> equal to the response's, a <c>title</c> and a <c>type</c> (RFC
  /// 9110's read as <see langword="null"/>); a 500 with no members but <see cref="_internalErrorMembers"/>. Otherwise
  /// <see langword="null"/>.
  /// </summary>
  private static TransactionsReading? FailureOf(HttpStatusCode status, string mediaType, JsonElement problem) {
    if (!IsMediaType(mediaType, PROBLEM_JSON) || Int(problem, STATUS) != (int)status)
      return null;

    if (status == HttpStatusCode.InternalServerError && !problem.EnumerateObject().All(static member => _internalErrorMembers.Contains(member.Name)))
      return null;

    if (Text(problem, TITLE) is not string title || Text(problem, TYPE) is not string type)
      return null;

    ProblemDescription description = new(title, type.StartsWith(RFC_9110_TYPE, StringComparison.Ordinal) ? null : type);

    return _statusByCase.TryGetValue(description, out HttpStatusCode caseStatus) && caseStatus == status ? TransactionsReading.Failed(description) : null;
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

  /// <summary>The member <paramref name="name"/> when it is <c>true</c> or <c>false</c>; otherwise <see langword="null"/>.</summary>
  private static bool? Bool(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind is JsonValueKind.True or JsonValueKind.False ? member.GetBoolean() : null;

  /// <summary>The member <paramref name="name"/> when it is a JSON string; otherwise <see langword="null"/>.</summary>
  private static string? Text(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.String ? member.GetString() : null;

  /// <summary>Whether the member <paramref name="name"/> is there and is a JSON string or <c>null</c>; the string, or <see langword="null"/>, in <paramref name="text"/>.</summary>
  private static bool TextOrNull(JsonElement value, string name, out string? text) {
    text = null;

    if (!value.TryGetProperty(name, out JsonElement member))
      return false;

    text = member.ValueKind == JsonValueKind.String ? member.GetString() : null;

    return member.ValueKind is JsonValueKind.String or JsonValueKind.Null;
  }

  /// <summary>The member <paramref name="name"/> when it is a JSON array of strings; otherwise <see langword="null"/>.</summary>
  private static List<string>? Texts(JsonElement value, string name) {
    if (!value.TryGetProperty(name, out JsonElement member) || member.ValueKind != JsonValueKind.Array)
      return null;

    List<string> texts = [];

    foreach (JsonElement line in member.EnumerateArray()) {
      if (line.ValueKind != JsonValueKind.String)
        return null;

      texts.Add(line.GetString()!);
    }

    return texts;
  }

  /// <summary>The member <paramref name="name"/> when it is a JSON string holding a date as <c>yyyy-MM-dd</c>; otherwise <see langword="null"/>.</summary>
  private static DateOnly? Date(JsonElement value, string name) =>
    Text(value, name) is string text && DateOnly.TryParseExact(text, DATE_FORMAT, CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly date) ? date : null;

  /// <summary>Whether the member <paramref name="name"/> is there and is a date as <c>yyyy-MM-dd</c> or <c>null</c>; the date, or <see langword="null"/>, in <paramref name="date"/>.</summary>
  private static bool DateOrNull(JsonElement value, string name, out DateOnly? date) {
    date = null;

    if (!value.TryGetProperty(name, out JsonElement member))
      return false;

    if (member.ValueKind == JsonValueKind.Null)
      return true;

    date = Date(value, name);

    return date is not null;
  }
}