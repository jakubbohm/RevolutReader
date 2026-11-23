using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenTelemetry.Trace;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.Api.Bank;
using Shouldly;
using TUnit.AspNetCore;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// No account identifiers in logs or traces (c004 design.md D5; CLAUDE.md: never log account identifiers). The bank's
/// paths carry the account id, and the user headers carry the user's address and browser (personal data with no use in
/// the log, D5); the HTTP client's default logging and the HTTP-client trace instrumentation record a request's URL. So
/// the test's app copy reads the bank once for its balance and once for its transactions, for a present user, and
/// nothing it logs (message, structured value or scope value) or exports as a trace (activity name, tag, event or
/// status) may contain the configured account id, the session id, or the user's IP address or browser. A second test
/// does the same for a read retried once, whose retry the resilience library logs as well (c008 design.md D9). A third
/// counts the bank reads of one account check, two since c018 (design.md D5), and guards them the same way.
/// <para>
/// The present user is the guard's own, with an address and a browser no other test uses: the app copies of tests running
/// in parallel export into this test's collection too (<see cref="ExportedActivityCollection"/>), and the server activity of
/// every request an app copy answers records that request's browser (<c>user_agent.original</c>, OpenTelemetry's
/// ASP.NET Core instrumentation). A shared value would fail this test whenever such a request ran at the same time.
/// </para>
/// <para>
/// A rule, not a scenario: no public channel shows logs. "Exported" is what OpenTelemetry's in-memory exporter receives
/// from the app's own tracing setup. TUnit's own trace additions (its HTTP activity source and correlation processor,
/// its headers on the app's outgoing calls) are switched off for this test, so only what the app itself records counts.
/// The fake bank's own server, an ASP.NET Core host in the same process, records nothing: <see cref="FakeBank"/> gives it
/// a diagnostic listener and an activity source nobody listens to. Otherwise its server activities, whose path carries the
/// account id, would arrive here as if the app had recorded them. So nothing exported is excluded: every activity counts.
/// </para>
/// </summary>
public sealed class BankTelemetryTests : AcceptanceTest {
  /// <summary>The log category of the resilience library the bank client retries with (Polly, c008 design.md D3, D9).</summary>
  private const string RESILIENCE_LIBRARY = "Polly";

  /// <summary>The guard's own present user: a documentation address (RFC 5737) and a made-up browser, both used nowhere else.</summary>
  private static readonly UserAtDevice _user = new("192.0.2.71", "Mozilla/5.0 (RevolutReader telemetry guard; made up)");

  /// <summary>The phone of the check's guard: a documentation address (RFC 5737) and a made-up Shortcut browser, both used nowhere else.</summary>
  private static readonly UserAtDevice _checkingPhone = new("192.0.2.72", "BackgroundShortcutRunner/5114.0 (RevolutReader telemetry guard; made up)");

  private readonly CapturedLogTexts _logs = new();
  private readonly ExportedActivityCollection _traces = new();

  [Test]
  public async Task Bank_reads_leave_no_account_id_session_id_or_user_headers_in_logs_or_traces() {
    Bank.HasAvailableBalance(1234.56m);
    Bank.Lists(TransactionAtBank.Payment(StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 3), to: "Pekárna U Lípy", reference: "e-101"));

    (await Bank.ReadBalanceFor(_user)).Outcome.ShouldBe(BankOutcome.Read, "the balance read reached the bank");
    (await Bank.ReadTransactionsFor(_user, new DateOnly(2026, 11, 1))).Outcome.ShouldBe(BankOutcome.Read, "the transactions read reached the bank");

    string[] identifiers = [ConfiguredBankSetting("AccountId"), ConfiguredBankSetting("SessionId"), _user.IpAddress, _user.Browser];

