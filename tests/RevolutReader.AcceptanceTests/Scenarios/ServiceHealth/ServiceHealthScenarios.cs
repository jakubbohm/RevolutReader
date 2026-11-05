using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.ServiceHealth;

public sealed class ServiceHealthScenarios : AcceptanceTest {
  [Test, Scenario("service-health", "Health check answers while the app runs")]
  public async Task Health_check_answers_while_the_app_runs() => (await Health.Check()).ShouldBe(HealthAnswer.Healthy);
}