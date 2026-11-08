using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.Api.Bank;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Drives the app's bank port (spec bank-reads, c004 design.md D1): takes <see cref="IBankAccount"/> from the test's own
/// app copy, so the reads run on the production wiring (settings, <c>HttpClient</c> with the bank client's retries, at a
/// zero wait: <see cref="FakeBank.RetryDelay"/>) against <see cref="FakeBank"/>. Turns the DSL's facts into the fake bank's
/// answers, and the port's results into DSL answers.
/// <list type="bullet">
/// <item>A <see cref="BankResult{T}"/> becomes the answer's outcome: the value is <see cref="BankOutcome.Read"/>, each
/// failure its own outcome, with no value.</item>
/// <item>A <see cref="BankTransaction"/> becomes a <see cref="TransactionSeen"/> field by field; booked is
/// <see cref="TransactionSeen.STATUS_BOOKED"/>, pending <see cref="TransactionSeen.STATUS_PENDING"/>.</item>
/// <item>A received request's user headers are <c>Psu-Ip-Address</c> and <c>Psu-User-Agent</c>; a request carrying no
/// <c>Psu-*</c> header at all has none (<see cref="RequestAtBank.WithoutUserHeaders"/>).</item>
/// </list>
/// </summary>
public sealed class BankDriver(FakeBank bank, IServiceProvider services) {
  /// <summary>As the API reference writes a calendar date.</summary>
  private const string DATE = "yyyy-MM-dd";

  /// <summary>The user headers (c004 design.md D2); any header with the prefix makes a request carry user headers.</summary>
  private const string USER_HEADER_PREFIX = "Psu-";
  private const string USER_IP_ADDRESS = "Psu-Ip-Address";
  private const string USER_AGENT = "Psu-User-Agent";

  /// <summary>
  /// The bank's own error. Written from the API reference (<c>ErrorResponse</c>, error code <c>ASPSP_ERROR</c>), not
  /// captured: the Mock ASPSP cannot fail on demand. The reference does not say which status comes with the code; 502 Bad
  /// Gateway is chosen (<see cref="OWN_ERROR_STATUS"/>), as HTTP's status for an upstream server (here the bank behind
  /// Enable Banking) failing. The message text is made up.
  /// </summary>
  private const string OWN_ERROR = """
    {
      "code": 502,
      "message": "Error interacting with the bank",
      "error": "ASPSP_ERROR",
      "detail": null
    }
    """;

  private const HttpStatusCode OWN_ERROR_STATUS = HttpStatusCode.BadGateway;

  /// <summary>
  /// A gateway's maintenance page: what a proxy or load balancer in front of Enable Banking answers during an outage,
  /// with 503 (<see cref="MAINTENANCE_PAGE_STATUS"/>), as <c>text/html</c>, and no Enable Banking error body, so no error
  /// code (spec bank-reads § Bank unavailable, c006 design.md D3). Written from a typical gateway page, made up and with
  /// no vendor's name, not captured: the Mock ASPSP cannot produce it.
  /// </summary>
  private const string MAINTENANCE_PAGE = """
    <!DOCTYPE html>
    <html>
    <head><title>503 Service Temporarily Unavailable</title></head>
    <body>
    <h1>503 Service Temporarily Unavailable</h1>
    <p>The service is down for maintenance. Please try again later.</p>
    </body>
    </html>
    """;

  private const HttpStatusCode MAINTENANCE_PAGE_STATUS = HttpStatusCode.ServiceUnavailable;

