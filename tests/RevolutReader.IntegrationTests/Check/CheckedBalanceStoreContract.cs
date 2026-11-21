using RevolutReader.Api.Account;
using RevolutReader.Api.Check;
using Shouldly;

namespace RevolutReader.IntegrationTests.Check;

/// <summary>
/// The contract of the account check's store of its two balances (c014 design.md § Ports and contracts, D4), written only
/// against <see cref="ICheckedBalanceStore"/>, and run against both the in-memory fake the unit tests use
/// (<see cref="InMemoryCheckedBalanceStoreContract"/>) and the Table adapter on Azurite
/// (<see cref="TableCheckedBalanceStoreContract"/>), so the fake stays honest:
/// <list type="bullet">
/// <item><c>Read</c>: <see langword="null"/> when nothing was ever saved; otherwise both balances as last saved, whole: the
/// amounts to the cent, a negative one too, and beyond what a <see cref="double"/> holds (amounts and rates are kept as
/// decimal text, D4); the rates with all their decimals; the read times as the same instants, to the tick.</item>
/// <item><c>Save</c>: replaces both, whole: a second save leaves the latest values.</item>
/// </list>
/// A read time is given with an offset, and each with another one, and comes back as the same instant: the store need not
/// keep the offset itself. Table Storage keeps its date type in UTC; probed on Azurite 3.37.0 (2026-11-21): a
/// <see cref="DateTimeOffset"/> written at +01:00 with seven decimals of a second read back as the same instant to the
/// tick, at +00:00. Each test starts from a new, empty store of its own (<see cref="NewStore"/>: for the adapter, a table
/// no other test uses). The amounts and rates are made up.
/// </summary>
public abstract class CheckedBalanceStoreContract {
  [Test]
  public async Task Nothing_stored_reads_as_nothing() {
    ICheckedBalanceStore store = NewStore();

    (await store.Read(CancellationToken.None)).ShouldBeNull();
  }

  /// <summary>
  /// Last seen is negative, read an hour east of UTC; last notified is larger than a <see cref="double"/> holds to the cent,
  /// read five hours west of UTC late in the evening, so its UTC day is the next one: a store that kept a local time as UTC,
  /// or dropped the ticks below a second, or a rate's decimals, fails.
  /// </summary>
  [Test]
  public async Task Saved_balances_read_back_whole_amounts_to_the_cent_rates_with_their_decimals_read_times_with_their_offset() {
    ICheckedBalanceStore store = NewStore();
    CheckedBalances saved = new(
      LastSeen: new AccountBalance(-1234.56m, new DateTimeOffset(2026, 11, 21, 10, 14, 3, TimeSpan.FromHours(1)).AddTicks(5_123_457), CzkPerEur: 24.3456789012345678m),
      LastNotified: new AccountBalance(98765432109876.54m, new DateTimeOffset(2026, 11, 20, 21, 2, 44, TimeSpan.FromHours(-5)).AddTicks(9_876_543), CzkPerEur: 24.3m));

    await store.Save(saved, CancellationToken.None);

    CheckedBalances read = (await store.Read(CancellationToken.None)).ShouldNotBeNull("the balances saved");
    read.ShouldSatisfyAllConditions(
      () => read.LastSeen.Amount.ShouldBe(-1234.56m, "last seen's amount, negative, to the cent"),
      () => read.LastSeen.ReadAt.UtcTicks.ShouldBe(saved.LastSeen.ReadAt.UtcTicks, "last seen's read time, the same instant to the tick"),
      () => read.LastSeen.CzkPerEur.ShouldBe(24.3456789012345678m, "last seen's rate, with all its decimals"),
      () => read.LastNotified.Amount.ShouldBe(98765432109876.54m, "last notified's amount, to the cent"),
      () => read.LastNotified.ReadAt.UtcTicks.ShouldBe(saved.LastNotified.ReadAt.UtcTicks, "last notified's read time, the same instant to the tick"),
      () => read.LastNotified.CzkPerEur.ShouldBe(24.3m, "last notified's rate"));
  }

  [Test]
  public async Task A_second_save_replaces_the_first() {
    ICheckedBalanceStore store = NewStore();
    DateTimeOffset firstRead = new(2026, 11, 21, 8, 0, 0, TimeSpan.Zero);
    CheckedBalances first = new(
      LastSeen: new AccountBalance(49.00m, firstRead, CzkPerEur: 24.3m),
      LastNotified: new AccountBalance(49.00m, firstRead, CzkPerEur: 24.3m));
    CheckedBalances second = new(
      LastSeen: new AccountBalance(45.20m, firstRead.AddMinutes(5), CzkPerEur: 24.4m),
      LastNotified: new AccountBalance(47.10m, firstRead.AddMinutes(2), CzkPerEur: 24.35m));
    await store.Save(first, CancellationToken.None);

    await store.Save(second, CancellationToken.None);

    (await store.Read(CancellationToken.None)).ShouldBe(second, "the latest values, whole");
  }

  /// <summary>A new, empty store of the test's own.</summary>
  protected abstract ICheckedBalanceStore NewStore();
}