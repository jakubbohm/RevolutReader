using Microsoft.Extensions.Time.Testing;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Asks the app copy for the balance, <c>GET /api/balance</c> (spec account-balance, c009 design.md D1), in the signed-in
/// browser: the <see cref="HttpClient"/> <see cref="SignInDriver"/> signs in with, its cookies the login. Status codes,
/// headers and JSON stay here; the DSL gets a <see cref="BalanceReading"/>.
/// <list type="bullet">
/// <item>Every request carries <c>X-Forwarded-For</c> with the user's address and <c>User-Agent</c> with the user's browser,
/// as the hosting proxy and the browser send them: the in-process server sets no client address and the test client sends
/// no <c>User-Agent</c>, so without them every request would answer 400 (design.md § Risks). The request naming no browser
/// leaves out <c>User-Agent</c> only.</item>
/// <item>A bank the test set nothing up for answers <see cref="BankDsl.DEFAULT_BALANCE"/> EUR, as <see cref="BankDsl"/>
/// does by default: a fallback below every answer a test sets up, so a scenario about the user headers needs no balance.</item>
/// <item>A <see cref="BalanceReading"/> only when the answer's exact shape fits: a 200 has exactly <c>amount</c>,
/// <c>readAt</c> and <c>czkPerEur</c>; a problem has <c>application/problem+json</c>, a body <c>status</c> equal to the
/// response's, and the status its case belongs to (its <c>type</c> as <see cref="ProblemDescription.Type"/>,
/// <see langword="null"/> for RFC 9110's); a 500 has no members but <c>type</c>, <c>title</c>, <c>status</c> and
/// <c>traceId</c>, so nothing about the failure. Any other answer fails the step. <c>readAt</c> is compared as an
/// instant.</item>
/// <item>The status each case belongs to is the driver's own table, as <see cref="ApiDriver"/>'s:
/// <see cref="ProblemDescription.BadRequest"/> 400, <see cref="ProblemDescription.BankAccessExpired"/> 503,
/// <see cref="ProblemDescription.BankRateLimited"/> 429, <see cref="ProblemDescription.BankUnavailable"/> 503,
/// <see cref="ProblemDescription.InternalServerError"/> 500. The answer gives a reading only when its status matches its
/// case; status codes never reach the DSL.</item>
/// </list>
/// Filled in by the wiring groups; until then every method throws.
/// </summary>
public sealed class BalanceDriver(HttpClient browser, FakeBank bank, FakeTimeProvider clock) {
  /// <summary>The signed-in browser.</summary>
  private HttpClient Browser => browser;

  /// <summary>The fake bank this test's app copy reads.</summary>
  private FakeBank Bank => bank;

  /// <summary>
  /// The app copy's clock (<see cref="FakeMicrosoft.Clock"/>), read as it is: a property may not throw
  /// <see cref="NotImplementedException"/> (CA1065), so this one member is no stub.
  /// </summary>
  public DateTimeOffset Now => clock.GetUtcNow();

  /// <summary><c>GET /api/balance</c> from this user's phone: <c>X-Forwarded-For</c> its address, <c>User-Agent</c> its browser.</summary>
  public Task<BalanceReading> AskForBalance(UserAtDevice user) => throw new NotImplementedException();

  /// <summary><c>GET /api/balance</c> with <c>X-Forwarded-For</c> <paramref name="ipAddress"/> and no <c>User-Agent</c>.</summary>
  public Task<BalanceReading> AskForBalanceNamingNoBrowser(string ipAddress) => throw new NotImplementedException();

  /// <summary>
  /// Every request: an Enable Banking error answer (<c>ErrorResponse</c>, written from the API reference, with a comment
  /// saying so) whose error code no case maps (c004 design.md D4), so the adapter throws <c>BankReadException</c>.
  /// </summary>
  public void BankAnswersAnErrorNoCaseFits() => throw new NotImplementedException();
}