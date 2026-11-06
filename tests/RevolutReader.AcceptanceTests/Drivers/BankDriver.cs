using Microsoft.Extensions.DependencyInjection;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.Api.Bank;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Drives the app's bank port (spec bank-reads, c004 design.md D1): takes <see cref="IBankAccount"/> from the test's own
/// app copy, so the reads run on the production wiring (settings, <c>HttpClient</c>, no retries) against
/// <see cref="FakeBank"/>. Turns the DSL's facts into the fake bank's answers, and the port's results into DSL answers.
/// <list type="bullet">
/// <item>A <see cref="BankResult{T}"/> becomes the answer's outcome: the value is <see cref="BankOutcome.Read"/>, each
/// failure its own outcome, with no value.</item>
/// <item>A <see cref="BankTransaction"/> becomes a <see cref="TransactionSeen"/> field by field; booked is
/// <see cref="TransactionSeen.STATUS_BOOKED"/>, pending <see cref="TransactionSeen.STATUS_PENDING"/>.</item>
/// <item>A received request's user headers are <c>Psu-Ip-Address</c> and <c>Psu-User-Agent</c>; a request carrying no
/// <c>Psu-*</c> header at all has none (<see cref="RequestAtBank.WithoutUserHeaders"/>).</item>
/// </list>
/// Filled in by the wiring groups; until then every method throws.
/// </summary>
public sealed class BankDriver(FakeBank bank, IServiceProvider services) {
  /// <summary>The fake bank this test's app copy reads.</summary>
  private FakeBank Bank => bank;

  /// <summary>The port, as the app copy wires it.</summary>
  private IBankAccount Account => services.GetRequiredService<IBankAccount>();

  public void HasAvailableBalance(decimal amount, string currency) => throw new NotImplementedException();

  public void Lists(IReadOnlyList<TransactionAtBank> transactions) => throw new NotImplementedException();

  public void ListsInPages(DateOnly since, int count, int pages) => throw new NotImplementedException();

  public void ListsFirstPageThenFails(DateOnly since) => throw new NotImplementedException();

  public void ReportsExpiredSession() => throw new NotImplementedException();

  public void ReportsRequestLimitReached() => throw new NotImplementedException();

  public void ReportsOwnError() => throw new NotImplementedException();

  public void AnswersAfterTheRequestTimeout() => throw new NotImplementedException();

  public Task<BalanceAnswer> ReadBalanceFor(UserAtDevice user) => throw new NotImplementedException();

  public Task<BalanceAnswer> ReadBalanceUnattended() => throw new NotImplementedException();

  public Task<TransactionsAnswer> ReadTransactionsFrom(DateOnly day, UserAtDevice user) => throw new NotImplementedException();

  public IReadOnlyList<RequestAtBank> RequestsReceived() => throw new NotImplementedException();
}