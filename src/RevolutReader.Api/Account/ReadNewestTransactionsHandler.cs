using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>
/// The newest page (c010 design.md D1, D2, D10): the store's rows, then the bank, read as the present user, then the live
/// transactions dated from <see cref="TransactionPaging.WindowStart"/> (today being the UTC date of the clock, D3), pending
/// ones included, in the bank's order, with the koruna rate and its date; <see cref="TransactionPage.OlderBefore"/> is the
/// window's start when a kept transaction is older. A bank failure comes back as it is, and nothing is kept.
/// </summary>
#pragma warning disable CS9113 // The logger is read once the logs come (c010 tasks.md, slices 4, 11 and 15); then this goes.
public sealed class ReadNewestTransactionsHandler(IBankAccount bank, ITransactionStore store, TimeProvider time, ILogger<ReadNewestTransactionsHandler> logger) {
#pragma warning restore CS9113
  public async Task<BankResult<TransactionPage>> Handle(PresentUser user, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);

    DateOnly windowStart = TransactionPaging.WindowStart(DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime));
    IReadOnlyList<KeptTransaction> kept = await store.ReadAll(cancellationToken);

    // From the window's start for now: TransactionPaging.LiveReadStart takes over with slices 10 to 12.
    BankResult<Transactions> live = await bank.ReadTransactions(windowStart, user, cancellationToken);

    // Nothing is kept yet: TransactionPaging.ToKeep and the store's Keep come with slice 15.
    return live switch {
      Transactions transactions => NewestPage(transactions.Items, kept, windowStart),
      BankAccessExpired expired => expired,
      BankRateLimited rateLimited => rateLimited,
      BankUnavailable unavailable => unavailable,
    };
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
    // The bank's lines unchanged for now: TransactionText.Details cuts them with slice 3.
    transaction.PaymentDetails,
    // Other for now: TransactionKinds.Of names the kind with slice 4.
    TransactionKind.Other);
}