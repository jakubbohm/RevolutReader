using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// The bank as the scenarios state it (spec bank-reads, c004 design.md D1): what the bank holds or reports, the reads
/// through the app's bank port, and what the bank received. Defaults: reads are for a present user
/// (<see cref="DefaultUser"/>), amounts are in EUR, and a balance read the scenario sets nothing up for gets the
/// available balance <see cref="DEFAULT_BALANCE"/> EUR, so a scenario about the user headers needs no balance.
/// </summary>
public sealed class BankDsl(BankDriver driver) {
  /// <summary>The Mock ASPSP account's available balance in the capture (made-up data).</summary>
  public const decimal DEFAULT_BALANCE = 1234.56m;

  private bool _balanceAnswerGiven;

  /// <summary>
  /// The present user a read is for unless the scenario names one: an iPhone at a documentation address (RFC 5737). Its
  /// address and browser differ from those of every user a scenario names, so a read that goes out for this user instead
  /// of the named one fails that scenario.
  /// </summary>
  public static UserAtDevice DefaultUser { get; } = new(
    "198.51.100.23",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1");

  // What the bank holds or reports (GIVEN)

  public void HasAvailableBalance(decimal amount, string currency = TransactionAtBank.DEFAULT_CURRENCY) {
    _balanceAnswerGiven = true;
    driver.HasAvailableBalance(amount, currency);
  }

  /// <summary>The bank lists these transactions, in this order, in one page.</summary>
  public void Lists(params IEnumerable<TransactionAtBank> transactions) => driver.Lists([.. transactions]);

  /// <summary>The bank lists <paramref name="count"/> different booked or pending transactions since <paramref name="since"/>, split into <paramref name="pages"/> pages.</summary>
  public void ListsInPages(DateOnly since, int count, int pages) => driver.ListsInPages(since, count, pages);

  /// <summary>The bank returns the first page of transactions since <paramref name="since"/>, then reports an error of its own for the second page.</summary>
  public void ListsFirstPageThenFails(DateOnly since) => driver.ListsFirstPageThenFails(since);

  /// <summary>Every request: the bank reports that the session has expired.</summary>
  public void ReportsExpiredSession() {
    _balanceAnswerGiven = true;
    driver.ReportsExpiredSession();
  }

  /// <summary>Every request: the bank reports that its request limit is reached.</summary>
  public void ReportsRequestLimitReached() {
    _balanceAnswerGiven = true;
    driver.ReportsRequestLimitReached();
  }

  /// <summary>Every request: the bank reports an error of its own.</summary>
  public void ReportsOwnError() {
    _balanceAnswerGiven = true;
    driver.ReportsOwnError();
  }

  /// <summary>Every request: the bank answers only after the configured request timeout.</summary>
  public void AnswersAfterTheRequestTimeout() {
    _balanceAnswerGiven = true;
    driver.AnswersAfterTheRequestTimeout();
  }

  // Reads (WHEN)

  /// <summary>The balance, read for <see cref="DefaultUser"/>.</summary>
  public Task<BalanceAnswer> ReadBalance() => ReadBalanceFor(DefaultUser);

  /// <summary>The balance, read for this present user.</summary>
  public Task<BalanceAnswer> ReadBalanceFor(UserAtDevice user) {
    AnswerTheBalanceByDefault();

    return driver.ReadBalanceFor(user);
  }

  /// <summary>The balance, read with nobody present (the background check).</summary>
  public Task<BalanceAnswer> ReadBalanceUnattended() {
    AnswerTheBalanceByDefault();

    return driver.ReadBalanceUnattended();
  }

  /// <summary>The transactions from <paramref name="day"/>, inclusive, read for <see cref="DefaultUser"/>.</summary>
  public Task<TransactionsAnswer> ReadTransactionsFrom(DateOnly day) => ReadTransactionsFrom(day, DefaultUser);

  /// <summary>The transactions from <paramref name="day"/>, inclusive, read for this present user.</summary>
  public Task<TransactionsAnswer> ReadTransactionsFrom(DateOnly day, UserAtDevice user) => driver.ReadTransactionsFrom(day, user);

  // What the bank received (THEN)

  /// <summary>Every request the bank received during the test, in order.</summary>
  public IReadOnlyList<RequestAtBank> RequestsReceived() => driver.RequestsReceived();

  private void AnswerTheBalanceByDefault() {
    if (_balanceAnswerGiven)
      return;

    HasAvailableBalance(DEFAULT_BALANCE);
  }
}