using RevolutReader.Api.Rate;

namespace RevolutReader.Api.Account;

// c018 group 18's stub: firstSeen is read in group 19's wiring (D9), which removes this pragma.
#pragma warning disable CS9113
/// <summary>
/// An older page from the store only (c010 design.md D1, D10); never reads the bank. The store's rows, the page
/// <see cref="TransactionPaging.Older"/> cuts from them before the given day, each kept transaction shown as settled with
/// the bank's text as the app shows it (<see cref="TransactionText"/>, D4b) and its kind (<see cref="TransactionKinds"/>,
/// D4), and the koruna rate with its date as <see cref="IKorunaRates"/> answers them, asked before the store is read and
/// awaited after it, so the two run alongside (c017 design.md D4, D8). Its type codes are not logged: only the newest page
/// logs them (D4c).
/// </summary>
public sealed class ReadOlderTransactionsHandler(ITransactionStore store, IFirstSeenStore firstSeen, IKorunaRates rates) {
#pragma warning restore CS9113
  public async Task<TransactionPage> Handle(DateOnly before, CancellationToken cancellationToken) {
    Task<KorunaRate> rate = rates.Current(cancellationToken);
    OlderPage page = TransactionPaging.Older(await store.ReadAll(cancellationToken), before);
    KorunaRate koruna = await rate;

    return new TransactionPage([.. page.Transactions.Select(Shown)], page.OlderBefore, koruna.CzkPerEur, koruna.Date);
  }

  /// <summary>A kept transaction as the app shows it: settled, so never pending.</summary>
  private static ShownTransaction Shown(KeptTransaction transaction) => ShownTransaction.Of(
    transaction.Date,
    transaction.Amount,
    transaction.Currency,
    pending: false,
    transaction.Counterparty,
    transaction.PaymentDetails,
    transaction.TypeCode,
    seenAt: null);
}