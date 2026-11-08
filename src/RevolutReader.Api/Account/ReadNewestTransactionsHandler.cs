using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>
/// The newest page (c010 design.md D1, D2, D3, D10): the store's rows; from their newest day, where the live read starts
/// (<see cref="TransactionPaging.LiveReadStart"/>; a gap beyond its reach logged, <see cref="TransactionsLog.HistoryGap"/>);
/// then the bank, read from there as the present user; then the live transactions dated from
/// <see cref="TransactionPaging.WindowStart"/> (today being the UTC date of the clock, D3), pending ones included, in the
/// bank's order, each with the bank's text as the app shows it (<see cref="TransactionText"/>, D4b), with the koruna rate
/// and its date; <see cref="TransactionPage.OlderBefore"/> is the window's start when a kept transaction is older. A bank
/// failure comes back as it is, and nothing is kept.
/// </summary>
public sealed class ReadNewestTransactionsHandler(IBankAccount bank, ITransactionStore store, TimeProvider time, ILogger<ReadNewestTransactionsHandler> logger) {
  public async Task<BankResult<TransactionPage>> Handle(PresentUser user, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);

    DateOnly today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
    DateOnly windowStart = TransactionPaging.WindowStart(today);
    IReadOnlyList<KeptTransaction> kept = await store.ReadAll(cancellationToken);
    BankResult<Transactions> live = await bank.ReadTransactions(LiveReadStartAfter(kept, today), user, cancellationToken);

    // Nothing is kept yet: TransactionPaging.ToKeep and the store's Keep come with slice 15.
    return live switch {
      Transactions transactions => NewestPage(transactions.Items, kept, windowStart),
      BankAccessExpired expired => expired,
      BankRateLimited rateLimited => rateLimited,
      BankUnavailable unavailable => unavailable,
    };
  }

  /// <summary>
  /// The day the live read starts from, after these kept transactions (<see cref="TransactionPaging.LiveReadStart"/> from
  /// their newest day, none when nothing is kept); a gap beyond its reach is logged with its days (D3).
  /// </summary>
  private DateOnly LiveReadStartAfter(IReadOnlyList<KeptTransaction> kept, DateOnly today) {
    LiveReadStart start = TransactionPaging.LiveReadStart(today, kept.Count == 0 ? null : kept.Max(static transaction => transaction.Date));

    if (start.GapDays is int gapDays)
      TransactionsLog.HistoryGap(logger, gapDays);

    return start.From;
  }

  /// <summary>The live transactions dated from the window's start, in the bank's order; the window's start as OlderBefore when a kept one is older (D10).</summary>
  private static TransactionPage NewestPage(IReadOnlyList<BankTransaction> live, IReadOnlyList<KeptTransaction> kept, DateOnly windowStart) => new(
    [.. live.Where(transaction => transaction.Date >= windowStart).Select(Shown)],
    kept.Any(transaction => transaction.Date < windowStart) ? windowStart : null,
    KorunaRate.CzkPerEur,
    KorunaRate.Date);

  private static ShownTransaction Shown(BankTransaction transaction) => new(
    transaction.Date,
    transaction.Amount,
    transaction.Currency,
    transaction.Status == TransactionStatus.Pending,
    transaction.Counterparty,
    TransactionText.Details(transaction.Counterparty, transaction.PaymentDetails),
    // Other for now: TransactionKinds.Of names the kind with slice 4.
    TransactionKind.Other);
}