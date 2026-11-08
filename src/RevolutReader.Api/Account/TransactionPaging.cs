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
  /// today.
  /// </summary>
  public static LiveReadStart LiveReadStart(DateOnly today, DateOnly? newestKeptDay) {
    DateOnly windowStart = WindowStart(today);

    // Nothing kept reads from the window's start for now: slice 12 makes it MOST_DAYS_BACK.
    if (newestKeptDay is not DateOnly newest || newest >= windowStart)
      return new(windowStart, GapDays: null);

    DateOnly mostDaysBack = today.AddDays(-MOST_DAYS_BACK);

    return newest >= mostDaysBack
      ? new(newest, GapDays: null)
      : new(mostDaysBack, GapDays: today.DayNumber - newest.DayNumber);
  }

  /// <summary>
  /// Settled ones with a reference, each with its position within its day in the given order; pending ones and those
  /// without a reference left out (the latter counted).
  /// </summary>
  public static ToKeep ToKeep(IReadOnlyList<BankTransaction> live) => throw new NotImplementedException();

  /// <summary>Whole days before <paramref name="before"/>, newest first, until at least <see cref="PAGE_SIZE"/>; OlderBefore as D10.</summary>
  public static OlderPage Older(IReadOnlyList<KeptTransaction> allNewestFirst, DateOnly before) => throw new NotImplementedException();
}

/// <summary>Where the live read starts, and the gap's days when the newest kept day is beyond <see cref="TransactionPaging.MOST_DAYS_BACK"/> days.</summary>
public sealed record LiveReadStart(DateOnly From, int? GapDays);

/// <summary>The settled transactions to keep, and how many settled ones had no reference.</summary>
public sealed record ToKeep(IReadOnlyList<KeptTransaction> Transactions, int WithoutReference);

/// <summary>An older page's kept transactions, and the day before which older ones are kept (none: <see langword="null"/>).</summary>
public sealed record OlderPage(IReadOnlyList<KeptTransaction> Transactions, DateOnly? OlderBefore);