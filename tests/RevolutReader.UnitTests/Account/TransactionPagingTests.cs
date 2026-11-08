using System.Globalization;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The page rules (c010 design.md D1, D3, D10), pure: the newest page's window, where the live read starts, and an older
/// page (whole days from the kept transactions before a day, newest first, added until the page holds at least 30). The
/// days and counts are written out, never computed from the class's own constants: they are the rule the screen and the
/// scenarios count on. Kept transactions are given as the store reads them: newest day first, by position within a day.
/// </summary>
public sealed class TransactionPagingTests {
  /// <summary>The day the older pages here are asked before, unless a test says otherwise.</summary>
  private const string BEFORE = "2026-11-19";

  // An older page (D1, D10)

  /// <summary>
  /// Two days after the given one, the given day itself, and two days before it, few enough that the page takes them all:
  /// only the two days before it, in the order kept (newest day first, by position within a day).
  /// </summary>
  [Test]
  public void An_older_page_holds_only_transactions_dated_before_the_given_day_newest_first() {
    OlderPage page = TransactionPaging.Older(KeptDays(("2026-11-20", 2), ("2026-11-19", 2), ("2026-11-18", 3), ("2026-11-17", 2)), Day(BEFORE));

    page.Transactions.Select(static transaction => transaction.Reference).ShouldBe(["e-1118-0", "e-1118-1", "e-1118-2", "e-1117-0", "e-1117-1"]);
  }

  /// <param name="days">How many are kept on each day before 2026-11-19, newest first.</param>
  /// <param name="pageSize">The page: the whole days, newest first, until it holds at least 30.</param>
  /// <param name="daysOnThePage">How many of those days the page holds.</param>
  [Test]
  [Arguments("10, 15, 10, 10", 35, 3)]
  [Arguments("10, 20, 10", 30, 2)]
  public void An_older_page_adds_whole_days_until_it_holds_at_least_30_transactions(string days, int pageSize, int daysOnThePage) {
    OlderPage page = TransactionPaging.Older(KeptDays(Counts(days)), Day(BEFORE));

    page.ShouldSatisfyAllConditions(
      () => page.Transactions.Count.ShouldBe(pageSize),
      () => page.Transactions.Select(static transaction => transaction.Date).Distinct().ShouldBe(Days(daysOnThePage)));
  }

  /// <param name="days">How many are kept on each day before 2026-11-19, newest first: a busy second day, or one day of 40 on its own.</param>
  /// <param name="pageSize">The page: always whole days, so more than 30.</param>
  [Test]
  [Arguments("25, 20, 5", 45)]
  [Arguments("40, 5", 40)]
  public void A_day_is_never_split_across_pages_even_when_it_makes_the_page_longer_than_30(string days, int pageSize) =>
    TransactionPaging.Older(KeptDays(Counts(days)), Day(BEFORE)).Transactions.Count.ShouldBe(pageSize);

  /// <summary>10, 15, 10 and 10 kept on the four days before 2026-11-19: the page holds three of them, and a fourth is older.</summary>
  [Test]
  public void An_older_page_names_its_oldest_day_when_older_transactions_are_kept() =>
    TransactionPaging.Older(KeptDays(Counts("10, 15, 10, 10")), Day(BEFORE)).OlderBefore.ShouldBe(Day("2026-11-16"));

  // The end of the history (D10)

  /// <param name="days">
  /// How many are kept on each day before 2026-11-19, newest first, and nothing earlier: fewer than 30 in all, or exactly 30
  /// reached on the last kept day. Either way the page holds every one of them, and nothing older is kept.
  /// </param>
  /// <param name="pageSize">The page: all of them.</param>
  [Test]
  [Arguments("10, 15", 25)]
  [Arguments("10, 20", 30)]
  public void An_older_page_with_nothing_older_kept_says_so(string days, int pageSize) {
    OlderPage page = TransactionPaging.Older(KeptDays(Counts(days)), Day(BEFORE));

    page.ShouldSatisfyAllConditions(
      () => page.Transactions.Count.ShouldBe(pageSize),
      () => page.OlderBefore.ShouldBeNull());
  }

  /// <param name="before">The oldest kept day itself (nothing is dated before it), and a day long before every kept one.</param>
  [Test]
  [Arguments("2026-11-17")]
  [Arguments("2026-10-01")]
  public void An_older_page_before_every_kept_day_is_empty_and_says_nothing_older_is_kept(string before) {
    OlderPage page = TransactionPaging.Older(KeptDays(("2026-11-18", 3), ("2026-11-17", 2)), Day(before));

    page.ShouldSatisfyAllConditions(
      () => page.Transactions.ShouldBeEmpty(),
      () => page.OlderBefore.ShouldBeNull());
  }

