using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// A network failure is the bank unavailable (c004 design.md § Error model): the bank cannot be reached, or the connection
/// breaks while the answer comes in.
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
    await using ConnectionBreakingServer server = new();
    using BankOnWireMock bank = new(apiBaseUrl: server.Address);

    (await bank.Account.ReadBalance(new Unattended(), CancellationToken.None)).Value.ShouldBeOfType<BankUnavailable>();
  }
}