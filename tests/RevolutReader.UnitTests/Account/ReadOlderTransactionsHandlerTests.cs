using RevolutReader.Api.Account;
using RevolutReader.UnitTests.Rate;
using Shouldly;
using KorunaRate = RevolutReader.Api.Rate.KorunaRate;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// An older page (c010 design.md D1, D10): the kept transactions before a day, from the store alone, with the koruna rate
/// and its day as the rates answer them (c017 design.md D8). The handler is given a store and the rates and nothing else:
/// it has no bank to read, and the page it answers can only come from what the store keeps. The store is
/// <see cref="InMemoryTransactionStore"/>, the rates <see cref="FixedKorunaRates"/>. The kinds, the shown details and the
/// log are other slices' rules and are left alone here; the rate and its day are written out, as the contract. The
/// transactions are made up.
/// </summary>
public sealed class ReadOlderTransactionsHandlerTests {
  private static readonly DateOnly _november19 = new(2026, 11, 19);
  private static readonly DateOnly _november18 = new(2026, 11, 18);
  private static readonly DateOnly _november17 = new(2026, 11, 17);

  /// <summary>The rate the rates answer: the spec's 24.38 koruna per euro, for 2026-11-19.</summary>
  private static readonly KorunaRate _rate = new(24.38m, new DateOnly(2026, 11, 19));

  /// <summary>The rates' rate and day, written out (c017 design.md D8): 24.38 koruna per euro, for 2026-11-19.</summary>
  [Test]
  public async Task An_older_page_carries_the_rate_and_the_day_the_koruna_rates_answer() {
    InMemoryTransactionStore store = new();
    await store.Keep([Kept("e-1", _november18, 0, -12.30m)], CancellationToken.None);

    TransactionPage page = await Handler(store).Handle(_november19, CancellationToken.None);

    page.ShouldSatisfyAllConditions(
      () => page.CzkPerEur.ShouldBe(24.38m),
      () => page.RateDate.ShouldBe(new DateOnly(2026, 11, 19)));
  }

  /// <summary>
  /// The handler holds no bank, so nothing but the store can answer: the page is the store's transactions before
  /// 2026-11-19, in the store's order (newest day first, by position within a day), each with its day and amount.
  /// </summary>
  [Test]
  public async Task An_older_page_reads_only_the_store() {
    InMemoryTransactionStore store = new();
    await store.Keep([
      Kept("e-3", _november17, 0, -4.20m),
      Kept("e-2", _november18, 1, 50.00m),
      Kept("e-1", _november18, 0, -12.30m),
    ], CancellationToken.None);

    TransactionPage page = await Handler(store).Handle(_november19, CancellationToken.None);

    page.Transactions.Select(static transaction => (transaction.Date, transaction.Amount)).ShouldBe([
      (_november18, -12.30m),
      (_november18, 50.00m),
      (_november17, -4.20m),
    ]);
  }

  /// <summary>
  /// A kept transaction whose counterparty is empty or of spaces only names no one: the page carries none, so the screen
  /// names the kind instead (D4b).
  /// </summary>
  /// <param name="counterparty">Empty, or spaces only.</param>
  [Test]
  [Arguments("")]
  [Arguments("   ")]
  public async Task A_blank_counterparty_is_shown_as_none_on_an_older_page(string counterparty) {
    InMemoryTransactionStore store = new();
    await store.Keep([Kept("e-1", _november18, 0, -12.30m) with { Counterparty = counterparty }], CancellationToken.None);

    TransactionPage page = await Handler(store).Handle(_november19, CancellationToken.None);

    page.Transactions.ShouldHaveSingleItem().Counterparty.ShouldBeNull();
  }

  /// <summary>The handler under test, its rates answering <see cref="_rate"/>.</summary>
  private static ReadOlderTransactionsHandler Handler(ITransactionStore store) => new(store, new FixedKorunaRates(_rate));

  /// <summary>A settled transaction the store keeps, with a known type code and a line of details that does not repeat its counterparty.</summary>
  private static KeptTransaction Kept(string reference, DateOnly date, int position, decimal amount) =>
    new(reference, date, position, amount, Currency: "EUR", Counterparty: "Pekárna U Lípy", PaymentDetails: ["Praha 2"], TypeCode: "CARD_PAYMENT");
}