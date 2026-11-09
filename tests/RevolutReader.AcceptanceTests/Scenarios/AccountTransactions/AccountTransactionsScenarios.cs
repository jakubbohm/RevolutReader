using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.AccountTransactions;

public sealed class AccountTransactionsScenarios : AcceptanceTest {
  [Test, Scenario("account-transactions", "The newest transactions come live with the koruna rate")]
  public async Task The_newest_transactions_come_live_with_the_koruna_rate() {
    Transactions.TodayIs(new DateOnly(2026, 11, 20));
    await SignIn.HasSignedIn(Visitor.Lucie);
    Transactions.BankLists(
      TransactionAtBank.Payment(StatusAtBank.Pending, 8.90m, on: new DateOnly(2026, 11, 19), to: "Kavárna Na Rohu"),
      TransactionAtBank.Payment(StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 18), to: "Pekárna U Lípy", details: new Lines("Praha 2")));

    (await Transactions.AsksForTheTransactions()).ShouldBe(TransactionsReading.Of(
      [
        TransactionSeenInApi.StillPending(-8.90m, on: new DateOnly(2026, 11, 19), counterparty: "Kavárna Na Rohu"),
        TransactionSeenInApi.Settled(-12.30m, on: new DateOnly(2026, 11, 18), counterparty: "Pekárna U Lípy", details: new Lines("Praha 2")),
      ],
      olderBefore: null,
      czkPerEur: 24.3m,
      rateDate: new DateOnly(2026, 11, 8)));
  }

  [Test, Scenario("account-transactions", "The live read covers the last 31 days")]
  public async Task The_live_read_covers_the_last_31_days() {
    Transactions.TodayIs(new DateOnly(2026, 11, 20));
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Transactions.Kept(new KeptAtApp(new DateOnly(2026, 11, 19), -4.20m));

    await Transactions.AsksForTheTransactions();

    Transactions.DaysTheBankWasAskedFrom().ShouldBe([new DateOnly(2026, 10, 20)]);
  }

  [Test, Scenario("account-transactions", "After a long pause, the live read reaches back to the newest kept day")]
  public async Task After_a_long_pause_the_live_read_reaches_back_to_the_newest_kept_day() {
    Transactions.TodayIs(new DateOnly(2026, 11, 20));
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Transactions.Kept(new KeptAtApp(new DateOnly(2026, 9, 30), -4.20m));

    await Transactions.AsksForTheTransactions();

    Transactions.DaysTheBankWasAskedFrom().ShouldBe([new DateOnly(2026, 9, 30)]);
  }

  [Test, Scenario("account-transactions", "With nothing kept, the live read reaches back 89 days")]
  public async Task With_nothing_kept_the_live_read_reaches_back_89_days() {
    Transactions.TodayIs(new DateOnly(2026, 11, 20));
    await SignIn.HasSignedIn(Visitor.Lucie);

    await Transactions.AsksForTheTransactions();

    Transactions.DaysTheBankWasAskedFrom().ShouldBe([new DateOnly(2026, 8, 23)]);
  }

  [Test, Scenario("account-transactions", "A settled transaction stays in the history after the bank stops listing it")]
  public async Task A_settled_transaction_stays_in_the_history_after_the_bank_stops_listing_it() {
    Transactions.TodayIs(new DateOnly(2026, 11, 20));
    await SignIn.HasSignedIn(Visitor.Lucie);
    Transactions.BankLists(TransactionAtBank.Payment(StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 18), to: "Pekárna U Lípy"));
    (await Transactions.AsksForTheTransactions()).Transactions.ShouldBe([TransactionSeenInApi.Settled(-12.30m, on: new DateOnly(2026, 11, 18), counterparty: "Pekárna U Lípy")]);
    // To 2026-12-30. A login unused for 30 days ends (spec sign-in), so she uses the app on the way, as she would.
    Transactions.DaysPass(20);
    await SignIn.UsesTheApp();
    Transactions.DaysPass(20);
    Transactions.BankLists();

    (await Transactions.AsksForTheTransactionsBefore(new DateOnly(2026, 11, 29))).Transactions
      .ShouldBe([TransactionSeenInApi.Settled(-12.30m, on: new DateOnly(2026, 11, 18), counterparty: "Pekárna U Lípy")]);
  }

  [Test, Scenario("account-transactions", "A pending transaction is never kept")]
  public async Task A_pending_transaction_is_never_kept() {
    Transactions.TodayIs(new DateOnly(2026, 11, 20));
    await SignIn.HasSignedIn(Visitor.Lucie);
    Transactions.BankLists(TransactionAtBank.Payment(StatusAtBank.Pending, 8.90m, on: new DateOnly(2026, 11, 19)));
    (await Transactions.AsksForTheTransactions()).Transactions.ShouldBe([TransactionSeenInApi.StillPending(-8.90m, on: new DateOnly(2026, 11, 19))]);
    Transactions.BankLists();

    (await Transactions.AsksForTheTransactionsBefore(new DateOnly(2026, 11, 21))).Transactions.ShouldNotBeNull().ShouldBeEmpty();
  }

  [Test, Scenario("account-transactions", "Older transactions come from storage in pages of whole days")]
  public async Task Older_transactions_come_from_storage_in_pages_of_whole_days() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Transactions.KeptOnDay(new DateOnly(2026, 10, 19), 10);
    await Transactions.KeptOnDay(new DateOnly(2026, 10, 18), 15);
    await Transactions.KeptOnDay(new DateOnly(2026, 10, 17), 10);
    await Transactions.KeptOnDay(new DateOnly(2026, 10, 16), 10);

    TransactionsReading reading = await Transactions.AsksForTheTransactionsBefore(new DateOnly(2026, 10, 20));

    reading.Transactions.ShouldNotBeNull().Select(static transaction => transaction.Date).ShouldBe([
      .. Enumerable.Repeat(new DateOnly(2026, 10, 19), 10),
      .. Enumerable.Repeat(new DateOnly(2026, 10, 18), 15),
      .. Enumerable.Repeat(new DateOnly(2026, 10, 17), 10),
    ]);
    reading.OlderBefore.ShouldBe(new DateOnly(2026, 10, 17));
    Bank.RequestsReceived().ShouldBeEmpty();
  }

  [Test, Scenario("account-transactions", "The oldest page says nothing older is kept")]
  public async Task The_oldest_page_says_nothing_older_is_kept() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Transactions.KeptOnDay(new DateOnly(2026, 10, 19), 5);
    await Transactions.KeptOnDay(new DateOnly(2026, 10, 12), 4);
    await Transactions.KeptOnDay(new DateOnly(2026, 10, 1), 3);

    TransactionsReading reading = await Transactions.AsksForTheTransactionsBefore(new DateOnly(2026, 10, 20));

    reading.Transactions.ShouldNotBeNull().Count.ShouldBe(12);
    reading.OlderBefore.ShouldBeNull();
  }

  [Test, Scenario("account-transactions", "The bank's text leaves out the line that repeats the counterparty")]
  public async Task The_banks_text_leaves_out_the_line_that_repeats_the_counterparty() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Transactions.BankLists(TransactionAtBank.Payment(
      StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 18), to: "Pekárna U Lípy", details: new Lines("PEKARNA U LIPY", "Praha 2")));

    (await Transactions.AsksForTheTransactions()).Transactions.ShouldNotBeNull().ShouldHaveSingleItem().Details.ShouldBe(new Lines("Praha 2"));
  }

  [Test, Scenario("account-transactions", "A refund is told by the bank's type code")]
  public async Task A_refund_is_told_by_the_banks_type_code() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Transactions.BankLists(TransactionAtBank.Refund(StatusAtBank.Booked, 5.95m, on: new DateOnly(2026, 11, 18), from: "Lékárna Benu", typeCode: "CARD_REFUND"));

    (await Transactions.AsksForTheTransactions()).Transactions.ShouldNotBeNull().ShouldHaveSingleItem().Kind.ShouldBe(TransactionSeenInApi.REFUND);
  }

  [Test, Scenario("account-transactions", "The bank sees the signed-in user's address and browser")]
  public async Task The_bank_sees_the_signed_in_users_address_and_browser() {
    UserAtDevice phone = new("203.0.113.7", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)");
    await SignIn.HasSignedIn(Visitor.Lucie);

    await Transactions.AsksForTheTransactionsFrom(phone);

    Bank.RequestsReceived().ShouldBe([RequestAtBank.WithUserHeadersOf(phone)]);
  }

  [Test, Scenario("account-transactions", "A transactions request without a browser name reads nothing at the bank")]
  public async Task A_transactions_request_without_a_browser_name_reads_nothing_at_the_bank() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await Transactions.AsksForTheTransactionsNamingNoBrowser()).ShouldBe(TransactionsReading.Failed(ProblemDescription.BadRequest));
    Bank.RequestsReceived().ShouldBeEmpty();
  }

  [Test, Scenario("account-transactions", "Expired bank access answers its own problem")]
  public async Task Expired_bank_access_answers_its_own_problem() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Bank.ReportsExpiredSession();

    (await Transactions.AsksForTheTransactions()).ShouldBe(TransactionsReading.Failed(ProblemDescription.BankAccessExpired));
  }

  [Test, Scenario("account-transactions", "A reached bank limit answers its own problem")]
  public async Task A_reached_bank_limit_answers_its_own_problem() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Bank.ReportsRequestLimitReached();

    (await Transactions.AsksForTheTransactions()).ShouldBe(TransactionsReading.Failed(ProblemDescription.BankRateLimited));
  }

  [Test, Scenario("account-transactions", "A bank that does not answer is its own problem")]
  public async Task A_bank_that_does_not_answer_is_its_own_problem() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Bank.ReportsOwnError();

    (await Transactions.AsksForTheTransactions()).ShouldBe(TransactionsReading.Failed(ProblemDescription.BankUnavailable));
  }
}