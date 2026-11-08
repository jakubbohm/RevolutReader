using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.BankReads;

public sealed class BankReadsScenarios : AcceptanceTest {
  [Test, Scenario("bank-reads", "The balance is the account's available balance")]
  public async Task The_balance_is_the_accounts_available_balance() {
    Bank.HasAvailableBalance(1234.56m, "EUR");

    (await Bank.ReadBalance()).ShouldBe(BalanceAnswer.Of(1234.56m, "EUR"));
  }

  [Test, Scenario("bank-reads", "Pending transactions come back marked pending")]
  public async Task Pending_transactions_come_back_marked_pending() {
    Bank.Lists(TransactionAtBank.Payment(StatusAtBank.Pending, 8.90m, on: new DateOnly(2026, 11, 5), reference: null));

    (await Bank.ReadTransactionsFrom(new DateOnly(2026, 11, 1))).ShouldBe(TransactionsAnswer.Of(
      TransactionSeen.Pending(-8.90m, "EUR", on: new DateOnly(2026, 11, 5), reference: null)));
  }

  [Test, Scenario("bank-reads", "Cancelled and rejected transactions are left out")]
  public async Task Cancelled_and_rejected_transactions_are_left_out() {
    Bank.Lists(
      TransactionAtBank.Payment(StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 3), to: "Pekárna U Lípy", reference: "e-101"),
      TransactionAtBank.Payment(StatusAtBank.Cancelled, 30.00m, on: new DateOnly(2026, 11, 2)),
      TransactionAtBank.Payment(StatusAtBank.Rejected, 45.00m, on: new DateOnly(2026, 11, 4)));

