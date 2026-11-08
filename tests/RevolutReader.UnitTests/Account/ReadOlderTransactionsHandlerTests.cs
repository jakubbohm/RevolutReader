using Microsoft.Extensions.Logging.Abstractions;
using RevolutReader.Api.Account;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// An older page (c010 design.md D1, D10): the kept transactions before a day, from the store alone, with the koruna rate
/// and its date as the newest page carries them. The handler is given a store and a logger and nothing else: it has no
/// bank to read, and the page it answers can only come from what the store keeps. The store is
/// <see cref="InMemoryTransactionStore"/>. The kinds, the shown details and the log are other slices' rules and are left
/// alone here; the rate and its date are written out, as the contract. The transactions are made up.
/// </summary>
public sealed class ReadOlderTransactionsHandlerTests {
  private static readonly DateOnly _november19 = new(2026, 11, 19);
  private static readonly DateOnly _november18 = new(2026, 11, 18);
  private static readonly DateOnly _november17 = new(2026, 11, 17);

  /// <summary>C13's rate and the day it is for, written out: 24.3 koruna per euro, 2026-11-08.</summary>
  [Test]
  public async Task An_older_page_carries_the_koruna_rate_and_its_date() {
    InMemoryTransactionStore store = new();
    await store.Keep([Kept("e-1", _november18, 0, -12.30m)], CancellationToken.None);

    TransactionPage page = await Handler(store).Handle(_november19, CancellationToken.None);

    page.ShouldSatisfyAllConditions(
      () => page.CzkPerEur.ShouldBe(24.3m),
      () => page.RateDate.ShouldBe(new DateOnly(2026, 11, 8)));
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

  private static ReadOlderTransactionsHandler Handler(ITransactionStore store) => new(store, NullLogger<ReadOlderTransactionsHandler>.Instance);

  /// <summary>A settled transaction the store keeps, with a known type code and a line of details that does not repeat its counterparty.</summary>
  private static KeptTransaction Kept(string reference, DateOnly date, int position, decimal amount) =>
    new(reference, date, position, amount, Currency: "EUR", Counterparty: "Pekárna U Lípy", PaymentDetails: ["Praha 2"], TypeCode: "CARD_PAYMENT");
}