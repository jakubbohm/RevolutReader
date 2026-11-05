using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.ApiErrors;

public sealed class ApiErrorsScenarios : AcceptanceTest {
  [Test, Scenario("api-errors", "Unknown API address answers with a problem description")]
  public async Task Unknown_API_address_answers_with_a_problem_description() => (await Api.AskForAnAddressThatDoesNotExist()).ShouldBe(ProblemDescription.NotFound);
}