using RevolutReader.Api.Account;
using Shouldly;

namespace RevolutReader.IntegrationTests.Account;

/// <summary>
/// The contract of the store of settled transactions (c010 design.md § Ports and contracts, D5), written only against
/// <see cref="ITransactionStore"/>, and run against both the in-memory fake the unit tests use
/// (<see cref="InMemoryTransactionStoreContract"/>) and the Table adapter on Azurite
/// (<see cref="TableTransactionStoreContract"/>), so the fake stays honest:
/// <list type="bullet">
/// <item><c>ReadAll</c>: every kept transaction, newest day first, then by its position within the day; an empty store
/// reads as no transactions; every field comes back as kept: the amount to the cent, an empty list of details as empty, a
/// missing counterparty or type code as missing, a reference with <c>/</c>, <c>#</c>, <c>?</c> or <c>\</c>
/// unchanged.</item>
/// <item><c>Keep</c>: inserts or replaces each by its reference, so keeping one again leaves one with the latest values;
/// keeping nothing changes nothing; more than 100 at once (Table Storage's limit for one batch) keeps them all.</item>
/// </list>
/// Each test starts from a new, empty store of its own (<see cref="NewStore"/>: for the adapter, a table no other test
/// uses) and keeps its own made-up transactions, with references of its own. The names are the spec's made-up ones.
/// </summary>
public abstract class TransactionStoreContract {
  private static readonly DateOnly _november17 = new(2026, 11, 17);
  private static readonly DateOnly _november18 = new(2026, 11, 18);
  private static readonly DateOnly _november19 = new(2026, 11, 19);

  [Test]
  public async Task An_empty_store_reads_as_no_transactions() {
    ITransactionStore store = NewStore();

    (await store.ReadAll(CancellationToken.None)).ShouldBeEmpty();
  }

  /// <summary>Kept in an order that is neither by day nor by position, in one call.</summary>
  [Test]
  public async Task Kept_transactions_read_back_newest_day_first_then_by_their_position_within_the_day() {
    ITransactionStore store = NewStore();

    await store.Keep([
      Payment("e-302", _november18, position: 1),
      Payment("e-601", _november17, position: 2),
      Payment("e-101", _november19, position: 0),
      Payment("e-401", _november17, position: 0),
      Payment("e-301", _november18, position: 0),
      Payment("e-501", _november17, position: 1),
    ], CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).Select(static transaction => transaction.Reference)
      .ShouldBe(["e-101", "e-301", "e-302", "e-401", "e-501", "e-601"]);
  }

  /// <summary>
  /// Two transactions, each field set or missing on purpose: a payment with no counterparty, no details and no type code;
  /// and a refund whose amount has more significant digits than a double holds, with two lines of details, one with
  /// spaces around it.
  /// </summary>
  [Test]
  public async Task Every_field_reads_back_as_kept_the_amount_to_the_cent_empty_details_a_missing_counterparty_and_a_missing_type_code() {
    ITransactionStore store = NewStore();

    await store.Keep([
      new KeptTransaction("e-201", _november18, Position: 0, Amount: -1234.56m, Currency: "EUR", Counterparty: null, PaymentDetails: [], TypeCode: null),
      new KeptTransaction("e-202", _november17, Position: 3, Amount: 98765432109876.54m, Currency: "CZK", Counterparty: "Lékárna Benu", PaymentDetails: ["Reklamace", "  Praha 2  "], TypeCode: "CARD_REFUND"),
    ], CancellationToken.None);

    IReadOnlyList<KeptTransaction> read = await store.ReadAll(CancellationToken.None);

    read.Count.ShouldBe(2, "the two transactions kept");
    KeptTransaction payment = read.Where(static transaction => transaction.Reference == "e-201").ShouldHaveSingleItem("the payment e-201");
    payment.ShouldSatisfyAllConditions(
      () => payment.Date.ShouldBe(_november18),
      () => payment.Position.ShouldBe(0),
      () => payment.Amount.ShouldBe(-1234.56m),
      () => payment.Currency.ShouldBe("EUR"),
      () => payment.Counterparty.ShouldBeNull(),
      () => payment.PaymentDetails.ShouldBeEmpty(),
      () => payment.TypeCode.ShouldBeNull());
    KeptTransaction refund = read.Where(static transaction => transaction.Reference == "e-202").ShouldHaveSingleItem("the refund e-202");
    refund.ShouldSatisfyAllConditions(
      () => refund.Date.ShouldBe(_november17),
      () => refund.Position.ShouldBe(3),
      () => refund.Amount.ShouldBe(98765432109876.54m),
      () => refund.Currency.ShouldBe("CZK"),
      () => refund.Counterparty.ShouldBe("Lékárna Benu"),
      () => refund.PaymentDetails.ShouldBe(["Reklamace", "  Praha 2  "]),
      () => refund.TypeCode.ShouldBe("CARD_REFUND"));
  }

