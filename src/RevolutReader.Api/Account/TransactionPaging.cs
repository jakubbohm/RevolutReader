using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>The page rules (c010 design.md D1, D3), pure. Not the adapter's <see cref="TransactionPages"/>.</summary>
public static class TransactionPaging {
  public const int WINDOW_DAYS = 31;
  public const int MOST_DAYS_BACK = 89;
  public const int PAGE_SIZE = 30;

  /// <summary>The first day of the newest page: <see cref="WINDOW_DAYS"/> days before <paramref name="today"/>.</summary>
  public static DateOnly WindowStart(DateOnly today) => today.AddDays(-WINDOW_DAYS);

  /// <summary>
  /// Where the live read starts (D3): the earlier of the window's start and the newest kept day, which is read again since
  /// more of its transactions may have settled; never earlier than <see cref="MOST_DAYS_BACK"/> days before
  /// <paramref name="today"/>. A newest kept day earlier than that is a gap: the read starts <see cref="MOST_DAYS_BACK"/>
  /// days back, and <see cref="Account.LiveReadStart.GapDays"/> holds the gap's length, the days from the newest kept day to
  /// today. With nothing kept, the read starts <see cref="MOST_DAYS_BACK"/> days back, keeping as much as the bank serves,
  /// and there is no gap: nothing kept is missing.
  /// </summary>
  public static LiveReadStart LiveReadStart(DateOnly today, DateOnly? newestKeptDay) {
    DateOnly windowStart = WindowStart(today);
    DateOnly mostDaysBack = today.AddDays(-MOST_DAYS_BACK);

    if (newestKeptDay is not DateOnly newest)
      return new(mostDaysBack, GapDays: null);

    if (newest >= windowStart)
      return new(windowStart, GapDays: null);

    return newest >= mostDaysBack
      ? new(newest, GapDays: null)
      : new(mostDaysBack, GapDays: today.DayNumber - newest.DayNumber);
  }

  /// <summary>
  /// Settled ones with a reference, each with its position within its day in the given order; pending ones and those
  /// without a reference left out (the latter counted). What D5 keeps: the bank's values unchanged, the lines too, so the
  /// shown text and the kind are worked out when answering. Pending ones are never kept (ADR-0001 item 6). The positions
  /// count the kept ones only, 0 first on each day, so a pending or reference-less one between them leaves no gap.
  /// </summary>
  public static ToKeep ToKeep(IReadOnlyList<BankTransaction> live) {
    ArgumentNullException.ThrowIfNull(live);

    List<KeptTransaction> kept = [];
    Dictionary<DateOnly, int> nextPositionOn = [];
    int withoutReference = 0;

    foreach (BankTransaction transaction in live) {
      if (transaction.Status != TransactionStatus.Booked)
        continue;

      if (transaction.Reference is not string reference) {
        withoutReference++;

        continue;
      }

      int position = nextPositionOn.GetValueOrDefault(transaction.Date);
      nextPositionOn[transaction.Date] = position + 1;

      kept.Add(new KeptTransaction(
        reference,
        transaction.Date,
        position,
        transaction.Amount,
        transaction.Currency,
        transaction.Counterparty,
        transaction.PaymentDetails,
        transaction.TypeCode));
    }

    return new ToKeep(kept, withoutReference);
  }

  /// <summary>
  /// An older page (D1): the kept transactions dated before <paramref name="before"/>, in the order given (newest day
  /// first, by position within a day, as the store reads them), whole days added until the page holds at least
  /// <see cref="PAGE_SIZE"/> or nothing older is left; a day is never split, so a busy day makes the page longer.
  /// <see cref="OlderPage.OlderBefore"/> is the page's oldest day while something older is kept, and
  /// <see langword="null"/> where the history ends: nothing older left, or nothing on the page at all (D10).
  /// </summary>
  public static OlderPage Older(IReadOnlyList<KeptTransaction> allNewestFirst, DateOnly before) {
    ArgumentNullException.ThrowIfNull(allNewestFirst);

    List<KeptTransaction> page = [];
    bool olderKept = false;

    foreach (IGrouping<DateOnly, KeptTransaction> day in allNewestFirst.Where(transaction => transaction.Date < before).GroupBy(static transaction => transaction.Date)) {
      if (page.Count >= PAGE_SIZE) {
        olderKept = true;

        break;
      }

      page.AddRange(day);
    }

    return new OlderPage(page, olderKept ? page[^1].Date : null);
  }
}

/// <summary>Where the live read starts, and the gap's days when the newest kept day is beyond <see cref="TransactionPaging.MOST_DAYS_BACK"/> days.</summary>
public sealed record LiveReadStart(DateOnly From, int? GapDays);

/// <summary>The settled transactions to keep, and how many settled ones had no reference.</summary>
public sealed record ToKeep(IReadOnlyList<KeptTransaction> Transactions, int WithoutReference);

/// <summary>An older page's kept transactions, and the day before which older ones are kept (none: <see langword="null"/>).</summary>
public sealed record OlderPage(IReadOnlyList<KeptTransaction> Transactions, DateOnly? OlderBefore);