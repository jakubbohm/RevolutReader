using RevolutReader.Api.Bank;
using RevolutReader.Api.Rate;

namespace RevolutReader.Api.Account;

/// <summary>
/// The newest page (c010 design.md D1, D2, D3, D10): the store's rows; from their newest day, where the live read starts
/// (<see cref="TransactionPaging.LiveReadStart"/>; a gap beyond its reach logged, <see cref="TransactionsLog.HistoryGap"/>);
/// then the bank, read from there as the present user; then its settled transactions kept, every day it read, the days
/// before the window too (<see cref="TransactionPaging.ToKeep"/>, D5; settled ones without a reference logged by count,
/// <see cref="TransactionsLog.SettledWithoutReference"/>); then the live transactions dated from
/// <see cref="TransactionPaging.WindowStart"/> (today being the UTC date of the clock, D3), pending ones included, newest
/// day first and in the bank's order within a day, each with the bank's text as the app shows it
/// (<see cref="TransactionText"/>, D4b) and its kind (<see cref="TransactionKinds"/>, D4; the page's type codes the app
/// does not know logged once each, D4c), with the koruna rate and its date; <see cref="TransactionPage.OlderBefore"/> is
/// the window's start when a kept transaction is older, counting those this read has just kept. The rate is the one
/// <see cref="IKorunaRates"/> answers, asked first and awaited last, so it runs alongside the store and the bank, and
/// awaited whatever the bank answers (c017 design.md D4, D8). A bank failure comes back as it is, and nothing is kept. The
/// store failing is an exception: the page is not answered without its write (D5).
/// <para>
/// Each transaction's first-seen time (c018 design.md D1, D2, D8): right after the bank's answer, the read's moment
/// (<see cref="FirstSeenRule.ReadAt"/> of the clock); the read recorded and its kept moments read through
/// <see cref="FirstSeenTimes.Record"/>; each shown transaction's <see cref="ShownTransaction.SeenAt"/> is
/// <see cref="FirstSeenRule.Shown"/> of its kept moment. A bank failure records nothing; the first-seen store failing is
/// an exception, so the page is not answered without its record (D8).
/// </para>
/// </summary>
public sealed class ReadNewestTransactionsHandler(
  IBankAccount bank,
  ITransactionStore store,
  FirstSeenTimes firstSeen,
  IKorunaRates rates,
  TimeProvider time,
  ILogger<ReadNewestTransactionsHandler> logger) {
  public async Task<BankResult<TransactionPage>> Handle(PresentUser user, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);

    Task<KorunaRate> rate = rates.Current(cancellationToken);
    DateOnly today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
    DateOnly windowStart = TransactionPaging.WindowStart(today);
    IReadOnlyList<KeptTransaction> kept = await store.ReadAll(cancellationToken);
    BankResult<Transactions> live = await bank.ReadTransactions(LiveReadStartAfter(kept, today), user, cancellationToken);

    BankResult<TransactionPage> result = live switch {
      Transactions transactions => await KeptAndShown(transactions.Items, FirstSeenRule.ReadAt(time.GetUtcNow()), kept, windowStart, rate, cancellationToken),
      BankAccessExpired expired => expired,
      BankRateLimited rateLimited => rateLimited,
      BankUnavailable unavailable => unavailable,
    };

    // A bank failure answers only once the rate it asked has come, as a page does (D8).
    _ = await rate;

    return result;
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
  /// The live read's settled transactions kept (D5), a count of those without a reference logged when there are any; the
  /// read recorded at <paramref name="readAt"/>, the moment the bank answered (c018 design.md D1); then the page, each
  /// transaction with its first-seen time: the live transactions dated from the window's start, newest day first and in the bank's order within a day,
  /// their type codes the app does not know logged (D4c), and the window's start as OlderBefore when a transaction kept before this read, or by it, is older
  /// (D10); with <paramref name="rate"/>'s rate and day, awaited last (c017 design.md D4).
  /// </summary>
  private async Task<TransactionPage> KeptAndShown(
    IReadOnlyList<BankTransaction> live,
    DateTimeOffset readAt,
    IReadOnlyList<KeptTransaction> keptBefore,
    DateOnly windowStart,
    Task<KorunaRate> rate,
    CancellationToken cancellationToken) {
    ToKeep toKeep = TransactionPaging.ToKeep(live);
    await store.Keep(toKeep.Transactions, cancellationToken);

    if (toKeep.WithoutReference > 0)
      TransactionsLog.SettledWithoutReference(logger, toKeep.WithoutReference);

    IReadOnlyDictionary<string, DateTimeOffset> seen = await firstSeen.Record(live, readAt, cancellationToken);
    IReadOnlyList<BankTransaction> onPage = [.. live.Where(transaction => transaction.Date >= windowStart)];
    LogUnknownTypeCodes(onPage);
    KorunaRate koruna = await rate;

    // Newest day first: the bank's order across days is not guaranteed (pending ones can come after the booked ones).
    // OrderByDescending is a stable sort, so the bank's order within a day is kept.
    return new TransactionPage(
      [.. onPage.OrderByDescending(static transaction => transaction.Date).Select(transaction => Shown(transaction, seen))],
      keptBefore.Concat(toKeep.Transactions).Any(transaction => transaction.Date < windowStart) ? windowStart : null,
      koruna.CzkPerEur,
      koruna.Date);
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

  /// <summary>
  /// A live transaction as the app shows it: pending when the bank has not settled it, seen at the moment
  /// <paramref name="seen"/> keeps for its reference as <see cref="FirstSeenRule.Shown"/> answers it.
  /// </summary>
  private static ShownTransaction Shown(BankTransaction transaction, IReadOnlyDictionary<string, DateTimeOffset> seen) => ShownTransaction.Of(
    transaction.Date,
    transaction.Amount,
    transaction.Currency,
    transaction.Status == TransactionStatus.Pending,
    transaction.Counterparty,
    transaction.PaymentDetails,
    transaction.TypeCode,
    FirstSeenRule.Shown(transaction.Date, transaction.Reference is { } reference && seen.TryGetValue(reference, out DateTimeOffset at) ? at : null));
}