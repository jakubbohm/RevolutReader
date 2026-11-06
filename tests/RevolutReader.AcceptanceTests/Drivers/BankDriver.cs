using System.Globalization;
using System.Net;
using System.Text.Json;
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

  /// <summary>
  /// The balances answer of the Mock ASPSP capture <c>spikes/enable-banking-mock/evidence/2026-11-06-account1-balances.json</c>
  /// (made-up data), copied with its shape and its other fields as captured; only the ITAV amount and currency are the
  /// DSL's. The amount goes on the wire as a string, as the bank writes it.
  /// </summary>
  public void HasAvailableBalance(decimal amount, string currency) =>
    Bank.AnswerBalances($$"""
      {
        "balances": [
          {
            "name": "Available balance calculated in the course of the business day",
            "balance_amount": {
              "currency": {{JsonString(currency)}},
              "amount": {{JsonString(amount.ToString(CultureInfo.InvariantCulture))}}
            },
            "balance_type": "ITAV",
            "last_change_date_time": null,
            "reference_date": "2026-11-06",
            "last_committed_transaction": null
          }
        ]
      }
      """);

  public void Lists(IReadOnlyList<TransactionAtBank> transactions) => throw new NotImplementedException();

  public void ListsInPages(DateOnly since, int count, int pages) => throw new NotImplementedException();

  public void ListsFirstPageThenFails(DateOnly since) => throw new NotImplementedException();

  public void ReportsExpiredSession() => throw new NotImplementedException();

  public void ReportsRequestLimitReached() => throw new NotImplementedException();

  public void ReportsOwnError() => throw new NotImplementedException();

  public void AnswersAfterTheRequestTimeout() => throw new NotImplementedException();

  public async Task<BalanceAnswer> ReadBalanceFor(UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    return AnswerOf(await Account.ReadBalance(new PresentUser(IPAddress.Parse(user.IpAddress), user.Browser), CancellationToken.None));
  }

  public Task<BalanceAnswer> ReadBalanceUnattended() => throw new NotImplementedException();

  public Task<TransactionsAnswer> ReadTransactionsFrom(DateOnly day, UserAtDevice user) => throw new NotImplementedException();

  public IReadOnlyList<RequestAtBank> RequestsReceived() => throw new NotImplementedException();

  /// <summary>The value is <see cref="BankOutcome.Read"/> with the balance; each failure is its own outcome, with no balance.</summary>
  private static BalanceAnswer AnswerOf(BankResult<Balance> result) => result switch {
    Balance balance => BalanceAnswer.Of(balance.Amount, balance.Currency),
    BankAccessExpired => BalanceAnswer.AccessExpired,
    BankRateLimited => BalanceAnswer.RateLimited,
    BankUnavailable => BalanceAnswer.BankUnavailable,
  };

  /// <summary><paramref name="value"/> as a JSON string literal, quotes and escapes included.</summary>
  private static string JsonString(string value) => JsonSerializer.Serialize(value);
}