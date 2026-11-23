using System.Globalization;
using RevolutReader.Api.Account;
using RevolutReader.UnitTests.Rate;
using Shouldly;
using KorunaRate = RevolutReader.Api.Rate.KorunaRate;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// An older page (c010 design.md D1, D10): the kept transactions before a day, from the store alone, with the koruna rate
/// and its day as the rates answer them (c017 design.md D8), and each transaction's first-seen time as the first-seen store
/// keeps it (c018 design.md D2, D8, D9). The handler is given a store, the first-seen store and the rates and nothing else:
/// it has no bank to read, and the page it answers can only come from what the stores keep. The store is
/// <see cref="InMemoryTransactionStore"/>, the first-seen store <see cref="InMemoryFirstSeenStore"/> (empty unless a test
/// hands in its own), the rates <see cref="FixedKorunaRates"/>. The kinds, the shown details and the
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

  /// <summary>
  /// The kept transactions on 2026-11-18, the page before 2026-11-19, each with a first-seen moment kept: the spec's
  /// payment at 13:05:12 UTC on its own day, answered; one at 00:10:00 UTC on 2026-11-19, the day after its date,
  /// answered as none (<see cref="FirstSeenRule.Shown"/>); and one with no moment kept, answered as none.
  /// </summary>
  [Test]
  public async Task An_older_pages_transaction_carries_the_moment_kept_for_its_reference_through_FirstSeenRule_Shown() {
    InMemoryTransactionStore store = new();
    await store.Keep([
      Kept("e-c018-pekarna", _november18, 0, -12.30m),
      Kept("e-c018-kavarna", _november18, 1, -8.90m),
      Kept("e-c018-trafika", _november18, 2, -3.80m),
    ], CancellationToken.None);
    InMemoryFirstSeenStore firstSeen = new();
    firstSeen.Keep("e-c018-pekarna", new DateTimeOffset(2026, 11, 18, 13, 5, 12, TimeSpan.Zero));
    firstSeen.Keep("e-c018-kavarna", new DateTimeOffset(2026, 11, 19, 0, 10, 0, TimeSpan.Zero));

    TransactionPage page = await Handler(store, firstSeen).Handle(_november19, CancellationToken.None);

    page.Transactions.Select(static transaction => $"{transaction.Amount.ToString(CultureInfo.InvariantCulture)} {Written(transaction.SeenAt)}").ShouldBe([
      "-12.30 2026-11-18T13:05:12.0000000+00:00",
      "-8.90 none",
      "-3.80 none",
    ]);
  }

  /// <summary>
  /// The store keeps one transaction on 2026-11-19, the day the page is asked before, 30 on 2026-11-18, which fill the
  /// page, and one on 2026-11-17, past it: the first-seen store is read once, for the 30 references on the page alone.
  /// </summary>
  [Test]
  public async Task An_older_page_reads_the_first_seen_store_once_for_its_own_transactions_references() {
    string[] onThePage = [.. Enumerable.Range(0, TransactionPaging.PAGE_SIZE).Select(static position => $"e-c018-18-{position:00}")];
    InMemoryTransactionStore store = new();
    await store.Keep([
      Kept("e-c018-19", _november19, 0, -4.20m),
      .. onThePage.Select(static (reference, position) => Kept(reference, _november18, position, -1.00m)),
      Kept("e-c018-17", _november17, 0, -2.50m),
    ], CancellationToken.None);
    InMemoryFirstSeenStore firstSeen = new();

    TransactionPage page = await Handler(store, firstSeen).Handle(_november19, CancellationToken.None);

    page.ShouldSatisfyAllConditions(
      () => page.Transactions.Count.ShouldBe(TransactionPaging.PAGE_SIZE, "the transactions on the page"),
      () => firstSeen.ReferencesRead.ShouldHaveSingleItem("the reads sent").ShouldBe(onThePage, ignoreOrder: true, "the references read"));
  }

  /// <summary>
  /// The first-seen store fails: the store's own exception comes out of the handler, and no page is answered (D8).
  /// </summary>
  [Test]
  public async Task A_first_seen_store_failure_on_an_older_page_throws() {
    InMemoryTransactionStore store = new();
    await store.Keep([Kept("e-c018-pekarna", _november18, 0, -12.30m)], CancellationToken.None);
    InvalidOperationException storeFailure = new("The first-seen store fails (made up).");
    InMemoryFirstSeenStore firstSeen = new();
    firstSeen.FailWith(storeFailure);

    InvalidOperationException thrown = await Should.ThrowAsync<InvalidOperationException>(
      () => Handler(store, firstSeen).Handle(_november19, CancellationToken.None));

    thrown.ShouldBeSameAs(storeFailure, "the first-seen store's own exception");
  }

  /// <summary>
  /// The handler under test, its rates answering <see cref="_rate"/>, its first-seen store a new, empty
  /// <see cref="InMemoryFirstSeenStore"/> unless a test hands in its own.
  /// </summary>
  private static ReadOlderTransactionsHandler Handler(ITransactionStore store, IFirstSeenStore? firstSeen = null) =>
    new(store, firstSeen ?? new InMemoryFirstSeenStore(), new FixedKorunaRates(_rate));

  /// <summary>A moment written out in the round-trip form, or <c>none</c>.</summary>
  private static string Written(DateTimeOffset? moment) => moment?.ToString("O", CultureInfo.InvariantCulture) ?? "none";

  /// <summary>A settled transaction the store keeps, with a known type code and a line of details that does not repeat its counterparty.</summary>
  private static KeptTransaction Kept(string reference, DateOnly date, int position, decimal amount) =>
    new(reference, date, position, amount, Currency: "EUR", Counterparty: "Pekárna U Lípy", PaymentDetails: ["Praha 2"], TypeCode: "CARD_PAYMENT");
}