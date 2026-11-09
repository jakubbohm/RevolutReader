using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>
/// The newest page (c010 design.md D1, D2, D3, D10): the store's rows; from their newest day, where the live read starts
/// (<see cref="TransactionPaging.LiveReadStart"/>; a gap beyond its reach logged, <see cref="TransactionsLog.HistoryGap"/>);
/// then the bank, read from there as the present user; then its settled transactions kept, every day it read, the days
/// before the window too (<see cref="TransactionPaging.ToKeep"/>, D5; settled ones without a reference logged by count,
/// <see cref="TransactionsLog.SettledWithoutReference"/>); then the live transactions dated from
/// <see cref="TransactionPaging.WindowStart"/> (today being the UTC date of the clock, D3), pending ones included, in the
/// bank's order, each with the bank's text as the app shows it (<see cref="TransactionText"/>, D4b) and its kind
/// (<see cref="TransactionKinds"/>, D4; the page's type codes the app does not know logged once each, D4c), with the koruna
/// rate and its date; <see cref="TransactionPage.OlderBefore"/> is the window's start when a kept transaction is older,
/// counting those this read has just kept. A bank failure comes back as it is, and nothing is kept. The store failing is
/// an exception: the page is not answered without its write (D5).
/// </summary>
public sealed class ReadNewestTransactionsHandler(IBankAccount bank, ITransactionStore store, TimeProvider time, ILogger<ReadNewestTransactionsHandler> logger) {
  public async Task<BankResult<TransactionPage>> Handle(PresentUser user, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);

    DateOnly today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
    DateOnly windowStart = TransactionPaging.WindowStart(today);
    IReadOnlyList<KeptTransaction> kept = await store.ReadAll(cancellationToken);
    BankResult<Transactions> live = await bank.ReadTransactions(LiveReadStartAfter(kept, today), user, cancellationToken);

    return live switch {
      Transactions transactions => await KeptAndShown(transactions.Items, kept, windowStart, cancellationToken),
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

  /// <summary>
  /// The live read's settled transactions kept (D5), a count of those without a reference logged when there are any; then
  /// the page: the live transactions dated from the window's start, in the bank's order, their type codes the app does not
  /// know logged (D4c), and the window's start as OlderBefore when a transaction kept before this read, or by it, is older
  /// (D10).
  /// </summary>
  private async Task<TransactionPage> KeptAndShown(IReadOnlyList<BankTransaction> live, IReadOnlyList<KeptTransaction> keptBefore, DateOnly windowStart, CancellationToken cancellationToken) {
    ToKeep toKeep = TransactionPaging.ToKeep(live);
    await store.Keep(toKeep.Transactions, cancellationToken);

    if (toKeep.WithoutReference > 0)
      TransactionsLog.SettledWithoutReference(logger, toKeep.WithoutReference);

    IReadOnlyList<BankTransaction> onPage = [.. live.Where(transaction => transaction.Date >= windowStart)];
    LogUnknownTypeCodes(onPage);

    return new TransactionPage(
      [.. onPage.Select(Shown)],
      keptBefore.Concat(toKeep.Transactions).Any(transaction => transaction.Date < windowStart) ? windowStart : null,
      KorunaRate.CzkPerEur,
      KorunaRate.Date);
  }

  /// <summary>
  /// The page's type codes the app does not know (<see cref="TransactionKinds.IsKnown"/>), each thing once per page however
  /// many transactions carry it (D4c): each distinct code-shaped code quoted, as a refund code when it contains REFUND, else
  /// as an unknown one; the codes that do not look like one in a single unquoted line; the missing ones in a single line.
  /// </summary>
  private void LogUnknownTypeCodes(IReadOnlyList<BankTransaction> onPage) {
    IReadOnlyList<string?> unknown = [.. onPage.Select(static transaction => transaction.TypeCode).Where(static code => !TransactionKinds.IsKnown(code)).Distinct()];

    foreach (string code in unknown.OfType<string>().Where(TransactionKinds.LooksLikeACode)) {
      if (TransactionKinds.Of(code) == TransactionKind.Refund)
        TransactionsLog.RefundTypeCode(logger, code);
      else
        TransactionsLog.UnknownTypeCode(logger, code);
    }

    if (unknown.OfType<string>().Any(static code => !TransactionKinds.LooksLikeACode(code)))
      TransactionsLog.TypeCodeNotLikeACode(logger);

    if (unknown.Contains(null))
      TransactionsLog.NoTypeCode(logger);
  }

  private static ShownTransaction Shown(BankTransaction transaction) => new(
    transaction.Date,
    transaction.Amount,
    transaction.Currency,
    transaction.Status == TransactionStatus.Pending,
    transaction.Counterparty,
    TransactionText.Details(transaction.Counterparty, transaction.PaymentDetails),
    TransactionKinds.Of(transaction.TypeCode));
}