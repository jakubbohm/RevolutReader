using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;
using RevolutReader.AcceptanceTests.Dsl;
using TUnit.AspNetCore;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Base of every acceptance test class (c001 design.md D6). Each test gets its own copy of the API inside the test
/// process (TUnit.AspNetCore), in environment <c>Production</c>, so it runs on the base <c>appsettings.json</c>. The DSL
/// and its drivers are built on that copy. Two things are swapped: the web root is the stand-in page folder
/// (<see cref="StandInPages"/>, c003 design.md D6), and Enable Banking is the test's own fake bank
/// (<see cref="Drivers.FakeBank"/>, c004 design.md D6), whose settings every app copy gets. Later changes override
/// <c>ConfigureTestServices</c> / <c>ConfigureTestConfiguration</c> for the sign-in key and the clock.
/// </summary>
public abstract class AcceptanceTest : WebApplicationTest<ApiFactory, Program> {
  private HttpClient? _http;
  private FakeBank? _fakeBank;
  private HealthDsl? _health;
  private ApiDsl? _api;
  private PagesDsl? _pages;
  private BankDsl? _bank;

  protected HealthDsl Health => _health ??= new(new HealthDriver(Http));

  protected ApiDsl Api => _api ??= new(new ApiDriver(Http));

  protected PagesDsl Pages => _pages ??= new(new PagesDriver(Http));

  /// <summary>The bank, read through the app copy's bank port (spec bank-reads, D1).</summary>
  protected BankDsl Bank => _bank ??= new(new BankDriver(FakeBank, Services));

  /// <summary>An anonymous caller of this test's app copy; created on first use, disposed after the test.</summary>
  private HttpClient Http => _http ??= Factory.CreateClient();

  /// <summary>This test's fake bank; started when the app copy is configured, so before it starts; stopped after the test.</summary>
  private FakeBank FakeBank => _fakeBank ??= FakeBank.Start();

  [After(Test)]
  public void DisposeHttpClient() => _http?.Dispose();

  [After(Test)]
  public void StopFakeBank() => _fakeBank?.Dispose();

  protected override void ConfigureWebHostBuilder(IWebHostBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    builder.UseEnvironment(Environments.Production);
    builder.UseWebRoot(StandInPages.Folder);
    FakeBank.Configure(builder);
  }
}