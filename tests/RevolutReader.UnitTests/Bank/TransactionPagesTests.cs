using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// A transactions read follows every page (spec bank-reads, "Every page is read"; c004 design.md D7): it asks for the
/// next page with the continuation key the last one returned, until a page comes back without one
/// (<c>continuation_key: null</c>, as Revolut and the Mock ASPSP mark the last page, § Bootstrap), also after an empty
/// page, and joins the pages in order. A key that comes back again would loop forever, so it is an error, and so is a
/// 20th page that still carries a key: a read requests at most 20 pages (c006 design.md D4). The fake bank here answers
/// each key with its page and records the keys it was asked for: which page was requested with which key is the contract.
/// Keys and transactions are made up.
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

  /// <summary>
  /// The bank marks the last page with no key; an empty key is undocumented and cannot name a page, so it ends the read
  /// the same way (D7, the user, 2026-11-07): nothing more is asked for, and the page that carried it counts.
  /// </summary>
  [Test]
  public async Task An_empty_continuation_key_ends_the_read_as_no_key_does() {
    PagesAtBank bank = new(
      firstPage: new([Booked("e-101")], KEY_OF_PAGE_2),
      (KEY_OF_PAGE_2, new([Booked("e-102")], ContinuationKey: "")));

    JoinedPages joined = Joined(await TransactionPages.ReadAll(bank.Read));

    joined.Transactions.Select(static transaction => transaction.EntryReference).ShouldBe(["e-101", "e-102"]);
    joined.PageCount.ShouldBe(2);
    bank.KeysAskedFor.ShouldBe([null, KEY_OF_PAGE_2], "no page is asked for with the empty key");
  }

  /// <param name="failure">
  /// Each of the bank's expected failures, on page 2 of 3 (spec bank-reads, "A failure on a later page fails the whole
  /// read"; D7). The read ends with that failure, no partial list; <see cref="TransactionPages"/> does not ask for page 2
  /// again (a retry, if any, happens below it, in the bank client's HTTP handler: c008 design.md D3), and page 3 is never
  /// asked for.
  /// </param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("bank unavailable")]
  public async Task A_failure_on_a_later_page_ends_the_read_with_that_failure_and_no_further_page_is_requested(string failure) {
    BankResult<EbTransactionPage> failedPage = failure switch {
      "access expired" => new BankAccessExpired(),
      "rate limited" => new BankRateLimited(),
      "bank unavailable" => new BankUnavailable(),
      _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known case."),
    };
    PagesAtBank bank = new(
      firstPage: new([Booked("e-101")], KEY_OF_PAGE_2),
      (KEY_OF_PAGE_2, new([Booked("e-102")], KEY_OF_PAGE_3)),
      (KEY_OF_PAGE_3, new([Booked("e-103")], ContinuationKey: null)));
    bank.Fails(KEY_OF_PAGE_2, failedPage);

    BankResult<JoinedPages> result = await TransactionPages.ReadAll(bank.Read);

    result.Value.ShouldBe(failedPage.Value, "the read is that page's failure, with no partial list");
    bank.KeysAskedFor.ShouldBe([null, KEY_OF_PAGE_2], "nothing is asked for after the failed page");
  }

  // The cap: at most 20 pages (spec bank-reads, "Every page is read"; c006 design.md D4)

  /// <summary>
  /// Every page carries a new key, so the repeated-key check never stops the read; the bank would end a page later, with a
  /// 21st page without a key, so only the cap can. The cap is named by its number; the message quotes nothing from the
  /// pages (c004 design.md D5).
  /// </summary>
  [Test]
  public async Task A_read_whose_20th_page_still_carries_a_key_is_an_error_naming_the_cap_and_no_21st_page_is_requested() {
    PagesAtBank bank = PagesInARow(TransactionPages.MOST_PAGES + 1);

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => TransactionPages.ReadAll(bank.Read));

    // Pages 1 to 20: the first with no key, then each with its own; never the 21st page's key.
    bank.KeysAskedFor.ShouldBe([null, .. Enumerable.Range(2, 19).Select(KeyOfPage)], "no 21st page is requested");
    error.Message.ShouldContain("20");

    string text = error.ToString();

    bank.BankData().ShouldAllBe(value => !text.Contains(value, StringComparison.Ordinal), "the error carries neither a key nor a transaction's data (D5)");
  }

  [Test]
  public async Task A_read_of_exactly_20_pages_the_last_without_a_key_returns_the_transactions_of_every_page() {
    PagesAtBank bank = PagesInARow(20);

    JoinedPages joined = Joined(await TransactionPages.ReadAll(bank.Read));

    joined.Transactions.Select(static transaction => transaction.EntryReference).ShouldBe([.. Enumerable.Range(1, 20).Select(ReferenceOnPage)]);
  }

  /// <summary>The read's value; fails when the read came back as one of the failures instead.</summary>
  private static JoinedPages Joined(BankResult<JoinedPages> result) => result.Value.ShouldBeOfType<JoinedPages>();

  /// <summary>
  /// A bank with <paramref name="pages"/> pages in a row, one transaction each (<see cref="ReferenceOnPage"/>); each page
  /// but the last carries the next page's own key (<see cref="KeyOfPage"/>), the last none.
  /// </summary>
  private static PagesAtBank PagesInARow(int pages) {
    EbTransactionPage Page(int number) => new([Booked(ReferenceOnPage(number))], number == pages ? null : KeyOfPage(number + 1));

    return new(firstPage: Page(1), [.. Enumerable.Range(2, pages - 1).Select(number => (KeyOfPage(number), Page(number)))]);
  }

  /// <summary>The made-up reference of the one transaction on the page with this number: <c>e-001</c>, <c>e-002</c>, …</summary>
  private static string ReferenceOnPage(int number) => $"e-{number:000}";

  /// <summary>The made-up key of the page with this number (2 and up), different for every page.</summary>
  private static string KeyOfPage(int number) => $"ck-page-{number}-b3f0";

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
    RemittanceInformation: ["Pekárna U Lípy"],
    BankTransactionCode: new("CARD_PAYMENT"));

  /// <summary>
  /// The fake bank: the first page for no key, each further page for its key, and a record of the keys asked for, in
  /// order. A key it has no page for, or more requests than a test could need (a loop; the cap's tests set up at most 21
  /// pages), fails the test instead of hanging it.
  /// </summary>
  private sealed class PagesAtBank(EbTransactionPage firstPage, params (string Key, EbTransactionPage Page)[] next) {
    private const int MOST_REQUESTS_A_TEST_NEEDS = 30;

    private readonly List<string?> _keysAskedFor = [];

    private readonly Dictionary<string, BankResult<EbTransactionPage>> _failures = new(StringComparer.Ordinal);

    public IReadOnlyList<string?> KeysAskedFor => _keysAskedFor;

    /// <summary>The page asked for with <paramref name="continuationKey"/> comes back as <paramref name="failure"/> instead, every time.</summary>
    public void Fails(string continuationKey, BankResult<EbTransactionPage> failure) => _failures[continuationKey] = failure;

    public Task<BankResult<EbTransactionPage>> Read(string? continuationKey) {
      _keysAskedFor.Add(continuationKey);

      if (_keysAskedFor.Count > MOST_REQUESTS_A_TEST_NEEDS)
        throw new InvalidOperationException($"More than {MOST_REQUESTS_A_TEST_NEEDS} pages asked for: the read loops.");

      if (continuationKey is not null && _failures.TryGetValue(continuationKey, out BankResult<EbTransactionPage> failure))
        return Task.FromResult(failure);

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