    (await Bank.ReadTransactionsFrom(new DateOnly(2026, 11, 1))).ShouldBe(TransactionsAnswer.Of(
      TransactionSeen.Booked(-12.30m, "EUR", on: new DateOnly(2026, 11, 3), reference: "e-101", counterparty: "Pekárna U Lípy")));
  }

  [Test, Scenario("bank-reads", "A spent payment comes back negative, with the payee and its details")]
  public async Task A_spent_payment_comes_back_negative_with_the_payee_and_its_details() {
    Bank.Lists(TransactionAtBank.Payment(
      StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 3), to: "Pekárna U Lípy", reference: "e-101", details: new Lines("Pekárna U Lípy", "Praha 2")));

    (await Bank.ReadTransactionsFrom(new DateOnly(2026, 11, 1))).ShouldBe(TransactionsAnswer.Of(TransactionSeen.Booked(
      -12.30m, "EUR", on: new DateOnly(2026, 11, 3), reference: "e-101", counterparty: "Pekárna U Lípy", details: new Lines("Pekárna U Lípy", "Praha 2"))));
  }

  [Test, Scenario("bank-reads", "A received transfer comes back positive, with the payer")]
  public async Task A_received_transfer_comes_back_positive_with_the_payer() {
    Bank.Lists(TransactionAtBank.TransferReceived(StatusAtBank.Booked, 50.00m, on: new DateOnly(2026, 11, 4), from: "Jan Novák"));

    (await Bank.ReadTransactionsFrom(new DateOnly(2026, 11, 1))).ShouldBe(TransactionsAnswer.Of(
      TransactionSeen.Booked(50.00m, "EUR", on: new DateOnly(2026, 11, 4), counterparty: "Jan Novák")));
  }

  [Test, Scenario("bank-reads", "Transactions on every page are returned")]
  public async Task Transactions_on_every_page_are_returned() {
    Bank.ListsInPages(since: new DateOnly(2026, 10, 6), count: 25, pages: 3);

    TransactionsAnswer answer = await Bank.ReadTransactionsFrom(new DateOnly(2026, 10, 6));

    answer.Outcome.ShouldBe(BankOutcome.Read);
    answer.Transactions.Count.ShouldBe(25);
    answer.Transactions.ShouldBeUnique();
  }

  [Test, Scenario("bank-reads", "A failure on a later page fails the whole read")]
  public async Task A_failure_on_a_later_page_fails_the_whole_read() {
    Bank.ListsFirstPageThenFails(since: new DateOnly(2026, 10, 6));

    (await Bank.ReadTransactionsFrom(new DateOnly(2026, 10, 6))).ShouldBe(TransactionsAnswer.BankUnavailable);
  }

  [Test, Scenario("bank-reads", "A read for a present user carries the user's address and browser")]
  public async Task A_read_for_a_present_user_carries_the_users_address_and_browser() {
    UserAtDevice user = new("203.0.113.7", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)");

    await Bank.ReadBalanceFor(user);

    Bank.RequestsReceived().ShouldBe([RequestAtBank.WithUserHeadersOf(user)]);
  }

  [Test, Scenario("bank-reads", "An unattended read carries no user headers")]
  public async Task An_unattended_read_carries_no_user_headers() {
    await Bank.ReadBalanceUnattended();

    Bank.RequestsReceived().ShouldBe([RequestAtBank.WithoutUserHeaders]);
  }

  [Test, Scenario("bank-reads", "A browser name with an accent reaches the bank with a question mark")]
  public async Task A_browser_name_with_an_accent_reaches_the_bank_with_a_question_mark() {
    UserAtDevice user = new("203.0.113.7", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Čtečka/1.0");

    await Bank.ReadBalanceFor(user);

    Bank.RequestsReceived().ShouldBe([RequestAtBank.WithUserHeadersOf(user with { Browser = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) ?te?ka/1.0" })]);
  }

  [Test, Scenario("bank-reads", "An expired bank session reads as access expired")]
  public async Task An_expired_bank_session_reads_as_access_expired() {
    Bank.ReportsExpiredSession();

    (await Bank.ReadBalance()).ShouldBe(BalanceAnswer.AccessExpired);
  }

  [Test, Scenario("bank-reads", "A reached request limit reads as rate limited, with no second request")]
  public async Task A_reached_request_limit_reads_as_rate_limited_with_no_second_request() {
    Bank.ReportsRequestLimitReached();

    (await Bank.ReadBalanceUnattended()).ShouldBe(BalanceAnswer.RateLimited);
    Bank.RequestsReceived().Count.ShouldBe(1);
  }

  [Test, Scenario("bank-reads", "A bank error reads as bank unavailable")]
  public async Task A_bank_error_reads_as_bank_unavailable() {
    Bank.ReportsOwnError();

    (await Bank.ReadBalance()).ShouldBe(BalanceAnswer.BankUnavailable);
  }

  [Test, Scenario("bank-reads", "A bank that answers too slowly reads as bank unavailable")]
  public async Task A_bank_that_answers_too_slowly_reads_as_bank_unavailable() {
    Bank.AnswersAfterTheRequestTimeout();

    (await Bank.ReadBalance()).ShouldBe(BalanceAnswer.BankUnavailable);
    Bank.RequestsReceived().Count.ShouldBe(1);
  }

  [Test, Scenario("bank-reads", "A gateway's error page reads as bank unavailable")]
  public async Task A_gateways_error_page_reads_as_bank_unavailable() {
    Bank.GatewayAnswersWithMaintenancePage();

    (await Bank.ReadBalance()).ShouldBe(BalanceAnswer.BankUnavailable);
  }

  [Test, Scenario("bank-reads", "A one-off bank error is retried and the read succeeds")]
  public async Task A_one_off_bank_error_is_retried_and_the_read_succeeds() {
    Bank.ReportsOwnErrorForTheFirstRequest();
    Bank.HasAvailableBalance(1234.56m, "EUR");

    (await Bank.ReadBalance()).ShouldBe(BalanceAnswer.Of(1234.56m, "EUR"));
    Bank.RequestsReceived().Count.ShouldBe(2);
  }

  [Test, Scenario("bank-reads", "A connection that breaks once is retried and the read succeeds")]
  public async Task A_connection_that_breaks_once_is_retried_and_the_read_succeeds() {
    Bank.BreaksConnectionWhileAnsweringTheFirstRequest();
    Bank.HasAvailableBalance(1234.56m, "EUR");

    (await Bank.ReadBalance()).ShouldBe(BalanceAnswer.Of(1234.56m, "EUR"));
    Bank.RequestsReceived().Count.ShouldBe(2);
  }

  [Test, Scenario("bank-reads", "A bank error that persists is tried four times, then reads as bank unavailable")]
  public async Task A_bank_error_that_persists_is_tried_four_times_then_reads_as_bank_unavailable() {
    Bank.ReportsOwnError();

    (await Bank.ReadBalance()).ShouldBe(BalanceAnswer.BankUnavailable);
    Bank.RequestsReceived().Count.ShouldBe(4);
  }

  [Test, Scenario("bank-reads", "A failure on a later page retries only that page")]
  public async Task A_failure_on_a_later_page_retries_only_that_page() {
    Bank.ListsInPagesWithOneErrorOnPage(since: new DateOnly(2026, 10, 6), count: 25, pages: 3, failingPage: 2);

    TransactionsAnswer answer = await Bank.ReadTransactionsFrom(new DateOnly(2026, 10, 6));

    answer.Outcome.ShouldBe(BankOutcome.Read);
    answer.Transactions.Count.ShouldBe(25);
    answer.Transactions.ShouldBeUnique();
    Bank.RequestsReceived().Count.ShouldBe(4);
    Bank.PagesRequested().ShouldBe([1, 2, 2, 3]);
  }

  [Test, Scenario("bank-reads", "An unattended read is never retried")]
  public async Task An_unattended_read_is_never_retried() {
    Bank.ReportsOwnErrorForTheFirstRequest();
    Bank.HasAvailableBalance(1234.56m, "EUR");

    (await Bank.ReadBalanceUnattended()).ShouldBe(BalanceAnswer.BankUnavailable);
    Bank.RequestsReceived().Count.ShouldBe(1);
  }
}