  /// <param name="today">The scenarios' today, and two whose 31 days back cross a short February and a year's end.</param>
  /// <param name="windowStart">31 days before it: the newest page's first day.</param>
  [Test]
  [Arguments("2026-11-20", "2026-10-20")]
  [Arguments("2026-03-01", "2026-01-29")]
  [Arguments("2027-01-15", "2026-12-15")]
  public void The_window_starts_31_days_before_today(string today, string windowStart) =>
    TransactionPaging.WindowStart(Day(today)).ShouldBe(Day(windowStart));

  /// <param name="newestKeptDay">
  /// Inside the last 31 days of 2026-11-20: yesterday, today itself, and the window's first day, 2026-10-20. The read then
  /// starts where the window does, and there is no gap (D3).
  /// </param>
  [Test]
  [Arguments("2026-11-19")]
  [Arguments("2026-11-20")]
  [Arguments("2026-10-20")]
  public void With_the_newest_kept_day_inside_the_last_31_days_the_read_starts_31_days_before_today(string newestKeptDay) =>
    TransactionPaging.LiveReadStart(Day("2026-11-20"), Day(newestKeptDay)).ShouldBe(new LiveReadStart(Day("2026-10-20"), GapDays: null));

  /// <param name="newestKeptDay">
  /// Earlier than 31 days before 2026-11-20 but not earlier than 89 days: the day before the window's first, the long
  /// pause of the spec's scenario, and exactly 89 days back (2026-08-23). The read starts on that day, read again because
  /// more of its transactions may have settled since, and there is no gap (D3).
  /// </param>
  [Test]
  [Arguments("2026-10-19")]
  [Arguments("2026-09-30")]
  [Arguments("2026-08-23")]
  public void With_the_newest_kept_day_earlier_than_31_days_back_the_read_starts_on_that_day(string newestKeptDay) =>
    TransactionPaging.LiveReadStart(Day("2026-11-20"), Day(newestKeptDay)).ShouldBe(new LiveReadStart(Day(newestKeptDay), GapDays: null));

  /// <param name="newestKeptDay">Earlier than 89 days before 2026-11-20 (2026-08-23): by one day, by three, and by months.</param>
  /// <param name="gapDays">
  /// The gap D3 names, "longer than 89 days": the days from the newest kept day to today. The days the read cannot reach,
  /// and so are lost unless a history file covers them, are those before 2026-08-23 and after the newest kept day.
  /// </param>
  [Test]
  [Arguments("2026-08-22", 90)]
  [Arguments("2026-08-20", 92)]
  [Arguments("2026-05-01", 203)]
  public void With_the_newest_kept_day_earlier_than_89_days_back_the_read_starts_89_days_back_and_reports_the_gaps_days(string newestKeptDay, int gapDays) =>
    TransactionPaging.LiveReadStart(Day("2026-11-20"), Day(newestKeptDay)).ShouldBe(new LiveReadStart(Day("2026-08-23"), gapDays));

  /// <param name="today">The scenarios' today, and two whose 89 days back cross a year's end and a short February.</param>
  /// <param name="readStart">89 days before it: as far back as the bank serves, with no gap reported, since nothing kept is missing (D3).</param>
  [Test]
  [Arguments("2026-11-20", "2026-08-23")]
  [Arguments("2027-01-15", "2026-10-18")]
  [Arguments("2026-03-01", "2025-12-02")]
  public void With_nothing_kept_the_read_starts_89_days_before_today(string today, string readStart) =>
    TransactionPaging.LiveReadStart(Day(today), newestKeptDay: null).ShouldBe(new LiveReadStart(Day(readStart), GapDays: null));

  // What a live read keeps (D5)

