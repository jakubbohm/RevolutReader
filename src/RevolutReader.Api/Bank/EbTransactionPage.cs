namespace RevolutReader.Api.Bank;

/// <summary>
/// One page of the answer to <c>GET /accounts/{id}/transactions</c> (API reference <c>HalfTransactions</c>; Mock ASPSP
/// capture <c>spikes/enable-banking-mock/evidence/2026-11-06-account1-transactions.json</c>, whose list holds one page),
/// with only what the read uses.
/// </summary>
/// <param name="Transactions">The page's transactions, in the bank's order.</param>
/// <param name="ContinuationKey">The key of the next page; <see langword="null"/> on the last (c004 design.md § Bootstrap, D7).</param>
public sealed record EbTransactionPage(IReadOnlyList<EbTransaction> Transactions, string? ContinuationKey);