  /// <summary>
  /// The booked and pending transactions of the Mock ASPSP capture <c>spikes/enable-banking-mock/evidence/2026-11-06-account1-transactions.json</c>
  /// (made-up data, design.md § Bootstrap), copied in its order with their values as captured; its one cancelled
  /// (<c>c004-c05</c>) and one rejected (<c>c004-r07</c>) transaction are left out, as a read leaves them out.
  /// </summary>
  private static readonly WireTransaction[] _captured = [
    new("PDNG", "DBIT", null, "8.90", "EUR", "Kavárna Na Rohu", null, null, null, "2026-11-06", ["Kavárna Na Rohu"]),
    new("BOOK", "CRDT", "c004-b03", "50.00", "EUR", null, "Jan Novák", "2026-11-05", "2026-11-05", null, ["Kapesné listopad"]),
    new("PDNG", "DBIT", "c004-p02", "23.40", "EUR", "Lékárna Pod Věží", null, null, null, "2026-11-05", ["Lékárna Pod Věží"]),
    new("BOOK", "DBIT", "c004-b04", "12.30", "EUR", "Pekárna U Lípy", null, "2026-11-04", "2026-11-05", null, ["Pekárna U Lípy", "Praha 2"]),
    new("BOOK", "DBIT", "c004-b06", "4.20", "EUR", "Trafika U Mostu", null, "2026-11-03", "2026-11-04", null, ["Trafika U Mostu"]),
    new("BOOK", "DBIT", "c004-b08", "31.75", "EUR", null, null, "2026-11-01", "2026-11-01", null, []),
    new("BOOK", "DBIT", "c004-b09", "9.99", "EUR", "Hudba Online", null, "2026-10-31", "2026-10-31", null, ["Hudba Online", "Předplatné"]),
    new("BOOK", "DBIT", "c004-b10", "18.60", "EUR", "Pizzerie Sole", null, "2026-10-30", "2026-10-31", null, ["Pizzerie Sole"]),
    new("BOOK", "CRDT", "c004-b11", "15.00", "EUR", null, "Eva Nováková", "2026-10-29", "2026-10-29", null, ["Vrácení za lístky"]),
    new("BOOK", "DBIT", "c004-b12", "6.50", "EUR", "Kavárna Na Rohu", null, "2026-10-28", "2026-10-28", null, ["Kavárna Na Rohu"]),
    new("BOOK", "DBIT", "c004-b13", "42.00", "EUR", "Sportovní hala Výšina", null, "2026-10-27", "2026-10-28", null, ["Sportovní hala Výšina"]),
    new("BOOK", "DBIT", "c004-b14", "3.10", "EUR", "Trafika U Mostu", null, "2026-10-26", "2026-10-26", null, ["Trafika U Mostu"]),
    new("BOOK", "DBIT", "c004-b15", "27.80", "EUR", "Potraviny U Kašny", null, "2026-10-25", "2026-10-25", null, ["Potraviny U Kašny"]),
    new("BOOK", "DBIT", "c004-b16", "11.40", "EUR", "Pekárna U Lípy", null, "2026-10-24", "2026-10-24", null, ["Pekárna U Lípy"]),
    new("BOOK", "DBIT", "c004-b17", "64.90", "EUR", "Obuv Krok", null, "2026-10-23", "2026-10-24", "2026-10-22", ["Obuv Krok"]),
    new("BOOK", "DBIT", "c004-b18", "7.20", "EUR", "Kavárna Na Rohu", null, "2026-10-21", "2026-10-21", null, ["Kavárna Na Rohu"]),
    new("BOOK", "DBIT", "c004-b19", "19.90", "EUR", "Knihkupectví Stránka", null, "2026-10-19", "2026-10-19", null, ["Knihkupectví Stránka"]),
    new("BOOK", "DBIT", "c004-b20", "5.60", "EUR", "Trafika U Mostu", null, "2026-10-17", "2026-10-17", null, ["Trafika U Mostu"]),
    new("BOOK", "CRDT", "c004-b21", "50.00", "EUR", null, "Jan Novák", "2026-10-15", "2026-10-15", null, ["Kapesné říjen"]),
    new("BOOK", "DBIT", "c004-b22", "22.30", "EUR", "Potraviny U Kašny", null, "2026-10-13", "2026-10-13", null, ["Potraviny U Kašny"]),
    new("BOOK", "DBIT", "c004-b23", "8.40", "EUR", "Pizzerie Sole", null, "2026-10-11", "2026-10-11", null, ["Pizzerie Sole"]),
    new("BOOK", "DBIT", "c004-b24", "13.00", "EUR", "Kino Světlo", null, "2026-10-09", "2026-10-09", null, ["Kino Světlo"]),
    new("BOOK", "DBIT", "c004-b25", "2.90", "EUR", "Trafika U Mostu", null, "2026-10-07", "2026-10-07", null, ["Trafika U Mostu"]),
  ];

