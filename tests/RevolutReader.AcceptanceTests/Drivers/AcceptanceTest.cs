using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;
using RevolutReader.AcceptanceTests.Dsl;
using TUnit.AspNetCore;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Base of every acceptance test class (c001 design.md D6). Each test gets its own copy of the API inside the test
/// process (TUnit.AspNetCore), in environment <c>Production</c>, so it runs on the base <c>appsettings.json</c>. The DSL
/// and its drivers are built on that copy. One thing is swapped: the web root is the stand-in page folder
/// (<see cref="StandInPages"/>, c003 design.md D6). Later changes override <c>ConfigureTestServices</c> /
/// <c>ConfigureTestConfiguration</c> for the bank, the sign-in key and the clock.
/// </summary>
public abstract class AcceptanceTest : WebApplicationTest<ApiFactory, Program> {
  private HttpClient? _http;
  private HealthDsl? _health;
  private ApiDsl? _api;
  private PagesDsl? _pages;

  protected HealthDsl Health => _health ??= new(new HealthDriver(Http));

  protected ApiDsl Api => _api ??= new(new ApiDriver(Http));

  protected PagesDsl Pages => _pages ??= new(new PagesDriver(Http));

  /// <summary>An anonymous caller of this test's app copy; created on first use, disposed after the test.</summary>
  private HttpClient Http => _http ??= Factory.CreateClient();

  [After(Test)]
  public void DisposeHttpClient() => _http?.Dispose();

  protected override void ConfigureWebHostBuilder(IWebHostBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    builder.UseEnvironment(Environments.Production);
    builder.UseWebRoot(StandInPages.Folder);
  }
}