namespace RevolutReader.Api.Account;

/// <summary>
/// An older page from the store only (c010 design.md D1, D10); never reads the bank. The store's rows, the page
/// <see cref="TransactionPaging.Older"/> cuts from them before the given day, each kept transaction shown as settled with
/// the bank's text as the app shows it (<see cref="TransactionText"/>, D4b) and its kind (<see cref="TransactionKinds"/>,
/// D4), and the koruna rate with its date. Its type codes are not logged: only the newest page logs them (D4c).
/// </summary>
#pragma warning disable CS9113 // The logger is unused: only the newest page logs type codes (D4c).
public sealed class ReadOlderTransactionsHandler(ITransactionStore store, ILogger<ReadOlderTransactionsHandler> logger) {
#pragma warning restore CS9113
  public async Task<TransactionPage> Handle(DateOnly before, CancellationToken cancellationToken) {
    OlderPage page = TransactionPaging.Older(await store.ReadAll(cancellationToken), before);

    return new TransactionPage([.. page.Transactions.Select(Shown)], page.OlderBefore, KorunaRate.CzkPerEur, KorunaRate.Date);
  }

  /// <summary>A kept transaction as the app shows it: settled, so never pending.</summary>
  private static ShownTransaction Shown(KeptTransaction transaction) => new(
    transaction.Date,
    transaction.Amount,
    transaction.Currency,
    Pending: false,
    transaction.Counterparty,
    TransactionText.Details(transaction.Counterparty, transaction.PaymentDetails),
    TransactionKinds.Of(transaction.TypeCode));
}