  /// <summary>
  /// The one page <see cref="Lists"/> gave. The fake bank gets it when the read's day is known (in
  /// <see cref="ReadTransactionsFrom"/>), so it answers only a request whose <c>date_from</c> is that day.
  /// </summary>
  private string? _listedPage;

  /// <summary>The page each continuation key this test's fake bank hands out asks for (<see cref="ContinuationKeyOf"/>), for <see cref="PagesRequested"/>.</summary>
  private readonly Dictionary<string, int> _pageOfKey = [];

  /// <summary>The fake bank this test's app copy reads.</summary>
  private FakeBank Bank => bank;

  /// <summary>The port, as the app copy wires it.</summary>
  private IBankAccount Account => services.GetRequiredService<IBankAccount>();

  /// <summary>
  /// The balances answer of the Mock ASPSP capture <c>spikes/enable-banking-mock/evidence/2026-11-06-account1-balances.json</c>
  /// (made-up data), copied with its shape and its other fields as captured; only the ITAV amount and currency are the
  /// DSL's. The amount goes on the wire as a string, as the bank writes it.
  /// </summary>
  public void HasAvailableBalance(decimal amount, string currency) =>
    Bank.AnswerBalances($$"""
      {
        "balances": [
          {
            "name": "Available balance calculated in the course of the business day",
            "balance_amount": {
              "currency": {{JsonString(currency)}},
              "amount": {{JsonString(amount.ToString(CultureInfo.InvariantCulture))}}
            },
            "balance_type": "ITAV",
            "last_change_date_time": null,
            "reference_date": "2026-11-06",
            "last_committed_transaction": null
          }
        ]
      }
      """);

  /// <summary>One page, the transactions in the given order, and no next page (<c>continuation_key: null</c>, as the capture ends).</summary>
  public void Lists(IReadOnlyList<TransactionAtBank> transactions) {
    ArgumentNullException.ThrowIfNull(transactions);

    _listedPage = PageJson(transactions.Select(Wire), continuationKey: null);
  }

  /// <summary>
  /// <paramref name="count"/> different booked and pending transactions in <paramref name="pages"/> pages, as even as the
  /// count allows, in order. The transactions are the capture's 23 booked and pending ones (<see cref="_captured"/>),
  /// then made-up ones in the same shape for the rest (<see cref="MadeUp"/>).
  /// <para>
  /// The multi-page structure is not captured: the Mock ASPSP returned all 25 of its transactions in one page (design.md
  /// § Bootstrap). It is written from the M1 page structure at Revolut: pages chained by continuation keys, the last one
  /// with <c>continuation_key: null</c>. The keys are made up and hold characters a query must escape (<c>+</c>,
  /// <c>/</c>, <c>=</c>). Each page answers only for <paramref name="since"/> as <c>date_from</c> and its own key: the first
  /// page only when no key is sent.
  /// </para>
  /// </summary>
  public void ListsInPages(DateOnly since, int count, int pages) {
    ArgumentOutOfRangeException.ThrowIfNegative(count);
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(pages);

    WireTransaction[] transactions = [
      .. _captured.Take(count),
      .. Enumerable.Range(1, Math.Max(0, count - _captured.Length)).Select(number => MadeUp(number, since)),
    ];

    for (int page = 1; page <= pages; page++) {
      string? keyOfThisPage = page == 1 ? null : ContinuationKeyOf(page);
      string? keyOfNextPage = page == pages ? null : ContinuationKeyOf(page + 1);
      WireTransaction[] onThisPage = transactions[((page - 1) * count / pages)..(page * count / pages)];

      Bank.AnswerTransactionsPage(since, keyOfThisPage, PageJson(onThisPage, keyOfNextPage));
    }
  }