    _logs.Texts().Where(text => Names(text, identifiers)).ShouldBeEmpty("Log messages, structured values or scope values naming the account, the session, or the user's address or browser");
    _traces.Texts().Where(text => Names(text, identifiers)).ShouldBeEmpty("Exported trace names, tags, events or statuses naming the account, the session, or the user's address or browser");
  }

  /// <summary>
  /// A read retried once (c008 design.md D9): the resilience library writes its own lines about the retry, under its
  /// category <see cref="RESILIENCE_LIBRARY"/>, and they must hold no identifier either. The test first checks that the
  /// library did write some, so it cannot pass without them.
  /// </summary>
  [Test]
  public async Task A_retried_bank_read_leaves_no_account_id_session_id_or_user_headers_in_the_resilience_librarys_lines_or_in_traces() {
    Bank.ReportsOwnErrorForTheFirstRequest();
    Bank.HasAvailableBalance(1234.56m);

    (await Bank.ReadBalanceFor(_user)).Outcome.ShouldBe(BankOutcome.Read, "the balance read reached the bank");
    Bank.RequestsReceived().Count.ShouldBe(2, "the balance read was retried once");

    string[] identifiers = [ConfiguredBankSetting("AccountId"), ConfiguredBankSetting("SessionId"), _user.IpAddress, _user.Browser];

    _logs.MessagesOf(RESILIENCE_LIBRARY).ShouldNotBeEmpty("The resilience library's lines about the retry");
    _logs.Texts().Where(text => Names(text, identifiers)).ShouldBeEmpty("Log messages, structured values or scope values naming the account, the session, or the user's address or browser");
    _traces.Texts().Where(text => Names(text, identifiers)).ShouldBeEmpty("Exported trace names, tags, events or statuses naming the account, the session, or the user's address or browser");
  }

  /// <summary>
  /// One account check, as the owner's phone asks for it, reads the bank twice: its balance and, since c018, its
  /// transactions (design.md D5, D10; tasks.md 32.2). The bank's requests are left out of the exported traces (c004
  /// design.md D5), so the bank adapter's own line of each read is what the telemetry holds of them: one balance line and
  /// one transactions line, and the fake bank receives those two requests and nothing else. Nothing logged or exported
  /// names the account or the session, and nothing logged names the phone's address or browser. The phone's values are
  /// this test's own, so another test's guard never meets them; its browser is not looked for in the traces, since the
  /// server activity of the check's own request records it (see the class).
  /// </summary>
  [Test]
  public async Task A_check_reads_the_bank_twice_each_read_in_the_bank_adapters_line_with_no_account_id_or_session_id() {
    Bank.HasAvailableBalance(1234.56m);

    _ = await Check.PhoneAsksForACheckFrom(_checkingPhone);

    IReadOnlyList<string> bankLines = _logs.MessagesOf(typeof(EnableBankingClient).FullName!);
    string[] bankIdentifiers = [ConfiguredBankSetting("AccountId"), ConfiguredBankSetting("SessionId")];
    string[] phoneHeaders = [_checkingPhone.IpAddress, _checkingPhone.Browser];

    bankLines.ShouldSatisfyAllConditions(
      () => bankLines.Count(static line => line.StartsWith("Bank balance read", StringComparison.Ordinal)).ShouldBe(1, "one balance read, in the bank adapter's line"),
      () => bankLines.Count(static line => line.StartsWith("Bank transactions read", StringComparison.Ordinal)).ShouldBe(1, "one transactions read, in the bank adapter's line"),
      () => Bank.RequestsReceived().Count.ShouldBe(2, "the fake bank receives the two requests and nothing else"),
      () => _logs.Texts().Where(text => Names(text, [.. bankIdentifiers, .. phoneHeaders])).ShouldBeEmpty("Log messages, structured values or scope values naming the account, the session, or the phone's address or browser"),
      () => _traces.Texts().Where(text => Names(text, bankIdentifiers)).ShouldBeEmpty("Exported trace names, tags, events or statuses naming the account or the session"));
  }

  protected override void ConfigureTestOptions(WebApplicationTestOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    options.AutoConfigureOpenTelemetry = false;
    options.AutoPropagateHttpClientFactory = false;
  }

  protected override void ConfigureTestServices(IServiceCollection services) {
    services.AddSingleton<ILoggerProvider>(_ => _logs.Provider());
    services.ConfigureOpenTelemetryTracerProvider(tracing => tracing.AddInMemoryExporter(_traces));
  }

  private static bool Names(string text, IEnumerable<string> identifiers) => identifiers.Any(identifier => text.Contains(identifier, StringComparison.OrdinalIgnoreCase));

  /// <summary>The value the app copy was configured with, in its <c>EnableBanking</c> section.</summary>
  private string ConfiguredBankSetting(string key) {
    string? value = Services.GetRequiredService<IConfiguration>()[$"EnableBanking:{key}"];

    value.ShouldNotBeNullOrWhiteSpace($"the app copy's EnableBanking:{key}");

    return value;
  }
}