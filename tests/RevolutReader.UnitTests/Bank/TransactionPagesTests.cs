using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// A transactions read follows every page (spec bank-reads, "Every page is read"; c004 design.md D7): it asks for the
/// next page with the continuation key the last one returned, until a page comes back without one
/// (<c>continuation_key: null</c>, as Revolut and the Mock ASPSP mark the last page, § Bootstrap), also after an empty
/// page, and joins the pages in order. A key that comes back again would loop forever, so it is an error. The fake bank
/// here answers each key with its page and records the keys it was asked for: which page was requested with which key is
/// the contract. Keys and transactions are made up.
/// </summary>
public sealed class TransactionPagesTests {
  private const string KEY_OF_PAGE_2 = "ck-page-2-7d1e";
  private const string KEY_OF_PAGE_3 = "ck-page-3-a94c";

  [Test]
  public async Task A_page_without_a_continuation_key_is_the_whole_list() {
    EbTransaction[] transactions = [Booked("e-101"), Booked("e-102")];
    PagesAtBank bank = new(firstPage: new(transactions, ContinuationKey: null));

    JoinedPages joined = Joined(await TransactionPages.ReadAll(bank.Read));

    joined.Transactions.ShouldBe(transactions);
    bank.KeysAskedFor.ShouldBe([null], "one request, for the first page");
  }

  [Test]
  public async Task Pages_are_followed_until_no_continuation_key_comes_back_and_joined_in_order() {
    PagesAtBank bank = new(
      firstPage: new([Booked("e-101"), Booked("e-102")], KEY_OF_PAGE_2),
      (KEY_OF_PAGE_2, new([Booked("e-103")], KEY_OF_PAGE_3)),
      (KEY_OF_PAGE_3, new([Booked("e-104"), Booked("e-105")], ContinuationKey: null)));

    JoinedPages joined = Joined(await TransactionPages.ReadAll(bank.Read));

    joined.Transactions.Select(static transaction => transaction.EntryReference).ShouldBe(["e-101", "e-102", "e-103", "e-104", "e-105"]);
    bank.KeysAskedFor.ShouldBe([null, KEY_OF_PAGE_2, KEY_OF_PAGE_3]);
  }

  [Test]
  public async Task An_empty_page_with_a_continuation_key_is_followed() {
    PagesAtBank bank = new(
      firstPage: new([Booked("e-101")], KEY_OF_PAGE_2),
      (KEY_OF_PAGE_2, new([], KEY_OF_PAGE_3)),
      (KEY_OF_PAGE_3, new([Booked("e-102")], ContinuationKey: null)));

    JoinedPages joined = Joined(await TransactionPages.ReadAll(bank.Read));

    joined.Transactions.Select(static transaction => transaction.EntryReference).ShouldBe(["e-101", "e-102"]);
    bank.KeysAskedFor.ShouldBe([null, KEY_OF_PAGE_2, KEY_OF_PAGE_3]);
  }

  /// <param name="repeat">
  /// Any key seen before closes a loop, so both count: the key of the page just read, or the key of an earlier one.
  /// </param>
  [Test]
  [Arguments("the key of the page just read")]
  [Arguments("the key of an earlier page")]
  public async Task A_repeated_continuation_key_is_an_error(string repeat) {
    (PagesAtBank bank, string?[] keysAskedFor) = repeat switch {
      "the key of the page just read" => (
        new PagesAtBank(firstPage: new([Booked("e-101")], KEY_OF_PAGE_2), (KEY_OF_PAGE_2, new([Booked("e-102")], KEY_OF_PAGE_2))),
        new string?[] { null, KEY_OF_PAGE_2 }),
      "the key of an earlier page" => (
        new PagesAtBank(
          firstPage: new([Booked("e-101")], KEY_OF_PAGE_2),
          (KEY_OF_PAGE_2, new([Booked("e-102")], KEY_OF_PAGE_3)),
          (KEY_OF_PAGE_3, new([Booked("e-103")], KEY_OF_PAGE_2))),
        new string?[] { null, KEY_OF_PAGE_2, KEY_OF_PAGE_3 }),
      _ => throw new ArgumentOutOfRangeException(nameof(repeat), repeat, "Not a known case."),
    };

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => TransactionPages.ReadAll(bank.Read));

