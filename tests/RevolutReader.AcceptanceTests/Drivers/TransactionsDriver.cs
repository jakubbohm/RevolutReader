using RevolutReader.AcceptanceTests.Dsl;

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
/// day shifted onto the clock, and its place within its day in the order given.</item>
/// <item><see cref="DaysTheBankWasAskedFrom"/> reads the <c>date_from</c> of every request for the account's transactions
/// the fake bank received, in order, shifted back to the scenario's calendar.</item>
/// </list>
/// Filled in by the wiring groups; until then every method throws.
/// </summary>
public sealed class TransactionsDriver(HttpClient browser, FakeBank bank, ScenarioCalendar calendar, IServiceProvider app) {
  /// <summary>The signed-in browser.</summary>
  private HttpClient Browser => browser;

  /// <summary>The fake bank this test's app copy reads.</summary>
  private FakeBank Bank => bank;

  /// <summary>The scenario's calendar on the app copy's clock.</summary>
  private ScenarioCalendar Calendar => calendar;

  /// <summary>The app copy's services, for its store.</summary>
  private IServiceProvider App => app;

  /// <summary><c>GET /api/transactions</c> from this user's phone: <c>X-Forwarded-For</c> its address, <c>User-Agent</c> its browser.</summary>
  public Task<TransactionsReading> AskForNewest(UserAtDevice user) => throw new NotImplementedException();

  /// <summary><c>GET /api/transactions</c> with <c>X-Forwarded-For</c> <paramref name="ipAddress"/> and no <c>User-Agent</c>.</summary>
  public Task<TransactionsReading> AskForNewestNamingNoBrowser(string ipAddress) => throw new NotImplementedException();

  /// <summary><c>GET /api/transactions/older?before=</c> the clock's date for <paramref name="before"/>, in the signed-in browser.</summary>
  public Task<TransactionsReading> AskForOlder(DateOnly before) => throw new NotImplementedException();

  /// <summary>The fake bank lists these transactions, in this order, as one page for any <c>date_from</c>, replacing what it listed before.</summary>
  public void BankLists(IReadOnlyList<TransactionAtBank> transactions) => throw new NotImplementedException();

  /// <summary>Keeps these settled transactions in the app copy's own table, through its store.</summary>
  public Task Keep(params IEnumerable<KeptAtApp> transactions) => throw new NotImplementedException();

  /// <summary>The <c>date_from</c> of every transactions request the fake bank received, in order, as the scenario's dates.</summary>
  public IReadOnlyList<DateOnly> DaysTheBankWasAskedFrom() => throw new NotImplementedException();
}