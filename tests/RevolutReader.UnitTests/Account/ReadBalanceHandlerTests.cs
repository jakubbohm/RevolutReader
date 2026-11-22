using System.Net;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using RevolutReader.UnitTests.Rate;
using Shouldly;
using KorunaRate = RevolutReader.Api.Rate.KorunaRate;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// Reading the balance for the API (c009 design.md D1, § Public API sketch; c017 design.md D4, D8): the handler reads it at
/// the bank as the given present user, and answers the amount in euros, the clock's time when the bank answered and the
/// koruna rate the rates answer; it asks for the rate before the bank answers, so the two run alongside, and awaits it
/// whatever the bank answers; each of the bank's failures comes back as the same case; a balance in any other currency is
/// a bug, whose message names neither the amount nor the currency (never log bank data). The bank is a hand-written stub
/// of the port that answers a fixed result, records who each read was for and can hold its answer; the rates are
/// <see cref="FixedKorunaRates"/>; the clock is a <see cref="FakeTimeProvider"/>. The amounts are made up, the rate is the
/// spec's Friday rate; the address is a documentation address (RFC 5737), the browser made up.
/// </summary>
public sealed class ReadBalanceHandlerTests {
  /// <summary>The handler's clock before the read.</summary>
  private static readonly DateTimeOffset _beforeTheRead = new(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);

  /// <summary>How long the stub bank takes to answer, on the handler's clock, so the read time can only be when it answered.</summary>
  private static readonly TimeSpan _theBankTakes = TimeSpan.FromSeconds(2);

  private static readonly PresentUser _lucieOnHerPhone = new(IPAddress.Parse("203.0.113.7"), "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)");

  /// <summary>The rate the rates answer: the spec's Friday rate, unlike any rate the app had before.</summary>
  private static readonly KorunaRate _fridaysRate = new(24.41m, new DateOnly(2026, 11, 20));

  [Test]
  public async Task The_balance_comes_with_the_clocks_time_when_the_bank_answered() {
    FakeTimeProvider clock = new(_beforeTheRead);
    StubBankAccount bank = new(new Balance(286.40m, "EUR"), whileReading: () => clock.Advance(_theBankTakes));

    BankResult<AccountBalance> result = await new ReadBalanceHandler(bank, new FixedKorunaRates(_fridaysRate), clock).Handle(_lucieOnHerPhone, CancellationToken.None);

    AccountBalance balance = result.Value.ShouldBeOfType<AccountBalance>();
    balance.ShouldSatisfyAllConditions(
      () => balance.Amount.ShouldBe(286.40m),
      () => balance.ReadAt.ShouldBe(_beforeTheRead + _theBankTakes));
  }

  [Test]
  public async Task The_balance_carries_the_rate_the_koruna_rates_answer() {
    StubBankAccount bank = new(new Balance(286.40m, "EUR"));

    BankResult<AccountBalance> result = await new ReadBalanceHandler(bank, new FixedKorunaRates(_fridaysRate), new FakeTimeProvider(_beforeTheRead))
      .Handle(_lucieOnHerPhone, CancellationToken.None);

    result.Value.ShouldBeOfType<AccountBalance>().CzkPerEur.ShouldBe(24.41m);
  }

  /// <summary>
  /// Both the bank's answer and the rate are held, so neither can come before the other is asked: the handler, once
  /// called, has asked for the rate while the bank has not answered and read the bank while the rate has not come
  /// (c017 design.md D4).
  /// </summary>
  [Test]
  public async Task The_rate_is_asked_before_the_bank_answers_so_the_two_run_alongside() {
    StubBankAccount bank = new(new Balance(286.40m, "EUR"));
    FixedKorunaRates rates = new(_fridaysRate);
    bank.HoldTheAnswer();
    rates.HoldTheAnswer();

    Task<BankResult<AccountBalance>> handling = new ReadBalanceHandler(bank, rates, new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);

    try {
      bank.ShouldSatisfyAllConditions(
        () => rates.TimesAsked.ShouldBe(1, "the rate is asked while the bank has not answered"),
        () => bank.ReadsFor.ShouldBe([_lucieOnHerPhone], "the bank is read while the rate has not come"));
    }
    finally {
      rates.ReleaseTheAnswer();
      bank.ReleaseTheAnswer();
    }

    (await handling).Value.ShouldBeOfType<AccountBalance>("the balance, once both have come");
  }

