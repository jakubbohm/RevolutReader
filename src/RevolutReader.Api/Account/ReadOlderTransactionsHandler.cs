using RevolutReader.Api.Rate;

namespace RevolutReader.Api.Account;

/// <summary>
/// An older page from the stores only (c010 design.md D1, D10); never reads the bank. The store's rows, the page
/// <see cref="TransactionPaging.Older"/> cuts from them before the given day, each kept transaction shown as settled with
/// the bank's text as the app shows it (<see cref="TransactionText"/>, D4b), its kind (<see cref="TransactionKinds"/>,
/// D4) and its first-seen time: the moment <see cref="IFirstSeenStore"/> keeps for its reference, read once for the
/// page's references after the page is cut, as <see cref="FirstSeenRule.Shown"/> answers it (c018 design.md D2, D9); a
/// first-seen store failure throws (D8). The koruna rate with its date as <see cref="IKorunaRates"/> answers them, asked
/// before the stores are read and awaited after them, so they run alongside (c017 design.md D4, D8). Its type codes are
/// not logged: only the newest page logs them (D4c).
/// </summary>
public sealed class ReadOlderTransactionsHandler(ITransactionStore store, IFirstSeenStore firstSeen, IKorunaRates rates) {
  public async Task<TransactionPage> Handle(DateOnly before, CancellationToken cancellationToken) {
    Task<KorunaRate> rate = rates.Current(cancellationToken);
    OlderPage page = TransactionPaging.Older(await store.ReadAll(cancellationToken), before);
    IReadOnlyDictionary<string, DateTimeOffset> seen = await firstSeen.Read(
      [.. page.Transactions.Select(static transaction => transaction.Reference).Distinct(StringComparer.Ordinal)],
      cancellationToken);
    KorunaRate koruna = await rate;

    return new TransactionPage([.. page.Transactions.Select(transaction => Shown(transaction, seen))], page.OlderBefore, koruna.CzkPerEur, koruna.Date);
  }

  /// <summary>A kept transaction as the app shows it: settled, so never pending, with its kept first-seen time if shown.</summary>
  private static ShownTransaction Shown(KeptTransaction transaction, IReadOnlyDictionary<string, DateTimeOffset> seen) => ShownTransaction.Of(
    transaction.Date,
    transaction.Amount,
    transaction.Currency,
    pending: false,
    transaction.Counterparty,
    transaction.PaymentDetails,
    transaction.TypeCode,
    seenAt: FirstSeenRule.Shown(transaction.Date, seen.TryGetValue(transaction.Reference, out DateTimeOffset at) ? at : null));
}