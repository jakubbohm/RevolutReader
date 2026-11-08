using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.ApiErrors;

public sealed class ApiErrorsScenarios : AcceptanceTest {
  [Test, Scenario("api-errors", "Unknown API address answers with a problem description")]
  public async Task Unknown_API_address_answers_with_a_problem_description() => (await Api.AskForAnAddressThatDoesNotExist()).ShouldBe(ProblemDescription.NotFound);

  [Test, Scenario("api-errors", "A write to an unknown API address answers with a problem description")]
  public async Task A_write_to_an_unknown_API_address_answers_with_a_problem_description() => (await Api.SendAWriteToAnAddressThatDoesNotExist()).ShouldBe(ProblemDescription.NotFound);

  [Test, Scenario("api-errors", "An unexpected failure answers with a problem description that reveals nothing")]
  public async Task An_unexpected_failure_answers_with_a_problem_description_that_reveals_nothing() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Balance.BankAnswersAnErrorTheAppDoesNotKnow();

    (await Balance.AsksForTheBalance()).ShouldBe(BalanceReading.Failed(ProblemDescription.InternalServerError));
  }
}