  /// <summary>
  /// Five settled transactions over two days, in the bank's order (newest first): each kept with its place within its day,
  /// 0 first, in that order. A kept one carries the bank's values unchanged, its lines too (the line repeating the
  /// counterparty among them): the shown text and the kind are worked out when answering, so a later rule needs no
  /// migration.
  /// </summary>
  [Test]
  public void Settled_transactions_are_kept_with_their_position_within_their_day_in_the_banks_order() {
    BankTransaction withEveryField = new("e-a", TransactionStatus.Booked, Day("2026-11-19"), -12.30m, "EUR", "Pekárna U Lípy", ["Pekárna U Lípy", "Praha 2"], "CARD_PAYMENT");

    ToKeep kept = TransactionPaging.ToKeep([
      withEveryField,
      Booked("e-b", "2026-11-19"),
      Booked("e-c", "2026-11-18"),
      Booked("e-d", "2026-11-18"),
      Booked("e-e", "2026-11-18"),
    ]);

    kept.Transactions.Select(static transaction => (transaction.Reference, transaction.Date, transaction.Position)).ShouldBe([
      ("e-a", Day("2026-11-19"), 0),
      ("e-b", Day("2026-11-19"), 1),
      ("e-c", Day("2026-11-18"), 0),
      ("e-d", Day("2026-11-18"), 1),
      ("e-e", Day("2026-11-18"), 2),
    ]);
    KeptTransaction first = kept.Transactions[0];
    first.ShouldSatisfyAllConditions(
      () => first.Amount.ShouldBe(-12.30m),
      () => first.Currency.ShouldBe("EUR"),
      () => first.Counterparty.ShouldBe("Pekárna U Lípy"),
      () => first.PaymentDetails.ShouldBe(["Pekárna U Lípy", "Praha 2"]),
      () => first.TypeCode.ShouldBe("CARD_PAYMENT"));
  }

  /// <summary>Two settled ones without a reference among three with one: they have no key to be kept by (D5).</summary>
  [Test]
  public void A_settled_transaction_without_a_reference_is_not_kept_and_counted() {
    ToKeep kept = TransactionPaging.ToKeep([
      Booked("e-a", "2026-11-19"),
      Booked(null, "2026-11-19"),
      Booked("e-b", "2026-11-18"),
      Booked(null, "2026-11-17"),
      Booked("e-c", "2026-11-17"),
    ]);

    kept.ShouldSatisfyAllConditions(
      () => kept.Transactions.Select(static transaction => transaction.Reference).ShouldBe(["e-a", "e-b", "e-c"]),
      () => kept.WithoutReference.ShouldBe(2));
  }

  /// <summary>
  /// Pending ones, with a reference and without, among settled ones: only the settled ones are kept (ADR-0001 item 6, D5),
  /// and a pending one without a reference is not counted as a settled one without.
  /// </summary>
  [Test]
  public void A_pending_transaction_is_never_kept() {
    ToKeep kept = TransactionPaging.ToKeep([
      Booked("e-p1", "2026-11-19") with { Status = TransactionStatus.Pending },
      Booked("e-a", "2026-11-19"),
      Booked(null, "2026-11-18") with { Status = TransactionStatus.Pending },
      Booked("e-b", "2026-11-18"),
    ]);

    kept.ShouldSatisfyAllConditions(
      () => kept.Transactions.Select(static transaction => transaction.Reference).ShouldBe(["e-a", "e-b"]),
      () => kept.WithoutReference.ShouldBe(0));
  }

  private static DateOnly Day(string isoDate) => DateOnly.ParseExact(isoDate, "yyyy-MM-dd", CultureInfo.InvariantCulture);

  /// <summary>A booked card payment with this reference (none: <see langword="null"/>) on this day, as the bank's read returns one.</summary>
  private static BankTransaction Booked(string? reference, string day) =>
    new(reference, TransactionStatus.Booked, Day(day), -4.20m, "EUR", "Trafika Můstek", ["Praha 2"], "CARD_PAYMENT");

  /// <summary>The first <paramref name="count"/> days before 2026-11-19, newest first: 2026-11-18, 2026-11-17, …</summary>
  private static DateOnly[] Days(int count) => [.. Enumerable.Range(1, count).Select(back => Day(BEFORE).AddDays(-back))];

  /// <summary>The counts written as "10, 15, 10", for the days before 2026-11-19, newest first.</summary>
  private static (string Day, int Count)[] Counts(string counts) {
    ArgumentNullException.ThrowIfNull(counts);

    return [
      .. counts.Split(',', StringSplitOptions.TrimEntries)
        .Select((count, index) => (Day(BEFORE).AddDays(-(index + 1)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), int.Parse(count, CultureInfo.InvariantCulture))),
    ];
  }

  /// <summary>
  /// The kept transactions of these days, given newest first, as the store reads them: on each day, settled payments at
  /// positions 0, 1, …, each with the reference <c>e-MMdd-position</c> and an amount of its own.
  /// </summary>
  private static KeptTransaction[] KeptDays(params (string Day, int Count)[] days) => [
    .. days.SelectMany(static day => Enumerable.Range(0, day.Count).Select(position => new KeptTransaction(
      Reference: FormattableString.Invariant($"e-{Day(day.Day):MMdd}-{position}"),
      Date: Day(day.Day),
      Position: position,
      Amount: -(1.00m + (position / 100m)),
      Currency: "EUR",
      Counterparty: "Knihkupectví Luxor",
      PaymentDetails: [],
      TypeCode: "CARD_PAYMENT"))),
  ];
}