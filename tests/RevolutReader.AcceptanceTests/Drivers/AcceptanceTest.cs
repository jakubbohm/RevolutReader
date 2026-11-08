using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;
using RevolutReader.AcceptanceTests.Dsl;
using TUnit.AspNetCore;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Base of every acceptance test class (c001 design.md D6). Each test gets its own copy of the API inside the test
/// process (TUnit.AspNetCore), in environment <c>Production</c>, so it runs on the base <c>appsettings.json</c>. The DSL
/// and its drivers are built on that copy. Swapped: the web root is the stand-in page folder (<see cref="StandInPages"/>,
/// c003 design.md D6); Enable Banking is the test's own fake bank (<see cref="Drivers.FakeBank"/>, c004 design.md D6);
/// Microsoft's sign-in is the test's own fake Microsoft (<see cref="Drivers.FakeMicrosoft"/>, c007 design.md D6), which
/// also brings the ephemeral cookie keys and the app copy's clock. Every app copy gets both fakes' settings.
/// <para>
/// Storage is real: the test session's Azurite (<see cref="AzuriteStorage"/>, c010 design.md D12), with a table of each
/// app copy's own. Every app copy gets its settings too.
/// </para>
/// </summary>
public abstract class AcceptanceTest : WebApplicationTest<ApiFactory, Program> {
  private HttpClient? _http;
  private HttpClient? _browser;
  private FakeBank? _fakeBank;
  private FakeMicrosoft? _fakeMicrosoft;
  private ScenarioCalendar? _calendar;
  private TransactionsDsl? _transactions;
  private TransactionsDriver? _transactionsDriver;
  private HealthDriver? _healthDriver;
  private HealthDsl? _health;
  private ApiDriver? _apiDriver;
  private ApiDsl? _api;
  private PagesDsl? _pages;
  private BankDsl? _bank;
  private SignInDriver? _signInDriver;
  private SignInDsl? _signIn;

  protected HealthDsl Health => _health ??= new(HealthDriver);

  /// <summary>The driver under <see cref="Health"/>, an anonymous caller, for the guards in <c>Conventions/</c>. Scenarios use <see cref="Health"/> only.</summary>
  protected HealthDriver HealthDriver => _healthDriver ??= new(Http);

  protected ApiDsl Api => _api ??= new(ApiDriver);

  /// <summary>
  /// The driver under <see cref="Api"/>, an anonymous caller, for the guards in <c>Conventions/</c> that check how the app
  /// answers addresses no scenario names. Scenarios use <see cref="Api"/> only.
  /// </summary>
  protected ApiDriver ApiDriver => _apiDriver ??= new(Http);

  protected PagesDsl Pages => _pages ??= new(new PagesDriver(Http));

  /// <summary>The bank, read through the app copy's bank port (spec bank-reads, D1).</summary>
  protected BankDsl Bank => _bank ??= new(new BankDriver(FakeBank, Services));

  /// <summary>Signing in through the fake Microsoft, in this test's one browser (spec sign-in, c007 design.md D6).</summary>
  protected SignInDsl SignIn => _signIn ??= new(SignInDriver);

  /// <summary>
  /// The driver under <see cref="SignIn"/>, the same browser, for the guards in <c>Conventions/</c> that check the channel
  /// itself (cookie attributes, requests other sites make the browser send). Scenarios use <see cref="SignIn"/> only.
  /// </summary>
  protected SignInDriver SignInDriver => _signInDriver ??= new(Browser, FakeMicrosoft, Services);

  /// <summary>An anonymous caller of this test's app copy; created on first use, disposed after the test.</summary>
  private HttpClient Http => _http ??= Factory.CreateClient();

  /// <summary>The visitor's browser (<see cref="SignInDriver.BrowserOptions"/>): its cookies are the login; created on first use, disposed after the test.</summary>
  private HttpClient Browser => _browser ??= Factory.CreateClient(SignInDriver.BrowserOptions);

  /// <summary>This test's fake bank; started when the app copy is configured, so before it starts; stopped after the test.</summary>
  private FakeBank FakeBank => _fakeBank ??= FakeBank.Start();

  /// <summary>This test's fake Microsoft; started when the app copy is configured, so before it starts; stopped after the test.</summary>
  private FakeMicrosoft FakeMicrosoft => _fakeMicrosoft ??= FakeMicrosoft.Start();

  /// <summary>The test session's Azurite, shared by every app copy (c010 design.md D12); started before the first test, removed after the last.</summary>
  [ClassDataSource<AzuriteStorage>(Shared = SharedType.PerTestSession)]
  public required AzuriteStorage Azurite { get; init; }

  /// <summary>
  /// The transactions through the API, asked for in the browser <see cref="SignIn"/> signs in with, against this test's fake
  /// bank and storage, on the scenario's calendar (spec account-transactions, c010 design.md D12).
  /// </summary>
  protected TransactionsDsl Transactions => _transactions ??= new(TransactionsDriver, Calendar);

  /// <summary>
  /// The driver under <see cref="Transactions"/>, the same browser, for the guards in <c>Conventions/</c> that send what no
  /// scenario names (an older page asked with a query it cannot read). Scenarios use <see cref="Transactions"/> only.
  /// </summary>
  protected TransactionsDriver TransactionsDriver => _transactionsDriver ??= new(Browser, FakeBank, Calendar, Services);

  /// <summary>The scenario's dates on the app copy's clock; the scenario's today is <see cref="TransactionsDsl.DefaultToday"/> until it names another.</summary>
  private ScenarioCalendar Calendar => _calendar ??= new(TransactionsDsl.DefaultToday, FakeMicrosoft.Clock);

  [After(Test)]
  public void DisposeHttpClient() => _http?.Dispose();

  [After(Test)]
  public void DisposeBrowser() => _browser?.Dispose();

  [After(Test)]
  public void StopFakeBank() => _fakeBank?.Dispose();

  [After(Test)]
  public void StopFakeMicrosoft() => _fakeMicrosoft?.Dispose();

  protected override void ConfigureWebHostBuilder(IWebHostBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    builder.UseEnvironment(Environments.Production);
    builder.UseWebRoot(StandInPages.Folder);
    FakeBank.Configure(builder);
    Azurite.Configure(builder);
    FakeMicrosoft.Configure(builder);
  }
}