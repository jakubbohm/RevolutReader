using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using RevolutReader.AcceptanceTests.Drivers;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// The harness runs the app as it deploys (c001 design.md D6): environment <c>Production</c>, on the base
/// <c>appsettings.json</c>, without Development-only behaviour. Nothing else would notice a fallback to the test
/// host's default, <c>Development</c>.
/// </summary>
public sealed class AcceptanceHarnessTests : AcceptanceTest {
  [Test]
  public Task The_app_copy_runs_in_the_Production_environment() {
    Services.GetRequiredService<IHostEnvironment>().EnvironmentName.ShouldBe(Environments.Production);

    return Task.CompletedTask;
  }
}