  /// <summary>
  /// The first page from <paramref name="since"/>, then the bank's own error for the second (<see cref="OWN_ERROR"/>), each
  /// answering only for <paramref name="since"/> as <c>date_from</c> and its own key. The first page holds the capture's
  /// booked and pending transactions (<see cref="_captured"/>); its continuation key is made up, as the capture was a
  /// single page (design.md § Bootstrap). The second page's error is written from the API reference.
  /// </summary>
  public void ListsFirstPageThenFails(DateOnly since) {
    string keyOfPage2 = ContinuationKeyOf(2);

    Bank.AnswerTransactionsPage(since, continuationKey: null, PageJson(_captured, keyOfPage2));
    Bank.AnswerTransactionsPageError(since, keyOfPage2, OWN_ERROR_STATUS, OWN_ERROR);
  }

  /// <summary>
  /// As <see cref="ListsInPages"/>, and the first request for page <paramref name="failingPage"/> (with its continuation key,
  /// none for page 1) gets the bank's own error (<see cref="OWN_ERROR"/>, written from the API reference) instead; a later
  /// request for that page gets the page. Not captured: the Mock ASPSP neither pages nor fails on demand.
  /// </summary>
  public void ListsInPagesWithOneErrorOnPage(DateOnly since, int count, int pages, int failingPage) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(failingPage);
    ArgumentOutOfRangeException.ThrowIfGreaterThan(failingPage, pages);