  /// <summary>Table Storage forbids each of these four in a key (D5); the bank never promised to leave them out of a reference.</summary>
  [Test]
  public async Task A_reference_containing_a_slash_a_hash_a_question_mark_or_a_backslash_reads_back_unchanged() {
    ITransactionStore store = NewStore();
    string[] references = ["e/101", "e#102", "e?103", @"e\104", @"e/#?\105"];

    await store.Keep([.. references.Select((reference, position) => Payment(reference, _november18, position))], CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).Select(static transaction => transaction.Reference).ShouldBe(references);
  }

  /// <summary>
  /// The second keep changes every field but the reference, and leaves out the counterparty, the details and the type code
  /// the first gave: the latest values replace the first ones whole, never merged into them.
  /// </summary>
  [Test]
  public async Task Keeping_a_transaction_again_leaves_one_transaction_with_the_latest_values() {
    ITransactionStore store = NewStore();
    await store.Keep([
      new KeptTransaction("e-701", _november18, Position: 0, Amount: -12.30m, Currency: "EUR", Counterparty: "Pekárna U Lípy", PaymentDetails: ["Praha 2"], TypeCode: "CARD_PAYMENT"),
    ], CancellationToken.None);

    await store.Keep([
      new KeptTransaction("e-701", _november19, Position: 2, Amount: -12.40m, Currency: "CZK", Counterparty: null, PaymentDetails: [], TypeCode: null),
    ], CancellationToken.None);

    KeptTransaction kept = (await store.ReadAll(CancellationToken.None)).ShouldHaveSingleItem();
    kept.ShouldSatisfyAllConditions(
      () => kept.Reference.ShouldBe("e-701"),
      () => kept.Date.ShouldBe(_november19),
      () => kept.Position.ShouldBe(2),
      () => kept.Amount.ShouldBe(-12.40m),
      () => kept.Currency.ShouldBe("CZK"),
      () => kept.Counterparty.ShouldBeNull(),
      () => kept.PaymentDetails.ShouldBeEmpty(),
      () => kept.TypeCode.ShouldBeNull());
  }

  /// <summary>250 at once, more than two of Table Storage's batches of 100, over five days.</summary>
  [Test]
  public async Task Keeping_more_than_100_transactions_at_once_keeps_them_all() {
    ITransactionStore store = NewStore();
    KeptTransaction[] transactions = [
      .. Enumerable.Range(0, 250).Select(static number => Payment(FormattableString.Invariant($"e-8{number:000}"),_november19.AddDays(-(number % 5)), position: number / 5)),
    ];

    await store.Keep(transactions, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).Select(static transaction => transaction.Reference)
      .ShouldBe(transactions.Select(static transaction => transaction.Reference), ignoreOrder: true);
  }

  /// <summary>Nothing kept into an empty store, then into one that holds two.</summary>
  [Test]
  public async Task Keeping_nothing_changes_nothing() {
    ITransactionStore store = NewStore();

    await store.Keep([], CancellationToken.None);
    (await store.ReadAll(CancellationToken.None)).ShouldBeEmpty("an empty store, after keeping nothing");

    await store.Keep([Payment("e-901", _november19, position: 0), Payment("e-902", _november18, position: 0)], CancellationToken.None);
    await store.Keep([], CancellationToken.None);
    (await store.ReadAll(CancellationToken.None)).Select(static transaction => transaction.Reference)
      .ShouldBe(["e-901", "e-902"], "the two kept before, after keeping nothing");
  }

  /// <summary>A new, empty store no other test uses.</summary>
  protected abstract ITransactionStore NewStore();

  /// <summary>A settled card payment of 12.30 EUR to "Pekárna U Lípy" with this reference, day and place within the day.</summary>
  private static KeptTransaction Payment(string reference, DateOnly date, int position) =>
    new(reference, date, position, Amount: -12.30m, Currency: "EUR", Counterparty: "Pekárna U Lípy", PaymentDetails: ["Praha 2"], TypeCode: "CARD_PAYMENT");
}