using RevolutReader.Api.Rate;

namespace RevolutReader.Api.Account;

/// <summary>
/// An older page from the store only (c010 design.md D1, D10); never reads the bank. The store's rows, the page
/// <see cref="TransactionPaging.Older"/> cuts from them before the given day, each kept transaction shown as settled with
/// the bank's text as the app shows it (<see cref="TransactionText"/>, D4b) and its kind (<see cref="TransactionKinds"/>,
/// D4), and the koruna rate with its date. Its type codes are not logged: only the newest page logs them (D4c).
/// </summary>
public sealed class ReadOlderTransactionsHandler(ITransactionStore store) {
  /// <summary>
  /// The handler with the rates its page carries (c017 design.md D8). A compile-only stub until tasks.md 9.1, which makes
  /// this the only constructor and puts the rate and the day <paramref name="rates"/> answers on the page; until then the
  /// page carries <see cref="KorunaRate.CzkPerEur"/> and <see cref="KorunaRate.Date"/> as before.
  /// </summary>
  public ReadOlderTransactionsHandler(ITransactionStore store, IKorunaRates rates) : this(store) {
  }

  public async Task<TransactionPage> Handle(DateOnly before, CancellationToken cancellationToken) {
    OlderPage page = TransactionPaging.Older(await store.ReadAll(cancellationToken), before);

    return new TransactionPage([.. page.Transactions.Select(Shown)], page.OlderBefore, KorunaRate.CzkPerEur, KorunaRate.Date);
  }

  /// <summary>A kept transaction as the app shows it: settled, so never pending.</summary>
  private static ShownTransaction Shown(KeptTransaction transaction) => ShownTransaction.Of(
    transaction.Date,
    transaction.Amount,
    transaction.Currency,
    pending: false,
    transaction.Counterparty,
    transaction.PaymentDetails,
    transaction.TypeCode);
}