namespace RevolutReader.Api.Bank;

/// <summary>
/// The answer to <c>GET /accounts/{id}/balances</c> (API reference <c>HalfBalances</c>; Mock ASPSP capture
/// <c>spikes/enable-banking-mock/evidence/2026-11-06-account1-balances.json</c>), with only what the balance selection reads.
/// </summary>
public sealed record EbBalances(IReadOnlyList<EbBalance> Balances);

/// <summary>One balance (API reference <c>BalanceResource</c>): its amount and its type, such as <c>ITAV</c> or <c>CLBD</c>.</summary>
public sealed record EbBalance(EbAmount BalanceAmount, string BalanceType);