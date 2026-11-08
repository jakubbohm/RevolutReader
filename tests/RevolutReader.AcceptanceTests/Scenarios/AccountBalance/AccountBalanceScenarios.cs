using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.AccountBalance;

public sealed class AccountBalanceScenarios : AcceptanceTest {
  [Test, Scenario("account-balance", "The balance comes with the time it was read and the koruna rate")]
  public async Task The_balance_comes_with_the_time_it_was_read_and_the_koruna_rate() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Bank.HasAvailableBalance(286.40m, "EUR");

    (await Balance.AsksForTheBalance()).ShouldBe(BalanceReading.Of(286.40m, readAt: Balance.Now, czkPerEur: 24.3m));
  }

  [Test, Scenario("account-balance", "The bank sees the signed-in user's address and browser")]
  public async Task The_bank_sees_the_signed_in_users_address_and_browser() {
    UserAtDevice phone = new("203.0.113.7", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)");
    await SignIn.HasSignedIn(Visitor.Lucie);

    await Balance.AsksForTheBalanceFrom(phone);

    Bank.RequestsReceived().ShouldBe([RequestAtBank.WithUserHeadersOf(phone)]);
  }

  [Test, Scenario("account-balance", "A balance request without a browser name reads nothing at the bank")]
  public async Task A_balance_request_without_a_browser_name_reads_nothing_at_the_bank() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await Balance.AsksForTheBalanceNamingNoBrowser()).ShouldBe(BalanceReading.Failed(ProblemDescription.BadRequest));
    Bank.RequestsReceived().ShouldBeEmpty();
  }

  [Test, Scenario("account-balance", "Expired bank access answers its own problem")]
  public async Task Expired_bank_access_answers_its_own_problem() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Bank.ReportsExpiredSession();

    (await Balance.AsksForTheBalance()).ShouldBe(BalanceReading.Failed(ProblemDescription.BankAccessExpired));
  }

  [Test, Scenario("account-balance", "A reached bank limit answers its own problem")]
  public async Task A_reached_bank_limit_answers_its_own_problem() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Bank.ReportsRequestLimitReached();

    (await Balance.AsksForTheBalance()).ShouldBe(BalanceReading.Failed(ProblemDescription.BankRateLimited));
  }

  [Test, Scenario("account-balance", "A bank that does not answer is its own problem")]
  public async Task A_bank_that_does_not_answer_is_its_own_problem() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Bank.ReportsOwnError();

    (await Balance.AsksForTheBalance()).ShouldBe(BalanceReading.Failed(ProblemDescription.BankUnavailable));
  }
}