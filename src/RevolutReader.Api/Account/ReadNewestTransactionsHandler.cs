using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>
/// The newest page (c010 design.md D1–D5): the store's rows → LiveReadStart → the bank, as the present user → keeps ToKeep
/// → the live transactions dated from WindowStart, shown; OlderBefore = WindowStart when a kept one is older. Bank
/// failures pass through; nothing is kept then. Logs: a gap beyond 89 days, settled ones without a reference, unknown type
/// codes.
/// </summary>
#pragma warning disable CS9113 // A stub until Handle is written (c010 tasks.md group 8 and on), which reads them all; then this goes.
public sealed class ReadNewestTransactionsHandler(IBankAccount bank, ITransactionStore store, TimeProvider time, ILogger<ReadNewestTransactionsHandler> logger) {
#pragma warning restore CS9113
  public Task<BankResult<TransactionPage>> Handle(PresentUser user, CancellationToken cancellationToken) => throw new NotImplementedException();
}