    ListsInPages(since, count, pages);
    Bank.AnswerTransactionsPageErrorOnce(since, failingPage == 1 ? null : ContinuationKeyOf(failingPage), OWN_ERROR_STATUS, OWN_ERROR);
  }

  /// <summary>
  /// Every request: the session has expired. Written from the API reference (<c>ErrorResponse</c>, error code
  /// <c>EXPIRED_SESSION</c>), not captured: the Mock ASPSP cannot expire a session on demand. The reference does not say
  /// which status comes with the code; 422 is chosen, the status of every error the mock did answer
  /// (<c>spikes/enable-banking-mock/evidence/2026-11-04-error-responses.json</c>) and the one design.md D4 cites for
  /// session errors. The message text is made up.
  /// </summary>
  public void ReportsExpiredSession() => Bank.AnswerError(HttpStatusCode.UnprocessableEntity, """
    {
      "code": 422,
      "message": "Session has expired",
      "error": "EXPIRED_SESSION",
      "detail": null
    }
    """);

  /// <summary>
  /// Every request: the bank's request limit is reached. Written from the API reference (<c>ErrorResponse</c>, error code
  /// <c>ASPSP_RATE_LIMIT_EXCEEDED</c>, with 429), not captured: the Mock ASPSP cannot reach its limit on demand. The
  /// message text is made up.
  /// </summary>
  public void ReportsRequestLimitReached() => Bank.AnswerError(HttpStatusCode.TooManyRequests, """
    {
      "code": 429,
      "message": "Request limit reached",
      "error": "ASPSP_RATE_LIMIT_EXCEEDED",
      "detail": null
    }
    """);

  /// <summary>Every request: the bank reports an error of its own (<see cref="OWN_ERROR"/>).</summary>
  public void ReportsOwnError() => Bank.AnswerError(OWN_ERROR_STATUS, OWN_ERROR);

  /// <summary>
  /// The first request: the bank reports an error of its own (<see cref="OWN_ERROR"/>), whatever else the test set up;
  /// later requests get that.
  /// </summary>
  public void ReportsOwnErrorForTheFirstRequest() => Bank.AnswerErrorOnce(OWN_ERROR_STATUS, OWN_ERROR);

  /// <summary>
  /// The first request: the answer the test set up for it starts and the connection breaks while it comes in
  /// (<see cref="FakeBank.BreakTheNextAnswer"/>); later requests get their answers whole. Not captured: the Mock ASPSP
  /// cannot break a connection.
  /// </summary>
  public void BreaksConnectionWhileAnsweringTheFirstRequest() => Bank.BreakTheNextAnswer();

  /// <summary>Every request: a gateway in front of the bank answers that the service is unavailable, with its own maintenance page (<see cref="MAINTENANCE_PAGE"/>).</summary>
  public void GatewayAnswersWithMaintenancePage() => Bank.AnswerHtmlPage(MAINTENANCE_PAGE_STATUS, MAINTENANCE_PAGE);

  /// <summary>
  /// Every request: the bank answers, with the DSL's default balance, but only a second after the harness's request
  /// timeout (<see cref="FakeBank.RequestTimeout"/>, 5 s). The answer would be a success, so only the timeout can end the
  /// read otherwise; the read ends at the timeout, so the test waits about 5 s, not 6. Not captured: the Mock ASPSP cannot
  /// be slowed down.
  /// </summary>
  public void AnswersAfterTheRequestTimeout() {
    HasAvailableBalance(BankDsl.DEFAULT_BALANCE, TransactionAtBank.DEFAULT_CURRENCY);
    Bank.AnswerAfter(FakeBank.RequestTimeout + TimeSpan.FromSeconds(1));
  }

  public async Task<BalanceAnswer> ReadBalanceFor(UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    return AnswerOf(await Account.ReadBalance(Present(user), CancellationToken.None));
  }

  public async Task<BalanceAnswer> ReadBalanceUnattended() => AnswerOf(await Account.ReadBalance(new Unattended(), CancellationToken.None));

  public async Task<TransactionsAnswer> ReadTransactionsFrom(DateOnly day, UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    if (_listedPage is not null)
      Bank.AnswerTransactionsPage(day, continuationKey: null, _listedPage);

    return AnswerOf(await Account.ReadTransactions(day, Present(user), CancellationToken.None));
  }

  /// <summary>
  /// Every request the fake bank received, in order, by its user headers: none when it carries no <c>Psu-*</c> header at
  /// all; otherwise <c>Psu-Ip-Address</c> and <c>Psu-User-Agent</c>, each missing one <see langword="null"/>.
  /// </summary>
  public IReadOnlyList<RequestAtBank> RequestsReceived() => [.. Bank.RequestHeadersReceived().Select(RequestOf)];

  /// <summary>
  /// The page every transactions request the fake bank received asked for, in order: 1 without a continuation key, else
  /// the page this test handed that key out for. A key the test never handed out fails the test.
  /// </summary>
  public IReadOnlyList<int> PagesRequested() => [.. Bank.ContinuationKeysReceived().Select(PageOf)];

  /// <summary>The value is <see cref="BankOutcome.Read"/> with the balance; each failure is its own outcome, with no balance.</summary>
  private static BalanceAnswer AnswerOf(BankResult<Balance> result) => result switch {
    Balance balance => BalanceAnswer.Of(balance.Amount, balance.Currency),
    BankAccessExpired => BalanceAnswer.AccessExpired,
    BankRateLimited => BalanceAnswer.RateLimited,
    BankUnavailable => BalanceAnswer.BankUnavailable,
  };

  /// <summary>The value is <see cref="BankOutcome.Read"/> with the transactions in the order returned; each failure is its own outcome, with none.</summary>
  private static TransactionsAnswer AnswerOf(BankResult<Transactions> result) => result switch {
    Transactions transactions => TransactionsAnswer.Of(transactions.Items.Select(Seen)),
    BankAccessExpired => TransactionsAnswer.AccessExpired,
    BankRateLimited => TransactionsAnswer.RateLimited,
    BankUnavailable => TransactionsAnswer.BankUnavailable,
  };

  /// <summary>Field by field; the details become <see cref="Lines"/>.</summary>
  private static TransactionSeen Seen(BankTransaction transaction) => new(
    transaction.Reference,
    transaction.Status switch {
      TransactionStatus.Booked => TransactionSeen.STATUS_BOOKED,
      TransactionStatus.Pending => TransactionSeen.STATUS_PENDING,
      _ => throw new ArgumentOutOfRangeException(nameof(transaction), transaction.Status, "Not a status a read returns."),
    },
    transaction.Date,
    transaction.Amount,
    transaction.Currency,
    transaction.Counterparty,
    new Lines(transaction.PaymentDetails));

  private static PresentUser Present(UserAtDevice user) => new(IPAddress.Parse(user.IpAddress), user.Browser);

  private static RequestAtBank RequestOf(IReadOnlyDictionary<string, string> headers) =>
    headers.Keys.Any(static name => name.StartsWith(USER_HEADER_PREFIX, StringComparison.OrdinalIgnoreCase))
      ? new RequestAtBank(new UserHeaders(headers.GetValueOrDefault(USER_IP_ADDRESS), headers.GetValueOrDefault(USER_AGENT)))
      : RequestAtBank.WithoutUserHeaders;

  /// <summary>
  /// A DSL transaction at the bank. Every field the DSL gives is set from it, and every field it does not give is absent.
  /// Money out names the counterparty as the creditor, money in as the debtor. A booked transaction carries its day as
  /// booking and value date, any other as its transaction date.
  /// </summary>
  private static WireTransaction Wire(TransactionAtBank transaction) {
    bool booked = transaction.Status == StatusAtBank.Booked;
    string day = transaction.Day.ToString(DATE, CultureInfo.InvariantCulture);

    return new(
      BankStatus(transaction.Status),
      BankIndicator(transaction.Flow),
      transaction.Reference,
      transaction.Amount.ToString(CultureInfo.InvariantCulture),
      transaction.Currency,
      Creditor: transaction.Flow == MoneyFlow.Out ? transaction.Counterparty : null,
      Debtor: transaction.Flow == MoneyFlow.In ? transaction.Counterparty : null,
      BookingDate: booked ? day : null,
      ValueDate: booked ? day : null,
      TransactionDate: booked ? null : day,
      transaction.Details.Items);
  }

  /// <summary>
  /// A made-up booked payment in the capture's shape, for a list longer than the capture's: its own reference
  /// (<c>c004-m01</c>, …) and amount, so no two are alike, booked and valued on <paramref name="day"/>.
  /// </summary>
  private static WireTransaction MadeUp(int number, DateOnly day) {
    string date = day.ToString(DATE, CultureInfo.InvariantCulture);

    return new(
      "BOOK",
      "DBIT",
      $"c004-m{number:00}",
      (1.00m + number).ToString("0.00", CultureInfo.InvariantCulture),
      "EUR",
      Creditor: "Papírnictví Tužka",
      Debtor: null,
      BookingDate: date,
      ValueDate: date,
      TransactionDate: null,
      ["Papírnictví Tužka"]);
  }

  /// <summary>A made-up key for the page with this number (2 and up), with characters a query must escape.</summary>
  private static string MadeUpContinuationKey(int page) => $"c004+page/{page}==";

  /// <summary>The made-up key of the page with this number (2 and up), remembered as that page's, for <see cref="PagesRequested"/>.</summary>
  private string ContinuationKeyOf(int page) {
    string key = MadeUpContinuationKey(page);
    _pageOfKey[key] = page;

    return key;
  }

  /// <summary>The page a transactions request with this continuation key asked for: 1 without one.</summary>
  private int PageOf(string? continuationKey) =>
    continuationKey is null ? 1
    : _pageOfKey.TryGetValue(continuationKey, out int page) ? page
    : throw new InvalidOperationException("The fake bank received a continuation key this test never handed out.");

  /// <summary>One page in the capture's shape: these transactions, then the key of the next page, <c>null</c> on the last.</summary>
  private static string PageJson(IEnumerable<WireTransaction> transactions, string? continuationKey) => $$"""
    {
      "transactions": [{{string.Join(",", transactions.Select(TransactionJson))}}],
      "continuation_key": {{JsonString(continuationKey)}}
    }
    """;

  /// <summary>
  /// One transaction in the shape of the Mock ASPSP capture <c>spikes/enable-banking-mock/evidence/2026-11-06-account1-transactions.json</c>
  /// (made-up data), copied from its booked payment <c>c004-b04</c>, with every value from <paramref name="transaction"/>:
  /// what it leaves empty is absent, as the capture writes absence (<c>null</c>, or no lines of details), and nothing of
  /// the template's own data is kept.
  /// </summary>
  private static string TransactionJson(WireTransaction transaction) => $$"""
    {
      "entry_reference": {{JsonString(transaction.Reference)}},
      "merchant_category_code": null,
      "transaction_amount": {
        "currency": {{JsonString(transaction.Currency)}},
        "amount": {{JsonString(transaction.Amount)}}
      },
      "creditor": {{Party(transaction.Creditor)}},
      "creditor_account": null,
      "creditor_agent": null,
      "debtor": {{Party(transaction.Debtor)}},
      "debtor_account": null,
      "debtor_agent": null,
      "bank_transaction_code": null,
      "credit_debit_indicator": {{JsonString(transaction.Indicator)}},
      "status": {{JsonString(transaction.Status)}},
      "booking_date": {{JsonString(transaction.BookingDate)}},
      "value_date": {{JsonString(transaction.ValueDate)}},
      "transaction_date": {{JsonString(transaction.TransactionDate)}},
      "balance_after_transaction": null,
      "reference_number": null,
      "reference_number_schema": null,
      "remittance_information": {{JsonSerializer.Serialize(transaction.Details)}},
      "debtor_account_additional_identification": null,
      "creditor_account_additional_identification": null,
      "exchange_rate": null,
      "note": null,
      "transaction_id": null
    }
    """;

  /// <summary>A creditor or debtor as the capture writes one: the name and nothing else; <c>null</c> when there is none.</summary>
  private static string Party(string? name) => name is null ? "null" : $$"""
    {
      "name": {{JsonString(name)}},
      "postal_address": null,
      "organisation_id": null,
      "private_id": null,
      "contact_details": null
    }
    """;

  private static string BankStatus(StatusAtBank status) => status switch {
    StatusAtBank.Booked => "BOOK",
    StatusAtBank.Pending => "PDNG",
    StatusAtBank.Cancelled => "CNCL",
    StatusAtBank.Rejected => "RJCT",
    _ => throw new ArgumentOutOfRangeException(nameof(status), status, "Not a status at the bank."),
  };

  private static string BankIndicator(MoneyFlow flow) => flow switch {
    MoneyFlow.Out => "DBIT",
    MoneyFlow.In => "CRDT",
    _ => throw new ArgumentOutOfRangeException(nameof(flow), flow, "Not a money flow."),
  };

  /// <summary><paramref name="value"/> as a JSON string literal, quotes and escapes included; <c>null</c> when there is none.</summary>
  private static string JsonString(string? value) => JsonSerializer.Serialize(value);

  /// <summary>
  /// A transaction's values as the bank writes them, for the fields of the capture's shape that hold one in the capture
  /// or the DSL; <see langword="null"/> or no lines is absent.
  /// </summary>
  private sealed record WireTransaction(
    string Status,
    string Indicator,
    string? Reference,
    string Amount,
    string Currency,
    string? Creditor,
    string? Debtor,
    string? BookingDate,
    string? ValueDate,
    string? TransactionDate,
    IReadOnlyList<string> Details);
}