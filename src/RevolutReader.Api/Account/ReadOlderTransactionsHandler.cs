namespace RevolutReader.Api.Account;

/// <summary>An older page from the store only (c010 design.md D1); never reads the bank. Logs unknown type codes.</summary>
#pragma warning disable CS9113 // A stub until c010 slice 13 writes Handle, which reads both; then this goes.
public sealed class ReadOlderTransactionsHandler(ITransactionStore store, ILogger<ReadOlderTransactionsHandler> logger) {
#pragma warning restore CS9113
  public Task<TransactionPage> Handle(DateOnly before, CancellationToken cancellationToken) => throw new NotImplementedException();
}