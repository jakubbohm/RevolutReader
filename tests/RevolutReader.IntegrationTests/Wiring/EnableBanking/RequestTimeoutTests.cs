using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// Our own request timeout (<see cref="EnableBankingOptions.RequestTimeout"/>, c004 design.md D4, § Error model): an answer
/// slower than it is the bank unavailable. The caller's own cancellation is not a failure of the bank: it passes on as an
/// <see cref="OperationCanceledException"/>, never as a result.
/// </summary>
public sealed class RequestTimeoutTests {
  /// <summary>A balances answer the read would accept, had it come in time.</summary>
  private const string READABLE_BALANCES = """{ "balances": [{ "balance_amount": { "currency": "EUR", "amount": "1234.56" }, "balance_type": "ITAV" }] }""";

  /// <summary>The timeout is 1 s; the answer, a readable one, would come after 3 s.</summary>
  [Test]
  public async Task An_answer_slower_than_the_request_timeout_is_bank_unavailable() {
    using BankOnWireMock bank = new(requestTimeout: TimeSpan.FromSeconds(1));
    bank.AnswersAfter(TimeSpan.FromSeconds(3), READABLE_BALANCES);

    (await bank.Account.ReadBalance(new Unattended(), CancellationToken.None)).Value.ShouldBeOfType<BankUnavailable>();
  }

  /// <summary>The caller gives up after 0.2 s, well before the request timeout (5 s) and the answer (after 10 s).</summary>
  [Test]
  public async Task The_callers_own_cancellation_passes_on() {
    using BankOnWireMock bank = new(requestTimeout: BankOnWireMock.DefaultRequestTimeout);
    bank.AnswersAfter(TimeSpan.FromSeconds(10), READABLE_BALANCES);
    using CancellationTokenSource caller = new(TimeSpan.FromMilliseconds(200));

    await Should.ThrowAsync<OperationCanceledException>(() => bank.Account.ReadBalance(new Unattended(), caller.Token));
  }
}