    bank.KeysAskedFor.ShouldBe(keysAskedFor, "no page is asked for again with the repeated key");

    string text = error.ToString();

    bank.BankData().ShouldAllBe(value => !text.Contains(value, StringComparison.Ordinal), "the error carries neither a key nor a transaction's data (D5)");
  }

  /// <param name="pages">One page; or three, the middle one empty, which counts like any other.</param>
  /// <param name="pageCount">The pages read.</param>
  [Test]
  [Arguments("one page", 1)]
  [Arguments("three pages, one of them empty", 3)]
  public async Task The_pages_read_are_counted(string pages, int pageCount) {
    PagesAtBank bank = pages switch {
      "one page" => new(firstPage: new([Booked("e-101")], ContinuationKey: null)),
      "three pages, one of them empty" => new(
        firstPage: new([Booked("e-101")], KEY_OF_PAGE_2),
        (KEY_OF_PAGE_2, new([], KEY_OF_PAGE_3)),
        (KEY_OF_PAGE_3, new([Booked("e-102")], ContinuationKey: null))),
      _ => throw new ArgumentOutOfRangeException(nameof(pages), pages, "Not a known case."),
    };

    Joined(await TransactionPages.ReadAll(bank.Read)).PageCount.ShouldBe(pageCount);
  }

  /// <summary>The read's value; fails when the read came back as one of the failures instead.</summary>
  private static JoinedPages Joined(BankResult<JoinedPages> result) => result.Value.ShouldBeOfType<JoinedPages>();

  /// <summary>A booked payment with this reference; the pages pass transactions on without mapping them.</summary>
  private static EbTransaction Booked(string reference) => new(
    EntryReference: reference,
    Status: "BOOK",
    TransactionAmount: new("EUR", "12.30"),
    CreditDebitIndicator: "DBIT",
    Creditor: new("Pekárna U Lípy"),
    Debtor: null,
    TransactionDate: null,
    BookingDate: new DateOnly(2026, 11, 3),
    ValueDate: new DateOnly(2026, 11, 3),
    RemittanceInformation: ["Pekárna U Lípy"]);

  /// <summary>
  /// The fake bank: the first page for no key, each further page for its key, and a record of the keys asked for, in
  /// order. A key it has no page for, or more requests than a test could need (a loop), fails the test instead of hanging it.
  /// </summary>
  private sealed class PagesAtBank(EbTransactionPage firstPage, params (string Key, EbTransactionPage Page)[] next) {
    private const int MOST_REQUESTS_A_TEST_NEEDS = 10;

    private readonly List<string?> _keysAskedFor = [];

    public IReadOnlyList<string?> KeysAskedFor => _keysAskedFor;

    public Task<BankResult<EbTransactionPage>> Read(string? continuationKey) {
      _keysAskedFor.Add(continuationKey);

      if (_keysAskedFor.Count > MOST_REQUESTS_A_TEST_NEEDS)
        throw new InvalidOperationException($"More than {MOST_REQUESTS_A_TEST_NEEDS} pages asked for: the read loops.");

      EbTransactionPage page = continuationKey is null
        ? firstPage
        : next.FirstOrDefault(entry => entry.Key == continuationKey).Page ?? throw new InvalidOperationException("A page asked for with a key the bank never gave.");

      return Task.FromResult<BankResult<EbTransactionPage>>(page);
    }

    /// <summary>What the bank's pages hold that no error may quote: the keys, and each transaction's amount, currency, reference, names and details.</summary>
    public IEnumerable<string> BankData() =>
      new[] { firstPage }.Concat(next.Select(static entry => entry.Page))
        .SelectMany(static page => new[] { page.ContinuationKey }.Concat(page.Transactions.SelectMany(static transaction => new[] {
          transaction.TransactionAmount.Amount, transaction.TransactionAmount.Currency, transaction.EntryReference, transaction.Creditor?.Name, transaction.Debtor?.Name,
        }.Concat(transaction.RemittanceInformation ?? []))))
        .OfType<string>()
        .Where(static value => value.Length > 0)
        .Distinct(StringComparer.Ordinal);
  }
}