using System.Buffers.Text;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// The account check through the API (spec account-check; c014 design.md D6–D8, D11, D16). Status codes, headers, JSON, the
/// app copy's services and the fake bank's held answer stay here; the DSL gets <see cref="CheckAnswer"/> and
/// <see cref="WholeAnswer"/> values. Modelled on <see cref="BalanceDriver"/> and <see cref="PushDriver"/>.
/// <list type="bullet">
/// <item><b>The key</b>: every app copy gets a made-up check key, new for every test (<see cref="NewKey"/>: 32 random bytes,
/// base64url without padding, as the real one), written into <c>AccountCheck:Key</c> by <see cref="Configure"/> next to the
/// fake bank's and the fake push service's settings, so the app starts whether or not the test asks for a check.</item>
/// <item><b>The phone</b> is the owner's iPhone Shortcut: an anonymous <see cref="HttpClient"/>, as Apple's URL loading
/// sends a request (D6): <c>POST /api/account/check</c> with <c>X-Check-Key</c> the test's key, <c>User-Agent</c> the
/// phone's browser name and <c>X-Forwarded-For</c> its address (the harness takes the client address from it, c009's
/// probe), no body, no fetch metadata (<c>Sec-Fetch-*</c>) and no <c>Origin</c>. A call naming no browser leaves out
/// <c>User-Agent</c> only. A bank the test set nothing up for answers <see cref="BankDsl.DEFAULT_BALANCE"/> EUR, as
/// <see cref="BalanceDriver"/> does: a fallback below every answer the test sets up, so a scenario about the phone's
/// headers needs no balance.</item>
/// <item><b>Exact shapes</b>, any other answer failing the step, naming it: 200 <c>application/json</c> with exactly
/// <c>changed</c>, a JSON boolean (<see cref="CheckAnswer.BalanceChanged"/>, <see cref="CheckAnswer.NothingChanged"/>); a
/// problem as <see cref="BalanceDriver"/> reads one, with the status its case belongs to by the driver's own table:
/// <see cref="ProblemDescription.BadRequest"/> 400, <see cref="ProblemDescription.BankAccessExpired"/> 503,
/// <see cref="ProblemDescription.BankRateLimited"/> 429, <see cref="ProblemDescription.BankUnavailable"/> 503,
/// <see cref="ProblemDescription.InternalServerError"/> 500 (no members but <c>type</c>, <c>title</c>, <c>status</c> and
/// <c>traceId</c>).</item>
/// <item><b>A wrong key</b>: the phone's request with <c>X-Check-Key</c> 32 made-up random bytes in base64url, as long as
/// the key and never it, read as a <see cref="WholeAnswer"/> as <see cref="PushDriver"/> reads one (the status, the content
/// type and the body without its <c>traceId</c>). <see cref="SendTheSameToAnUnknownApiAddress"/> sends the request
/// <see cref="CheckWithAWrongKey"/> sent last, the same method and headers, to <c>/api/no-such-address</c>.</item>
/// <item><b>The kept balances</b> are written and read through the app copy's own <c>ICheckedBalanceStore</c> (from its
/// services: the real Table adapter on the test's own table in Azurite; D16), each balance whole: its amount, read time and
/// rate. Never made by an earlier check, which would add a request at the bank.</item>
/// <item><b>A burst</b> (D16): the bank's next balance answer held (<see cref="FakeBank.HoldTheNextBalanceAnswer"/>), the
/// first call sent, its request at the bank awaited (<see cref="FakeBank.WaitUntilTheHeldRequestArrives"/>), the other calls
/// sent, then a bounded wait on the real clock until <c>AccountCheckQueue.CallersWaiting</c>, read through the app copy's
/// services, counts them all, the bank released, and every call's answer, in the order sent.</item>
/// <item><b>A caller that stops waiting</b> (D16): the bank's next balance answer held, the call sent with a cancellation
/// token of its own, its request at the bank awaited, the call cancelled and its end awaited, the bank released. What the
/// check sends afterwards the scenario awaits itself (<see cref="PushDsl.Eventually"/>).</item>
/// </list>
/// Filled in by the wiring groups (tasks.md 3.4, 5.1, 10.2, 16.1, 36.1, 39.1); until then every method that calls the app
/// or reads its services throws. The key and the clock are real now (tasks.md 1.1).
/// </summary>
public sealed class AccountCheckDriver(HttpClient anonymous, FakeBank bank, FakeTimeProvider clock, IServiceProvider app, string key) {
  /// <summary>The settings section the check's key is bound to (D6).</summary>
  private const string SECTION = "AccountCheck";