  /// <summary>The rate is held while the bank fails at once: the handler answers only once the rate it asked has come (c017 design.md D8).</summary>
  [Test]
  public async Task A_bank_failure_still_comes_back_as_its_case_with_the_rate_awaited() {
    StubBankAccount bank = new(new BankUnavailable());
    FixedKorunaRates rates = new(_fridaysRate);
    rates.HoldTheAnswer();

    Task<BankResult<AccountBalance>> handling = new ReadBalanceHandler(bank, rates, new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);
    bool answeredBeforeTheRate = handling.IsCompleted;
    rates.ReleaseTheAnswer();
    BankResult<AccountBalance> result = await handling;

    result.ShouldSatisfyAllConditions(
      () => rates.TimesAsked.ShouldBe(1, "the rate is asked"),
      () => answeredBeforeTheRate.ShouldBeFalse("the handler waits for the rate it asked before it answers"),
      () => result.Value.ShouldBeOfType<BankUnavailable>("the bank's failure, as it came"));
  }

  [Test]
  public async Task The_read_is_made_as_the_given_present_user() {
    StubBankAccount bank = new(new Balance(286.40m, "EUR"));

    _ = await new ReadBalanceHandler(bank, new FixedKorunaRates(_fridaysRate), new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);

    bank.ReadsFor.ShouldBe([_lucieOnHerPhone]);
  }

  [Test]
  public async Task Expired_bank_access_comes_back_as_access_expired() {
    StubBankAccount bank = new(new BankAccessExpired());

    BankResult<AccountBalance> result = await new ReadBalanceHandler(bank, new FixedKorunaRates(_fridaysRate), new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);

    result.Value.ShouldBeOfType<BankAccessExpired>();
  }

  [Test]
  public async Task A_reached_bank_limit_comes_back_as_rate_limited() {
    StubBankAccount bank = new(new BankRateLimited());

    BankResult<AccountBalance> result = await new ReadBalanceHandler(bank, new FixedKorunaRates(_fridaysRate), new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);

    result.Value.ShouldBeOfType<BankRateLimited>();
  }

  [Test]
  public async Task A_bank_that_does_not_answer_comes_back_as_unavailable() {
    StubBankAccount bank = new(new BankUnavailable());

    BankResult<AccountBalance> result = await new ReadBalanceHandler(bank, new FixedKorunaRates(_fridaysRate), new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None);

    result.Value.ShouldBeOfType<BankUnavailable>();
  }

  /// <summary>The account is a euro account, so any other currency is a bug: an exception, never an answer (D1).</summary>
  [Test]
  public async Task A_balance_in_another_currency_throws_and_the_message_names_neither_the_amount_nor_the_currency() {
    StubBankAccount bank = new(new Balance(7654.32m, "GBP"));

    InvalidOperationException error = await Should.ThrowAsync<InvalidOperationException>(
      () => new ReadBalanceHandler(bank, new FixedKorunaRates(_fridaysRate), new FakeTimeProvider(_beforeTheRead)).Handle(_lucieOnHerPhone, CancellationToken.None));

    error.Message.ShouldNotContain("654", Case.Insensitive);
    error.Message.ShouldNotContain("GBP", Case.Insensitive);
  }

  /// <summary>
  /// The bank port, answering every balance read with <paramref name="answer"/> and recording who each read was for
  /// (<see cref="ReadsFor"/>) as the read starts; <paramref name="whileReading"/> runs during the read, as the time the bank
  /// takes. Its answer can be held (<see cref="HoldTheAnswer"/>) until the test releases it (<see cref="ReleaseTheAnswer"/>).
  /// </summary>
  private sealed class StubBankAccount(BankResult<Balance> answer, Action? whileReading = null) : IBankAccount {
    private readonly List<object> _readsFor = [];
    private TaskCompletionSource? _held;

    /// <summary>Who each balance read was for, in order: the trigger's case (a <see cref="PresentUser"/> or <see cref="Unattended"/>).</summary>
    public IReadOnlyList<object> ReadsFor => _readsFor;

    /// <summary>Reads from now on wait for <see cref="ReleaseTheAnswer"/> before they answer.</summary>
    public void HoldTheAnswer() => _held ??= new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Every held read answers now.</summary>
    public void ReleaseTheAnswer() => _held?.TrySetResult();

    public async Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken) {
      _readsFor.Add(trigger.Value!);
      whileReading?.Invoke();

      if (_held is not null)
        await _held.Task.WaitAsync(cancellationToken);

      return answer;
    }

    public Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken) =>
      throw new NotSupportedException("Reading the balance reads no transactions.");
  }
}