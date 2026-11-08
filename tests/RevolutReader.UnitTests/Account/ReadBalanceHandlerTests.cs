using System.Net;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// Reading the balance for the API (c009 design.md D1, § Public API sketch): the handler reads it at the bank as the given
/// present user, and answers the amount in euros, the clock's time when the bank answered and C13's koruna rate; each of
/// the bank's failures comes back as the same case; a balance in any other currency is a bug, whose message names neither
/// the amount nor the currency (never log bank data). The bank is a hand-written stub of the port that answers a fixed
/// result and records who each read was for; the clock is a <see cref="FakeTimeProvider"/>. The amounts are made up; the
/// address is a documentation address (RFC 5737), the browser made up.
/// </summary>
public sealed class ReadBalanceHandlerTests {
  /// <summary>The handler's clock before the read.</summary>
  private static readonly DateTimeOffset _beforeTheRead = new(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);

  /// <summary>How long the stub bank takes to answer, on the handler's clock, so the read time can only be when it answered.</summary>
  private static readonly TimeSpan _theBankTakes = TimeSpan.FromSeconds(2);

  private static readonly PresentUser _lucieOnHerPhone = new(IPAddress.Parse("203.0.113.7"), "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)");

  [Test]
  public async Task The_balance_comes_with_the_clocks_time_and_the_koruna_rate() {
    FakeTimeProvider clock = new(_beforeTheRead);
    StubBankAccount bank = new(new Balance(286.40m, "EUR"), whileReading: () => clock.Advance(_theBankTakes));

    BankResult<AccountBalance> result = await new ReadBalanceHandler(bank, clock).Handle(_lucieOnHerPhone, CancellationToken.None);

    result.Value.ShouldBe(new AccountBalance(286.40m, ReadAt: _beforeTheRead + _theBankTakes, CzkPerEur: KorunaRate.CzkPerEur));
  }

  [Test]
  public async Task The_read_is_made_as_the_given_present_user() {
    StubBankAccount bank = new(new Balance(286.40m, "EUR"));

    _ = await new ReadBalanceHandler(bank, new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);

    bank.ReadsFor.ShouldBe([_lucieOnHerPhone]);
  }

  [Test]
  public async Task Expired_bank_access_comes_back_as_access_expired() {
    StubBankAccount bank = new(new BankAccessExpired());

    BankResult<AccountBalance> result = await new ReadBalanceHandler(bank, new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);

    result.Value.ShouldBeOfType<BankAccessExpired>();
  }

  [Test]
  public async Task A_reached_bank_limit_comes_back_as_rate_limited() {
    StubBankAccount bank = new(new BankRateLimited());

    BankResult<AccountBalance> result = await new ReadBalanceHandler(bank, new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);

    result.Value.ShouldBeOfType<BankRateLimited>();
  }

  [Test]
  public async Task A_bank_that_does_not_answer_comes_back_as_unavailable() {
    StubBankAccount bank = new(new BankUnavailable());

    BankResult<AccountBalance> result = await new ReadBalanceHandler(bank, new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);

    result.Value.ShouldBeOfType<BankUnavailable>();
  }

  /// <summary>The account is a euro account, so any other currency is a bug: an exception, never an answer (D1).</summary>
  [Test]
  public async Task A_balance_in_another_currency_throws_and_the_message_names_neither_the_amount_nor_the_currency() {
    StubBankAccount bank = new(new Balance(7654.32m, "GBP"));

    InvalidOperationException error = await Should.ThrowAsync<InvalidOperationException>(
      () => new ReadBalanceHandler(bank, new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None));

    error.Message.ShouldNotContain("654", Case.Insensitive);
    error.Message.ShouldNotContain("GBP", Case.Insensitive);
  }

  /// <summary>
  /// The bank port, answering every balance read with <paramref name="answer"/> and recording who each read was for
  /// (<see cref="ReadsFor"/>); <paramref name="whileReading"/> runs during the read, as the time the bank takes.
  /// </summary>
  private sealed class StubBankAccount(BankResult<Balance> answer, Action? whileReading = null) : IBankAccount {
    private readonly List<object> _readsFor = [];

    /// <summary>Who each balance read was for, in order: the trigger's case (a <see cref="PresentUser"/> or <see cref="Unattended"/>).</summary>
    public IReadOnlyList<object> ReadsFor => _readsFor;

    public Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken) {
      _readsFor.Add(trigger.Value!);
      whileReading?.Invoke();

      return Task.FromResult(answer);
    }

    public Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken) =>
      throw new NotSupportedException("Reading the balance reads no transactions.");
  }
}