  /// <summary>The check key's size (D6): 32 random bytes, as the message key's.</summary>
  private const int KEY_BYTES = 32;

  /// <summary>
  /// The app copy's clock (<see cref="FakeMicrosoft.Clock"/>), read as it is: a property may not throw
  /// <see cref="NotImplementedException"/> (CA1065), so this one member is no stub.
  /// </summary>
  public DateTimeOffset Now => clock.GetUtcNow();

  /// <summary>The phone's anonymous client, as the Shortcut calls the check endpoint.</summary>
  internal HttpClient Phone => anonymous;

  /// <summary>The fake bank this test's app copy reads, whose balance answer a burst and a caller that stops waiting hold.</summary>
  internal FakeBank Bank => bank;

  /// <summary>The app copy's services, for its store of the check's balances and the check queue's count of waiting callers.</summary>
  internal IServiceProvider App => app;

  /// <summary>This test's check key, the one the app copy is configured with (<see cref="Configure"/>).</summary>
  internal string Key => key;

  /// <summary>A new made-up check key: 32 random bytes in base64url without padding (D6), never a real one.</summary>
  public static string NewKey() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(KEY_BYTES));

  /// <summary>
  /// Writes <paramref name="key"/> into the app copy's <c>AccountCheck:Key</c>, as the last configuration source, so it wins
  /// over <c>appsettings.json</c> (whose secret is <c>"&lt;secret&gt;"</c>), as <see cref="FakePushService.Configure"/>
  /// writes the push settings.
  /// </summary>
  public static void Configure(IWebHostBuilder builder, string key) {
    ArgumentNullException.ThrowIfNull(builder);
    ArgumentException.ThrowIfNullOrWhiteSpace(key);

    Dictionary<string, string?> settings = new() { [$"{SECTION}:Key"] = key };

    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
  }

  /// <summary><c>POST /api/account/check</c> from <paramref name="phone"/> with the check key: its address and its browser name.</summary>
  public Task<CheckAnswer> Check(UserAtDevice phone) => throw new NotImplementedException();

  /// <summary><c>POST /api/account/check</c> with the check key and <c>X-Forwarded-For</c> <paramref name="ipAddress"/>, but no <c>User-Agent</c>.</summary>
  public Task<CheckAnswer> CheckNamingNoBrowser(string ipAddress) => throw new NotImplementedException();

  /// <summary><c>POST /api/account/check</c> from <paramref name="phone"/>, with a wrong check key.</summary>
  public Task<WholeAnswer> CheckWithAWrongKey(UserAtDevice phone) => throw new NotImplementedException();

  /// <summary>The request <see cref="CheckWithAWrongKey"/> sent last, sent to an address under <c>/api</c> no endpoint serves; throws when none was sent.</summary>
  public Task<WholeAnswer> SendTheSameToAnUnknownApiAddress() => throw new NotImplementedException();

  /// <summary>Whether the app copy's store holds any of the check's balances.</summary>
  public Task<bool> KeepsAnyBalance() => throw new NotImplementedException();

  /// <summary>
  /// Writes the check's two balances into the app copy's store, replacing what it held: last seen
  /// <paramref name="lastSeen"/> EUR read at <paramref name="lastSeenReadAt"/>, last notified <paramref name="lastNotified"/>
  /// EUR read at <paramref name="lastNotifiedReadAt"/>, both at <paramref name="czkPerEur"/> koruna per euro.
  /// </summary>
  public Task Keep(decimal lastSeen, DateTimeOffset lastSeenReadAt, decimal lastNotified, DateTimeOffset lastNotifiedReadAt, decimal czkPerEur) =>
    throw new NotImplementedException();

  /// <summary>
  /// A check from <paramref name="phone"/>, and <paramref name="checks"/> more from it while the first is still reading the
  /// bank, lined up as the class describes; every call's answer, the first first.
  /// </summary>
  public Task<IReadOnlyList<CheckAnswer>> ChecksWhileTheFirstReadsTheBank(UserAtDevice phone, int checks) => throw new NotImplementedException();

  /// <summary>A check from <paramref name="phone"/>, whose call is cancelled while the check is still reading the bank, as the class describes.</summary>
  public Task CheckThenStopWaitingWhileTheBankReads(UserAtDevice phone) => throw new NotImplementedException();
}