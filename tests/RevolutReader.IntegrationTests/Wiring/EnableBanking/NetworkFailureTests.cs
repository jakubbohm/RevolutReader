using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// A network failure is the bank unavailable (c004 design.md § Error model): the bank cannot be reached, or the connection
/// breaks while the answer comes in. The caller's own cancellation is not a failure of the bank: it passes on as an
/// <see cref="OperationCanceledException"/>, never as a result.
/// </summary>
public sealed class NetworkFailureTests {
  private static readonly DateOnly _november1 = new(2026, 11, 1);

  [Test]
  public async Task With_nothing_listening_a_read_is_bank_unavailable() {
    using BankOnWireMock bank = new();
    bank.StopsListening();

    (await bank.Account.ReadBalance(new Unattended(), CancellationToken.None)).Value.ShouldBeOfType<BankUnavailable>();
    (await bank.Account.ReadTransactions(_november1, new Unattended(), CancellationToken.None)).Value.ShouldBeOfType<BankUnavailable>();
  }

  /// <summary>The answer starts (a success status, a promised body) and the connection closes after a few bytes of the body.</summary>
  [Test]
  public async Task A_connection_that_breaks_while_the_answer_comes_in_is_bank_unavailable() {
    using ConnectionBreakingServer server = new();
    using BankOnWireMock bank = new(apiBaseUrl: server.Address);

    (await bank.Account.ReadBalance(new Unattended(), CancellationToken.None)).Value.ShouldBeOfType<BankUnavailable>();
  }

  /// <summary>The answer would come after 5 s; the caller gives up after 0.2 s, well inside the client's own timeout.</summary>
  [Test]
  public async Task The_callers_own_cancellation_passes_on() {
    using BankOnWireMock bank = new();
    bank.AnswersAfter(TimeSpan.FromSeconds(5), """{ "balances": [] }""");
    using CancellationTokenSource caller = new(TimeSpan.FromMilliseconds(200));

    await Should.ThrowAsync<OperationCanceledException>(() => bank.Account.ReadBalance(new Unattended(), caller.Token));
  }
}