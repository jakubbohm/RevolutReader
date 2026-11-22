using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.KorunaRate;

/// <summary>
/// A scenario's "today is" a weekday at a time comes after signing in (c017 design.md D10): it moves the app's clock, and
/// Microsoft's ID token is checked against the real clock.
/// </summary>
public sealed class KorunaRateScenarios : AcceptanceTest {
  [Test, Scenario("koruna-rate", "Monday's rate replaces Friday's and is not asked for again that day")]
  public async Task Mondays_rate_replaces_Fridays_and_is_not_asked_for_again_that_day() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Rate.TodayIs(new DateOnly(2026, 11, 23), new TimeOnly(15, 0));
    await Rate.TheKeptRateIs(24.41m, new DateOnly(2026, 11, 20));
    Rate.TheCnbsLatestRateIs(24.52m, new DateOnly(2026, 11, 23));

    BalanceReading first = await Balance.AsksForTheBalance();
    BalanceReading second = await Balance.AsksForTheBalance();

    first.CzkPerEur.ShouldBe(24.52m, "the first answer's rate");
    second.CzkPerEur.ShouldBe(24.52m, "the second answer's rate");
    Rate.RequestsTheCnbReceived().ShouldBe(1, "the CNB receives one request");
  }

  [Test, Scenario("koruna-rate", "A rate for an earlier day than the kept one is ignored")]
  public async Task A_rate_for_an_earlier_day_than_the_kept_one_is_ignored() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Rate.TodayIs(new DateOnly(2026, 11, 24), new TimeOnly(9, 0));
    await Rate.TheKeptRateIs(24.52m, new DateOnly(2026, 11, 23));
    Rate.TheCnbsLatestRateIs(24.41m, new DateOnly(2026, 11, 20));

    TransactionsReading answer = await Transactions.AsksForTheTransactions();

    answer.CzkPerEur.ShouldBe(24.52m, "the koruna rate");
    answer.RateDate.ShouldBe(new DateOnly(2026, 11, 23), "its date");
  }

  [Test, Scenario("koruna-rate", "Friday's rate is not asked for again over the weekend")]
  public async Task Fridays_rate_is_not_asked_for_again_over_the_weekend() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Rate.TodayIs(new DateOnly(2026, 11, 21), new TimeOnly(10, 0));
    await Rate.TheKeptRateIs(24.41m, new DateOnly(2026, 11, 20));

    BalanceReading answer = await Balance.AsksForTheBalance();

    answer.CzkPerEur.ShouldBe(24.41m, "the answer's rate");
    Rate.RequestsTheCnbReceived().ShouldBe(0, "the CNB receives no request");
  }

  [Test, Scenario("koruna-rate", "From 08:00 UTC on Monday every request asks until Monday's rate comes")]
  public async Task From_08_00_UTC_on_Monday_every_request_asks_until_Mondays_rate_comes() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Rate.TodayIs(new DateOnly(2026, 11, 23), new TimeOnly(9, 0));
    await Rate.TheKeptRateIs(24.41m, new DateOnly(2026, 11, 20));
    Rate.TheCnbsLatestRateIs(24.41m, new DateOnly(2026, 11, 20));

    BalanceReading first = await Balance.AsksForTheBalance();
    BalanceReading second = await Balance.AsksForTheBalance();

    first.CzkPerEur.ShouldBe(24.41m, "the first answer's rate");
    second.CzkPerEur.ShouldBe(24.41m, "the second answer's rate");
    Rate.RequestsTheCnbReceived().ShouldBe(2, "the CNB receives two requests");
  }

  [Test, Scenario("koruna-rate", "A CNB that answers with an error leaves the kept rate")]
  public async Task A_CNB_that_answers_with_an_error_leaves_the_kept_rate() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Rate.TodayIs(new DateOnly(2026, 11, 23), new TimeOnly(9, 0));
    await Rate.TheKeptRateIs(24.41m, new DateOnly(2026, 11, 20));
    Rate.TheCnbAnswersAServerError();

    TransactionsReading answer = await Transactions.AsksForTheTransactions();

    answer.CzkPerEur.ShouldBe(24.41m, "the koruna rate");
    answer.RateDate.ShouldBe(new DateOnly(2026, 11, 20), "its date");
  }

  [Test, Scenario("koruna-rate", "A CNB that does not answer within 2 s leaves the kept rate")]
  public async Task A_CNB_that_does_not_answer_within_2_s_leaves_the_kept_rate() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Rate.TodayIs(new DateOnly(2026, 11, 23), new TimeOnly(9, 0));
    await Rate.TheKeptRateIs(24.41m, new DateOnly(2026, 11, 20));
    Rate.TheCnbDoesNotAnswerInTime();

    BalanceReading answer = await Balance.AsksForTheBalance();

    answer.CzkPerEur.ShouldBe(24.41m, "the answer's rate");
  }

  [Test, Scenario("koruna-rate", "With no rate kept and the CNB failing, the app's own rate of 24.47 is answered")]
  public async Task With_no_rate_kept_and_the_CNB_failing_the_apps_own_rate_of_24_47_is_answered() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Rate.NoRateIsKept();
    Rate.TheCnbAnswersAServerError();

    TransactionsReading answer = await Transactions.AsksForTheTransactions();

    answer.CzkPerEur.ShouldBe(24.47m, "the koruna rate");
    answer.RateDateAsAnswered.ShouldBe(new DateOnly(2026, 11, 20), "its date, a fixed one, not a date of the scenario's calendar");
  }
}